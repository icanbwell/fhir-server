'use strict';

const { describe, test, beforeEach, expect, jest: jestGlobal } = require('@jest/globals');
const { FhirDataSource } = require('../../../graphqlv2/dataSource');

function createPrototypedMock(RealClass) {
    return Object.create(RealClass.prototype);
}

function defineGetter(obj, prop, value) {
    Object.defineProperty(obj, prop, { get: () => value, configurable: true });
}

const { R4ArgsParser } = require('../../../operations/query/r4ArgsParser');
const { QueryRewriterManager } = require('../../../queryRewriters/queryRewriterManager');
const { ConfigManager } = require('../../../utils/configManager');
const { SearchBundleOperation } = require('../../../operations/search/searchBundle');
const { PatientDataViewControlManager } = require('../../../utils/patientDataViewController');
const { CustomTracer } = require('../../../utils/customTracer');
const { PatientScopeManager } = require('../../../operations/security/patientScopeManager');
const { OperationAccessManager } = require('../../../utils/operationAccessManager');

function createDataSource(overrides = {}) {
    const requestInfo = overrides.requestInfo || { requestId: 'req-1', headers: {}, isUser: false };
    const searchBundleOperation = createPrototypedMock(SearchBundleOperation);
    searchBundleOperation.searchBundleAsync = jestGlobal.fn().mockResolvedValue({
        entry: [{ resource: { resourceType: 'Patient', id: 'p1', _uuid: 'u1', _sourceId: 'p1' } }],
        meta: { tag: [{ system: 'https://www.icanbwell.com/query', code: '{}', display: '{}' }] }
    });
    const r4ArgsParser = createPrototypedMock(R4ArgsParser);
    r4ArgsParser.parseArgs = jestGlobal.fn().mockReturnValue({ headers: null, add: jestGlobal.fn() });
    const queryRewriterManager = createPrototypedMock(QueryRewriterManager);
    queryRewriterManager.rewriteArgsAsync = jestGlobal.fn().mockImplementation(async ({ parsedArgs }) => parsedArgs);
    const configManager = createPrototypedMock(ConfigManager);
    defineGetter(configManager, 'graphQLFetchResourceBatchSize', 100);
    defineGetter(configManager, 'enableMongoProjectionsInGraphQLv2', false);
    const patientDataViewControlManager = createPrototypedMock(PatientDataViewControlManager);
    const customTracer = createPrototypedMock(CustomTracer);
    customTracer.trace = jestGlobal.fn().mockImplementation(async ({ func }) => await func());
    const patientScopeManager = createPrototypedMock(PatientScopeManager);
    const accessManager = overrides.accessManager || createPrototypedMock(OperationAccessManager);
    if (!overrides.accessManager) {
        accessManager.verifyGraphQLReadAccess = jestGlobal.fn();
    }

    return new FhirDataSource({
        requestInfo,
        searchBundleOperation,
        r4ArgsParser,
        queryRewriterManager,
        configManager,
        patientDataViewControlManager,
        customTracer,
        patientScopeManager,
        accessManager
    });
}

