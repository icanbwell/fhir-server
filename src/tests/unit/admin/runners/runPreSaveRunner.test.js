'use strict';

const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

const { RunPreSaveRunner } = require('../../../../admin/runners/runPreSaveRunner');
const { AdminLogger } = require('../../../../admin/adminLogger');
const { MongoDatabaseManager } = require('../../../../utils/mongoDatabaseManager');
const { PreSaveManager } = require('../../../../preSaveHandlers/preSave');
const { SourceIdColumnHandler } = require('../../../../preSaveHandlers/handlers/sourceIdColumnHandler');
const { SourceAssigningAuthorityColumnHandler } = require('../../../../preSaveHandlers/handlers/sourceAssigningAuthorityColumnHandler');
const { UuidColumnHandler } = require('../../../../preSaveHandlers/handlers/uuidColumnHandler');
const { AccessColumnHandler } = require('../../../../preSaveHandlers/handlers/accessColumnHandler');
const { ConfigManager } = require('../../../../utils/configManager');
const { SecurityTagSystem } = require('../../../../utils/securityTagSystem');

function createMockInstance (ClassType) {
    return Object.create(ClassType.prototype);
}

const UUID_ID = '3f4c9d7e-0000-4000-8000-0000000000b1';

function makePatientDoc (overrides = {}) {
    return {
        _id: 'mongo-1',
        resourceType: 'Patient',
        id: UUID_ID,
        meta: {
            versionId: '1',
            lastUpdated: '2024-01-02T03:04:05.000Z',
            security: [
                { system: SecurityTagSystem.owner, code: 'tenantA' },
                { system: SecurityTagSystem.access, code: 'tenantA' }
            ]
        },
        ...overrides
    };
}

