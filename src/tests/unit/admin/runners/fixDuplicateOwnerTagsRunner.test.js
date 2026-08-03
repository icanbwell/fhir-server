const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

// Mock FhirResourceCreator
jestGlobal.mock('../../../../fhir/fhirResourceCreator', () => {
    return {
        FhirResourceCreator: {
            create: (doc) => {
                const resource = JSON.parse(JSON.stringify(doc));
                resource.clone = () => {
                    const cloned = JSON.parse(JSON.stringify(doc));
                    cloned.clone = resource.clone;
                    cloned.toJSONInternal = () => {
                        const copy = JSON.parse(JSON.stringify(cloned));
                        delete copy.clone;
                        delete copy.toJSONInternal;
                        return copy;
                    };
                    return cloned;
                };
                resource.toJSONInternal = () => {
                    const copy = JSON.parse(JSON.stringify(resource));
                    delete copy.clone;
                    delete copy.toJSONInternal;
                    return copy;
                };
                return resource;
            }
        }
    };
});

const { FixDuplicateOwnerTagsRunner } = require('../../../../admin/runners/fixDuplicateOwnerTagsRunner');
const { AdminLogger } = require('../../../../admin/adminLogger');
const { MongoDatabaseManager } = require('../../../../utils/mongoDatabaseManager');
const { SecurityTagSystem } = require('../../../../utils/securityTagSystem');

function createMockInstance(ClassType) {
    return Object.create(ClassType.prototype);
}

