const { commonBeforeEach, commonAfterEach } = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { ConfigManager } = require('../../../utils/configManager');
const { KafkaClient } = require('../../../utils/kafkaClient');

class MockConfigManager extends ConfigManager {
    get kafkaEnableEvents () {
        return true;
    }

    get kafkaUseSasl () {
        return true;
    }

    get kafkaClientId () {
        return 'kafka_client_id';
    }

    get kafkaBrokers () {
        return [
            'broker1',
            'broker2'
        ];
    }

    get kafkaUseSsl () {
        return true;
    }
}

describe('kafkaClientConfig Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Patient kafkaClientConfig Tests', () => {
        test('kafkaClient returns correct config', async () => {
            /**
             * @type {KafkaClient}
             */
            const kafkaClient = new KafkaClient({
                configManager: new MockConfigManager()
            });
            const kafkaClientConfig = kafkaClient.getConfigAsync();
            expect(kafkaClientConfig).toStrictEqual({
                clientId: 'kafka_client_id',
                brokers: [
                    'broker1',
                    'broker2'
                ],
                ssl: true,
                sasl: {
                    mechanism: 'aws',
                    authorizationIdentity: null,
                    username: 'msk_user_dev_ue1',
                    password: 'foo;ar',
                    accessKeyId: null,
                    secretAccessKey: null
                }
            });
        });
    });
});
