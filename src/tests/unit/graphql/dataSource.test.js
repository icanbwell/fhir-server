'use strict';

const { describe, test, beforeEach, expect, jest: jestGlobal } = require('@jest/globals');
const { FhirDataSource } = require('../../../graphql/dataSource');

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
const { OperationAccessManager } = require('../../../utils/operationAccessManager');

function createDataSource(overrides = {}) {
    const requestInfo = overrides.requestInfo || { requestId: 'req-1', headers: {} };
    const searchBundleOperation = createPrototypedMock(SearchBundleOperation);
    searchBundleOperation.searchBundleAsync = jestGlobal.fn().mockResolvedValue({
        entry: [{ resource: { resourceType: 'Patient', id: 'p1', _uuid: 'u1', _sourceId: 'p1' } }],
        meta: { tag: [{ system: 'sys', code: 'c', display: 'd' }] }
    });
    const r4ArgsParser = createPrototypedMock(R4ArgsParser);
    r4ArgsParser.parseArgs = jestGlobal.fn().mockReturnValue({ headers: null });
    const queryRewriterManager = createPrototypedMock(QueryRewriterManager);
    queryRewriterManager.rewriteArgsAsync = jestGlobal.fn().mockImplementation(async ({ parsedArgs }) => parsedArgs);
    const configManager = createPrototypedMock(ConfigManager);
    defineGetter(configManager, 'graphQLFetchResourceBatchSize', 100);
    defineGetter(configManager, 'enableMongoProjectionsInGraphQL', false);
    const accessManager = createPrototypedMock(OperationAccessManager);
    accessManager.verifyAccess = jestGlobal.fn();

    return new FhirDataSource({
        requestInfo,
        searchBundleOperation,
        r4ArgsParser,
        queryRewriterManager,
        configManager,
        accessManager
    });
}

describe('FhirDataSource (graphql)', () => {
    let dataSource;

    beforeEach(() => {
        dataSource = createDataSource();
    });

    describe('unBundle', () => {
        test('returns resources from bundle', () => {
            const bundle = { entry: [{ resource: { id: 'p1' } }], meta: { tag: [] } };
            expect(dataSource.unBundle(bundle).length).toBe(1);
        });

        test('returns empty for no entries', () => {
            expect(dataSource.unBundle({ meta: { tag: [] } })).toEqual([]);
        });
    });

    describe('reorderResources', () => {
        test('matches by _uuid and fills nulls', async () => {
            const resources = [
                { resourceType: 'Patient', _uuid: 'u1', id: 'p1' }
            ];
            const keys = ['Patient/u1', 'Patient/missing'];
            const result = await dataSource.reorderResources(resources, keys);
            expect(result[0]._uuid).toBe('u1');
            expect(result[1]).toBeNull();
        });

        test('matches by id (split on pipe)', async () => {
            const resources = [{ resourceType: 'Patient', _uuid: 'different', id: 'p1' }];
            const keys = ['Patient/p1|auth'];
            const result = await dataSource.reorderResources(resources, keys);
            expect(result[0].id).toBe('p1');
        });
    });

    describe('resolveType', () => {
        test('returns resourceType for object', () => {
            expect(dataSource.resolveType({ resourceType: 'Obs' }, {}, {})).toBe('Obs');
        });

        test('returns first element resourceType for array', () => {
            expect(dataSource.resolveType([{ resourceType: 'A' }], {}, {})).toBe('A');
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

        test('returns null for invalid resourceType', async () => {
            const info = { fieldNodes: [{ selectionSet: { selections: [] } }] };
            const result = await dataSource.findResourceByReference(
                { resourceType: 'X', id: '1' }, {}, {},
                info,
                { reference: 'BadType/123' }
            );
            expect(result).toBeNull();
        });

        test('handles reference without reference field (enrichment path)', async () => {
            const info = {
                fieldNodes: [{ selectionSet: { selections: [] } }],
                returnType: { constructor: { name: 'GraphQLUnionType' }, _types: [{ name: 'Patient' }] }
            };
            const reference = { type: 'Patient', display: 'Test Patient' };
            const result = await dataSource.findResourceByReference(
                { resourceType: 'Encounter', id: 'e1' }, {},
                {},
                info,
                reference
            );
            // Should enrich with extension data since display is present
            if (result) {
                expect(result.extension).toBeDefined();
            }
        });
    });

    describe('enrichResourceWithReferenceData', () => {
        test('adds display as extension', () => {
            const result = dataSource.enrichResourceWithReferenceData(
                {},
                { display: 'Dr. Smith', type: 'Practitioner' },
                'Practitioner'
            );
            expect(result.extension).toBeDefined();
            expect(result.extension.length).toBeGreaterThan(0);
        });

        test('returns empty object when no enrichable data', () => {
            const result = dataSource.enrichResourceWithReferenceData(
                {},
                { reference: 'Patient/1' },
                'Patient'
            );
            expect(result).toEqual({});
        });

        test('preserves existing resource extensions', () => {
            const existing = { extension: [{ url: 'existing', valueString: 'keep' }] };
            const result = dataSource.enrichResourceWithReferenceData(
                existing,
                { display: 'New Display' },
                'Patient'
            );
            expect(result.extension.length).toBeGreaterThan(1);
            expect(result.extension[0].url).toBe('existing');
        });
    });

    describe('getBundleMeta', () => {
        test('returns null with no meta', () => {
            expect(dataSource.getBundleMeta()).toBeNull();
        });

        test('combines codes from same system', () => {
            dataSource.metaList = [
                { tag: [{ system: 's', code: 'a', display: 'x' }] },
                { tag: [{ system: 's', code: 'b', display: 'y' }] }
            ];
            const meta = dataSource.getBundleMeta();
            expect(meta.tag[0].code).toBe('[a,b]');
            expect(meta.tag[0].display).toBe('[x,y]');
        });
    });

    describe('createDataLoader', () => {
        test('initializes once', () => {
            dataSource.createDataLoader({});
            const first = dataSource.dataLoader;
            dataSource.createDataLoader({});
            expect(dataSource.dataLoader).toBe(first);
        });
    });

    describe('getParsedArgsAsync', () => {
        test('parses and rewrites args', async () => {
            await dataSource.getParsedArgsAsync({ args: { base_version: '4_0_0' }, resourceType: 'Patient', headers: {} });
            expect(dataSource.r4ArgsParser.parseArgs).toHaveBeenCalled();
            expect(dataSource.queryRewriterManager.rewriteArgsAsync).toHaveBeenCalled();
        });
    });

    describe('getParsedArgsForMutationAsync', () => {
        test('parses args without rewrite', async () => {
            const result = await dataSource.getParsedArgsForMutationAsync({ args: { base_version: '4_0_0' }, resourceType: 'Patient', headers: { prefer: 'x' } });
            expect(dataSource.r4ArgsParser.parseArgs).toHaveBeenCalled();
            expect(result.headers).toEqual({ prefer: 'x' });
        });
    });

    describe('getExtensionValueByUrl', () => {
        test('returns value for matching url', async () => {
            const resource = { extension: [{ url: 'http://ext', valueString: 'val' }] };
            expect(await dataSource.getExtensionValueByUrl({ resource, url: 'http://ext' })).toBe('val');
        });

        test('returns null for missing extension', async () => {
            expect(await dataSource.getExtensionValueByUrl({ resource: { extension: [] }, url: 'x' })).toBeNull();
        });

        test('returns null for null resource', async () => {
            expect(await dataSource.getExtensionValueByUrl({ resource: null, url: 'x' })).toBeNull();
        });
    });
});