describe('FhirDataSource (graphqlv2)', () => {
    let dataSource;

    beforeEach(() => {
        dataSource = createDataSource();
    });

    describe('unBundle', () => {
        test('returns resources from bundle entries', () => {
            const bundle = {
                entry: [
                    { resource: { resourceType: 'Patient', id: 'p1' } },
                    { resource: { resourceType: 'Patient', id: 'p2' } }
                ],
                meta: { tag: [{ system: 'sys', code: 'code1', display: 'disp1' }] }
            };
            const result = dataSource.unBundle(bundle);
            expect(result.length).toBe(2);
            expect(result[0].id).toBe('p1');
        });

        test('returns empty array for bundle with no entries', () => {
            const bundle = { meta: { tag: [] } };
            const result = dataSource.unBundle(bundle);
            expect(result).toEqual([]);
        });

        test('accumulates meta from multiple bundles', () => {
            dataSource.unBundle({ entry: [], meta: { tag: [{ system: 's1', code: 'c1', display: 'd1' }] } });
            dataSource.unBundle({ entry: [], meta: { tag: [{ system: 's2', code: 'c2', display: 'd2' }] } });
            expect(dataSource.metaList.length).toBe(2);
        });
    });

    describe('reorderResources', () => {
        test('orders resources by keys, filling nulls for missing', async () => {
            const resources = [
                { resourceType: 'Patient', _uuid: 'u2', _sourceId: 'p2', id: 'p2' },
                { resourceType: 'Patient', _uuid: 'u1', _sourceId: 'p1', id: 'p1' }
            ];
            const keys = ['Patient/u1', 'Patient/u2', 'Patient/u3'];
            const result = await dataSource.reorderResources(resources, keys);
            expect(result[0]._uuid).toBe('u1');
            expect(result[1]._uuid).toBe('u2');
            expect(result[2]).toBeNull();
        });

        test('0 keys returns empty array', async () => {
            const result = await dataSource.reorderResources([], []);
            expect(result).toEqual([]);
        });
    });

    describe('resolveType', () => {
        test('returns resourceType for single object', () => {
            expect(dataSource.resolveType({ resourceType: 'Patient' }, {}, {})).toBe('Patient');
        });

        test('returns first resourceType for array', () => {
            const arr = [{ resourceType: 'Observation' }, { resourceType: 'Patient' }];
            expect(dataSource.resolveType(arr, {}, {})).toBe('Observation');
        });

        test('returns null for empty array', () => {
            expect(dataSource.resolveType([], {}, {})).toBeNull();
        });
    });

    describe('findResourceByReference', () => {
        test('returns null for null reference', async () => {
            const result = await dataSource.findResourceByReference(null, {}, {}, { fieldNodes: [{ selectionSet: { selections: [] } }] }, null);
            expect(result).toBeNull();
        });

        test('returns null for reference without reference field', async () => {
            const result = await dataSource.findResourceByReference(
                null, {}, {}, { fieldNodes: [{ selectionSet: { selections: [] } }] },
                { type: 'Patient' }
            );
            expect(result).toBeNull();
        });

        test('returns null for invalid resourceType in reference', async () => {
            const result = await dataSource.findResourceByReference(
                { resourceType: 'Parent', id: 'x' }, {},
                {},
                { fieldNodes: [{ selectionSet: { selections: [] } }] },
                { reference: 'InvalidType/123' }
            );
            expect(result).toBeNull();
        });
    });

    describe('getBundleMeta', () => {
        test('returns null with empty metaList', () => {
            expect(dataSource.getBundleMeta()).toBeNull();
        });

        test('combines meta tags from multiple entries', () => {
            dataSource.metaList = [
                { tag: [{ system: 'sys', code: 'a', display: 'x' }] },
                { tag: [{ system: 'sys', code: 'b', display: 'y' }] }
            ];
            const combined = dataSource.getBundleMeta();
            expect(combined.tag.length).toBe(1);
            expect(combined.tag[0].code).toContain('a');
            expect(combined.tag[0].code).toContain('b');
            expect(combined.tag[0].display).toContain('x');
            expect(combined.tag[0].display).toContain('y');
        });

        test('different systems kept separate', () => {
            dataSource.metaList = [
                { tag: [{ system: 's1', code: 'a', display: 'x' }] },
                { tag: [{ system: 's2', code: 'b', display: 'y' }] }
            ];
            const combined = dataSource.getBundleMeta();
            expect(combined.tag.length).toBe(2);
        });
    });

    describe('createDataLoader', () => {
        test('lazy init creates dataLoader once', () => {
            dataSource.createDataLoader({ _debug: false });
            const loader1 = dataSource.dataLoader;
            dataSource.createDataLoader({ _debug: false });
            expect(dataSource.dataLoader).toBe(loader1);
        });

        test('sets debugMode when _debug is true', () => {
            dataSource.createDataLoader({ _debug: true });
            expect(dataSource.debugMode).toBe(true);
        });
    });

    describe('getResources (DCON-4846)', () => {
        test('checks operation access before executing the search', async () => {
            const context = { fhirRequestInfo: { user: 'test', scope: 'access/tenant_a.*' } };
            await dataSource.getResources(null, {}, context, {}, 'Patient');

            expect(dataSource.accessManager.verifyGraphQLReadAccess).toHaveBeenCalledWith({
                requestInfo: context.fhirRequestInfo,
                resourceType: 'Patient',
                operation: 'search'
            });
        });

        test('does not execute the search when access is denied', async () => {
            const forbiddenError = new Error('CMS partner user does not have access to Practitioner search');
            dataSource.accessManager.verifyGraphQLReadAccess.mockImplementation(() => { throw forbiddenError; });
            const context = { fhirRequestInfo: { user: 'test', scope: 'access/tenant_a.*' } };

            await expect(
                dataSource.getResources(null, {}, context, {}, 'Practitioner')
            ).rejects.toThrow(forbiddenError.message);

            expect(dataSource.searchBundleOperation.searchBundleAsync).not.toHaveBeenCalled();
        });
    });

    describe('getResourcesBundle (DCON-4846)', () => {
        test('checks operation access before executing the search', async () => {
            const context = { fhirRequestInfo: { user: 'test', scope: 'access/tenant_a.*' }, req: {} };
            await dataSource.getResourcesBundle(null, {}, context, {}, 'Patient');

            expect(dataSource.accessManager.verifyGraphQLReadAccess).toHaveBeenCalledWith({
                requestInfo: context.fhirRequestInfo,
                resourceType: 'Patient',
                operation: 'search'
            });
        });

        test('does not execute the search when access is denied', async () => {
            const forbiddenError = new Error('CMS partner user does not have access to Practitioner search');
            dataSource.accessManager.verifyGraphQLReadAccess.mockImplementation(() => { throw forbiddenError; });
            const context = { fhirRequestInfo: { user: 'test', scope: 'access/tenant_a.*' }, req: {} };

            await expect(
                dataSource.getResourcesBundle(null, {}, context, {}, 'Practitioner')
            ).rejects.toThrow(forbiddenError.message);

            expect(dataSource.searchBundleOperation.searchBundleAsync).not.toHaveBeenCalled();
        });
    });

    describe('extractFieldsForResource', () => {
        test('SEC-1585: forces extension into the Subscription projection even when not requested', () => {
            dataSource.resourceProjections = {};
            dataSource.extractFieldsForResource({
                Subscription: { id: { name: 'id' }, resourceType: { name: 'resourceType' } }
            });
            expect(dataSource.resourceProjections.Subscription.has('extension')).toBe(true);
        });

        test('SEC-1585: forces extension into the SubscriptionStatus projection even when not requested', () => {
            dataSource.resourceProjections = {};
            dataSource.extractFieldsForResource({
                SubscriptionStatus: { id: { name: 'id' }, resourceType: { name: 'resourceType' } }
            });
            expect(dataSource.resourceProjections.SubscriptionStatus.has('extension')).toBe(true);
        });

        test('SEC-1585: forces identifier into the SubscriptionTopic projection even when not requested', () => {
            dataSource.resourceProjections = {};
            dataSource.extractFieldsForResource({
                SubscriptionTopic: { id: { name: 'id' }, resourceType: { name: 'resourceType' } }
            });
            expect(dataSource.resourceProjections.SubscriptionTopic.has('identifier')).toBe(true);
        });

        test('does not force extension/identifier onto unrelated resource types', () => {
            dataSource.resourceProjections = {};
            dataSource.extractFieldsForResource({
                Patient: { id: { name: 'id' }, resourceType: { name: 'resourceType' } }
            });
            expect(dataSource.resourceProjections.Patient.has('extension')).toBe(false);
            expect(dataSource.resourceProjections.Patient.has('identifier')).toBe(false);
        });
    });

    describe('getExtensionValueByUrl', () => {
        test('returns value for matching extension', async () => {
            const resource = {
                extension: [{ url: 'http://example.com/ext', valueString: 'hello' }]
            };
            const result = await dataSource.getExtensionValueByUrl({ resource, url: 'http://example.com/ext' });
            expect(result).toBe('hello');
        });

        test('returns null for no matching extension', async () => {
            const resource = {
                extension: [{ url: 'http://other.com/ext', valueString: 'nope' }]
            };
            const result = await dataSource.getExtensionValueByUrl({ resource, url: 'http://example.com/ext' });
            expect(result).toBeNull();
        });

        test('returns null for resource without extensions', async () => {
            const result = await dataSource.getExtensionValueByUrl({ resource: {}, url: 'x' });
            expect(result).toBeNull();
        });

        test('uses custom valueType', async () => {
            const resource = {
                extension: [{ url: 'http://example.com/ext', valueBoolean: true }]
            };
            const result = await dataSource.getExtensionValueByUrl({ resource, url: 'http://example.com/ext', valueType: 'valueBoolean' });
            expect(result).toBe(true);
        });
    });

    describe('getParsedArgsAsync', () => {
        test('calls parseArgs and rewriteArgsAsync', async () => {
            const result = await dataSource.getParsedArgsAsync({
                args: { base_version: '4_0_0' },
                resourceType: 'Patient',
                headers: { prefer: 'return=representation' }
            });
            expect(dataSource.r4ArgsParser.parseArgs).toHaveBeenCalled();
            expect(dataSource.queryRewriterManager.rewriteArgsAsync).toHaveBeenCalled();
        });
    });
});
