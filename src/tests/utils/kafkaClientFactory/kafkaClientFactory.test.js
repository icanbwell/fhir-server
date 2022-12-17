const {commonBeforeEach, commonAfterEach} = require('../../common');
const {describe, beforeEach, afterEach, expect, test} = require('@jest/globals');
const {KafkaClientFactory} = require('../../../utils/kafkaClientFactory');
const {ConfigManager} = require('../../../utils/configManager');
const {AwsSecretsManager} = require('../../../utils/awsSecretsManager');

class MockSecretsManager extends AwsSecretsManager {
    async getSecretValueAsync({secretName}) {
        return secretName === 'foo' ? {username: 'myuser', password: 'mypassword'} : {username: null, password: null};
    }
}

class MockConfigManager extends ConfigManager {

    get kafkaEnableEvents() {
        return true;
    }

    get kafkaUseSasl() {
        return true;
    }

    get kafkaAwsSecretName() {
        return 'foo';
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
                secretsManager: new MockSecretsManager(),
                configManager: new MockConfigManager()
            });
            const kafkaClientConfig = await kafkaClientFactory.getKafkaClientConfigAsync();
            expect(kafkaClientConfig).toStrictEqual({});
        });
    });
});