describe('RunPreSaveRunner', () => {
    let runner;
    let mockAdminLogger;
    let mockMongoDatabaseManager;
    let preSaveManager;

    beforeEach(() => {
        mockAdminLogger = createMockInstance(AdminLogger);
        mockAdminLogger.logInfo = jestGlobal.fn();
        mockAdminLogger.logError = jestGlobal.fn();

        mockMongoDatabaseManager = createMockInstance(MongoDatabaseManager);
        mockMongoDatabaseManager.getClientConfigAsync = jestGlobal.fn().mockResolvedValue({
            connection: 'mongodb://localhost:27017',
            db_name: 'client_db',
            options: {}
        });
        mockMongoDatabaseManager.getAuditConfigAsync = jestGlobal.fn().mockResolvedValue({
            connection: 'mongodb://localhost:27017',
            db_name: 'audit_db',
            options: {}
        });

        const configManager = new ConfigManager();
        // real handlers - the value of this runner is the transform they perform end to end
        preSaveManager = new PreSaveManager({
            preSaveHandlers: [
                new SourceIdColumnHandler(),
                new SourceAssigningAuthorityColumnHandler({ configManager }),
                new UuidColumnHandler({ configManager }),
                new AccessColumnHandler()
            ]
        });

        runner = new RunPreSaveRunner({
            collections: ['Patient_4_0_0'],
            batchSize: 100,
            afterLastUpdatedDate: undefined,
            beforeLastUpdatedDate: undefined,
            useAuditDatabase: false,
            adminLogger: mockAdminLogger,
            mongoDatabaseManager: mockMongoDatabaseManager,
            preSaveManager,
            includeHistoryCollections: false,
            startFromCollection: undefined,
            limit: undefined
        });
    });

    // =====================================================
    // constructor
    // =====================================================
    describe('constructor', () => {
        test('rejects a preSaveManager that is not a PreSaveManager instance', () => {
            expect(() => new RunPreSaveRunner({
                collections: ['Patient_4_0_0'],
                batchSize: 100,
                useAuditDatabase: false,
                adminLogger: mockAdminLogger,
                mongoDatabaseManager: mockMongoDatabaseManager,
                preSaveManager: { preSaveAsync: async () => {} }
            })).toThrow();
        });
    });

    // =====================================================
    // processRecordAsync
    // =====================================================
    describe('processRecordAsync', () => {
        test('skips documents with no meta', async () => {
            const operations = await runner.processRecordAsync({
                _id: 'a', resourceType: 'Patient', id: UUID_ID
            });
            expect(operations).toEqual([]);
        });

        test('skips documents whose meta carries no security tags', async () => {
            const operations = await runner.processRecordAsync({
                _id: 'a', resourceType: 'Patient', id: UUID_ID, meta: { versionId: '1' }
            });
            expect(operations).toEqual([]);
        });

        test('refuses a document with no resourceType', async () => {
            const doc = makePatientDoc();
            delete doc.resourceType;

            await expect(runner.processRecordAsync(doc)).rejects.toThrow();
        });

        test('SEC-SAA-OWNER-FALLBACK: backfills _sourceAssigningAuthority from the owner tag', async () => {
            const operations = await runner.processRecordAsync(makePatientDoc());

            expect(operations).toHaveLength(1);
            const replacement = operations[0].replaceOne.replacement;
            expect(replacement._sourceAssigningAuthority).toBe('tenantA');
        });

        test('SEC-META-PRESERVE: the rewritten document keeps its original owner and access tags', async () => {
            // A preSave rewrite that drops meta.security would strand the resource: the access
            // index and every downstream read filter key off these tags.
            const operations = await runner.processRecordAsync(makePatientDoc());

            const security = operations[0].replaceOne.replacement.meta.security;
            expect(security).toEqual(expect.arrayContaining([
                expect.objectContaining({ system: SecurityTagSystem.owner, code: 'tenantA' }),
                expect.objectContaining({ system: SecurityTagSystem.access, code: 'tenantA' })
            ]));
        });

        test('materialises the derived sourceAssigningAuthority tag into meta.security', async () => {
            const operations = await runner.processRecordAsync(makePatientDoc());

            const security = operations[0].replaceOne.replacement.meta.security;
            const saaTags = security.filter(
                (s) => s.system === SecurityTagSystem.sourceAssigningAuthority
            );
            expect(saaTags).toHaveLength(1);
            expect(saaTags[0].code).toBe('tenantA');
        });

        test('SEC-ACCESS-INDEX: builds _access only from access-system tags', async () => {
            const doc = makePatientDoc({
                meta: {
                    versionId: '1',
                    security: [
                        { system: SecurityTagSystem.owner, code: 'ownerOnly' },
                        { system: SecurityTagSystem.access, code: 'allowed' }
                    ]
                }
            });

            const operations = await runner.processRecordAsync(doc);

            const replacement = operations[0].replaceOne.replacement;
            expect(replacement._access).toEqual({ allowed: 1 });
            expect(replacement._access.ownerOnly).toBeUndefined();
        });

        test('backfills _uuid and _sourceId', async () => {
            const operations = await runner.processRecordAsync(makePatientDoc());

            const replacement = operations[0].replaceOne.replacement;
            expect(replacement._uuid).toBe(UUID_ID);
            expect(replacement._sourceId).toBe(UUID_ID);
        });

        test('SEC-UUID-SAA: derives _uuid from id|sourceAssigningAuthority for non-uuid ids', async () => {
            const { generateUUIDv5 } = require('../../../../utils/uid.util');
            const doc = makePatientDoc({ id: 'mrn-777' });

            const operations = await runner.processRecordAsync(doc);

            expect(operations[0].replaceOne.replacement._uuid)
                .toBe(generateUUIDv5('mrn-777|tenantA'));
        });

        test('SEC-UUID-SAA-NEG: refuses to mint a tenant-less uuid when no owner/SAA tag exists', async () => {
            const doc = makePatientDoc({
                id: 'mrn-777',
                meta: {
                    versionId: '1',
                    security: [{ system: SecurityTagSystem.access, code: 'tenantA' }]
                }
            });

            await expect(runner.processRecordAsync(doc))
                .rejects.toThrow(/sourceAssigningAuthority is null/);
        });

        test('stamps a fresh Date on meta.lastUpdated when it writes', async () => {
            const before = Date.now();

            const operations = await runner.processRecordAsync(makePatientDoc());

            const lastUpdated = operations[0].replaceOne.replacement.meta.lastUpdated;
            expect(lastUpdated).toBeInstanceOf(Date);
            expect(lastUpdated.getTime()).toBeGreaterThanOrEqual(before - 1000);
        });

        test('returns no operations when preSave changes nothing', async () => {
            const doc = makePatientDoc({
                _uuid: UUID_ID,
                _sourceId: UUID_ID,
                _sourceAssigningAuthority: 'tenantA',
                _access: { tenantA: 1 },
                meta: {
                    versionId: '1',
                    lastUpdated: '2024-01-02T03:04:05.000Z',
                    security: [
                        { system: SecurityTagSystem.owner, code: 'tenantA' },
                        { system: SecurityTagSystem.access, code: 'tenantA' },
                        { system: SecurityTagSystem.sourceAssigningAuthority, code: 'tenantA' }
                    ]
                }
            });

            const operations = await runner.processRecordAsync(doc);

            expect(operations).toEqual([]);
        });

        test('targets the replace at the document _id', async () => {
            const operations = await runner.processRecordAsync(
                makePatientDoc({ _id: 'mongo-object-id-99' })
            );

            expect(operations[0].replaceOne.filter).toEqual({ _id: 'mongo-object-id-99' });
        });

        test('leaves the input document object untouched', async () => {
            const doc = makePatientDoc();

            await runner.processRecordAsync(doc);

            expect(doc._uuid).toBeUndefined();
            expect(doc._sourceAssigningAuthority).toBeUndefined();
            expect(doc.meta.security).toHaveLength(2);
        });
    });

    // =====================================================
    // processAsync
    // =====================================================
    describe('processAsync', () => {
        beforeEach(() => {
            runner.runForQueryBatchesAsync = jestGlobal.fn().mockResolvedValue('done');
        });

        test('defaults to scanning documents whose _sourceAssigningAuthority is not a string', async () => {
            await runner.processAsync();

            expect(runner.runForQueryBatchesAsync.mock.calls[0][0].query).toEqual({
                _sourceAssigningAuthority: { $not: { $type: 'string' } }
            });
        });

        test('scans by beforeLastUpdatedDate when only that bound is given', async () => {
            runner.beforeLastUpdatedDate = new Date('2023-12-31');

            await runner.processAsync();

            expect(runner.runForQueryBatchesAsync.mock.calls[0][0].query).toEqual({
                'meta.lastUpdated': { $lt: new Date('2023-12-31') }
            });
        });

        test('scans by afterLastUpdatedDate when only that bound is given', async () => {
            runner.afterLastUpdatedDate = new Date('2023-01-01');

            await runner.processAsync();

            expect(runner.runForQueryBatchesAsync.mock.calls[0][0].query).toEqual({
                'meta.lastUpdated': { $gt: new Date('2023-01-01') }
            });
        });

        test('scans a closed date range when both bounds are given', async () => {
            runner.afterLastUpdatedDate = new Date('2023-01-01');
            runner.beforeLastUpdatedDate = new Date('2023-12-31');

            await runner.processAsync();

            expect(runner.runForQueryBatchesAsync.mock.calls[0][0].query).toEqual({
                'meta.lastUpdated': {
                    $gt: new Date('2023-01-01'),
                    $lt: new Date('2023-12-31')
                }
            });
        });

        test('resets startFromId before each collection so collection N+1 never resumes mid-scan', async () => {
            runner.collections = ['Patient_4_0_0', 'Person_4_0_0'];
            const seen = [];
            runner.runForQueryBatchesAsync.mockImplementation(async ({ startFromIdContainer }) => {
                seen.push(startFromIdContainer.startFromId);
                startFromIdContainer.startFromId = 'left-over';
                return 'done';
            });

            await runner.processAsync();

            expect(seen).toEqual(['', '']);
        });

        test('expands the "all" sentinel, sorts, and honours startFromCollection', async () => {
            runner.collections = ['all'];
            runner.startFromCollection = 'Patient_4_0_0';
            runner.includeHistoryCollections = true;
            runner.getAllCollectionNamesAsync = jestGlobal.fn().mockResolvedValue([
                'Person_4_0_0', 'Account_4_0_0', 'Patient_4_0_0'
            ]);

            await runner.processAsync();

            expect(runner.getAllCollectionNamesAsync).toHaveBeenCalledWith({
                useAuditDatabase: false,
                includeHistoryCollections: true
            });
            expect(runner.collections).toEqual(['Patient_4_0_0', 'Person_4_0_0']);
        });

        test('writes back to the audit database when useAuditDatabase is set', async () => {
            runner.useAuditDatabase = true;

            await runner.processAsync();

            expect(mockMongoDatabaseManager.getAuditConfigAsync).toHaveBeenCalled();
            expect(runner.runForQueryBatchesAsync.mock.calls[0][0].config.db_name)
                .toBe('audit_db');
        });

        test('reads and writes the same collection (never cross-writes)', async () => {
            runner.collections = ['Patient_4_0_0', 'Person_4_0_0'];

            await runner.processAsync();

            for (const call of runner.runForQueryBatchesAsync.mock.calls) {
                expect(call[0].sourceCollectionName).toBe(call[0].destinationCollectionName);
            }
        });

        test('a collection whose bulk write fails is never reported to the admin logger', async () => {
            // runPreSaveRunner.js:201-204 - the per-collection catch only does console.error /
            // console.log. processAsync then resolves, and src/admin/scripts/runPreSave.js calls
            // process.exit(0) unconditionally. A run that failed to migrate an entire collection
            // is therefore indistinguishable from a clean run in the admin log and in the exit code.
            runner.collections = ['Patient_4_0_0', 'Person_4_0_0'];
            runner.runForQueryBatchesAsync
                .mockRejectedValueOnce(new Error('bulk write failed'))
                .mockResolvedValue('done');

            await runner.processAsync();

            // CORRECT behaviour: the failure must be surfaced through the admin logger
            // (every other runner in src/admin/runners uses adminLogger.logError here).
            expect(mockAdminLogger.logError).toHaveBeenCalledWith(
                expect.stringContaining('Patient_4_0_0'),
                expect.anything()
            );
        });
    });
});
