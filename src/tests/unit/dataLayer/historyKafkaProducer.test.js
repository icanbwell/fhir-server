'use strict';

const { describe, test, beforeEach, afterEach, expect, jest } = require('@jest/globals');
const { validate: uuidValidate, version: uuidVersion } = require('uuid');
const { generateUUIDv5 } = require('../../../utils/uid.util');
const { HistoryKafkaProducer, CLOUD_EVENT_TYPE } = require('../../../dataLayer/historyKafkaProducer');
const { ConfigManager } = require('../../../utils/configManager');
const { KafkaClientV2 } = require('../../../utils/kafkaClientV2');
const metrics = require('../../../utils/metrics');

const ENV_KEYS = [
    'ENABLE_EVENTS_KAFKA_V2', 'KAFKA_HISTORY_RESOURCES',
    'KAFKA_HISTORY_EVENTS_TOPIC', 'HISTORY_KAFKA_BATCH_SIZE', 'AUDIT_EVENT_CLICKPIPE_COMPRESSION'
];

const historyOperation = (resourceType, uuid) => ({
    uuid,
    resourceType,
    operation: {
        insertOne: {
            document: {
                id: uuid,
                resource: { resourceType, id: `synthetic-${uuid}` },
                _recorded: new Date('2026-01-02T03:04:05.678Z')
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
        setEnv({ ENABLE_EVENTS_KAFKA_V2: '1', KAFKA_HISTORY_RESOURCES: 'Observation' });
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
        ['allowlist empty (feature off)', { KAFKA_HISTORY_RESOURCES: '' }, 'Observation'],
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
        expect(JSON.parse(messages[0].value)._recorded).toBe('2026-01-02T03:04:05.678Z');
        expect(messages[0].headers).toMatchObject({
            ce_specversion: '1.0',
            ce_type: CLOUD_EVENT_TYPE,
            ce_id: generateUUIDv5('Observation|u1||1767323045678')
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
        v1.operation.insertOne.document.resource.meta = { versionId: '1' };
        v2.operation.insertOne.document.resource.meta = { versionId: '2' };
        await producer.produceAsync({ resourceType: 'Observation', operations: [v1, v2], requestId: 'r1' });
        const [a, b] = kafkaClientV2.sendCloudEventMessageAsync.mock.calls[0][0].messages.map((m) => m.headers.ce_id);
        expect(a).toBe(generateUUIDv5('Observation|u1|1|1767323045678'));
        expect(a).not.toBe(b);
    });

    test('flag on for two types: both produce, and the list is read per call', async () => {
        setEnv({ KAFKA_HISTORY_RESOURCES: 'Observation, Condition' });
        await producer.produceAsync({ resourceType: 'Observation', operations: [historyOperation('Observation', 'u1')], requestId: 'r1' });
        await producer.produceAsync({ resourceType: 'Condition', operations: [historyOperation('Condition', 'u2')], requestId: 'r1' });
        expect(kafkaClientV2.sendCloudEventMessageAsync).toHaveBeenCalledTimes(2);

        setEnv({ KAFKA_HISTORY_RESOURCES: 'Observation' });
        await producer.produceAsync({ resourceType: 'Condition', operations: [historyOperation('Condition', 'u3')], requestId: 'r1' });
        expect(kafkaClientV2.sendCloudEventMessageAsync).toHaveBeenCalledTimes(2);
    });

    test.each([['0'], ['-5'], ['abc'], ['']])('invalid HISTORY_KAFKA_BATCH_SIZE=%j falls back to 50 and still sends everything', async (value) => {
        setEnv({ HISTORY_KAFKA_BATCH_SIZE: value });
        expect(new ConfigManager().historyKafkaBatchSize).toBe(50);
        const operations = Array.from({ length: 3 }, (_, i) => historyOperation('Observation', `u${i}`));
        await producer.produceAsync({ resourceType: 'Observation', operations, requestId: 'r1' });
        expect(kafkaClientV2.sendCloudEventMessageAsync.mock.calls[0][0].messages).toHaveLength(3);
    });

    test('splits a large flush into batches and honours the topic override', async () => {
        setEnv({ HISTORY_KAFKA_BATCH_SIZE: '2', KAFKA_HISTORY_EVENTS_TOPIC: 'test.history' });
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

        // 1 + maxRetries produce attempts, then one dead-letter publish
        expect(kafkaClientV2.sendCloudEventMessageAsync).toHaveBeenCalledTimes(4);
        expect(recordSpy).toHaveBeenCalledTimes(1);
        expect(recordSpy).toHaveBeenCalledWith('Observation', 1, false, expect.any(Number));
    });

    test('exhausted retries dead-letter ids and error metadata only, never the resource', async () => {
        kafkaClientV2.sendCloudEventMessageAsync.mockImplementation(async ({ topic }) => {
            if (topic === 'fhir_server.resource-history.events') throw new Error('broker down');
        });
        await producer.produceAsync({ resourceType: 'Observation', operations: [historyOperation('Observation', 'u1')], requestId: 'r1' });
        const dlq = kafkaClientV2.sendCloudEventMessageAsync.mock.calls.map((c) => c[0]).filter((c) => c.topic.endsWith('.dlq'));
        expect(dlq).toHaveLength(1);
        expect(dlq[0].topic).toBe('fhir_server.resource-history.events.dlq');
        const payload = JSON.parse(dlq[0].messages[0].value);
        expect(payload).toMatchObject({ resourceType: 'Observation', uuid: 'u1', error: 'broker down' });
        expect(Object.keys(payload)).not.toContain('resource');
        expect(dlq[0].messages[0].value).not.toContain('synthetic-u1');
    });

    test('a failing dead-letter publish is swallowed', async () => {
        kafkaClientV2.sendCloudEventMessageAsync.mockRejectedValue(new Error('broker down'));
        await expect(producer.produceAsync({
            resourceType: 'Observation', operations: [historyOperation('Observation', 'u1')], requestId: 'r1'
        })).resolves.toBeUndefined();
    });

    test('a chunk-specific rejection is not retried and only the bad record is dead-lettered', async () => {
        const tooLarge = new Error('too large');
        tooLarge.type = 'MESSAGE_TOO_LARGE';
        kafkaClientV2.sendCloudEventMessageAsync.mockImplementation(async ({ topic, messages }) => {
            if (!topic.endsWith('.dlq') && messages.some((m) => m.key === 'Observation:bad')) throw tooLarge;
        });
        await producer.produceAsync({
            resourceType: 'Observation',
            operations: [historyOperation('Observation', 'good'), historyOperation('Observation', 'bad')],
            requestId: 'r1'
        });
        const calls = kafkaClientV2.sendCloudEventMessageAsync.mock.calls.map((c) => c[0]);
        // whole chunk once, then record by record (no retries), then one dead letter for the bad record
        expect(calls.map((c) => [c.topic.endsWith('.dlq'), c.messages.map((m) => m.key)])).toStrictEqual([
            [false, ['Observation:good', 'Observation:bad']],
            [false, ['Observation:good']],
            [false, ['Observation:bad']],
            [true, ['Observation:bad']]
        ]);
    });

    test('a hung produce times out instead of blocking', async () => {
        const slow = new HistoryKafkaProducer({
            configManager: new ConfigManager(), kafkaClientV2, maxRetries: 2, initialRetryDelayMs: 1, produceTimeoutMs: 20
        });
        kafkaClientV2.sendCloudEventMessageAsync.mockReturnValue(new Promise(() => {}));
        await slow.produceAsync({ resourceType: 'Observation', operations: [historyOperation('Observation', 'u1')], requestId: 'r1' });
        expect(recordSpy).toHaveBeenCalledWith('Observation', 1, false, expect.any(Number));
        // a timed-out send may still deliver, so it is never resent (only the dead-letter publish follows)
        const produceCalls = kafkaClientV2.sendCloudEventMessageAsync.mock.calls.filter((c) => !c[0].topic.endsWith('.dlq'));
        expect(produceCalls).toHaveLength(1);
    });

    test('success is counted', async () => {
        await producer.produceAsync({ resourceType: 'Observation', operations: [historyOperation('Observation', 'u1')], requestId: 'r1' });
        expect(recordSpy).toHaveBeenCalledWith('Observation', 1, true, expect.any(Number));
    });
});
