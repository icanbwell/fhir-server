'use strict';

const { describe, test, expect } = require('@jest/globals');
const { DummyKafkaClientV2 } = require('../../../utils/dummyKafkaClientV2');
const { ConfigManager } = require('../../../utils/configManager');

describe('DummyKafkaClientV2', () => {
    // server.js disconnects the V2 client on shutdown even when V2 Kafka is disabled (this client)
    test('disconnect resolves without a producer', async () => {
        const client = new DummyKafkaClientV2({ configManager: new ConfigManager() });
        await expect(client.disconnect()).resolves.toBeUndefined();
    });
});
