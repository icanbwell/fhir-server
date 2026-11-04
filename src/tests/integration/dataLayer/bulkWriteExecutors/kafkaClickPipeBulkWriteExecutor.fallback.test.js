const { describe, beforeEach, afterEach, test, expect, jest } = require('@jest/globals');
const { commonBeforeEach, commonAfterEach, createTestRequest, getTestContainer, getTestRequestInfo } = require('../../common');
const { AuditLogger } = require('../../../../utils/auditLogger');
const { ConfigManager } = require('../../../../utils/configManager');
const { KafkaClickPipeBulkWriteExecutor } = require('../../../../dataLayer/bulkWriteExecutors/kafkaClickPipeBulkWriteExecutor');
const { MongoBulkWriteExecutor } = require('../../../../dataLayer/bulkWriteExecutors/mongoBulkWriteExecutor');

const MAX_RETRIES = 3;

class MockConfigManager extends ConfigManager {
    get enableAuditEventClickPipe () {
        return true;
    }

    get kafkaV2EnableEvents () {
        return true;
    }

    get enableAccessAuditEvent () {
        return true;
    }

    get auditEventClickPipeBatchSize () {
        return 1;
    }
}

describe('KafkaClickPipeBulkWriteExecutor falls back to Mongo through the container wiring', () => {
    let kafkaClientV2;
    let sendCloudEventMessageAsync;
    let auditLogger;
    let auditEventCollection;

    const logAuditEntriesAsync = async (patientIds) => {
        for (const patientId of patientIds) {
            await auditLogger.logAuditEntryAsync({
                requestInfo: getTestRequestInfo({ requestId: 'kafka-fallback-request' }),
                base_version: '4_0_0',
                resourceType: 'Patient',
                operation: 'read',
                args: {},
                ids: [patientId]
            });
        }
        await auditLogger.flushAsync();
    };

    const findPatientReferencesAsync = async () => {
        const docs = await auditEventCollection.find({}).toArray();
        return docs.map((d) => d.entity[0].what.reference).sort();
    };

    const kafkaError = (type) => Object.assign(new Error(`kafka ${type}`), { type });

    beforeEach(async () => {
        await commonBeforeEach();
        await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManager());
            return c;
        });
        const container = getTestContainer();
        kafkaClientV2 = container.kafkaClientV2;
        sendCloudEventMessageAsync = jest.spyOn(kafkaClientV2, 'sendCloudEventMessageAsync');
        kafkaClientV2.clear();
        container.kafkaClickPipeBulkWriteExecutor.initialRetryDelayMs = 1;
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
        sendCloudEventMessageAsync.mockRestore();
        await commonAfterEach();
    });

    test('is wired with the Mongo executor as its fallback', () => {
        const container = getTestContainer();

        expect(container.kafkaClickPipeBulkWriteExecutor).toBeInstanceOf(KafkaClickPipeBulkWriteExecutor);
        expect(container.kafkaClickPipeBulkWriteExecutor.fallbackExecutor).toBe(container.fastMongoBulkWriteExecutor);
        expect(container.fastMongoBulkWriteExecutor).toBeInstanceOf(MongoBulkWriteExecutor);
    });

    test('writes only to Kafka when the produce succeeds', async () => {
        await logAuditEntriesAsync(['patient-ok']);

        expect(kafkaClientV2.getCloudEventMessages()).toHaveLength(1);
        expect(await auditEventCollection.countDocuments({})).toBe(0);
    });

    test('writes the audit event to Mongo once Kafka retries are exhausted', async () => {
        sendCloudEventMessageAsync.mockRejectedValue(new Error('kafka unavailable'));

        await logAuditEntriesAsync(['patient-a']);

        expect(sendCloudEventMessageAsync).toHaveBeenCalledTimes(MAX_RETRIES + 1);
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

    test('sends the remaining chunks straight to Mongo without retrying Kafka again', async () => {
        sendCloudEventMessageAsync.mockRejectedValue(new Error('kafka unavailable'));

        await logAuditEntriesAsync(['patient-a', 'patient-b', 'patient-c']);

        expect(sendCloudEventMessageAsync).toHaveBeenCalledTimes(MAX_RETRIES + 1);
        expect(await findPatientReferencesAsync()).toEqual([
            'Patient/patient-a',
            'Patient/patient-b',
            'Patient/patient-c'
        ]);
    });

    test('falls back only the chunk Kafka rejects as chunk-specific, without retrying it', async () => {
        sendCloudEventMessageAsync
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(kafkaError('MESSAGE_TOO_LARGE'))
            .mockResolvedValueOnce(undefined);

        await logAuditEntriesAsync(['patient-a', 'patient-b', 'patient-c']);

        expect(sendCloudEventMessageAsync).toHaveBeenCalledTimes(3);
        expect(await findPatientReferencesAsync()).toEqual(['Patient/patient-b']);
    });
});
