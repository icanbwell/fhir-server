'use strict';

const { describe, test, expect, beforeEach, afterEach, jest: jestGlobal } = require('@jest/globals');

const fs = require('fs');

// the runner destructures validateResource at module-load time, so the module has to be
// replaced in the registry before the runner is required.
jestGlobal.mock('../../../../utils/validator.util', () => ({
    validateResource: jestGlobal.fn()
}));

const validatorUtil = require('../../../../utils/validator.util');

const { GetIncompatibleResourcesRunner } = require('../../../../admin/runners/getIncompatibleResourcesRunner');
const { AdminLogger } = require('../../../../admin/adminLogger');
const { MongoDatabaseManager } = require('../../../../utils/mongoDatabaseManager');

function createMockInstance (ClassType) {
    return Object.create(ClassType.prototype);
}

function makeWriteStream () {
    const chunks = [];
    let closed = false;
    let closeCb = null;
    return {
        chunks,
        write: jestGlobal.fn((data) => {
            chunks.push(data);
            return true;
        }),
        close: jestGlobal.fn(() => {
            closed = true;
            if (closeCb) closeCb();
        }),
        on: jestGlobal.fn((event, cb) => {
            if (event === 'close') {
                closeCb = cb;
                if (closed) cb();
            }
        })
    };
}

/**
 * Builds a DatabaseCursor-like object over the supplied resources.
 * @param {Object[]} resources
 */
function makeResourceCursor (resources) {
    let i = 0;
    return {
        hasNext: jestGlobal.fn().mockImplementation(async () => i < resources.length),
        nextObject: jestGlobal.fn().mockImplementation(async () => resources[i++])
    };
}

/**
 * Minimal resource stand-in exposing the two members validateCollectionAsync touches.
 */
function makeResource ({ uuid, json }) {
    return {
        _uuid: uuid,
        toJSON: () => JSON.parse(JSON.stringify(json))
    };
}

