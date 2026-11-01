const observation = require('./fixtures/observation.json');
const consent = require('./fixtures/consent.json');
const { describe, beforeEach, afterEach, jest, test, expect } = require('@jest/globals');
const { commonBeforeEach, commonAfterEach, getTestRequestInfo } = require('../../common');
const { createTestContainer } = require('../../createTestContainer');
const { HistoryKafkaProducer } = require('../../../../dataLayer/historyKafkaProducer');
const { MockKafkaClientV2 } = require('../../mocks/mockKafkaClientV2');
const Observation = require('../../../../fhir/classes/4_0_0/resources/observation');
const Consent = require('../../../../fhir/classes/4_0_0/resources/consent');

const base_version = '4_0_0';
const TOPIC = 'fhir_server.resource-history.events';
const ENV_KEYS = ['ENABLE_EVENTS_KAFKA_V2', 'KAFKA_HISTORY_RESOURCES'];

describe('History Kafka produce (parallel to MongoDB history)', () => {
    let savedEnv;

    beforeEach(async () => {
        await commonBeforeEach();
        jest.restoreAllMocks();
        savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
        process.env.ENABLE_EVENTS_KAFKA_V2 = '1';
        delete process.env.KAFKA_HISTORY_RESOURCES;
    });

    afterEach(async () => {
        ENV_KEYS.forEach((k) => (savedEnv[k] === undefined ? delete process.env[k] : (process.env[k] = savedEnv[k])));
        await commonAfterEach();
    });

    /**
     * Writes one synthetic Observation and one Consent, flushes history, and returns what landed where.
     */
    const writeAsync = async ({ failKafka = false } = {}) => {
        const container = createTestContainer((c) => {
            c.register('historyKafkaProducer', (cc) => new HistoryKafkaProducer({
                configManager: cc.configManager,
                kafkaClientV2: cc.kafkaClientV2,
                maxRetries: 1,
                initialRetryDelayMs: 1
            }));
            return c;
        });
        const sendSpy = jest.spyOn(MockKafkaClientV2.prototype, 'sendCloudEventMessageAsync');
        if (failKafka) {
            sendSpy.mockRejectedValue(new Error('broker down'));
        }
        const requestId = '1234';
        const requestInfo = getTestRequestInfo({ requestId });
        const inserter = container.databaseBulkInserter;
        await inserter.insertOneAsync({ base_version, requestInfo, resourceType: 'Observation', doc: new Observation(observation) });
        await inserter.insertOneAsync({ base_version, requestInfo, resourceType: 'Consent', doc: new Consent(consent) });
        const mergeResults = await inserter.executeAsync({ requestInfo, base_version });
        await container.postRequestProcessor.executeAsync({ requestId });
        await container.postRequestProcessor.waitTillAllRequestsDoneAsync({ timeoutInSeconds: 20 });

        const historyDb = await container.mongoDatabaseManager.getResourceHistoryDbAsync();
        const mongoHistoryCount = async (resourceType) => (
            await historyDb.collection(`${resourceType}_${base_version}_History`).countDocuments()
        );
        return {
            mergeResults,
            sendSpy,
            producedTypes: sendSpy.mock.calls.flatMap((c) => c[0].messages.map((m) => m.key.split(':')[0])),
            topics: [...new Set(sendSpy.mock.calls.map((c) => c[0].topic))],
            observationHistory: await mongoHistoryCount('Observation'),
            consentHistory: await mongoHistoryCount('Consent')
        };
    };

    test('flag off: nothing is produced, MongoDB history is written', async () => {
        const r = await writeAsync();
        expect(r.sendSpy).not.toHaveBeenCalled();
        expect(r.observationHistory).toStrictEqual(1);
        expect(r.consentHistory).toStrictEqual(1);
    });

    test('on for one type: only that type is produced, MongoDB history is written for both', async () => {
        process.env.KAFKA_HISTORY_RESOURCES = 'Observation';
        const r = await writeAsync();
        expect(r.producedTypes).toStrictEqual(['Observation']);
        expect(r.topics).toStrictEqual([TOPIC]);
        expect(r.observationHistory).toStrictEqual(1);
        expect(r.consentHistory).toStrictEqual(1);
    });

    test('on for two types: both are produced', async () => {
        process.env.KAFKA_HISTORY_RESOURCES = 'Observation,Consent';
        const r = await writeAsync();
        expect([...r.producedTypes].sort()).toStrictEqual(['Consent', 'Observation']);
        expect(r.observationHistory).toStrictEqual(1);
        expect(r.consentHistory).toStrictEqual(1);
    });

    test('Kafka down: write succeeds and MongoDB history is still written', async () => {
        process.env.KAFKA_HISTORY_RESOURCES = 'Observation';
        const r = await writeAsync({ failKafka: true });
        expect(r.sendSpy).toHaveBeenCalled();
        expect(r.mergeResults.length).toStrictEqual(2);
        expect(r.mergeResults.every((m) => m.created === true && !m.issue)).toBe(true);
        expect(r.observationHistory).toStrictEqual(1);
        expect(r.consentHistory).toStrictEqual(1);
    });

    test('DatabaseUpdateManager.postSaveAsync (admin link/unlink writer) also produces', async () => {
        process.env.KAFKA_HISTORY_RESOURCES = 'Observation';
        const container = createTestContainer();
        const sendSpy = jest.spyOn(MockKafkaClientV2.prototype, 'sendCloudEventMessageAsync');
        const requestInfo = getTestRequestInfo({ requestId: '5678' });
        const manager = container.databaseUpdateFactory.createDatabaseUpdateManager({ resourceType: 'Observation', base_version });
        const doc = new Observation(observation);
        doc._uuid = doc._uuid || 'synthetic-uuid-1';
        doc._sourceAssigningAuthority = doc._sourceAssigningAuthority || 'synthetic';
        await manager.postSaveAsync({ requestInfo, doc });
        expect(sendSpy).toHaveBeenCalledTimes(1);
        expect(sendSpy.mock.calls[0][0].messages[0].key).toBe(`Observation:${doc._uuid}`);
    });
});
