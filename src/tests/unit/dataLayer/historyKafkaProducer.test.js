'use strict';

const { describe, test, beforeEach, afterEach, expect, jest } = require('@jest/globals');
const { validate: uuidValidate, version: uuidVersion } = require('uuid');
const { generateUUIDv5 } = require('../../../utils/uid.util');
const { HistoryKafkaProducer, CLOUD_EVENT_TYPE } = require('../../../dataLayer/historyKafkaProducer');
const { ConfigManager } = require('../../../utils/configManager');
const { KafkaClientV2 } = require('../../../utils/kafkaClientV2');
const metrics = require('../../../utils/metrics');

const ENV_KEYS = [
    'ENABLE_EVENTS_KAFKA_V2', 'RESOURCE_HISTORY_KAFKA_RESOURCES',
    'RESOURCE_HISTORY_KAFKA_TOPIC', 'RESOURCE_HISTORY_KAFKA_BATCH_SIZE', 'KAFKA_PRODUCER_TIMEOUT_MS', 'KAFKA_PRODUCER_COMPRESSION'
];

const historyOperation = (resourceType, uuid) => ({
    uuid,
    resourceType,
    operation: {
        insertOne: {
            document: {
                id: uuid,
                resource: {
                    resourceType,
                    id: `synthetic-${uuid}`,
                    meta: {
                        versionId: '1',
                        security: [
                            { system: 'https://www.icanbwell.com/access', code: 'synthetic-client' },
                            { system: 'https://www.icanbwell.com/owner', code: 'synthetic-owner' }
                        ]
                    }
                },
                request: { id: 'req-1', method: 'PUT', url: `/4_0_0/${resourceType}/synthetic-${uuid}` },
                _recorded: new Date('2026-01-02T03:04:05.678Z'),
                _id: 'mongo-internal-id'
            }
        }
    }
});

