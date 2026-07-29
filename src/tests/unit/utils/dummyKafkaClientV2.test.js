'use strict';

const { describe, test, expect, beforeAll, jest: jestObj } = require('@jest/globals');

jestObj.mock('../../../utils/kafkaClientV2', () => ({
    KafkaClientV2: class KafkaClientV2 {}
}));

const { DummyKafkaClientV2 } = require('../../../utils/dummyKafkaClientV2');

describe('DummyKafkaClientV2', () => {
    let client;

    beforeAll(() => {
        client = new DummyKafkaClientV2();
    });

    test('init is a no-op', () => {
        expect(() => client.init({ clientId: 'x', brokers: [], ssl: false, sasl: null })).not.toThrow();
    });

    test('sendCloudEventMessageAsync resolves', async () => {
        await expect(client.sendCloudEventMessageAsync({ topic: 't', messages: [] })).resolves.toBeUndefined();
    });

    test('createConsumerAsync returns null', async () => {
        const result = await client.createConsumerAsync({ groupId: 'g' });
        expect(result).toBeNull();
    });

    test('receiveMessagesAsync resolves', async () => {
        await expect(client.receiveMessagesAsync({
            consumer: null, topic: 't', fromBeginning: true, onMessageAsync: async () => {}
        })).resolves.toBeUndefined();
    });

    test('waitForConsumerToJoinGroupAsync resolves', async () => {
        await expect(client.waitForConsumerToJoinGroupAsync(null, {})).resolves.toBeUndefined();
    });

    test('removeConsumerAsync resolves', async () => {
        await expect(client.removeConsumerAsync({ consumer: null })).resolves.toBeUndefined();
    });

    test('createAdminClient returns null', () => {
        expect(client.createAdminClient()).toBeNull();
    });
});
