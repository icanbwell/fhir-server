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
const ENV_KEYS = ['ENABLE_EVENTS_KAFKA_V2', 'RESOURCE_HISTORY_KAFKA_RESOURCES', 'RESOURCE_HISTORY_MONGO_DISABLED_RESOURCES'];

describe('History Kafka produce (parallel to MongoDB history)', () => {
    let savedEnv;

    beforeEach(async () => {
        await commonBeforeEach();
        jest.restoreAllMocks();
        savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
        process.env.ENABLE_EVENTS_KAFKA_V2 = '1';
        delete process.env.RESOURCE_HISTORY_KAFKA_RESOURCES;
        delete process.env.RESOURCE_HISTORY_MONGO_DISABLED_RESOURCES;
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
        process.env.RESOURCE_HISTORY_KAFKA_RESOURCES = 'Observation';
        const r = await writeAsync();
        expect(r.producedTypes).toStrictEqual(['Observation']);
        expect(r.topics).toStrictEqual([TOPIC]);
        expect(r.observationHistory).toStrictEqual(1);
        expect(r.consentHistory).toStrictEqual(1);
    });

    test('on for two types: both are produced', async () => {
        process.env.RESOURCE_HISTORY_KAFKA_RESOURCES = 'Observation,Consent';
        const r = await writeAsync();
        expect([...r.producedTypes].sort()).toStrictEqual(['Consent', 'Observation']);
        expect(r.observationHistory).toStrictEqual(1);
        expect(r.consentHistory).toStrictEqual(1);
    });

    test('Kafka down: write succeeds and MongoDB history is still written', async () => {
        process.env.RESOURCE_HISTORY_KAFKA_RESOURCES = 'Observation';
        const r = await writeAsync({ failKafka: true });
        expect(r.sendSpy).toHaveBeenCalled();
        expect(r.mergeResults.length).toStrictEqual(2);
        expect(r.mergeResults.every((m) => m.created === true && !m.issue)).toBe(true);
        expect(r.observationHistory).toStrictEqual(1);
        expect(r.consentHistory).toStrictEqual(1);
    });

    describe('MongoDB history write disabled', () => {
        test('Kafka healthy: the disabled type is produced and not written to MongoDB, other types are unaffected', async () => {
            process.env.RESOURCE_HISTORY_KAFKA_RESOURCES = 'Observation';
            process.env.RESOURCE_HISTORY_MONGO_DISABLED_RESOURCES = 'Observation';
            const r = await writeAsync();
            expect(r.producedTypes).toStrictEqual(['Observation']);
            expect(r.observationHistory).toStrictEqual(0);
            expect(r.consentHistory).toStrictEqual(1);
            expect(r.mergeResults.every((m) => m.created === true && !m.issue)).toBe(true);
        });

        test('Kafka down: the FHIR write succeeds and the history falls back to MongoDB', async () => {
            process.env.RESOURCE_HISTORY_KAFKA_RESOURCES = 'Observation';
            process.env.RESOURCE_HISTORY_MONGO_DISABLED_RESOURCES = 'Observation';
            const r = await writeAsync({ failKafka: true });
            expect(r.sendSpy).toHaveBeenCalled();
            expect(r.mergeResults.length).toStrictEqual(2);
            expect(r.mergeResults.every((m) => m.created === true && !m.issue)).toBe(true);
            expect(r.observationHistory).toStrictEqual(1);
            expect(r.consentHistory).toStrictEqual(1);
        });

        test.each([
            ['not in the produce list', { RESOURCE_HISTORY_KAFKA_RESOURCES: 'Consent' }],
            ['produce list empty', {}],
            ['Kafka V2 disabled', { RESOURCE_HISTORY_KAFKA_RESOURCES: 'Observation', ENABLE_EVENTS_KAFKA_V2: '0' }]
        ])('listed as disabled but %s: MongoDB history is still written', async (_name, env) => {
            process.env.RESOURCE_HISTORY_MONGO_DISABLED_RESOURCES = 'Observation';
            Object.assign(process.env, env);
            const r = await writeAsync();
            expect(r.producedTypes).not.toContain('Observation');
            expect(r.observationHistory).toStrictEqual(1);
        });
    });

    test('AdminResourceWriter (admin link/unlink writer) also produces', async () => {
        process.env.RESOURCE_HISTORY_KAFKA_RESOURCES = 'Person';
        const container = createTestContainer();
        const sendSpy = jest.spyOn(MockKafkaClientV2.prototype, 'sendCloudEventMessageAsync');
        const requestInfo = getTestRequestInfo({ requestId: '5678' });
        const person = {
            resourceType: 'Person',
            id: 'synthetic-person-1',
            _uuid: '3d1f9c4e-6b1a-5f6e-9a55-5a2f1c1d7b01',
            _sourceId: 'synthetic-person-1',
            _sourceAssigningAuthority: 'synthetic',
            meta: {
                versionId: '1',
                source: 'http://example.com/source',
                security: [
                    { system: 'https://www.icanbwell.com/access', code: 'synthetic' },
                    { system: 'https://www.icanbwell.com/owner', code: 'synthetic' },
                    { system: 'https://www.icanbwell.com/sourceAssigningAuthority', code: 'synthetic' }
                ]
            },
            link: [{ target: { reference: 'Patient/synthetic-patient-1' } }]
        };
        await container.adminResourceWriter.writeAsync({
            requestInfo,
            base_version,
            resourceType: 'Person',
            resource: person
        });
        await container.postRequestProcessor.waitTillAllRequestsDoneAsync({ timeoutInSeconds: 20 });
        expect(sendSpy).toHaveBeenCalledTimes(1);
        expect(sendSpy.mock.calls[0][0].messages[0].key).toBe(`Person:${person._uuid}`);
    });
});
