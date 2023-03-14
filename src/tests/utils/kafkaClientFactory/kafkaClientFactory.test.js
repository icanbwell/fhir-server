const {commonBeforeEach, commonAfterEach} = require('../../common');
const {describe, beforeEach, afterEach, expect, test} = require('@jest/globals');
const {KafkaClientFactory} = require('../../../utils/kafkaClientFactory');
const {ConfigManager} = require('../../../utils/configManager');

class MockConfigManager extends ConfigManager {

    get kafkaEnableEvents() {
        return true;
    }

    get kafkaUseSasl() {
        return true;
    }

    get kafkaClientId() {
        return 'kafka_client_id';
    }

    get kafkaBrokers() {
        return [
            'broker1',
            'broker2'
        ];
    }

    get kafkaUseSsl() {
        return true;
    }
}

describe('kafkaClientFactory Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Patient kafkaClientFactory Tests', () => {
        test('kafkaClientFactory returns correct confif', async () => {
            /**
             * @type {KafkaClientFactory}
             */
            const kafkaClientFactory = new KafkaClientFactory({
                configManager: new MockConfigManager()
            });
            const kafkaClientConfig = await kafkaClientFactory.getKafkaClientConfigAsync();
            expect(kafkaClientConfig).toStrictEqual({
                'clientId': 'kafka_client_id',
                'brokers': [
                    'broker1',
                    'broker2'
                ],
                'ssl': true,
                'sasl': {
                    'mechanism': 'aws',
                    'authorizationIdentity': null,
                    'username': 'msk_user_dev_ue1',
                    'password': 'foo;ar',
                    'accessKeyId': null,
                    'secretAccessKey': null
                }
            });
        });
    });
});
