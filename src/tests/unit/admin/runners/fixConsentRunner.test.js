const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

// Mock FhirResourceCreator to avoid deep FHIR class instantiation
jestGlobal.mock('../../../../fhir/fhirResourceCreator', () => {
    return {
        FhirResourceCreator: {
            create: (doc) => {
                // Return a simple object with clone and toJSONInternal
                const resource = { ...doc };
                resource.clone = () => ({ ...resource, clone: resource.clone, toJSONInternal: resource.toJSONInternal });
                resource.toJSONInternal = () => {
                    const copy = { ...resource };
                    delete copy.clone;
                    delete copy.toJSONInternal;
                    return copy;
                };
                return resource;
            }
        }
    };
});

const { FixConsentRunner } = require('../../../../admin/runners/fixConsentRunner');
const { PreSaveManager } = require('../../../../preSaveHandlers/preSave');
const { AdminLogger } = require('../../../../admin/adminLogger');
const { MongoDatabaseManager } = require('../../../../utils/mongoDatabaseManager');

// Create mock instances that pass assertTypeEquals checks
function createMockInstance (ClassType) {
    const instance = Object.create(ClassType.prototype);
    return instance;
}

describe('FixConsentRunner', () => {
    let runner;
    let mockAdminLogger;
    let mockMongoDatabaseManager;
    let mockPreSaveManager;

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

        mockPreSaveManager = createMockInstance(PreSaveManager);
        mockPreSaveManager.preSaveAsync = jestGlobal.fn().mockImplementation(({ resource }) => resource);

        runner = new FixConsentRunner({
            batchSize: 100,
            adminLogger: mockAdminLogger,
            mongoDatabaseManager: mockMongoDatabaseManager,
            collections: ['Consent_4_0_0'],
            preSaveManager: mockPreSaveManager,
            limit: undefined,
            skip: undefined,
            startFromId: undefined,
            useTransaction: undefined,
            beforeLastUpdatedDate: undefined,
            afterLastUpdatedDate: undefined
        });
    });

    // =====================================================
    // Tests for lookupQuestionnaire
    // =====================================================
    describe('lookupQuestionnaire', () => {
        test('returns null when doc is null', async () => {
            const result = await runner.lookupQuestionnaire(null);
            expect(result).toBeNull();
        });

        test('returns null when doc.sourceReference is undefined', async () => {
            const doc = { _id: '123' };
            const result = await runner.lookupQuestionnaire(doc);
            expect(result).toBeNull();
        });

        test('returns undefined when reference is not QuestionnaireResponse', async () => {
            const doc = {
                _id: '123',
                sourceReference: { reference: 'Observation/obs-1' }
            };
            const result = await runner.lookupQuestionnaire(doc);
            expect(result).toBeUndefined();
        });

        test('returns undefined when questionnaireResponseId is not in cache', async () => {
            const doc = {
                _id: '123',
                sourceReference: { reference: 'QuestionnaireResponse/qr-1' }
            };
            const result = await runner.lookupQuestionnaire(doc);
            expect(result).toBeUndefined();
        });

        test('returns questionnaire item when found in cache', async () => {
            const expectedItem = { linkId: '/dataSharingConsent', code: [{ id: 'code-category', code: 'sharing', display: 'Data Sharing' }] };
            runner.questionnaireResponseToQuestionnaireId.set('qr-1', 'q-uuid-1');
            runner.questionnaireValues.set('q-uuid-1', expectedItem);

            const doc = {
                _id: '123',
                sourceReference: { reference: 'QuestionnaireResponse/qr-1' }
            };
            const result = await runner.lookupQuestionnaire(doc);
            expect(result).toEqual(expectedItem);
        });

        // BUG NOTE: ReferenceParser.parseReference returns a string ('', '', '') via comma operator
        // when given null/non-string. Destructuring `{ id, resourceType }` from a string '' gives
        // undefined values. This is a silent bug: it should return { id: undefined, resourceType: undefined }
        // as an object, but instead returns a string due to missing braces around the return.
        test('returns undefined when sourceReference.reference is null (silent bug in ReferenceParser)', async () => {
            const doc = {
                _id: '123',
                sourceReference: { reference: null }
            };
            const result = await runner.lookupQuestionnaire(doc);
            expect(result).toBeUndefined();
        });
    });

    // =====================================================
    // Tests for lookupCategoryCoding
    // =====================================================
    describe('lookupCategoryCoding', () => {
        test('returns null when resource is null', async () => {
            const result = await runner.lookupCategoryCoding({ resource: null, category: [], questionnaireItem: {} });
            expect(result).toBeNull();
        });

        test('returns null when questionnaireItem is null', async () => {
            const result = await runner.lookupCategoryCoding({ resource: {}, category: [], questionnaireItem: null });
            expect(result).toBeNull();
        });

        test('adds coding to category when code-category is found', async () => {
            const category = [];
            const questionnaireItem = {
                code: [
                    { id: 'code-category', code: 'data-sharing', display: 'Data Sharing' }
                ]
            };
            const result = await runner.lookupCategoryCoding({ resource: {}, category, questionnaireItem });
            expect(result).toHaveLength(1);
            expect(result[0].coding[0].id).toBe('bwell-consent-type');
            expect(result[0].coding[0].code).toBe('data-sharing');
        });

        // EXPECTED: correct behavior (will fail until bug is fixed)
        test('should gracefully handle questionnaireItem.code being null', async () => {
            const category = [];
            const questionnaireItem = { code: null };
            // Should skip gracefully instead of crashing
            const result = await runner.lookupCategoryCoding({ resource: {}, category, questionnaireItem });
            expect(result).toEqual([]);
        });

        // EXPECTED: correct behavior (will fail until bug is fixed)
        test('should gracefully handle questionnaireItem.code being undefined', async () => {
            const category = [];
            const questionnaireItem = {};
            // Should skip gracefully instead of crashing
            const result = await runner.lookupCategoryCoding({ resource: {}, category, questionnaireItem });
            expect(result).toEqual([]);
        });
    });

    // =====================================================
    // Tests for lookupProvisionClass
    // =====================================================
    describe('lookupProvisionClass', () => {
        test('returns null when resource is null', async () => {
            const result = await runner.lookupProvisionClass({ resource: null, provisionClass: [], questionnaireItem: {} });
            expect(result).toBeNull();
        });

        test('returns null when questionnaireItem is null', async () => {
            const result = await runner.lookupProvisionClass({ resource: {}, provisionClass: [], questionnaireItem: null });
            expect(result).toBeNull();
        });

        test('adds class to provisionClass array when code-display is found', async () => {
            const provisionClass = [];
            const questionnaireItem = {
                code: [
                    { id: 'code-display', code: 'vital-signs', display: 'Vital Signs' }
                ]
            };
            const result = await runner.lookupProvisionClass({ resource: {}, provisionClass, questionnaireItem });
            expect(result).toHaveLength(1);
            expect(result[0].code).toBe('vital-signs');
            expect(result[0].display).toBe('Vital Signs');
        });

        // EXPECTED: correct behavior (will fail until bug is fixed)
        test('should gracefully handle questionnaireItem.code being null', async () => {
            const provisionClass = [];
            const questionnaireItem = { code: null };
            // Should skip gracefully instead of crashing
            const result = await runner.lookupProvisionClass({ resource: {}, provisionClass, questionnaireItem });
            expect(result).toEqual([]);
        });
    });

    // =====================================================
    // Tests for addCategoryCodingToConsent
    // =====================================================
    describe('addCategoryCodingToConsent', () => {
        test('returns resource unchanged when category is null', async () => {
            const resource = { category: null, toJSONInternal: () => ({}), clone: () => ({}) };
            const result = await runner.addCategoryCodingToConsent({
                base_version: '4_0_0',
                requestInfo: {},
                resource,
                questionnaireItem: {}
            });
            expect(result).toBe(resource);
        });

        test('returns resource unchanged when category is not an array', async () => {
            const resource = { category: 'invalid', toJSONInternal: () => ({}), clone: () => ({}) };
            const result = await runner.addCategoryCodingToConsent({
                base_version: '4_0_0',
                requestInfo: {},
                resource,
                questionnaireItem: {}
            });
            expect(result).toBe(resource);
        });

        // EXPECTED: correct behavior (will fail until bug is fixed)
        test('should gracefully handle category item with null coding', async () => {
            const resource = {
                category: [{ coding: null }],
                toJSONInternal: () => ({}),
                clone: () => ({})
            };
            // Should skip the null coding gracefully instead of crashing
            const result = await runner.addCategoryCodingToConsent({
                base_version: '4_0_0',
                requestInfo: {},
                resource,
                questionnaireItem: { code: [{ id: 'code-category', code: 'test', display: 'Test' }] }
            });
            expect(result).toBeDefined();
        });
    });

    // =====================================================
    // Tests for getQueryForConsent
    // =====================================================
    describe('getQueryForConsent', () => {
        test('builds basic query with required properties', async () => {
            const query = await runner.getQueryForConsent({ startFromId: undefined });
            expect(query.$and).toBeDefined();
            expect(query.$and.length).toBeGreaterThanOrEqual(4); // _uuid, patient, provision.class, sourceReference
        });

        test('adds date filter for beforeLastUpdatedDate', async () => {
            runner.beforeLastUpdatedDate = new Date('2023-01-01');
            const query = await runner.getQueryForConsent({ startFromId: undefined });
            const dateFilter = query.$and.find(f => f['meta.lastUpdated']);
            expect(dateFilter['meta.lastUpdated'].$lt).toEqual(new Date('2023-01-01'));
        });

        test('adds date filter for afterLastUpdatedDate', async () => {
            runner.afterLastUpdatedDate = new Date('2022-01-01');
            const query = await runner.getQueryForConsent({ startFromId: undefined });
            const dateFilter = query.$and.find(f => f['meta.lastUpdated']);
            expect(dateFilter['meta.lastUpdated'].$gt).toEqual(new Date('2022-01-01'));
        });

        test('adds both date filters', async () => {
            runner.beforeLastUpdatedDate = new Date('2023-01-01');
            runner.afterLastUpdatedDate = new Date('2022-01-01');
            const query = await runner.getQueryForConsent({ startFromId: undefined });
            const dateFilter = query.$and.find(f => f['meta.lastUpdated']);
            expect(dateFilter['meta.lastUpdated'].$lt).toEqual(new Date('2023-01-01'));
            expect(dateFilter['meta.lastUpdated'].$gt).toEqual(new Date('2022-01-01'));
        });

        test('adds startFromId filter with string id', async () => {
            const query = await runner.getQueryForConsent({ startFromId: 'non-objectid-string' });
            const idFilter = query.$and.find(f => f._id);
            expect(idFilter._id.$gte).toBe('non-objectid-string');
        });
    });

    // =====================================================
    // Tests for cacheQuestionnaireValues - cursor.next() returning null
    // =====================================================
    describe('cacheQuestionnaireValues', () => {
        test('BUG: cursor.next() returns null after hasNext returns false boundary', async () => {
            // When a MongoDB cursor's hasNext() returns true but next() returns null
            // (race condition or exhausted cursor), accessing questionnaire.id crashes
            const mockSession = { endSession: jestGlobal.fn() };
            const mockClient = { close: jestGlobal.fn() };
            const mockCursor = {
                sort: jestGlobal.fn().mockReturnThis(),
                hasNext: jestGlobal.fn()
                    .mockResolvedValueOnce(true)
                    .mockResolvedValueOnce(false),
                next: jestGlobal.fn().mockResolvedValueOnce(null) // BUG: null from cursor
            };
            const mockCollection = {
                find: jestGlobal.fn().mockReturnValue(mockCursor)
            };

            runner.createSingeConnectionAsync = jestGlobal.fn().mockResolvedValue({
                collection: mockCollection,
                session: mockSession,
                client: mockClient
            });

            const mongoConfig = { connection: 'mongodb://localhost', db_name: 'test', options: {} };

            // This should crash because line 370: questionnaire.id accessed on null
            await expect(async () => {
                await runner.cacheQuestionnaireValues(mongoConfig);
            }).rejects.toThrow();
        });
    });

    // =====================================================
    // Tests for addProvisionClassToConsent
    // =====================================================
    describe('addProvisionClassToConsent', () => {
        test('returns resource unchanged when provision is null', async () => {
            const resource = { provision: null };
            const result = await runner.addProvisionClassToConsent({
                base_version: '4_0_0',
                requestInfo: {},
                resource,
                questionnaireItem: {}
            });
            expect(result).toBe(resource);
        });

        test('returns resource unchanged when provisionClass is not array', async () => {
            const resource = { provision: { class: 'invalid-non-array' } };
            const result = await runner.addProvisionClassToConsent({
                base_version: '4_0_0',
                requestInfo: {},
                resource,
                questionnaireItem: {}
            });
            expect(result).toBe(resource);
        });

        test('calls lookupProvisionClass when provisionClass is empty', async () => {
            const resource = { provision: { class: [] } };
            const questionnaireItem = {
                code: [{ id: 'code-display', code: 'vital-signs', display: 'Vital Signs' }]
            };
            const result = await runner.addProvisionClassToConsent({
                base_version: '4_0_0',
                requestInfo: {},
                resource,
                questionnaireItem
            });
            expect(result.provision.class).toHaveLength(1);
            expect(result.provision.class[0].code).toBe('vital-signs');
        });
    });
});
