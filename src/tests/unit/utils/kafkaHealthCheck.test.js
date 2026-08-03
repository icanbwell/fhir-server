'use strict';

const { describe, test, expect, jest: jestObj, beforeEach, afterEach } = require('@jest/globals');

jestObj.mock('../../../utils/isTrue', () => ({
    isTrue: jestObj.fn((val) => val === 'true' || val === true)
}));

describe('kafkaHealthCheck', () => {
    let handleKafkaHealthCheck;
    let originalEnableEventsKafka;
    let originalEnableKafkaHealthcheck;

    beforeEach(() => {
        jestObj.resetModules();
        originalEnableEventsKafka = process.env.ENABLE_EVENTS_KAFKA;
        originalEnableKafkaHealthcheck = process.env.ENABLE_KAFKA_HEALTHCHECK;
    });

    afterEach(() => {
        if (originalEnableEventsKafka !== undefined) process.env.ENABLE_EVENTS_KAFKA = originalEnableEventsKafka;
        else delete process.env.ENABLE_EVENTS_KAFKA;
        if (originalEnableKafkaHealthcheck !== undefined) process.env.ENABLE_KAFKA_HEALTHCHECK = originalEnableKafkaHealthcheck;
        else delete process.env.ENABLE_KAFKA_HEALTHCHECK;
    });

    test('returns true when Kafka events disabled', async () => {
        delete process.env.ENABLE_EVENTS_KAFKA;
        delete process.env.ENABLE_KAFKA_HEALTHCHECK;
        handleKafkaHealthCheck = require('../../../utils/kafkaHealthCheck').handleKafkaHealthCheck;
        const result = await handleKafkaHealthCheck({});
        expect(result).toBe(true);
    });

    test('returns true when Kafka healthcheck disabled', async () => {
        process.env.ENABLE_EVENTS_KAFKA = 'true';
        process.env.ENABLE_KAFKA_HEALTHCHECK = 'false';
        handleKafkaHealthCheck = require('../../../utils/kafkaHealthCheck').handleKafkaHealthCheck;
        const result = await handleKafkaHealthCheck({});
        expect(result).toBe(true);
    });

    test('returns true when producer connects successfully', async () => {
        process.env.ENABLE_EVENTS_KAFKA = 'true';
        process.env.ENABLE_KAFKA_HEALTHCHECK = 'true';
        handleKafkaHealthCheck = require('../../../utils/kafkaHealthCheck').handleKafkaHealthCheck;
        const container = {
            kafkaClient: {
                producerConnected: false,
                producer: { connect: jestObj.fn().mockResolvedValue(undefined) }
            }
        };
        const result = await handleKafkaHealthCheck(container);
        expect(result).toBe(true);
    });

    test('returns false when producer connect throws', async () => {
        process.env.ENABLE_EVENTS_KAFKA = 'true';
        process.env.ENABLE_KAFKA_HEALTHCHECK = 'true';
        handleKafkaHealthCheck = require('../../../utils/kafkaHealthCheck').handleKafkaHealthCheck;
        const container = {
            kafkaClient: {
                producerConnected: false,
                producer: { connect: jestObj.fn().mockRejectedValue(new Error('timeout')) }
            }
        };
        const result = await handleKafkaHealthCheck(container);
        expect(result).toBe(false);
    });
});