describe('FixDuplicateOwnerTagsRunner', () => {
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

        runner = new FixDuplicateOwnerTagsRunner({
            mongoDatabaseManager: mockMongoDatabaseManager,
            collections: ['Patient_4_0_0'],
            batchSize: 100,
            adminLogger: mockAdminLogger,
            startFromCollection: undefined,
            limit: undefined,
            useTransaction: false,
            skip: undefined,
            startFromId: undefined
        });
    });

    // =====================================================
    // Tests for removeDuplicateOwnerTags
    // =====================================================
    describe('removeDuplicateOwnerTags', () => {
        test('removes duplicate owner tags with same code', () => {
            const resource = {
                meta: {
                    security: [
                        { system: SecurityTagSystem.owner, code: 'bwell' },
                        { system: SecurityTagSystem.owner, code: 'bwell' },
                        { system: SecurityTagSystem.access, code: 'bwell' }
                    ]
                }
            };

            const result = runner.removeDuplicateOwnerTags(resource);

            expect(result.meta.security).toHaveLength(2);
            expect(result.meta.security[0]).toEqual({ system: SecurityTagSystem.owner, code: 'bwell' });
            expect(result.meta.security[1]).toEqual({ system: SecurityTagSystem.access, code: 'bwell' });
        });

        test('keeps non-owner tags intact', () => {
            const resource = {
                meta: {
                    security: [
                        { system: SecurityTagSystem.access, code: 'bwell' },
                        { system: SecurityTagSystem.access, code: 'bwell' },
                        { system: SecurityTagSystem.owner, code: 'owner1' }
                    ]
                }
            };

            const result = runner.removeDuplicateOwnerTags(resource);

            // Non-owner duplicates are NOT removed by this function
            expect(result.meta.security).toHaveLength(3);
        });

        test('handles resource with no meta', () => {
            const resource = {};
            const result = runner.removeDuplicateOwnerTags(resource);
            expect(result).toEqual({});
        });

        test('handles resource with meta but no security', () => {
            const resource = { meta: {} };
            const result = runner.removeDuplicateOwnerTags(resource);
            expect(result.meta).toEqual({});
        });

        test('handles resource with null meta.security', () => {
            const resource = { meta: { security: null } };
            const result = runner.removeDuplicateOwnerTags(resource);
            expect(result.meta.security).toBeNull();
        });

        test('removes multiple different duplicate owner codes', () => {
            const resource = {
                meta: {
                    security: [
                        { system: SecurityTagSystem.owner, code: 'owner1' },
                        { system: SecurityTagSystem.owner, code: 'owner2' },
                        { system: SecurityTagSystem.owner, code: 'owner1' },
                        { system: SecurityTagSystem.owner, code: 'owner2' }
                    ]
                }
            };

            const result = runner.removeDuplicateOwnerTags(resource);
            expect(result.meta.security).toHaveLength(2);
            expect(result.meta.security[0].code).toBe('owner1');
            expect(result.meta.security[1].code).toBe('owner2');
        });

        test('BUG: treats owner tags with undefined code as duplicates of each other', () => {
            // Line 107-110: When s.code is undefined, ownerCodes.includes(undefined)
            // is false the first time, then pushes undefined. Second tag with undefined code
            // is treated as duplicate.
            const resource = {
                meta: {
                    security: [
                        { system: SecurityTagSystem.owner },  // code is undefined
                        { system: SecurityTagSystem.owner }   // code is undefined - treated as duplicate!
                    ]
                }
            };

            const result = runner.removeDuplicateOwnerTags(resource);
            // Second undefined-code owner tag is incorrectly removed
            expect(result.meta.security).toHaveLength(1);
        });

        test('handles empty security array', () => {
            const resource = { meta: { security: [] } };
            const result = runner.removeDuplicateOwnerTags(resource);
            expect(result.meta.security).toHaveLength(0);
        });
    });

    // =====================================================
    // Tests for processRecordAsync
    // =====================================================
    describe('processRecordAsync', () => {
        test('returns empty operations when no duplicates exist', async () => {
            const doc = {
                _id: 'doc-1',
                resourceType: 'Patient',
                meta: {
                    security: [
                        { system: SecurityTagSystem.owner, code: 'bwell' },
                        { system: SecurityTagSystem.access, code: 'bwell' }
                    ]
                }
            };

            const result = await runner.processRecordAsync(doc);
            expect(result).toEqual([]);
        });

        test('returns replaceOne operation when duplicates are removed', async () => {
            const doc = {
                _id: 'doc-1',
                resourceType: 'Patient',
                meta: {
                    security: [
                        { system: SecurityTagSystem.owner, code: 'bwell' },
                        { system: SecurityTagSystem.owner, code: 'bwell' },
                        { system: SecurityTagSystem.access, code: 'bwell' }
                    ]
                }
            };

            const result = await runner.processRecordAsync(doc);
            expect(result).toHaveLength(1);
            expect(result[0].replaceOne).toBeDefined();
            expect(result[0].replaceOne.filter).toEqual({ _id: 'doc-1' });
            // The replacement should have deduplicated security tags
            const replacement = result[0].replaceOne.replacement;
            const ownerTags = replacement.meta.security.filter(s => s.system === SecurityTagSystem.owner);
            expect(ownerTags).toHaveLength(1);
        });

        test('throws RethrownError when FhirResourceCreator fails', async () => {
            const doc = null; // Will cause FhirResourceCreator.create to throw

            await expect(async () => {
                await runner.processRecordAsync(doc);
            }).rejects.toThrow();
        });
    });

    // =====================================================
    // Tests for getAllCollectionNamesAsync
    // =====================================================
    describe('getAllCollectionNamesAsync', () => {
        test('filters out History collections', async () => {
            const mockSession = { endSession: jestGlobal.fn() };
            const mockClient = { close: jestGlobal.fn() };
            const mockDb = {};

            runner.createSingeConnectionAsync = jestGlobal.fn().mockResolvedValue({
                db: mockDb,
                client: mockClient,
                session: mockSession
            });

            runner.getAllCollectionNamesForDb = jestGlobal.fn().mockResolvedValue([
                'Patient_4_0_0',
                'Patient_4_0_0_History',
                'Person_4_0_0',
                'Person_4_0_0_History'
            ]);

            const result = await runner.getAllCollectionNamesAsync();

            expect(result).toEqual(['Patient_4_0_0', 'Person_4_0_0']);
            expect(mockSession.endSession).toHaveBeenCalled();
            expect(mockClient.close).toHaveBeenCalled();
        });

        test('cleans up connection on error', async () => {
            const mockSession = { endSession: jestGlobal.fn() };
            const mockClient = { close: jestGlobal.fn() };
            const mockDb = {};

            runner.createSingeConnectionAsync = jestGlobal.fn().mockResolvedValue({
                db: mockDb,
                client: mockClient,
                session: mockSession
            });

            runner.getAllCollectionNamesForDb = jestGlobal.fn().mockRejectedValue(
                new Error('Connection lost')
            );

            await expect(async () => {
                await runner.getAllCollectionNamesAsync();
            }).rejects.toThrow();

            // Ensure cleanup happens even on error
            expect(mockSession.endSession).toHaveBeenCalled();
            expect(mockClient.close).toHaveBeenCalled();
        });
    });

    // =====================================================
    // Tests for getResourceUuidsWithMultipleOwnerTagsAsync
    // =====================================================
    describe('getResourceUuidsWithMultipleOwnerTagsAsync', () => {
        test('returns uuids from aggregation cursor', async () => {
            const mockCursor = {
                hasNext: jestGlobal.fn()
                    .mockResolvedValueOnce(true)
                    .mockResolvedValueOnce(true)
                    .mockResolvedValueOnce(false),
                next: jestGlobal.fn()
                    .mockResolvedValueOnce({ _id: { _uuid: 'uuid-1' } })
                    .mockResolvedValueOnce({ _id: { _uuid: 'uuid-2' } })
            };

            const mockCollection = {
                aggregate: jestGlobal.fn().mockReturnValue(mockCursor)
            };

            const mockSession = { endSession: jestGlobal.fn() };
            const mockClient = { close: jestGlobal.fn() };

            runner.createSingeConnectionAsync = jestGlobal.fn().mockResolvedValue({
                collection: mockCollection,
                client: mockClient,
                session: mockSession
            });

            const result = await runner.getResourceUuidsWithMultipleOwnerTagsAsync({
                collectionName: 'Patient_4_0_0'
            });

            expect(result).toEqual(['uuid-1', 'uuid-2']);
            expect(mockSession.endSession).toHaveBeenCalled();
            expect(mockClient.close).toHaveBeenCalled();
        });

        test('returns empty array when no duplicates found', async () => {
            const mockCursor = {
                hasNext: jestGlobal.fn().mockResolvedValue(false),
                next: jestGlobal.fn()
            };

            const mockCollection = {
                aggregate: jestGlobal.fn().mockReturnValue(mockCursor)
            };

            const mockSession = { endSession: jestGlobal.fn() };
            const mockClient = { close: jestGlobal.fn() };

            runner.createSingeConnectionAsync = jestGlobal.fn().mockResolvedValue({
                collection: mockCollection,
                client: mockClient,
                session: mockSession
            });

            const result = await runner.getResourceUuidsWithMultipleOwnerTagsAsync({
                collectionName: 'Patient_4_0_0'
            });

            expect(result).toEqual([]);
        });

        test('BUG: crashes when cursor.next() returns null (cursor race condition)', async () => {
            // If hasNext() returns true but next() returns null due to a race condition
            const mockCursor = {
                hasNext: jestGlobal.fn()
                    .mockResolvedValueOnce(true)
                    .mockResolvedValueOnce(false),
                next: jestGlobal.fn().mockResolvedValueOnce(null)
            };

            const mockCollection = {
                aggregate: jestGlobal.fn().mockReturnValue(mockCursor)
            };

            const mockSession = { endSession: jestGlobal.fn() };
            const mockClient = { close: jestGlobal.fn() };

            runner.createSingeConnectionAsync = jestGlobal.fn().mockResolvedValue({
                collection: mockCollection,
                client: mockClient,
                session: mockSession
            });

            // Line 265: data._id._uuid - TypeError: Cannot read properties of null
            // Wrapped in RethrownError by the catch block
            await expect(async () => {
                await runner.getResourceUuidsWithMultipleOwnerTagsAsync({
                    collectionName: 'Patient_4_0_0'
                });
            }).rejects.toThrow("Cannot read properties of null (reading '_id')");
        });
    });

    // =====================================================
    // Tests for processAsync
    // =====================================================
    describe('processAsync', () => {
        test('fetches all collections when first item is "all"', async () => {
            runner.collections = ['all'];
            runner.getAllCollectionNamesAsync = jestGlobal.fn().mockResolvedValue([
                'Patient_4_0_0', 'Person_4_0_0', 'Observation_4_0_0'
            ]);
            runner.getResourceUuidsWithMultipleOwnerTagsAsync = jestGlobal.fn().mockResolvedValue([]);

            await runner.processAsync();

            expect(runner.getAllCollectionNamesAsync).toHaveBeenCalled();
            expect(runner.collections).toEqual(['Observation_4_0_0', 'Patient_4_0_0', 'Person_4_0_0']);
        });

        test('filters collections by startFromCollection', async () => {
            runner.collections = ['all'];
            runner.startFromCollection = 'Patient_4_0_0';
            runner.getAllCollectionNamesAsync = jestGlobal.fn().mockResolvedValue([
                'Observation_4_0_0', 'Patient_4_0_0', 'Person_4_0_0'
            ]);
            runner.getResourceUuidsWithMultipleOwnerTagsAsync = jestGlobal.fn().mockResolvedValue([]);

            await runner.processAsync();

            expect(runner.collections).toEqual(['Patient_4_0_0', 'Person_4_0_0']);
        });

        test('logs error and continues on processAsync failure', async () => {
            runner.collections = ['Patient_4_0_0'];
            runner.getResourceUuidsWithMultipleOwnerTagsAsync = jestGlobal.fn().mockRejectedValue(
                new Error('Connection failed')
            );

            await runner.processAsync();

            expect(mockAdminLogger.logError).toHaveBeenCalledWith(
                expect.stringContaining('Connection failed'),
                expect.any(Object)
            );
        });
    });
});
