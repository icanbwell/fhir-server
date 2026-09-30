'use strict';

const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

const { ProaResourcesStats } = require('../../../../admin/runners/proaResourcesStatsRunner');
const { AdminLogger } = require('../../../../admin/adminLogger');
const { MongoDatabaseManager } = require('../../../../utils/mongoDatabaseManager');
const { SecurityTagSystem } = require('../../../../utils/securityTagSystem');

function createMockInstance (ClassType) {
    return Object.create(ClassType.prototype);
}

describe('ProaResourcesStats', () => {
    let mockAdminLogger;
    let mockMongoDatabaseManager;

    function makeDb (existingCollectionNames, countsByName = {}) {
        return {
            listCollections: jestGlobal.fn().mockReturnValue({
                toArray: jestGlobal.fn().mockResolvedValue(existingCollectionNames.map((name) => ({ name })))
            }),
            collection: jestGlobal.fn((name) => ({
                countDocuments: jestGlobal.fn().mockImplementation(() => {
                    const value = countsByName[name];
                    if (value instanceof Error) {
                        return Promise.reject(value);
                    }
                    return Promise.resolve(value ?? 0);
                })
            }))
        };
    }

    function makeRunner (overrides = {}) {
        return new ProaResourcesStats({
            mongoDatabaseManager: mockMongoDatabaseManager,
            collections: ['Patient_4_0_0'],
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
    // constructor
    // =====================================================
    describe('constructor', () => {
        test('rejects an adminLogger that is not an AdminLogger instance', () => {
            expect(() => makeRunner({ adminLogger: { logInfo: () => {} } })).toThrow();
        });

        test('rejects a mongoDatabaseManager that is not a MongoDatabaseManager instance', () => {
            expect(() => makeRunner({ mongoDatabaseManager: { getClientDbAsync: () => {} } })).toThrow();
        });
    });

    // =====================================================
    // processAsync
    // =====================================================
    describe('processAsync', () => {
        test('logs an error and skips a collection name that does not exist in the database', async () => {
            mockMongoDatabaseManager.getClientDbAsync = jestGlobal.fn().mockResolvedValue(
                makeDb(['Practitioner_4_0_0'])
            );
            const runner = makeRunner({ collections: ['DoesNotExist_4_0_0'] });

            await runner.processAsync();

            expect(mockAdminLogger.logError).toHaveBeenCalledWith(
                'Invalid Collection Name: DoesNotExist_4_0_0'
            );
        });

        test('counts and logs the number of PROA resources for a valid collection', async () => {
            const db = makeDb(['Patient_4_0_0'], { Patient_4_0_0: 42 });
            mockMongoDatabaseManager.getClientDbAsync = jestGlobal.fn().mockResolvedValue(db);
            const runner = makeRunner({ collections: ['Patient_4_0_0'] });

            await runner.processAsync();

            expect(mockAdminLogger.logInfo).toHaveBeenCalledWith(
                expect.stringContaining('Number of PROA resources in Patient_4_0_0: 42')
            );
        });

        test('queries using an exact connectionType=proa security $elemMatch filter', async () => {
            const db = makeDb(['Patient_4_0_0'], { Patient_4_0_0: 1 });
            mockMongoDatabaseManager.getClientDbAsync = jestGlobal.fn().mockResolvedValue(db);
            const runner = makeRunner({ collections: ['Patient_4_0_0'] });

            await runner.processAsync();

            const collectionInstance = db.collection.mock.results[0].value;
            expect(collectionInstance.countDocuments).toHaveBeenCalledWith({
                'meta.security': {
                    $elemMatch: { system: SecurityTagSystem.connectionType, code: 'proa' }
                }
            });
        });

        test('processes each requested collection independently: skips the invalid one, counts the valid one', async () => {
            const db = makeDb(['Patient_4_0_0'], { Patient_4_0_0: 5 });
            mockMongoDatabaseManager.getClientDbAsync = jestGlobal.fn().mockResolvedValue(db);
            const runner = makeRunner({ collections: ['DoesNotExist_4_0_0', 'Patient_4_0_0'] });

            await runner.processAsync();

            expect(mockAdminLogger.logError).toHaveBeenCalledWith('Invalid Collection Name: DoesNotExist_4_0_0');
            expect(mockAdminLogger.logInfo).toHaveBeenCalledWith(expect.stringContaining('Patient_4_0_0: 5'));
        });

        test('does not query any collection when the collections list is empty', async () => {
            const db = makeDb(['Patient_4_0_0'], { Patient_4_0_0: 5 });
            mockMongoDatabaseManager.getClientDbAsync = jestGlobal.fn().mockResolvedValue(db);
            const runner = makeRunner({ collections: [] });

            await runner.processAsync();

            expect(db.collection).not.toHaveBeenCalled();
        });

        test('a countDocuments failure is caught, logged via adminLogger.logError, and does not throw', async () => {
            const db = makeDb(['Patient_4_0_0'], { Patient_4_0_0: new Error('mongo timeout') });
            mockMongoDatabaseManager.getClientDbAsync = jestGlobal.fn().mockResolvedValue(db);
            const runner = makeRunner({ collections: ['Patient_4_0_0'] });

            await expect(runner.processAsync()).resolves.toBeUndefined();

            expect(mockAdminLogger.logError).toHaveBeenCalledWith(expect.stringContaining('mongo timeout'));
        });

        test('always logs "Finished Processing." via the finally block, even after an error', async () => {
            const db = makeDb(['Patient_4_0_0'], { Patient_4_0_0: new Error('boom') });
            mockMongoDatabaseManager.getClientDbAsync = jestGlobal.fn().mockResolvedValue(db);
            const runner = makeRunner({ collections: ['Patient_4_0_0'] });

            await runner.processAsync();

            expect(mockAdminLogger.logInfo).toHaveBeenCalledWith('Finished Processing.');
        });
    });
});