describe('GetIncompatibleResourcesRunner', () => {
    let runner;
    let mockAdminLogger;
    let mockMongoDatabaseManager;
    let mockDatabaseQueryFactory;
    let mockDatabaseQueryManager;
    let mkdirSpy;
    let createWriteStreamSpy;
    let validateResourceSpy;
    let currentWriteStream;

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

        mockDatabaseQueryManager = { findAsync: jestGlobal.fn() };
        mockDatabaseQueryFactory = {
            createQuery: jestGlobal.fn().mockReturnValue(mockDatabaseQueryManager)
        };

        mkdirSpy = jestGlobal.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
        currentWriteStream = makeWriteStream();
        createWriteStreamSpy = jestGlobal.spyOn(fs, 'createWriteStream')
            .mockImplementation(() => currentWriteStream);
        validateResourceSpy = validatorUtil.validateResource;
        validateResourceSpy.mockReset();
        validateResourceSpy.mockReturnValue(undefined);

        runner = new GetIncompatibleResourcesRunner({
            databaseQueryFactory: mockDatabaseQueryFactory,
            collections: ['Patient_4_0_0'],
            startFromCollection: undefined,
            limit: undefined,
            skip: undefined,
            startFromId: undefined,
            afterLastUpdatedDate: undefined,
            beforeLastUpdatedDate: undefined,
            adminLogger: mockAdminLogger,
            mongoDatabaseManager: mockMongoDatabaseManager,
            batchSize: 100
        });
    });

    afterEach(() => {
        mkdirSpy.mockRestore();
        createWriteStreamSpy.mockRestore();
    });

    // =====================================================
    // getQueryFromParams
    // =====================================================
    describe('getQueryFromParams', () => {
        test('returns an unfiltered query when no parameters are supplied', () => {
            expect(runner.getQueryFromParams()).toEqual({});
        });

        test('builds a $lt filter for beforeLastUpdatedDate alone', () => {
            runner.beforeLastUpdatedDate = '2023-12-31';

            expect(runner.getQueryFromParams()).toEqual({
                'meta.lastUpdated': { $lt: '2023-12-31' }
            });
        });

        test('builds a $gt filter for afterLastUpdatedDate alone', () => {
            runner.afterLastUpdatedDate = '2023-01-01';

            expect(runner.getQueryFromParams()).toEqual({
                'meta.lastUpdated': { $gt: '2023-01-01' }
            });
        });

        test('combines both bounds into one range filter', () => {
            runner.afterLastUpdatedDate = '2023-01-01';
            runner.beforeLastUpdatedDate = '2023-12-31';

            expect(runner.getQueryFromParams()).toEqual({
                'meta.lastUpdated': { $gt: '2023-01-01', $lt: '2023-12-31' }
            });
        });

        test('routes a uuid startFromId to the _uuid column', () => {
            runner.startFromId = '3f4c9d7e-0000-4000-8000-00000000000c';

            const query = runner.getQueryFromParams();

            expect(Object.keys(query)).toEqual(['_uuid']);
        });

        test('routes a non-uuid startFromId to the _sourceId column', () => {
            runner.startFromId = 'mrn-123';

            const query = runner.getQueryFromParams();

            expect(Object.keys(query)).toEqual(['_sourceId']);
        });

        test('ANDs the startFromId clause with the date range instead of replacing it', () => {
            runner.afterLastUpdatedDate = '2023-01-01';
            runner.startFromId = 'mrn-123';

            const query = runner.getQueryFromParams();

            expect(query.$and).toHaveLength(2);
            expect(query.$and[0]).toEqual({ 'meta.lastUpdated': { $gt: '2023-01-01' } });
            expect(Object.keys(query.$and[1])).toEqual(['_sourceId']);
        });

        test('startFromId pins the scan to a single document instead of resuming from it', () => {
            // getIncompatibleResourcesRunner.js:204-215 emits an EQUALITY clause
            // ({_sourceId: 'mrn-123'}). Every other runner in src/admin/runners treats startFromId
            // as a resume cursor and emits {$gte: startId} (fixConsentRunner.js:498-505,
            // fixReferenceIdRunner.js:1096-1105, fixCodeableConceptsRunner). Resuming an
            // interrupted validation run here therefore validates exactly ONE resource and reports
            // the entire remainder of the collection as clean.
            runner.startFromId = 'mrn-123';

            const query = runner.getQueryFromParams();

            expect(query._sourceId).toEqual({ $gte: 'mrn-123' });
        });
    });

    // =====================================================
    // validateCollectionAsync
    // =====================================================
    describe('validateCollectionAsync', () => {
        test('derives the resourceType from the collection name', async () => {
            mockDatabaseQueryManager.findAsync.mockResolvedValue(makeResourceCursor([]));

            await runner.validateCollectionAsync('Practitioner_4_0_0');

            expect(mockDatabaseQueryFactory.createQuery).toHaveBeenCalledWith({
                resourceType: 'Practitioner',
                base_version: '4_0_0'
            });
        });

        test('opens a per-resourceType csv and writes the header row', async () => {
            mockDatabaseQueryManager.findAsync.mockResolvedValue(makeResourceCursor([]));

            await runner.validateCollectionAsync('Patient_4_0_0');

            expect(createWriteStreamSpy).toHaveBeenCalledWith(
                './validationErrors/Patient-errors.csv',
                { flags: 'w' }
            );
            expect(currentWriteStream.chunks[0])
                .toBe('ResourceType| ResourceId| ValidationOperationOutcome|\n');
        });

        test('passes skip and limit through to the query manager', async () => {
            runner.skip = 100;
            runner.limit = 25;
            mockDatabaseQueryManager.findAsync.mockResolvedValue(makeResourceCursor([]));

            await runner.validateCollectionAsync('Patient_4_0_0');

            expect(mockDatabaseQueryManager.findAsync).toHaveBeenCalledWith({
                query: {},
                options: { skip: 100, limit: 25 }
            });
        });

        test('writes one csv row per invalid resource and none for valid ones', async () => {
            const resources = [
                makeResource({ uuid: 'u-bad', json: { resourceType: 'Patient', id: 'bad', meta: { lastUpdated: 'x' } } }),
                makeResource({ uuid: 'u-good', json: { resourceType: 'Patient', id: 'good', meta: { lastUpdated: 'x' } } })
            ];
            mockDatabaseQueryManager.findAsync.mockResolvedValue(makeResourceCursor(resources));
            validateResourceSpy
                .mockReturnValueOnce({ issue: [{ severity: 'error', diagnostics: 'bad gender' }] })
                .mockReturnValueOnce(undefined);

            await runner.validateCollectionAsync('Patient_4_0_0');

            const rows = currentWriteStream.chunks.slice(1);
            expect(rows).toHaveLength(1);
            expect(rows[0]).toContain('Patient| u-bad|');
            expect(rows[0]).toContain('bad gender');
        });

        test('strips meta.lastUpdated before validating (it is a Date in mongo, a string in FHIR)', async () => {
            const resources = [
                makeResource({
                    uuid: 'u1',
                    json: { resourceType: 'Patient', id: 'p1', meta: { lastUpdated: '2024-01-01', versionId: '3' } }
                })
            ];
            mockDatabaseQueryManager.findAsync.mockResolvedValue(makeResourceCursor(resources));

            await runner.validateCollectionAsync('Patient_4_0_0');

            const call = validateResourceSpy.mock.calls[0][0];
            expect(call.resourceBody.meta.lastUpdated).toBeUndefined();
            expect(call.resourceBody.meta.versionId).toBe('3');
            expect(call.resourceName).toBe('Patient');
            expect(call.path).toBe('Patient');
        });

        test('iterates every resource in the cursor, not just the first', async () => {
            const resources = [
                makeResource({ uuid: 'u1', json: { resourceType: 'Patient', meta: {} } }),
                makeResource({ uuid: 'u2', json: { resourceType: 'Patient', meta: {} } }),
                makeResource({ uuid: 'u3', json: { resourceType: 'Patient', meta: {} } })
            ];
            mockDatabaseQueryManager.findAsync.mockResolvedValue(makeResourceCursor(resources));

            await runner.validateCollectionAsync('Patient_4_0_0');

            expect(validateResourceSpy).toHaveBeenCalledTimes(3);
        });

        test('closes the csv stream when the collection has no documents', async () => {
            mockDatabaseQueryManager.findAsync.mockResolvedValue(makeResourceCursor([]));

            await runner.validateCollectionAsync('Patient_4_0_0');

            expect(currentWriteStream.close).toHaveBeenCalled();
            expect(currentWriteStream.chunks).toHaveLength(1); // header only
        });

        test('wraps a query failure in a RethrownError naming the collection', async () => {
            mockDatabaseQueryManager.findAsync.mockRejectedValue(new Error('mongo unavailable'));

            await expect(runner.validateCollectionAsync('Patient_4_0_0'))
                .rejects.toThrow(/Error in validateCollection: mongo unavailable/);
        });

        test('NEG-META-MISSING: a resource with no meta aborts the whole collection scan', async () => {
            // delete resourceJson.meta.lastUpdated (line 151) dereferences meta unconditionally.
            const resources = [
                makeResource({ uuid: 'u1', json: { resourceType: 'Patient', id: 'p1' } })
            ];
            mockDatabaseQueryManager.findAsync.mockResolvedValue(makeResourceCursor(resources));

            await expect(runner.validateCollectionAsync('Patient_4_0_0'))
                .rejects.toThrow(/Error in validateCollection/);
        });
    });

    // =====================================================
    // processAsync
    // =====================================================
    describe('processAsync', () => {
        test('validates each configured collection in order', async () => {
            runner.collections = ['Patient_4_0_0', 'Person_4_0_0'];
            runner.validateCollectionAsync = jestGlobal.fn().mockResolvedValue(undefined);

            await runner.processAsync();

            expect(runner.validateCollectionAsync.mock.calls.map((c) => c[0]))
                .toEqual(['Patient_4_0_0', 'Person_4_0_0']);
        });

        test('expands the "all" sentinel, sorts, and honours startFromCollection', async () => {
            runner.collections = ['all'];
            runner.startFromCollection = 'Patient_4_0_0';
            runner.getAllCollectionNamesAsync = jestGlobal.fn().mockResolvedValue([
                'Person_4_0_0', 'Account_4_0_0', 'Patient_4_0_0'
            ]);
            runner.validateCollectionAsync = jestGlobal.fn().mockResolvedValue(undefined);

            await runner.processAsync();

            expect(runner.getAllCollectionNamesAsync).toHaveBeenCalledWith({
                useAuditDatabase: false,
                includeHistoryCollections: false
            });
            expect(runner.collections).toEqual(['Patient_4_0_0', 'Person_4_0_0']);
        });

        test('tolerates an already-existing validationErrors directory', async () => {
            const err = new Error('exists');
            err.code = 'EEXIST';
            mkdirSpy.mockImplementation(() => { throw err; });
            runner.collections = ['Patient_4_0_0'];
            runner.validateCollectionAsync = jestGlobal.fn().mockResolvedValue(undefined);

            await runner.processAsync();

            expect(mockAdminLogger.logInfo).toHaveBeenCalledWith('Directory already exists');
            expect(runner.validateCollectionAsync).toHaveBeenCalledWith('Patient_4_0_0');
        });

        test('aborts without validating anything when the output directory cannot be created', async () => {
            const err = new Error('permission denied');
            err.code = 'EACCES';
            mkdirSpy.mockImplementation(() => { throw err; });
            runner.collections = ['Patient_4_0_0'];
            runner.validateCollectionAsync = jestGlobal.fn().mockResolvedValue(undefined);

            await runner.processAsync();

            expect(runner.validateCollectionAsync).not.toHaveBeenCalled();
            expect(mockAdminLogger.logError).toHaveBeenCalledWith(
                'ERROR: permission denied',
                expect.any(Object)
            );
        });

        test('a failing collection stops the run and is reported through the admin logger', async () => {
            runner.collections = ['Patient_4_0_0', 'Person_4_0_0'];
            runner.validateCollectionAsync = jestGlobal.fn()
                .mockRejectedValueOnce(new Error('collection blew up'))
                .mockResolvedValue(undefined);

            await runner.processAsync();

            expect(mockAdminLogger.logError).toHaveBeenCalledWith(
                'ERROR: collection blew up',
                expect.any(Object)
            );
        });
    });
});
