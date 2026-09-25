'use strict';

const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

const { CreateAccessIndexRunner } = require('../../../../admin/runners/createAccessIndexFieldRunner');
const { AdminLogger } = require('../../../../admin/adminLogger');
const { MongoDatabaseManager } = require('../../../../utils/mongoDatabaseManager');
const { ConfigManager } = require('../../../../utils/configManager');
const { SecurityTagSystem } = require('../../../../utils/securityTagSystem');

function createMockInstance (ClassType) {
    return Object.create(ClassType.prototype);
}

/**
 * The exact projection createAccessIndexFieldRunner.processAsync (lines 158-166) hands to
 * runForQueryBatchesAsync. Documents reaching processRecordAsync have been shaped by it.
 */
const RUNNER_PROJECTION = {
    id: 1,
    'meta.security.system': 1,
    'meta.security.code': 1,
    _access: 1,
    _sourceAssigningAuthority: 1,
    _sourceId: 1,
    _uuid: 1
};


describe('CreateAccessIndexRunner', () => {
    let runner;
    let mockAdminLogger;
    let mockMongoDatabaseManager;
    let configManager;

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

        configManager = new ConfigManager();

        runner = new CreateAccessIndexRunner({
            collections: ['Patient_4_0_0'],
            batchSize: 100,
            useAuditDatabase: false,
            adminLogger: mockAdminLogger,
            mongoDatabaseManager: mockMongoDatabaseManager,
            configManager
        });
    });

    // =====================================================
    // constructor
    // =====================================================
    describe('constructor', () => {
        test('rejects a configManager that is not a ConfigManager instance', () => {
            expect(() => new CreateAccessIndexRunner({
                collections: ['Patient_4_0_0'],
                batchSize: 100,
                useAuditDatabase: false,
                adminLogger: mockAdminLogger,
                mongoDatabaseManager: mockMongoDatabaseManager,
                configManager: { preSaveCodingIdUpdateResources: [] }
            })).toThrow();
        });

        test('rejects a missing/zero batchSize', () => {
            expect(() => new CreateAccessIndexRunner({
                collections: ['Patient_4_0_0'],
                batchSize: 0,
                useAuditDatabase: false,
                adminLogger: mockAdminLogger,
                mongoDatabaseManager: mockMongoDatabaseManager,
                configManager
            })).toThrow();
        });
    });

    // =====================================================
    // processRecordAsync
    // =====================================================
    describe('processRecordAsync', () => {
        test('returns no operations when the document has no meta', async () => {
            const operations = await runner.processRecordAsync({ _id: 'a', resourceType: 'Patient', id: 'p1' });
            expect(operations).toEqual([]);
        });

        test('returns no operations when meta has no security array', async () => {
            const operations = await runner.processRecordAsync({
                _id: 'a', resourceType: 'Patient', id: 'p1', meta: { versionId: '1' }
            });
            expect(operations).toEqual([]);
        });

        test('builds _access from access tags only', async () => {
            const doc = {
                _id: 'a',
                resourceType: 'Patient',
                id: '3f4c9d7e-0000-4000-8000-000000000001',
                meta: {
                    security: [
                        { system: SecurityTagSystem.access, code: 'bwell' },
                        { system: SecurityTagSystem.access, code: 'client' },
                        { system: SecurityTagSystem.owner, code: 'bwell' }
                    ]
                }
            };

            const operations = await runner.processRecordAsync(doc);
            const setCommand = operations[0].updateOne.update.$set;

            expect(setCommand._access).toEqual({ bwell: 1, client: 1 });
        });

        test('SEC-ACCESS-TAG: owner and unrelated security systems never become _access entries', async () => {
            // fhir-server-security-data-model-spec: _access is the access-index projection of
            // meta.security entries whose system is the *access* system. Anything else leaking in
            // would widen read access to a tenant that was never granted it.
            const doc = {
                _id: 'a',
                resourceType: 'Patient',
                id: '3f4c9d7e-0000-4000-8000-000000000002',
                meta: {
                    security: [
                        { system: SecurityTagSystem.access, code: 'allowed' },
                        { system: SecurityTagSystem.owner, code: 'ownerOnly' },
                        { system: SecurityTagSystem.sourceAssigningAuthority, code: 'saaOnly' },
                        { system: 'https://example.com/other', code: 'otherOnly' }
                    ]
                }
            };

            const operations = await runner.processRecordAsync(doc);
            const setCommand = operations[0].updateOne.update.$set;

            expect(Object.keys(setCommand._access)).toEqual(['allowed']);
            expect(setCommand._access.ownerOnly).toBeUndefined();
            expect(setCommand._access.saaOnly).toBeUndefined();
            expect(setCommand._access.otherOnly).toBeUndefined();
        });

        test('does not recompute _access when the document already has it', async () => {
            const doc = {
                _id: 'a',
                resourceType: 'Patient',
                id: '3f4c9d7e-0000-4000-8000-000000000003',
                _access: { stale: 1 },
                _sourceAssigningAuthority: 'bwell',
                _sourceId: 'p3',
                _uuid: '3f4c9d7e-0000-4000-8000-000000000003',
                meta: { security: [{ system: SecurityTagSystem.access, code: 'bwell' }] }
            };

            const operations = await runner.processRecordAsync(doc);

            expect(operations).toEqual([]);
        });

        test('sets _sourceAssigningAuthority from the sourceAssigningAuthority tag', async () => {
            const doc = {
                _id: 'a',
                resourceType: 'Patient',
                id: '3f4c9d7e-0000-4000-8000-000000000004',
                _uuid: '3f4c9d7e-0000-4000-8000-000000000004',
                _sourceId: 'p4',
                meta: {
                    security: [
                        { system: SecurityTagSystem.access, code: 'bwell' },
                        { system: SecurityTagSystem.sourceAssigningAuthority, code: 'clientA' },
                        { system: SecurityTagSystem.owner, code: 'clientB' }
                    ]
                }
            };
            doc._access = { bwell: 1 };

            const operations = await runner.processRecordAsync(doc);
            const setCommand = operations[0].updateOne.update.$set;

            // the explicit sourceAssigningAuthority tag wins over the owner tag
            expect(setCommand._sourceAssigningAuthority).toBe('clientA');
        });

        test('SEC-SAA-OWNER-FALLBACK: falls back to the owner tag when no sourceAssigningAuthority tag exists', async () => {
            const doc = {
                _id: 'a',
                resourceType: 'Patient',
                id: '3f4c9d7e-0000-4000-8000-000000000005',
                _uuid: '3f4c9d7e-0000-4000-8000-000000000005',
                _sourceId: 'p5',
                _access: { bwell: 1 },
                meta: {
                    security: [
                        { system: SecurityTagSystem.access, code: 'bwell' },
                        { system: SecurityTagSystem.owner, code: 'ownerTenant' }
                    ]
                }
            };

            const operations = await runner.processRecordAsync(doc);
            const setCommand = operations[0].updateOne.update.$set;

            expect(setCommand._sourceAssigningAuthority).toBe('ownerTenant');
            // and the derived sourceAssigningAuthority tag is materialised into meta.security
            const saaTags = setCommand.meta.security.filter(
                (s) => s.system === SecurityTagSystem.sourceAssigningAuthority
            );
            expect(saaTags).toHaveLength(1);
            expect(saaTags[0].code).toBe('ownerTenant');
        });

        test('leaves an existing _sourceAssigningAuthority untouched', async () => {
            const doc = {
                _id: 'a',
                resourceType: 'Patient',
                id: '3f4c9d7e-0000-4000-8000-000000000006',
                _uuid: '3f4c9d7e-0000-4000-8000-000000000006',
                _sourceId: 'p6',
                _access: { bwell: 1 },
                _sourceAssigningAuthority: 'alreadySet',
                meta: {
                    security: [
                        { system: SecurityTagSystem.access, code: 'bwell' },
                        { system: SecurityTagSystem.owner, code: 'somethingElse' }
                    ]
                }
            };

            const operations = await runner.processRecordAsync(doc);

            expect(operations).toEqual([]);
        });

        test('sets _sourceId from the resource id', async () => {
            const doc = {
                _id: 'a',
                resourceType: 'Patient',
                id: '3f4c9d7e-0000-4000-8000-000000000007',
                _uuid: '3f4c9d7e-0000-4000-8000-000000000007',
                _access: { bwell: 1 },
                _sourceAssigningAuthority: 'bwell',
                meta: { security: [{ system: SecurityTagSystem.access, code: 'bwell' }] }
            };

            const operations = await runner.processRecordAsync(doc);
            const setCommand = operations[0].updateOne.update.$set;

            expect(setCommand._sourceId).toBe('3f4c9d7e-0000-4000-8000-000000000007');
        });

        test('sets _uuid to the id when the id is already a uuid', async () => {
            const doc = {
                _id: 'a',
                resourceType: 'Patient',
                id: '3f4c9d7e-0000-4000-8000-000000000008',
                _access: { bwell: 1 },
                _sourceAssigningAuthority: 'bwell',
                _sourceId: '3f4c9d7e-0000-4000-8000-000000000008',
                meta: { security: [{ system: SecurityTagSystem.access, code: 'bwell' }] }
            };

            const operations = await runner.processRecordAsync(doc);
            const setCommand = operations[0].updateOne.update.$set;

            expect(setCommand._uuid).toBe('3f4c9d7e-0000-4000-8000-000000000008');
        });

        test('SEC-UUID-SAA: derives _uuid deterministically from id|sourceAssigningAuthority for non-uuid ids', async () => {
            const { generateUUIDv5 } = require('../../../../utils/uid.util');

            const doc = {
                _id: 'a',
                resourceType: 'Patient',
                id: 'mrn-12345',
                _access: { bwell: 1 },
                _sourceId: 'mrn-12345',
                meta: {
                    security: [
                        { system: SecurityTagSystem.access, code: 'bwell' },
                        { system: SecurityTagSystem.owner, code: 'tenantA' }
                    ]
                }
            };

            const operations = await runner.processRecordAsync(doc);
            const setCommand = operations[0].updateOne.update.$set;

            expect(setCommand._uuid).toBe(generateUUIDv5('mrn-12345|tenantA'));
        });

        test('SEC-UUID-SAA-NEG: refuses to mint a _uuid when no sourceAssigningAuthority can be determined', async () => {
            // Without a tenant discriminator, a uuid-v5 derived from id alone would collide across
            // tenants (two tenants each holding "mrn-12345" would fold into one resource).
            const doc = {
                _id: 'a',
                resourceType: 'Patient',
                id: 'mrn-12345',
                _access: { bwell: 1 },
                _sourceId: 'mrn-12345',
                meta: { security: [{ system: SecurityTagSystem.access, code: 'bwell' }] }
            };

            await expect(runner.processRecordAsync(doc)).rejects.toThrow(
                /sourceAssigningAuthority is null/
            );
        });

        test('targets the update at the document _id', async () => {
            const doc = {
                _id: 'mongo-object-id-1',
                resourceType: 'Patient',
                id: '3f4c9d7e-0000-4000-8000-000000000009',
                meta: { security: [{ system: SecurityTagSystem.access, code: 'bwell' }] }
            };

            const operations = await runner.processRecordAsync(doc);

            expect(operations).toHaveLength(1);
            expect(operations[0].updateOne.filter).toEqual({ _id: 'mongo-object-id-1' });
        });

        test('emits a single updateOne carrying every derived field at once', async () => {
            const doc = {
                _id: 'a',
                resourceType: 'Patient',
                id: '3f4c9d7e-0000-4000-8000-00000000000a',
                meta: {
                    security: [
                        { system: SecurityTagSystem.access, code: 'bwell' },
                        { system: SecurityTagSystem.owner, code: 'bwell' }
                    ]
                }
            };

            const operations = await runner.processRecordAsync(doc);
            const setCommand = operations[0].updateOne.update.$set;

            expect(operations).toHaveLength(1);
            expect(setCommand._access).toEqual({ bwell: 1 });
            expect(setCommand._sourceAssigningAuthority).toBe('bwell');
            expect(setCommand._sourceId).toBe('3f4c9d7e-0000-4000-8000-00000000000a');
            expect(setCommand._uuid).toBe('3f4c9d7e-0000-4000-8000-00000000000a');
        });
    });

    // =====================================================
    // processAsync
    // =====================================================
    describe('processAsync', () => {
        test('expands the "all" sentinel into the real collection list', async () => {
            runner.collections = ['all'];
            runner.getAllCollectionNamesAsync = jestGlobal.fn().mockResolvedValue([
                'Patient_4_0_0', 'Person_4_0_0'
            ]);
            runner.runForQueryBatchesAsync = jestGlobal.fn().mockResolvedValue('done');

            await runner.processAsync();

            expect(runner.getAllCollectionNamesAsync).toHaveBeenCalledWith({ useAuditDatabase: false });
            expect(runner.collections).toEqual(['Patient_4_0_0', 'Person_4_0_0']);
            expect(runner.runForQueryBatchesAsync).toHaveBeenCalledTimes(2);
        });

        test('scans only documents missing _access and projects just the index fields', async () => {
            runner.collections = ['Patient_4_0_0'];
            runner.runForQueryBatchesAsync = jestGlobal.fn().mockResolvedValue('done');

            await runner.processAsync();

            const call = runner.runForQueryBatchesAsync.mock.calls[0][0];
            expect(call.query).toEqual({ _access: null });
            expect(call.projection).toEqual(RUNNER_PROJECTION);
            expect(call.sourceCollectionName).toBe('Patient_4_0_0');
            expect(call.destinationCollectionName).toBe('Patient_4_0_0');
            expect(call.batchSize).toBe(100);
        });

        test('resets startFromId between collections so a later collection never resumes mid-scan', async () => {
            runner.collections = ['Patient_4_0_0', 'Person_4_0_0'];
            const seenStartIds = [];
            runner.runForQueryBatchesAsync = jestGlobal.fn().mockImplementation(async ({ startFromIdContainer }) => {
                seenStartIds.push(startFromIdContainer.startFromId);
                startFromIdContainer.startFromId = 'left-over-id';
                return 'done';
            });

            await runner.processAsync();

            expect(seenStartIds).toEqual(['', '']);
        });

        test('continues to the next collection when one collection throws', async () => {
            runner.collections = ['Patient_4_0_0', 'Person_4_0_0'];
            runner.runForQueryBatchesAsync = jestGlobal.fn()
                .mockRejectedValueOnce(new Error('bulk write failed'))
                .mockResolvedValueOnce('done');

            await runner.processAsync();

            expect(runner.runForQueryBatchesAsync).toHaveBeenCalledTimes(2);
            expect(runner.runForQueryBatchesAsync.mock.calls[1][0].sourceCollectionName)
                .toBe('Person_4_0_0');
        });
    });
});
