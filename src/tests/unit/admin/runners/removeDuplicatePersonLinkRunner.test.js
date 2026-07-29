const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

// Mock FhirResourceCreator
jestGlobal.mock('../../../../fhir/fhirResourceCreator', () => {
    return {
        FhirResourceCreator: {
            create: (doc) => {
                const resource = { ...doc };
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

// Mock moment-timezone
jestGlobal.mock('moment-timezone', () => {
    const mockMoment = {
        format: () => '2024-01-01T00:00:00.000Z'
    };
    const fn = () => mockMoment;
    fn.utc = () => mockMoment;
    return fn;
});

const { RemoveDuplicatePersonLinkRunner } = require('../../../../admin/runners/removeDuplicatePersonLinkRunner');
const { PreSaveManager } = require('../../../../preSaveHandlers/preSave');
const { AdminLogger } = require('../../../../admin/adminLogger');
const { MongoDatabaseManager } = require('../../../../utils/mongoDatabaseManager');

function createMockInstance(ClassType) {
    return Object.create(ClassType.prototype);
}

describe('RemoveDuplicatePersonLinkRunner', () => {
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
        mockMongoDatabaseManager.getClientDbAsync = jestGlobal.fn().mockResolvedValue({
            collection: jestGlobal.fn().mockReturnValue({
                aggregate: jestGlobal.fn().mockReturnValue({
                    hasNext: jestGlobal.fn().mockResolvedValue(false),
                    next: jestGlobal.fn().mockResolvedValue(null)
                })
            })
        });

        mockPreSaveManager = createMockInstance(PreSaveManager);
        mockPreSaveManager.preSaveAsync = jestGlobal.fn().mockImplementation(({ resource }) => resource);

        runner = new RemoveDuplicatePersonLinkRunner({
            adminLogger: mockAdminLogger,
            mongoDatabaseManager: mockMongoDatabaseManager,
            preSaveManager: mockPreSaveManager,
            personUuids: null,
            limit: undefined,
            skip: undefined,
            batchSize: 100,
            ownerCode: undefined,
            uuidGreaterThan: undefined
        });
    });

    // =====================================================
    // Tests for removeDuplicateLinks
    // =====================================================
    describe('removeDuplicateLinks', () => {
        test('removes duplicate links based on target._uuid', async () => {
            const resource = {
                link: [
                    { target: { _uuid: 'uuid-1', reference: 'Person/p1' } },
                    { target: { _uuid: 'uuid-1', reference: 'Person/p1' } },
                    { target: { _uuid: 'uuid-2', reference: 'Person/p2' } }
                ]
            };

            const result = await runner.removeDuplicateLinks(resource);
            expect(result.link).toHaveLength(2);
            expect(result.link[0].target._uuid).toBe('uuid-1');
            expect(result.link[1].target._uuid).toBe('uuid-2');
        });

        test('handles links with no duplicates', async () => {
            const resource = {
                link: [
                    { target: { _uuid: 'uuid-1', reference: 'Person/p1' } },
                    { target: { _uuid: 'uuid-2', reference: 'Person/p2' } }
                ]
            };

            const result = await runner.removeDuplicateLinks(resource);
            expect(result.link).toHaveLength(2);
        });

        test('BUG: crashes when resource.link is null', async () => {
            // Line 89: resource.link.reduce(...) - TypeError: Cannot read properties of null
            const resource = { link: null };

            await expect(async () => {
                await runner.removeDuplicateLinks(resource);
            }).rejects.toThrow(TypeError);
        });

        test('BUG: crashes when resource.link is undefined', async () => {
            // Line 89: resource.link.reduce(...) - TypeError: Cannot read properties of undefined
            const resource = {};

            await expect(async () => {
                await runner.removeDuplicateLinks(resource);
            }).rejects.toThrow(TypeError);
        });

        test('handles empty link array', async () => {
            const resource = { link: [] };

            const result = await runner.removeDuplicateLinks(resource);
            expect(result.link).toHaveLength(0);
        });

        test('handles links where target is null', async () => {
            const resource = {
                link: [
                    { target: null },
                    { target: { _uuid: 'uuid-1' } }
                ]
            };

            // link?.target?._uuid evaluates to undefined for null target
            // Both undefined values would be treated as same - second one dropped
            const result = await runner.removeDuplicateLinks(resource);
            // First link with null target has reference = undefined, which gets added to set
            // Second link with target._uuid undefined would also be undefined... wait no
            // Actually for null target: link?.target?._uuid = undefined
            // For second: link?.target?._uuid = 'uuid-1'
            // So both should remain
            expect(result.link).toHaveLength(2);
        });

        test('BUG: treats multiple links with null/undefined target._uuid as duplicates', async () => {
            // When multiple links have no target._uuid, the first undefined gets added to Set,
            // and subsequent ones are incorrectly treated as duplicates
            const resource = {
                link: [
                    { target: { reference: 'Person/p1' } },  // _uuid is undefined
                    { target: { reference: 'Person/p2' } }   // _uuid is undefined - treated as duplicate!
                ]
            };

            const result = await runner.removeDuplicateLinks(resource);
            // BUG: Only one link remains because both have undefined _uuid
            // which are treated as the same value in the Set
            expect(result.link).toHaveLength(1);
        });
    });

    // =====================================================
    // Tests for processRecordAsync
    // =====================================================
    describe('processRecordAsync', () => {
        test('returns empty operations when resource is unchanged after dedup', async () => {
            const doc = {
                _id: 'doc-1',
                resourceType: 'Person',
                link: [
                    { target: { _uuid: 'uuid-1', reference: 'Person/p1' } },
                    { target: { _uuid: 'uuid-2', reference: 'Person/p2' } }
                ],
                meta: { lastUpdated: '2024-01-01' }
            };

            const result = await runner.processRecordAsync({
                base_version: '4_0_0',
                requestInfo: {},
                doc
            });

            expect(result).toEqual([]);
        });

        test('returns replaceOne operation when duplicates are removed', async () => {
            const doc = {
                _id: 'doc-1',
                resourceType: 'Person',
                link: [
                    { target: { _uuid: 'uuid-1', reference: 'Person/p1' } },
                    { target: { _uuid: 'uuid-1', reference: 'Person/p1' } },
                    { target: { _uuid: 'uuid-2', reference: 'Person/p2' } }
                ],
                meta: { lastUpdated: '2024-01-01', security: [] }
            };

            const result = await runner.processRecordAsync({
                base_version: '4_0_0',
                requestInfo: {},
                doc
            });

            expect(result).toHaveLength(1);
            expect(result[0].replaceOne).toBeDefined();
            expect(result[0].replaceOne.filter).toEqual({ _id: 'doc-1' });
        });

        test('BUG: crashes when doc has no link property (resource.link is undefined)', async () => {
            // processRecordAsync calls removeDuplicateLinks which accesses resource.link.reduce
            // If the doc has no link property, this crashes
            const doc = {
                _id: 'doc-1',
                resourceType: 'Person',
                meta: { lastUpdated: '2024-01-01' }
            };

            await expect(async () => {
                await runner.processRecordAsync({
                    base_version: '4_0_0',
                    requestInfo: {},
                    doc
                });
            }).rejects.toThrow(TypeError);
        });
    });

    // =====================================================
    // Tests for processAsync
    // =====================================================
    describe('processAsync', () => {
        test('processes documents from cursor in batches', async () => {
            const mockCursor = {
                hasNext: jestGlobal.fn()
                    .mockResolvedValueOnce(true)
                    .mockResolvedValueOnce(true)
                    .mockResolvedValueOnce(false),
                next: jestGlobal.fn()
                    .mockResolvedValueOnce({ _id: 'uuid-1' })
                    .mockResolvedValueOnce({ _id: 'uuid-2' })
            };

            const mockDbCollection = {
                aggregate: jestGlobal.fn().mockReturnValue(mockCursor)
            };

            mockMongoDatabaseManager.getClientDbAsync.mockResolvedValue({
                collection: jestGlobal.fn().mockReturnValue(mockDbCollection)
            });

            runner.init = jestGlobal.fn().mockResolvedValue(undefined);
            runner.startFromIdContainer = { startFromId: '' };
            runner.processBatch = jestGlobal.fn().mockResolvedValue(undefined);
            runner.shutdown = jestGlobal.fn().mockResolvedValue(undefined);

            await runner.processAsync();

            expect(runner.processBatch).toHaveBeenCalled();
            expect(runner.shutdown).toHaveBeenCalled();
        });

        test('handles empty cursor', async () => {
            const mockCursor = {
                hasNext: jestGlobal.fn().mockResolvedValue(false),
                next: jestGlobal.fn()
            };

            const mockDbCollection = {
                aggregate: jestGlobal.fn().mockReturnValue(mockCursor)
            };

            mockMongoDatabaseManager.getClientDbAsync.mockResolvedValue({
                collection: jestGlobal.fn().mockReturnValue(mockDbCollection)
            });

            runner.init = jestGlobal.fn().mockResolvedValue(undefined);
            runner.startFromIdContainer = { startFromId: '' };
            runner.processBatch = jestGlobal.fn().mockResolvedValue(undefined);
            runner.shutdown = jestGlobal.fn().mockResolvedValue(undefined);

            await runner.processAsync();

            expect(runner.processBatch).not.toHaveBeenCalled();
            expect(runner.shutdown).toHaveBeenCalled();
        });
    });
});
