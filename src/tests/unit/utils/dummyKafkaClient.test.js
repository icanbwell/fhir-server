'use strict';

const { describe, test, expect, beforeAll, jest: jestObj } = require('@jest/globals');

jestObj.mock('../../../utils/kafkaClient', () => ({
    KafkaClient: class KafkaClient {}
}));

const { DummyKafkaClient } = require('../../../utils/dummyKafkaClient');

describe('DummyKafkaClient', () => {
    let client;

    beforeAll(() => {
        client = new DummyKafkaClient();
    });

    test('init is a no-op (does not throw)', () => {
        expect(() => client.init({
            clientId: 'test', brokers: ['localhost:9092'], ssl: false, sasl: null
        })).not.toThrow();
    });

    test('sendMessagesAsync is a no-op (resolves)', async () => {
        await expect(client.sendMessagesAsync('topic', [{ key: 'k', value: 'v' }])).resolves.toBeUndefined();
    });

    test('is an instance of KafkaClient', () => {
        const { KafkaClient } = require('../../../utils/kafkaClient');
        expect(client).toBeInstanceOf(KafkaClient);
    });
});