describe('HistoryKafkaProducer', () => {
    let savedEnv;
    let producer;
    let kafkaClientV2;
    let recordSpy;

    const setEnv = (values) => Object.assign(process.env, values);

    beforeEach(() => {
        savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
        ENV_KEYS.forEach((k) => delete process.env[k]);
        setEnv({ ENABLE_EVENTS_KAFKA_V2: '1', RESOURCE_HISTORY_KAFKA_RESOURCES: 'Observation' });
        recordSpy = jest.spyOn(metrics, 'recordHistoryKafkaProduce').mockImplementation(() => {});
        kafkaClientV2 = Object.assign(Object.create(KafkaClientV2.prototype), {
            sendCloudEventMessageAsync: jest.fn().mockResolvedValue(undefined)
        });
        producer = new HistoryKafkaProducer({
            configManager: new ConfigManager(),
            kafkaClientV2,
            maxRetries: 2,
            initialRetryDelayMs: 1
        });
    });

    afterEach(() => {
        ENV_KEYS.forEach((k) => (savedEnv[k] === undefined ? delete process.env[k] : (process.env[k] = savedEnv[k])));
        jest.restoreAllMocks();
    });

    test.each([
        ['Kafka V2 disabled', { ENABLE_EVENTS_KAFKA_V2: '0' }, 'Observation'],
        ['allowlist empty (feature off)', { RESOURCE_HISTORY_KAFKA_RESOURCES: '' }, 'Observation'],
        ['type not listed', {}, 'Condition']
    ])('produces nothing when %s', async (_name, env, resourceType) => {
        setEnv(env);
        await producer.produceAsync({ resourceType, operations: [historyOperation(resourceType, 'u1')], requestId: 'r1' });
        expect(kafkaClientV2.sendCloudEventMessageAsync).not.toHaveBeenCalled();
    });

    test('flag on for one type: produces that type only', async () => {
        await producer.produceAsync({ resourceType: 'Observation', operations: [historyOperation('Observation', 'u1')], requestId: 'r1' });
        await producer.produceAsync({ resourceType: 'Condition', operations: [historyOperation('Condition', 'u2')], requestId: 'r1' });

        expect(kafkaClientV2.sendCloudEventMessageAsync).toHaveBeenCalledTimes(1);
        const { topic, messages } = kafkaClientV2.sendCloudEventMessageAsync.mock.calls[0][0];
        expect(topic).toBe('fhir_server.resource-history.events');
        expect(messages).toHaveLength(1);
        expect(messages[0].key).toBe('Observation:u1');
        // flat row for the history table: one top-level key per column, `raw` is the BundleEntry as written
        const row = JSON.parse(messages[0].value);
        expect(row).toStrictEqual({
            resource_type: 'Observation',
            _uuid: 'u1',
            _recorded: '2026-01-02T03:04:05.678Z',
            version_id: '1',
            access_tags: ['synthetic-client'],
            raw: {
                id: 'u1',
                resource: expect.objectContaining({ resourceType: 'Observation', id: 'synthetic-u1' }),
                request: { id: 'req-1', method: 'PUT', url: '/4_0_0/Observation/synthetic-u1' },
                _recorded: '2026-01-02T03:04:05.678Z'
            }
        });
        expect(Object.keys(row.raw)).not.toContain('_id');
        expect(messages[0].headers).toMatchObject({
            ce_specversion: '1.0',
            ce_type: CLOUD_EVENT_TYPE,
            ce_source: '/fhir-server',
            'content-type': 'application/json',
            ce_id: generateUUIDv5('Observation|u1|1|1767323045678')
        });
    });

    test('ce_id is a deterministic uuid5 that differs per resource type and recorded time', async () => {
        const later = historyOperation('Observation', 'u1');
        later.operation.insertOne.document._recorded = new Date('2026-01-02T03:04:06.000Z');
        await producer.produceAsync({
            resourceType: 'Observation',
            operations: [historyOperation('Observation', 'u1'), historyOperation('Observation', 'u1'), later],
            requestId: 'r1'
        });
        const ids = kafkaClientV2.sendCloudEventMessageAsync.mock.calls[0][0].messages.map((m) => m.headers.ce_id);
        expect(uuidValidate(ids[0]) && uuidVersion(ids[0])).toBe(5);
        expect(ids[0]).toBe(ids[1]);
        expect(ids[2]).not.toBe(ids[0]);
    });

    test('ce_id differs per meta.versionId even within the same millisecond', async () => {
        const v1 = historyOperation('Observation', 'u1');
        const v2 = historyOperation('Observation', 'u1');
        v2.operation.insertOne.document.resource.meta = { versionId: '2' };
        await producer.produceAsync({ resourceType: 'Observation', operations: [v1, v2], requestId: 'r1' });
        const [a, b] = kafkaClientV2.sendCloudEventMessageAsync.mock.calls[0][0].messages.map((m) => m.headers.ce_id);
        expect(a).toBe(generateUUIDv5('Observation|u1|1|1767323045678'));
        expect(a).not.toBe(b);
    });

    test('flag on for two types: both produce, and the list is read per call', async () => {
        setEnv({ RESOURCE_HISTORY_KAFKA_RESOURCES: 'Observation, Condition' });
        await producer.produceAsync({ resourceType: 'Observation', operations: [historyOperation('Observation', 'u1')], requestId: 'r1' });
        await producer.produceAsync({ resourceType: 'Condition', operations: [historyOperation('Condition', 'u2')], requestId: 'r1' });
        expect(kafkaClientV2.sendCloudEventMessageAsync).toHaveBeenCalledTimes(2);

        setEnv({ RESOURCE_HISTORY_KAFKA_RESOURCES: 'Observation' });
        await producer.produceAsync({ resourceType: 'Condition', operations: [historyOperation('Condition', 'u3')], requestId: 'r1' });
        expect(kafkaClientV2.sendCloudEventMessageAsync).toHaveBeenCalledTimes(2);
    });

    test.each([['0'], ['-5'], ['abc'], ['']])('invalid RESOURCE_HISTORY_KAFKA_BATCH_SIZE=%j falls back to 50 and still sends everything', async (value) => {
        setEnv({ RESOURCE_HISTORY_KAFKA_BATCH_SIZE: value });
        expect(new ConfigManager().resourceHistoryKafkaBatchSize).toBe(50);
        const operations = Array.from({ length: 3 }, (_, i) => historyOperation('Observation', `u${i}`));
        await producer.produceAsync({ resourceType: 'Observation', operations, requestId: 'r1' });
        expect(kafkaClientV2.sendCloudEventMessageAsync.mock.calls[0][0].messages).toHaveLength(3);
    });

    test('splits a large flush into batches and honours the topic override', async () => {
        setEnv({ RESOURCE_HISTORY_KAFKA_BATCH_SIZE: '2', RESOURCE_HISTORY_KAFKA_TOPIC: 'test.history' });
        const operations = ['a', 'b', 'c', 'd', 'e'].map((u) => historyOperation('Observation', u));
        await producer.produceAsync({ resourceType: 'Observation', operations, requestId: 'r1' });
        const calls = kafkaClientV2.sendCloudEventMessageAsync.mock.calls.map((c) => c[0]);
        expect(calls.map((c) => c.messages.length)).toEqual([2, 2, 1]);
        expect(calls.every((c) => c.topic === 'test.history')).toBe(true);
    });

    test('Kafka failure: retries, never throws, counts the failure', async () => {
        kafkaClientV2.sendCloudEventMessageAsync.mockRejectedValue(new Error('broker down'));
        await expect(producer.produceAsync({
            resourceType: 'Observation', operations: [historyOperation('Observation', 'u1')], requestId: 'r1'
        })).resolves.toBeUndefined();

        expect(kafkaClientV2.sendCloudEventMessageAsync).toHaveBeenCalledTimes(3); // 1 + maxRetries
        expect(recordSpy).toHaveBeenCalledTimes(1);
        expect(recordSpy).toHaveBeenCalledWith('Observation', 1, false, expect.any(Number));
    });

    test('a chunk-specific rejection is not retried and only the bad record is lost', async () => {
        const tooLarge = new Error('too large');
        tooLarge.type = 'MESSAGE_TOO_LARGE';
        kafkaClientV2.sendCloudEventMessageAsync.mockImplementation(async ({ messages }) => {
            if (messages.some((m) => m.key === 'Observation:bad')) throw tooLarge;
        });
        await producer.produceAsync({
            resourceType: 'Observation',
            operations: [historyOperation('Observation', 'good'), historyOperation('Observation', 'bad')],
            requestId: 'r1'
        });
        const calls = kafkaClientV2.sendCloudEventMessageAsync.mock.calls.map((c) => c[0]);
        // whole chunk once, then record by record (no retries)
        expect(calls.map((c) => c.messages.map((m) => m.key))).toStrictEqual([
            ['Observation:good', 'Observation:bad'],
            ['Observation:good'],
            ['Observation:bad']
        ]);
        expect(recordSpy).toHaveBeenCalledWith('Observation', 1, true, expect.any(Number));
        expect(recordSpy).toHaveBeenCalledWith('Observation', 1, false, expect.any(Number));
    });

    test('a hung produce times out instead of blocking', async () => {
        const slow = new HistoryKafkaProducer({
            configManager: new ConfigManager(), kafkaClientV2, maxRetries: 2, initialRetryDelayMs: 1, produceTimeoutMs: 20
        });
        kafkaClientV2.sendCloudEventMessageAsync.mockReturnValue(new Promise(() => {}));
        await slow.produceAsync({ resourceType: 'Observation', operations: [historyOperation('Observation', 'u1')], requestId: 'r1' });
        expect(recordSpy).toHaveBeenCalledWith('Observation', 1, false, expect.any(Number));
        // a timed-out send may still deliver, so it is never resent
        expect(kafkaClientV2.sendCloudEventMessageAsync).toHaveBeenCalledTimes(1);
    });

    test.each([[undefined, 10000], ['', 10000], ['0', 10000], ['-5', 10000], ['abc', 10000], ['2500', 2500]])(
        'KAFKA_PRODUCER_TIMEOUT_MS=%j resolves to %j ms', (value, expected) => {
            if (value === undefined) delete process.env.KAFKA_PRODUCER_TIMEOUT_MS;
            else setEnv({ KAFKA_PRODUCER_TIMEOUT_MS: value });
            expect(new ConfigManager().kafkaProducerTimeoutMs).toBe(expected);
        });

    test('the timeout comes from config when not overridden', async () => {
        setEnv({ KAFKA_PRODUCER_TIMEOUT_MS: '20' });
        const configured = new HistoryKafkaProducer({
            configManager: new ConfigManager(), kafkaClientV2, maxRetries: 2, initialRetryDelayMs: 1
        });
        kafkaClientV2.sendCloudEventMessageAsync.mockReturnValue(new Promise(() => {}));
        await configured.produceAsync({ resourceType: 'Observation', operations: [historyOperation('Observation', 'u1')], requestId: 'r1' });
        expect(recordSpy).toHaveBeenCalledWith('Observation', 1, false, expect.any(Number));
        expect(kafkaClientV2.sendCloudEventMessageAsync).toHaveBeenCalledTimes(1);
    });

    test('an unexpected failure is counted, not only logged', async () => {
        setEnv({ KAFKA_PRODUCER_COMPRESSION: 'not-a-codec' });
        await expect(producer.produceAsync({
            resourceType: 'Observation', operations: [historyOperation('Observation', 'u1')], requestId: 'r1'
        })).resolves.toBeUndefined();
        expect(recordSpy).toHaveBeenCalledWith('Observation', 1, false, expect.any(Number));
        expect(kafkaClientV2.sendCloudEventMessageAsync).not.toHaveBeenCalled();
    });

    test('success is counted', async () => {
        await producer.produceAsync({ resourceType: 'Observation', operations: [historyOperation('Observation', 'u1')], requestId: 'r1' });
        expect(recordSpy).toHaveBeenCalledWith('Observation', 1, true, expect.any(Number));
    });
});
