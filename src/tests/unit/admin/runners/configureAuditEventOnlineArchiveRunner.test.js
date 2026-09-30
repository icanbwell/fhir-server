'use strict';

const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

jestGlobal.mock('../../../../utils/digestAuth');

const {
    ConfigureAuditEventOnlineArchiveRunner
} = require('../../../../admin/runners/configureAuditEventOnlineArchiveRunner');
const { AdminLogger } = require('../../../../admin/adminLogger');
const { MongoDatabaseManager } = require('../../../../utils/mongoDatabaseManager');
const { RequestWithDigestAuth } = require('../../../../utils/digestAuth');

function createMockInstance (ClassType) {
    return Object.create(ClassType.prototype);
}

describe('ConfigureAuditEventOnlineArchiveRunner', () => {
    let runner;
    let mockAdminLogger;
    let mockMongoDatabaseManager;
    let mockRequestFn;

    beforeEach(() => {
        mockAdminLogger = createMockInstance(AdminLogger);
        mockAdminLogger.logInfo = jestGlobal.fn();
        mockAdminLogger.logError = jestGlobal.fn();

        mockMongoDatabaseManager = createMockInstance(MongoDatabaseManager);
        mockMongoDatabaseManager.getAuditConfigAsync = jestGlobal.fn().mockResolvedValue({
            connection: 'mongodb://localhost:27017', db_name: 'audit_db', options: {}
        });
        mockMongoDatabaseManager.createClientAsync = jestGlobal.fn().mockResolvedValue({
            db: jestGlobal.fn().mockReturnValue({ name: 'audit_db' })
        });

        mockRequestFn = jestGlobal.fn().mockResolvedValue({ status: 200, body: { _id: 'archive-1' } });
        RequestWithDigestAuth.mockImplementation(() => ({ request: mockRequestFn }));

        runner = new ConfigureAuditEventOnlineArchiveRunner({
            mongoDatabaseManager: mockMongoDatabaseManager,
            adminLogger: mockAdminLogger,
            collections: undefined,
            expireAfterDays: undefined
        });
    });

    // =====================================================
    // constructor
    // =====================================================
    describe('constructor', () => {
        test('defaults expireAfterDays to 60 when not provided', () => {
            expect(runner.expireAfterDays).toBe(60);
        });

        test('uses an explicitly provided expireAfterDays', () => {
            const custom = new ConfigureAuditEventOnlineArchiveRunner({
                mongoDatabaseManager: mockMongoDatabaseManager, adminLogger: mockAdminLogger, expireAfterDays: 90
            });
            expect(custom.expireAfterDays).toBe(90);
        });
    });

    // =====================================================
    // filterAuditEventCollections
    // =====================================================
    describe('filterAuditEventCollections', () => {
        test('keeps only collections whose name contains AuditEvent_4_0_0', () => {
            const result = runner.filterAuditEventCollections([
                'AuditEvent_4_0_0', 'AuditEvent_4_0_0_History', 'Patient_4_0_0'
            ]);
            expect(result).toEqual(['AuditEvent_4_0_0', 'AuditEvent_4_0_0_History']);
        });

        test('returns an empty array when no audit-event collections are present', () => {
            expect(runner.filterAuditEventCollections(['Patient_4_0_0'])).toEqual([]);
        });
    });

    // =====================================================
    // createCollection
    // =====================================================
    describe('createCollection', () => {
        test('sends the archive criteria with the configured expireAfterDays', async () => {
            runner.expireAfterDays = 45;

            await runner.createCollection({ config: { db_name: 'audit_db' }, collectionName: 'AuditEvent_4_0_0' });

            const [{ data }] = mockRequestFn.mock.calls[0];
            expect(data.collName).toBe('AuditEvent_4_0_0');
            expect(data.dbName).toBe('audit_db');
            expect(data.criteria.expireAfterDays).toBe(45);
            expect(data.criteria.dateField).toBe('recorded');
        });

        test('issues a POST request to the configured management API', async () => {
            process.env.AUDIT_EVENT_ONLINE_ARCHIVE_MANAGEMENT_API = 'https://mongo-atlas.example/api/archive';

            await runner.createCollection({ config: { db_name: 'audit_db' }, collectionName: 'AuditEvent_4_0_0' });

            const [request] = mockRequestFn.mock.calls[0];
            expect(request.method).toBe('post');
            expect(request.url).toBe('https://mongo-atlas.example/api/archive');
        });

        test('returns the response when the archive API answers 200', async () => {
            mockRequestFn.mockResolvedValue({ status: 200, body: { _id: 'ok-1' } });

            const response = await runner.createCollection({ config: {}, collectionName: 'AuditEvent_4_0_0' });

            expect(response.body._id).toBe('ok-1');
        });

        test('throws the response when the archive API answers a non-200 status', async () => {
            mockRequestFn.mockResolvedValue({ status: 400, body: { error: 'bad criteria' } });

            await expect(runner.createCollection({ config: {}, collectionName: 'AuditEvent_4_0_0' }))
                .rejects.toEqual({ status: 400, body: { error: 'bad criteria' } });
        });
    });

    // =====================================================
    // processAsync
    // =====================================================
    describe('processAsync', () => {
        test('uses the explicitly configured collection list instead of querying the database', async () => {
            runner.collections = ['AuditEvent_4_0_0'];

            await runner.processAsync();

            expect(mockRequestFn).toHaveBeenCalledTimes(1);
        });

        test('falls back to discovering collections and filters to AuditEvent ones only', async () => {
            runner.getAllCollectionNamesForDb = jestGlobal.fn().mockResolvedValue([
                'AuditEvent_4_0_0', 'Patient_4_0_0'
            ]);

            await runner.processAsync();

            expect(mockRequestFn).toHaveBeenCalledTimes(1);
            const [{ data }] = mockRequestFn.mock.calls[0];
            expect(data.collName).toBe('AuditEvent_4_0_0');
        });

        test('logs the created archive id for every successfully created collection', async () => {
            runner.collections = ['AuditEvent_4_0_0'];
            mockRequestFn.mockResolvedValue({ status: 200, body: { _id: 'archive-xyz' } });

            await runner.processAsync();

            expect(mockAdminLogger.logInfo).toHaveBeenCalledWith(expect.stringContaining('archive-xyz'));
        });

        test('logs a structured error and continues when the archive API rejects with a normal HTTP error shape', async () => {
            runner.collections = ['AuditEvent_4_0_0', 'AuditEvent_4_0_0_History'];
            mockRequestFn
                .mockRejectedValueOnce({ status: 409, response: { body: { error: 'already exists' } } })
                .mockResolvedValueOnce({ status: 200, body: { _id: 'ok-2' } });

            await runner.processAsync();

            expect(mockAdminLogger.logError).toHaveBeenCalledWith(expect.stringContaining('already exists'));
            expect(mockRequestFn).toHaveBeenCalledTimes(2);
        });

        test('a rejection with neither .status nor .response crashes the collection loop instead of being logged and skipped', async () => {
            // configureAuditEventOnlineArchiveRunner.js processAsync:
            //   const status = resp?.status || resp.response.status;
            // uses optional chaining for the first access but not the fallback. A plain network
            // failure (ECONNREFUSED, DNS failure, timeout) rejects with an Error that has neither
            // `.status` nor `.response` - the fallback then throws a TypeError from inside the
            // .catch() handler itself, which propagates out of the un-guarded `for` loop in
            // processAsync and aborts every remaining collection with no adminLogger.logError call
            // for the collection that actually failed.
            runner.collections = ['AuditEvent_4_0_0', 'AuditEvent_4_0_0_History'];
            mockRequestFn
                .mockRejectedValueOnce(new Error('ECONNREFUSED'))
                .mockResolvedValueOnce({ status: 200, body: { _id: 'ok-3' } });

            // CORRECT behaviour: a network-level failure on one collection must be logged, and the
            // remaining collections must still be attempted.
            await expect(runner.processAsync()).resolves.toBeUndefined();
            expect(mockRequestFn).toHaveBeenCalledTimes(2);
        });

        test('creates exactly one collection per filtered audit-event collection name', async () => {
            runner.collections = ['AuditEvent_4_0_0', 'AuditEvent_4_0_0_History', 'Patient_4_0_0'];

            await runner.processAsync();

            expect(mockRequestFn).toHaveBeenCalledTimes(2);
        });
    });
});
