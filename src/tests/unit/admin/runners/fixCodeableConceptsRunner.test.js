const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

const { FixCodeableConceptsRunner } = require('../../../../admin/runners/fixCodeableConceptsRunner');
const { AdminLogger } = require('../../../../admin/adminLogger');
const { MongoDatabaseManager } = require('../../../../utils/mongoDatabaseManager');
const CodeableConcept = require('../../../../fhir/classes/4_0_0/complex_types/codeableConcept');

function createMockInstance (ClassType) {
    const instance = Object.create(ClassType.prototype);
    return instance;
}

describe('FixCodeableConceptsRunner', () => {
    let runner;
    let mockAdminLogger;
    let mockMongoDatabaseManager;

    const oidToStandardSystemUrlMap = {
        '2.16.840.1.113883.6.96': 'http://snomed.info/sct',
        '2.16.840.1.113883.6.88': 'http://www.nlm.nih.gov/research/umls/rxnorm',
        '2.16.840.1.113883.6.1': 'http://loinc.org'
    };

    beforeEach(() => {
        mockAdminLogger = createMockInstance(AdminLogger);
        mockAdminLogger.logInfo = jestGlobal.fn();
        mockAdminLogger.logError = jestGlobal.fn();

        mockMongoDatabaseManager = createMockInstance(MongoDatabaseManager);
        mockMongoDatabaseManager.getClientConfigAsync = jestGlobal.fn().mockResolvedValue({
            connection: 'mongodb://localhost:27017',
            db_name: 'test_db',
            options: {}
        });
        mockMongoDatabaseManager.createClientAsync = jestGlobal.fn();

        runner = new FixCodeableConceptsRunner({
            batchSize: 100,
            adminLogger: mockAdminLogger,
            mongoDatabaseManager: mockMongoDatabaseManager,
            promiseConcurrency: 3,
            collections: ['Condition_4_0_0'],
            afterLastUpdatedDate: undefined,
            beforeLastUpdatedDate: undefined,
            startFromCollection: undefined,
            limit: undefined,
            properties: undefined,
            skip: undefined,
            filterToRecordsWithFields: undefined,
            startFromId: undefined,
            oidToStandardSystemUrlMap,
            updateResources: true
        });
    });

    describe('getFilter', () => {
        test('returns empty object for no properties', () => {
            expect(runner.getFilter([])).toEqual({});
        });

        test('returns empty object for undefined', () => {
            expect(runner.getFilter(undefined)).toEqual({});
        });

        test('returns single property filter for one item', () => {
            expect(runner.getFilter(['code'])).toEqual({ code: { $exists: true } });
        });

        test('returns $and for multiple properties', () => {
            const result = runner.getFilter(['code', 'category']);
            expect(result.$and).toHaveLength(2);
        });
    });

    describe('getProjection', () => {
        test('includes specified and needed properties', () => {
            runner.properties = ['code', 'category'];
            const result = runner.getProjection();
            expect(result.code).toBe(1);
            expect(result.category).toBe(1);
            expect(result.resourceType).toBe(1);
            expect(result._uuid).toBe(1);
        });
    });

    describe('isUpdateNeeded', () => {
        test('returns true for CodeableConcept with urn:oid: prefix', () => {
            const cc = new CodeableConcept({
                coding: [{ system: 'urn:oid:2.16.840.1.113883.6.96', code: '123' }]
            });
            expect(runner.isUpdateNeeded(cc)).toBe(true);
        });

        test('returns true for CodeableConcept with URN:OID: prefix (case insensitive)', () => {
            const cc = new CodeableConcept({
                coding: [{ system: 'URN:OID:2.16.840.1.113883.6.96', code: '123' }]
            });
            expect(runner.isUpdateNeeded(cc)).toBe(true);
        });

        test('returns true for CodeableConcept with known oid system', () => {
            const cc = new CodeableConcept({
                coding: [{ system: '2.16.840.1.113883.6.96', code: '123' }]
            });
            expect(runner.isUpdateNeeded(cc)).toBe(true);
        });

        test('returns false for CodeableConcept with standard url', () => {
            const cc = new CodeableConcept({
                coding: [{ system: 'http://snomed.info/sct', code: '123' }]
            });
            expect(runner.isUpdateNeeded(cc)).toBe(false);
        });

        test('returns false for empty coding array', () => {
            const cc = new CodeableConcept({ coding: [] });
            expect(runner.isUpdateNeeded(cc)).toBe(false);
        });

        test('returns true for nested objects containing CodeableConcept with oid', () => {
            const resource = {
                code: new CodeableConcept({
                    coding: [{ system: 'urn:oid:2.16.840.1.113883.6.1', code: '456' }]
                })
            };
            expect(runner.isUpdateNeeded(resource)).toBe(true);
        });

        test('returns false for nested objects without oid', () => {
            const resource = {
                code: new CodeableConcept({
                    coding: [{ system: 'http://loinc.org', code: '456' }]
                })
            };
            expect(runner.isUpdateNeeded(resource)).toBe(false);
        });
    });

    describe('updateResource', () => {
        test('replaces urn:oid: prefix with standard url', () => {
            const cc = new CodeableConcept({
                coding: [{ system: 'urn:oid:2.16.840.1.113883.6.96', code: '123' }]
            });
            const result = runner.updateResource(cc);
            expect(result.coding[0].system).toBe('http://snomed.info/sct');
        });

        test('replaces URN:OID: prefix (case insensitive) with standard url', () => {
            const cc = new CodeableConcept({
                coding: [{ system: 'URN:OID:2.16.840.1.113883.6.96', code: '123' }]
            });
            const result = runner.updateResource(cc);
            expect(result.coding[0].system).toBe('http://snomed.info/sct');
        });

        test('replaces raw oid with standard url', () => {
            const cc = new CodeableConcept({
                coding: [{ system: '2.16.840.1.113883.6.88', code: '789' }]
            });
            const result = runner.updateResource(cc);
            expect(result.coding[0].system).toBe('http://www.nlm.nih.gov/research/umls/rxnorm');
        });

        test('removes urn:oid prefix even for unmapped oid', () => {
            const cc = new CodeableConcept({
                coding: [{ system: 'urn:oid:9.9.9.9', code: '000' }]
            });
            const result = runner.updateResource(cc);
            expect(result.coding[0].system).toBe('9.9.9.9');
        });

        test('does not change standard url systems', () => {
            const cc = new CodeableConcept({
                coding: [{ system: 'http://loinc.org', code: '456' }]
            });
            const result = runner.updateResource(cc);
            expect(result.coding[0].system).toBe('http://loinc.org');
        });

        test('handles multiple codings in one CodeableConcept', () => {
            const cc = new CodeableConcept({
                coding: [
                    { system: 'urn:oid:2.16.840.1.113883.6.96', code: '1' },
                    { system: 'urn:oid:2.16.840.1.113883.6.1', code: '2' },
                    { system: 'http://some-url.com', code: '3' }
                ]
            });
            const result = runner.updateResource(cc);
            expect(result.coding[0].system).toBe('http://snomed.info/sct');
            expect(result.coding[1].system).toBe('http://loinc.org');
            expect(result.coding[2].system).toBe('http://some-url.com');
        });
    });

    describe('getQueryFromParameters', () => {
        test('returns empty filter when no parameters', () => {
            const result = runner.getQueryFromParameters({ queryPrefix: '' });
            expect(result).toEqual({});
        });

        test('returns afterLastUpdatedDate query', () => {
            runner.afterLastUpdatedDate = new Date('2023-01-01');
            const result = runner.getQueryFromParameters({ queryPrefix: '' });
            expect(result['meta.lastUpdated'].$gt).toEqual(new Date('2023-01-01'));
        });

        test('returns beforeLastUpdatedDate query', () => {
            runner.beforeLastUpdatedDate = new Date('2023-12-31');
            const result = runner.getQueryFromParameters({ queryPrefix: '' });
            expect(result['meta.lastUpdated'].$lt).toEqual(new Date('2023-12-31'));
        });

        test('returns $and for both date parameters', () => {
            runner.afterLastUpdatedDate = new Date('2023-01-01');
            runner.beforeLastUpdatedDate = new Date('2023-12-31');
            const result = runner.getQueryFromParameters({ queryPrefix: '' });
            expect(result.$and).toHaveLength(2);
        });

        test('uses queryPrefix', () => {
            runner.afterLastUpdatedDate = new Date('2023-01-01');
            const result = runner.getQueryFromParameters({ queryPrefix: 'resource.' });
            expect(result['resource.meta.lastUpdated']).toBeDefined();
        });

        test('adds startFromId when set', () => {
            runner.startFromId = 'start-id-123';
            const result = runner.getQueryFromParameters({ queryPrefix: '' });
            expect(result._id.$gte).toBe('start-id-123');
        });
    });

    describe('getQueryForResource', () => {
        test('creates query with uuid $in filter', () => {
            const uuidChunk = ['uuid-1', 'uuid-2'];
            const result = runner.getQueryForResource({ queryPrefix: '', uuidChunk });
            expect(result._uuid.$in).toEqual(uuidChunk);
        });

        test('merges with parameter query when present', () => {
            runner.afterLastUpdatedDate = new Date('2023-01-01');
            const uuidChunk = ['uuid-1'];
            const result = runner.getQueryForResource({ queryPrefix: '', uuidChunk });
            expect(result.$and).toBeDefined();
            expect(result.$and.length).toBe(2);
        });
    });

    describe('processRecordAsync', () => {
        test('returns empty operations when resource is unchanged', async () => {
            const doc = {
                _id: 'test-id',
                resourceType: 'Condition',
                id: 'cond-1',
                _uuid: 'uuid-1',
                _sourceId: 'cond-1',
                meta: { lastUpdated: new Date() },
                code: { coding: [{ system: 'http://snomed.info/sct', code: '123' }] }
            };

            const operations = await runner.processRecordAsync(doc);
            expect(operations).toEqual([]);
        });

        test('returns updateOne operation when oid is replaced', async () => {
            const doc = {
                _id: 'test-id',
                resourceType: 'Condition',
                id: 'cond-1',
                _uuid: 'uuid-1',
                _sourceId: 'cond-1',
                _sourceAssigningAuthority: 'src',
                meta: { lastUpdated: new Date() },
                code: new CodeableConcept({
                    coding: [{ system: 'urn:oid:2.16.840.1.113883.6.96', code: '123' }]
                })
            };

            const operations = await runner.processRecordAsync(doc);
            expect(operations.length).toBeGreaterThan(0);
            expect(operations[0].updateOne).toBeDefined();
            expect(operations[0].updateOne.filter._id).toBe('test-id');
        });

        test('handles history documents correctly', async () => {
            const doc = {
                _id: 'test-id',
                resource: {
                    resourceType: 'Condition',
                    id: 'cond-1',
                    _uuid: 'uuid-1',
                    _sourceId: 'cond-1',
                    _sourceAssigningAuthority: 'src',
                    meta: { lastUpdated: new Date() },
                    code: new CodeableConcept({
                        coding: [{ system: 'urn:oid:2.16.840.1.113883.6.96', code: '123' }]
                    })
                },
                request: { url: 'Condition/cond-1' }
            };

            const operations = await runner.processRecordAsync(doc);
            expect(operations.length).toBeGreaterThan(0);
        });
    });
});
