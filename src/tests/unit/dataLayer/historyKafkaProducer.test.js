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
            ce_id: generateUUIDv5('Observation|u1|1767323045678')
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

    test('flag on for two types: both produce, and the list is read per call', async () => {
        setEnv({ KAFKA_HISTORY_RESOURCES: 'Observation, Condition' });
        await producer.produceAsync({ resourceType: 'Observation', operations: [historyOperation('Observation', 'u1')], requestId: 'r1' });
        await producer.produceAsync({ resourceType: 'Condition', operations: [historyOperation('Condition', 'u2')], requestId: 'r1' });
        expect(kafkaClientV2.sendCloudEventMessageAsync).toHaveBeenCalledTimes(2);

        setEnv({ KAFKA_HISTORY_RESOURCES: 'Observation' });
        await producer.produceAsync({ resourceType: 'Condition', operations: [historyOperation('Condition', 'u3')], requestId: 'r1' });
        expect(kafkaClientV2.sendCloudEventMessageAsync).toHaveBeenCalledTimes(2);
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

        expect(kafkaClientV2.sendCloudEventMessageAsync).toHaveBeenCalledTimes(3); // 1 + maxRetries
        expect(recordSpy).toHaveBeenCalledTimes(1);
        expect(recordSpy).toHaveBeenCalledWith('Observation', 1, false, expect.any(Number));
    });

    test('a chunk-specific rejection is not retried', async () => {
        const err = new Error('too large');
        err.type = 'MESSAGE_TOO_LARGE';
        kafkaClientV2.sendCloudEventMessageAsync.mockRejectedValue(err);
        await producer.produceAsync({ resourceType: 'Observation', operations: [historyOperation('Observation', 'u1')], requestId: 'r1' });
        expect(kafkaClientV2.sendCloudEventMessageAsync).toHaveBeenCalledTimes(1);
    });

    test('a hung produce times out instead of blocking', async () => {
        const slow = new HistoryKafkaProducer({
            configManager: new ConfigManager(), kafkaClientV2, maxRetries: 0, produceTimeoutMs: 20
        });
        kafkaClientV2.sendCloudEventMessageAsync.mockReturnValue(new Promise(() => {}));
        await slow.produceAsync({ resourceType: 'Observation', operations: [historyOperation('Observation', 'u1')], requestId: 'r1' });
        expect(recordSpy).toHaveBeenCalledWith('Observation', 1, false, expect.any(Number));
    });

    test('success is counted', async () => {
        await producer.produceAsync({ resourceType: 'Observation', operations: [historyOperation('Observation', 'u1')], requestId: 'r1' });
        expect(recordSpy).toHaveBeenCalledWith('Observation', 1, true, expect.any(Number));
    });
});
