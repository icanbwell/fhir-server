'use strict';

const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

const { DatabaseStats } = require('../../../../admin/runners/dbStatsRunner');
const { AdminLogger } = require('../../../../admin/adminLogger');
const { MongoDatabaseManager } = require('../../../../utils/mongoDatabaseManager');

function createMockInstance (ClassType) {
    return Object.create(ClassType.prototype);
}

describe('DatabaseStats', () => {
    let mockAdminLogger;
    let mockMongoDatabaseManager;

    function makeRunner (overrides = {}) {
        return new DatabaseStats({
            mongoDatabaseManager: mockMongoDatabaseManager,
            collections: undefined,
            adminLogger: mockAdminLogger,
            ...overrides
        });
    }

    beforeEach(() => {
        mockAdminLogger = createMockInstance(AdminLogger);
        mockAdminLogger.logInfo = jestGlobal.fn();
        mockAdminLogger.logError = jestGlobal.fn();

        mockMongoDatabaseManager = createMockInstance(MongoDatabaseManager);
    });

    // =====================================================
    // validateCollections
    // =====================================================
    describe('validateCollections', () => {
        test('keeps regular, non-system collections', () => {
            const runner = makeRunner();
            const result = runner.validateCollections([
                { name: 'Patient_4_0_0', type: 'collection' },
                { name: 'Practitioner_4_0_0', type: 'collection' }
            ]);
            expect(result).toEqual(['Patient_4_0_0', 'Practitioner_4_0_0']);
        });

        test('excludes views (type !== "collection")', () => {
            const runner = makeRunner();
            const result = runner.validateCollections([
                { name: 'somePatientView', type: 'view' },
                { name: 'Patient_4_0_0', type: 'collection' }
            ]);
            expect(result).toEqual(['Patient_4_0_0']);
        });

        test('excludes system.* collections and logs why', () => {
            const runner = makeRunner();
            const result = runner.validateCollections([
                { name: 'system.indexes', type: 'collection' },
                { name: 'Patient_4_0_0', type: 'collection' }
            ]);
            expect(result).toEqual(['Patient_4_0_0']);
            expect(mockAdminLogger.logInfo).toHaveBeenCalledWith('system.indexes is an invalid collection');
        });
    });

    // =====================================================
    // filterCollections
    // =====================================================
    describe('filterCollections', () => {
        test('pairs a requested collection with its _History sibling when both exist', () => {
            const runner = makeRunner({ collections: ['Patient_4_0_0'] });
            const result = runner.filterCollections(['Patient_4_0_0', 'Patient_4_0_0_History']);
            expect(result).toEqual([['Patient_4_0_0', 'Patient_4_0_0_History']]);
        });

        test('does not pair a history collection when none exists', () => {
            const runner = makeRunner({ collections: ['Patient_4_0_0'] });
            const result = runner.filterCollections(['Patient_4_0_0']);
            expect(result).toEqual([['Patient_4_0_0']]);
        });

        test('defaults to including every valid collection when no explicit collections list is given', () => {
            const runner = makeRunner({ collections: undefined });
            const result = runner.filterCollections(['Patient_4_0_0', 'Practitioner_4_0_0']);
            expect(result).toEqual([['Patient_4_0_0'], ['Practitioner_4_0_0']]);
        });

        test('only includes explicitly requested collections when a collections list is given', () => {
            const runner = makeRunner({ collections: ['Patient_4_0_0'] });
            const result = runner.filterCollections(['Patient_4_0_0', 'Practitioner_4_0_0']);
            expect(result).toEqual([['Patient_4_0_0']]);
        });

        test('silently omits a requested collection name that does not exist among valid collections', () => {
            // Documents current behavior: filterCollections iterates the real (valid) collection
            // names, not the requested list, so a typo'd/nonexistent requested collection name
            // produces no output row and no warning is logged.
            const runner = makeRunner({ collections: ['DoesNotExist_4_0_0'] });
            const result = runner.filterCollections(['Patient_4_0_0']);
            expect(result).toEqual([]);
        });

        test('never includes a _History collection as its own top-level entry', () => {
            const runner = makeRunner({ collections: ['Patient_4_0_0_History'] });
            const result = runner.filterCollections(['Patient_4_0_0_History']);
            expect(result).toEqual([]);
        });
    });

    // =====================================================
    // processAsync
    // =====================================================
    describe('processAsync', () => {
        function makeDb ({ collectionNames, countsByName }) {
            return {
                listCollections: jestGlobal.fn().mockReturnValue({
                    toArray: jestGlobal.fn().mockResolvedValue(
                        collectionNames.map((name) => ({ name, type: 'collection' }))
                    )
                }),
                collection: jestGlobal.fn((name) => ({
                    countDocuments: jestGlobal.fn().mockImplementation(() => {
                        const value = countsByName[name];
                        if (value instanceof Error) {
                            return Promise.reject(value);
                        }
                        return Promise.resolve(value);
                    })
                }))
            };
        }

        test('sums main + history document counts across every collection and logs a summary', async () => {
            const db = makeDb({
                collectionNames: ['Patient_4_0_0', 'Patient_4_0_0_History', 'Practitioner_4_0_0'],
                countsByName: { Patient_4_0_0: 10, Patient_4_0_0_History: 4, Practitioner_4_0_0: 6 }
            });
            mockMongoDatabaseManager.getClientDbAsync = jestGlobal.fn().mockResolvedValue(db);
            const runner = makeRunner();

            await runner.processAsync();

            expect(mockAdminLogger.logInfo).toHaveBeenCalledWith(
                'Total documents in main db = 16, total documents in target db = 4'
            );
        });

        test('a countDocuments failure is caught, logged via adminLogger.logError, and does not throw', async () => {
            const db = makeDb({
                collectionNames: ['Patient_4_0_0'],
                countsByName: { Patient_4_0_0: new Error('mongo timeout') }
            });
            mockMongoDatabaseManager.getClientDbAsync = jestGlobal.fn().mockResolvedValue(db);
            const runner = makeRunner();

            await expect(runner.processAsync()).resolves.toBeUndefined();

            expect(mockAdminLogger.logError).toHaveBeenCalledWith(expect.stringContaining('mongo timeout'));
        });

        test('always logs "Connection Closed." even after an error, via the finally block', async () => {
            const db = makeDb({
                collectionNames: ['Patient_4_0_0'],
                countsByName: { Patient_4_0_0: new Error('boom') }
            });
            mockMongoDatabaseManager.getClientDbAsync = jestGlobal.fn().mockResolvedValue(db);
            const runner = makeRunner();

            await runner.processAsync();

            expect(mockAdminLogger.logInfo).toHaveBeenCalledWith('Connection Closed.');
        });

        test('restricts processing to only the explicitly requested collections', async () => {
            const db = makeDb({
                collectionNames: ['Patient_4_0_0', 'Practitioner_4_0_0'],
                countsByName: { Patient_4_0_0: 1, Practitioner_4_0_0: 100 }
            });
            mockMongoDatabaseManager.getClientDbAsync = jestGlobal.fn().mockResolvedValue(db);
            const runner = makeRunner({ collections: ['Patient_4_0_0'] });

            await runner.processAsync();

            expect(db.collection).toHaveBeenCalledWith('Patient_4_0_0');
            expect(db.collection).not.toHaveBeenCalledWith('Practitioner_4_0_0');
        });
    });
});
