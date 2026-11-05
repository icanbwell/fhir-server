const { describe, beforeEach, afterEach, test, expect, jest } = require('@jest/globals');
const { commonBeforeEach, commonAfterEach, createTestRequest, getTestContainer, getTestRequestInfo } = require('../../common');
const { AuditLogger } = require('../../../../utils/auditLogger');
const { ConfigManager } = require('../../../../utils/configManager');
const { ClickHouseBulkWriteExecutor } = require('../../../../dataLayer/bulkWriteExecutors/clickHouseBulkWriteExecutor');
const { MongoBulkWriteExecutor } = require('../../../../dataLayer/bulkWriteExecutors/mongoBulkWriteExecutor');

const MAX_RETRIES = 3;

class MockConfigManager extends ConfigManager {
    get clickHouseOnlyResources () {
        return ['AuditEvent'];
    }

    get enableAccessAuditEvent () {
        return true;
    }
}

describe('ClickHouseBulkWriteExecutor falls back to Mongo through the container wiring', () => {
    const genericClickHouseRepository = { insertAsync: jest.fn() };
    let auditLogger;
    let auditEventCollection;

    const logAuditEntriesAsync = async (patientIds) => {
        for (const patientId of patientIds) {
            await auditLogger.logAuditEntryAsync({
                requestInfo: getTestRequestInfo({ requestId: 'clickhouse-fallback-request' }),
                base_version: '4_0_0',
                resourceType: 'Patient',
                operation: 'read',
                args: {},
                ids: [patientId]
            });
        }
        await auditLogger.flushAsync();
    };

    beforeEach(async () => {
        await commonBeforeEach();
        genericClickHouseRepository.insertAsync.mockReset();
        await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManager());
            c.register('genericClickHouseRepository', () => genericClickHouseRepository);
            return c;
        });
        const container = getTestContainer();
        container.clickHouseBulkWriteExecutor.initialRetryDelayMs = 1;
        auditLogger = new AuditLogger({
            postRequestProcessor: container.postRequestProcessor,
            databaseBulkInserter: container.fastDatabaseBulkInserter,
            preSaveManager: container.preSaveManager,
            configManager: container.configManager
        });
        const auditDb = await container.mongoDatabaseManager.getAuditDbAsync();
        auditEventCollection = auditDb.collection('AuditEvent_4_0_0');
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('is wired with the Mongo executor as its fallback', () => {
        const container = getTestContainer();

        expect(container.clickHouseBulkWriteExecutor).toBeInstanceOf(ClickHouseBulkWriteExecutor);
        expect(container.clickHouseBulkWriteExecutor.fallbackExecutor).toBe(container.fastMongoBulkWriteExecutor);
        expect(container.fastMongoBulkWriteExecutor).toBeInstanceOf(MongoBulkWriteExecutor);
    });

    test('writes only to ClickHouse when the insert succeeds', async () => {
        genericClickHouseRepository.insertAsync.mockResolvedValue(undefined);

        await logAuditEntriesAsync(['patient-ok']);

        expect(genericClickHouseRepository.insertAsync).toHaveBeenCalledTimes(1);
        expect(await auditEventCollection.countDocuments({})).toBe(0);
    });

    test('writes the audit events to Mongo once ClickHouse retries are exhausted', async () => {
        genericClickHouseRepository.insertAsync.mockRejectedValue(new Error('clickhouse unavailable'));

        await logAuditEntriesAsync(['patient-a']);

        expect(genericClickHouseRepository.insertAsync).toHaveBeenCalledTimes(MAX_RETRIES + 1);
        const docs = await auditEventCollection.find({}).toArray();
        expect(docs).toHaveLength(1);
        expect(docs[0].resourceType).toBe('AuditEvent');
        expect(docs[0].action).toBe('R');
        expect(docs[0].entity[0].what.reference).toBe('Patient/patient-a');
        expect(docs[0]._uuid).toBe(docs[0].id);
        expect(docs[0].meta.security).toEqual(expect.arrayContaining([
            expect.objectContaining({ system: 'https://www.icanbwell.com/owner', code: 'bwell' }),
            expect.objectContaining({ system: 'https://www.icanbwell.com/access', code: 'bwell' })
        ]));
    });

    test('writes every audit event of a failed batch to Mongo in one flush', async () => {
        genericClickHouseRepository.insertAsync.mockRejectedValue(new Error('clickhouse unavailable'));

        await logAuditEntriesAsync(['patient-a', 'patient-b', 'patient-c']);

        expect(genericClickHouseRepository.insertAsync).toHaveBeenCalledTimes(MAX_RETRIES + 1);
        const docs = await auditEventCollection.find({}).toArray();
        expect(docs.map((d) => d.entity[0].what.reference).sort()).toEqual([
            'Patient/patient-a',
            'Patient/patient-b',
            'Patient/patient-c'
        ]);
    });

    test('recovers on a retry without touching Mongo', async () => {
        genericClickHouseRepository.insertAsync
            .mockRejectedValueOnce(new Error('transient'))
            .mockResolvedValue(undefined);

        await logAuditEntriesAsync(['patient-retry']);

        expect(genericClickHouseRepository.insertAsync).toHaveBeenCalledTimes(2);
        expect(await auditEventCollection.countDocuments({})).toBe(0);
    });
});
