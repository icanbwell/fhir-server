const {commonBeforeEach, commonAfterEach} = require('../../common');
const {describe, beforeEach, afterEach, expect, test} = require('@jest/globals');
const {KafkaClientFactory} = require('../../../utils/kafkaClientFactory');
const {ConfigManager} = require('../../../utils/configManager');
const {AwsSecretsManager} = require('../../../utils/awsSecretsManager');
const {AwsSecretsClientFactory} = require('../../../utils/awsSecretsClientFactory');

class MockSecretsManagerClient {
    async send() {
        return {
            ARN: 'arn:aws:secretsmanager:us-east-1:875300655693:secret:AmazonMSK_auth_dev_ue1-ihnGHs',
            CreatedDate: '2022-11-15T03:25:32.761Z',
            Name: 'AmazonMSK_auth_dev_ue1',
            SecretBinary: undefined,
            SecretString: '{"password":"foo\\u003bar","username":"msk_user_dev_ue1"}',
            VersionId: 'B27E3CD1-8EC8-4341-8B7A-E0F884928330',
            VersionStages: ['AWSCURRENT']
        };
    }
}

class MockSecretsClientFactory extends AwsSecretsClientFactory {
    /**
     * create client
     * @return {import('@aws-sdk/client-secrets-manager').SecretsManagerClient}
     */
    async createSecretsClientAsync() {
        return new MockSecretsManagerClient();
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
                secretsManager: new AwsSecretsManager({
                    secretsManagerClientFactory: new MockSecretsClientFactory()
                }),
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
