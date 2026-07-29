const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

// Mock FhirResourceCreator to avoid deep FHIR class instantiation
jestGlobal.mock('../../../../fhir/fhirResourceCreator', () => {
    return {
        FhirResourceCreator: {
            create: (doc) => {
                const resource = { ...doc };
                resource.toJSONInternal = () => {
                    const copy = { ...resource };
                    delete copy.toJSONInternal;
                    return copy;
                };
                return resource;
            }
        }
    };
});

const { FixDuplicatePractitionerRunner } = require('../../../../admin/runners/fixDuplicatePractitionerRunner');
const { AdminLogger } = require('../../../../admin/adminLogger');
const { MongoDatabaseManager } = require('../../../../utils/mongoDatabaseManager');

// Create mock instances that pass assertTypeEquals checks
function createMockInstance (ClassType) {
    const instance = Object.create(ClassType.prototype);
    return instance;
}

describe('FixDuplicatePractitionerRunner', () => {
    let runner;
    let mockAdminLogger;
    let mockMongoDatabaseManager;

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
        mockMongoDatabaseManager.createClientAsync = jestGlobal.fn().mockResolvedValue({
            startSession: jestGlobal.fn().mockReturnValue({
                serverSession: { id: 'session-1' },
                endSession: jestGlobal.fn()
            }),
            db: jestGlobal.fn().mockReturnValue({
                collection: jestGlobal.fn().mockReturnValue({})
            }),
            close: jestGlobal.fn()
        });

        runner = new FixDuplicatePractitionerRunner({
            collections: ['Appointment_4_0_0'],
            batchSize: 100,
            deleteData: undefined,
            adminLogger: mockAdminLogger,
            mongoDatabaseManager: mockMongoDatabaseManager,
            startFromCollection: undefined,
            limit: undefined,
            skip: undefined,
            startFromId: undefined,
            useTransaction: undefined,
            properties: undefined,
            afterLastUpdatedDate: undefined,
            beforeLastUpdatedDate: undefined
        });
    });

    // =====================================================
    // Tests for getQueryForFixCollection
    // =====================================================
    describe('getQueryForFixCollection', () => {
        test('returns empty query when no date filters or startFromId', () => {
            const query = runner.getQueryForFixCollection();
            expect(query).toEqual({});
        });

        test('adds afterLastUpdatedDate filter', () => {
            runner.afterLastUpdatedDate = '2023-01-01';
            const query = runner.getQueryForFixCollection();
            expect(query.$and).toBeDefined();
            expect(query.$and).toHaveLength(2);
            expect(query.$and[1]['meta.lastUpdated'].$gt).toBe('2023-01-01');
        });

        test('adds beforeLastUpdatedDate filter', () => {
            runner.beforeLastUpdatedDate = '2023-12-31';
            const query = runner.getQueryForFixCollection();
            expect(query.$and).toBeDefined();
            expect(query.$and[1]['meta.lastUpdated'].$lt).toBe('2023-12-31');
        });

        test('adds both date filters', () => {
            runner.afterLastUpdatedDate = '2023-01-01';
            runner.beforeLastUpdatedDate = '2023-12-31';
            const query = runner.getQueryForFixCollection();
            expect(query.$and).toHaveLength(3);
        });

        test('adds startFromId filter with non-ObjectId string', () => {
            runner.startFromId = 'non-objectid-string';
            const query = runner.getQueryForFixCollection();
            expect(query.$and).toBeDefined();
            const idFilter = query.$and.find(f => f._id);
            expect(idFilter._id.$gte).toBe('non-objectid-string');
        });

        test('combines date and startFromId filters', () => {
            runner.afterLastUpdatedDate = '2023-01-01';
            runner.startFromId = 'start-id';
            const query = runner.getQueryForFixCollection();
            expect(query.$and).toBeDefined();
        });
    });

    // =====================================================
    // Tests for createPractitionerSubstitutions
    // =====================================================
    describe('createPractitionerSubstitutions', () => {
        test('creates substitutions for duplicate practitioners with nppes', async () => {
            const dups = [{
                _id: 'npi-1234567890',
                uuid: ['uuid-correct', 'uuid-dup-1', 'uuid-dup-2'],
                sourceAssigningAuthority: ['nppes', 'other1', 'other2']
            }];

            await runner.createPractitionerSubstitutions(dups);

            expect(runner.dupUuids).toContain('Practitioner/uuid-dup-1');
            expect(runner.dupUuids).toContain('Practitioner/uuid-dup-2');
            expect(runner.dupUuids).not.toContain('Practitioner/uuid-correct');

            const subs = runner.practitionerSubstitutionsByUuid.get('Practitioner/uuid-dup-1');
            expect(subs.goodReference).toBe('Practitioner/npi-1234567890|nppes');
            expect(subs.goodUuid).toBe('Practitioner/uuid-correct');
        });

        test('skips dups without nppes sourceAssigningAuthority', async () => {
            const dups = [{
                _id: 'npi-1234567890',
                uuid: ['uuid-1', 'uuid-2'],
                sourceAssigningAuthority: ['other1', 'other2']
            }];

            await runner.createPractitionerSubstitutions(dups);
            expect(runner.dupUuids).toHaveLength(0);
            expect(runner.practitionerSubstitutionsByUuid.size).toBe(0);
        });

        test('handles empty dups array', async () => {
            await runner.createPractitionerSubstitutions([]);
            expect(runner.dupUuids).toHaveLength(0);
        });
    });

    // =====================================================
    // Tests for substituteOneReference
    // =====================================================
    describe('substituteOneReference', () => {
        beforeEach(() => {
            runner.practitionerSubstitutionsByUuid.set('Practitioner/old-uuid', {
                goodReference: 'Practitioner/npi-123|nppes',
                goodSourceId: 'Practitioner/npi-123',
                goodUuid: 'Practitioner/new-uuid'
            });
        });

        test('substitutes reference fields correctly', async () => {
            const ref = {
                _uuid: 'Practitioner/old-uuid',
                reference: 'Practitioner/npi-123|other',
                _sourceId: 'Practitioner/npi-123',
                _sourceAssigningAuthority: 'other'
            };

            const result = await runner.substituteOneReference({ ref });
            expect(result._uuid).toBe('Practitioner/new-uuid');
            expect(result.reference).toBe('Practitioner/npi-123|nppes');
            expect(result._sourceAssigningAuthority).toBe('nppes');
        });

        test('uses goodUuid as reference when sourceId does not match', async () => {
            const ref = {
                _uuid: 'Practitioner/old-uuid',
                reference: 'Practitioner/different-id|other',
                _sourceId: 'Practitioner/old-source',
                _sourceAssigningAuthority: 'other'
            };

            const result = await runner.substituteOneReference({ ref });
            expect(result.reference).toBe('Practitioner/new-uuid');
        });

        test('returns ref unchanged when uuid not in substitution map', async () => {
            const ref = {
                _uuid: 'Practitioner/unknown-uuid',
                reference: 'Practitioner/npi-123|other'
            };

            const result = await runner.substituteOneReference({ ref });
            expect(result._uuid).toBe('Practitioner/unknown-uuid');
        });

        test('updates extension fields', async () => {
            const ref = {
                _uuid: 'Practitioner/old-uuid',
                reference: 'Practitioner/npi-123|other',
                _sourceId: 'old-source',
                _sourceAssigningAuthority: 'other',
                extension: [
                    { id: 'sourceId', valueString: 'old' },
                    { id: 'sourceAssigningAuthority', valueString: 'old' },
                    { id: 'uuid', valueString: 'old' }
                ]
            };

            const result = await runner.substituteOneReference({ ref });
            expect(result.extension[0].valueString).toBe('Practitioner/npi-123');
            expect(result.extension[1].valueString).toBe('nppes');
            expect(result.extension[2].valueString).toBe('Practitioner/new-uuid');
        });

        // EXPECTED: correct behavior (will fail until bug is fixed)
        test('should gracefully handle ref.reference being null', async () => {
            const ref = {
                _uuid: 'Practitioner/old-uuid',
                reference: null,
                _sourceId: 'Practitioner/old-source'
            };

            // Should not crash - should handle null reference gracefully
            const result = await runner.substituteOneReference({ ref });
            expect(result).toBeDefined();
            expect(result._uuid).toBe('Practitioner/new-uuid');
        });

        // EXPECTED: correct behavior (will fail until bug is fixed)
        test('should gracefully handle ref.reference being undefined', async () => {
            const ref = {
                _uuid: 'Practitioner/old-uuid',
                _sourceId: 'Practitioner/old-source'
            };

            // Should not crash - should handle undefined reference gracefully
            const result = await runner.substituteOneReference({ ref });
            expect(result).toBeDefined();
            expect(result._uuid).toBe('Practitioner/new-uuid');
        });
    });

    // =====================================================
    // Tests for processResourceAsync
    // =====================================================
    describe('processResourceAsync', () => {
        beforeEach(() => {
            runner.dupUuids = ['Practitioner/dup-uuid-1'];
            runner.practitionerSubstitutionsByUuid.set('Practitioner/dup-uuid-1', {
                goodReference: 'Practitioner/npi-123|nppes',
                goodSourceId: 'Practitioner/npi-123',
                goodUuid: 'Practitioner/good-uuid'
            });
        });

        test('handles single-level field (e.g., requester)', async () => {
            const doc = {
                _id: 'doc-1',
                resourceType: 'ServiceRequest',
                _uuid: 'sr-uuid-1',
                requester: {
                    _uuid: 'Practitioner/dup-uuid-1',
                    reference: 'Practitioner/npi-123|other'
                }
            };

            const result = await runner.processResourceAsync({
                doc,
                collectionName: 'ServiceRequest_4_0_0',
                field: 'requester'
            });

            expect(result).toHaveLength(1);
            expect(result[0].replaceOne.filter._id).toBe('doc-1');
        });

        test('handles array single-level field (e.g., performer)', async () => {
            const doc = {
                _id: 'doc-1',
                resourceType: 'Observation',
                _uuid: 'obs-uuid-1',
                performer: [
                    { _uuid: 'Practitioner/dup-uuid-1', reference: 'Practitioner/npi-123|other' },
                    { _uuid: 'Practitioner/other-uuid', reference: 'Practitioner/other|nppes' }
                ]
            };

            const result = await runner.processResourceAsync({
                doc,
                collectionName: 'Observation_4_0_0',
                field: 'performer'
            });

            expect(result).toHaveLength(1);
        });

        // EXPECTED: correct behavior (will fail until bug is fixed)
        test('should gracefully handle two-level field when sub-field is null', async () => {
            const doc = {
                _id: 'doc-1',
                resourceType: 'Encounter',
                _uuid: 'enc-uuid-1',
                participant: [
                    { individual: null } // field exists but is null
                ]
            };

            // Should skip null sub-fields gracefully without crashing
            const result = await runner.processResourceAsync({
                doc,
                collectionName: 'Encounter_4_0_0',
                field: 'participant.individual'
            });
            expect(Array.isArray(result)).toBe(true);
        });

        // EXPECTED: correct behavior (will fail until bug is fixed)
        test('should gracefully handle two-level field when sub-field is undefined', async () => {
            const doc = {
                _id: 'doc-1',
                resourceType: 'Encounter',
                _uuid: 'enc-uuid-1',
                participant: [
                    { type: 'someType' } // 'individual' key doesn't exist
                ]
            };

            // Should skip undefined sub-fields gracefully without crashing
            const result = await runner.processResourceAsync({
                doc,
                collectionName: 'Encounter_4_0_0',
                field: 'participant.individual'
            });
            expect(Array.isArray(result)).toBe(true);
        });
    });

    // =====================================================
    // Tests for deleteDuplicatePractitioners
    // =====================================================
    describe('deleteDuplicatePractitioners', () => {
        test('creates correct delete query from dupUuids', async () => {
            runner.dupUuids = ['Practitioner/uuid-1', 'Practitioner/uuid-2'];
            const mockDeleteMany = jestGlobal.fn().mockResolvedValue({ deletedCount: 2 });
            const mockCollection = { deleteMany: mockDeleteMany };

            await runner.deleteDuplicatePractitioners({ collection: mockCollection });

            expect(mockDeleteMany).toHaveBeenCalledWith({
                _uuid: { $in: ['uuid-1', 'uuid-2'] }
            });
        });

        test('handles empty dupUuids array', async () => {
            runner.dupUuids = [];
            const mockDeleteMany = jestGlobal.fn().mockResolvedValue({ deletedCount: 0 });
            const mockCollection = { deleteMany: mockDeleteMany };

            await runner.deleteDuplicatePractitioners({ collection: mockCollection });

            expect(mockDeleteMany).toHaveBeenCalledWith({
                _uuid: { $in: [] }
            });
        });
    });

    // =====================================================
    // Tests for getDuplicatePractitionerArrayAsync
    // =====================================================
    describe('getDuplicatePractitionerArrayAsync', () => {
        test('returns aggregation result', async () => {
            const expectedResult = [
                { _id: 'npi-1234567890', count: 2, uuid: ['u1', 'u2'], sourceAssigningAuthority: ['nppes', 'other'] }
            ];
            const mockCollection = {
                aggregate: jestGlobal.fn().mockReturnValue({
                    toArray: jestGlobal.fn().mockResolvedValue(expectedResult)
                })
            };

            const result = await runner.getDuplicatePractitionerArrayAsync({ collection: mockCollection });
            expect(result).toEqual(expectedResult);
        });

        test('returns empty array when no duplicates', async () => {
            const mockCollection = {
                aggregate: jestGlobal.fn().mockReturnValue({
                    toArray: jestGlobal.fn().mockResolvedValue([])
                })
            };

            const result = await runner.getDuplicatePractitionerArrayAsync({ collection: mockCollection });
            expect(result).toEqual([]);
        });
    });
});
