const env = require('var');
const {KafkaClient} = require('./kafkaClient');
const {assertTypeEquals} = require('./assertType');
const {AwsSecretsManager} = require('./awsSecretsManager');
const {ConfigManager} = require('./configManager');
const {DummyKafkaClient} = require('./dummyKafkaClient');

class KafkaClientFactory {
    /**
     * constructor
     * @param {AwsSecretsManager} secretsManager
     * @param {ConfigManager} configManager
     */
    constructor(
        {
            secretsManager,
            configManager
        }
    ) {
        this.secretsManager = secretsManager;
        assertTypeEquals(secretsManager, AwsSecretsManager);

        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);

        /**
         * @type {string|undefined}
         */
        this.userName = undefined;
        /**
         * @type {string|undefined}
         */
        this.password = undefined;
    }

    /**
     * returns config for kafka
     * @return {Promise<{sasl: {accessKeyId: (string|null), secretAccessKey: (string|null), authorizationIdentity: (string|undefined), password: (string|null), mechanism: (string|undefined), username: (string|null)}, clientId: (string|undefined), brokers: string[], ssl: boolean}>}
     */
    async getKafkaClientConfigAsync() {
        const sasl = this.configManager.kafkaUseSasl ? {
            // https://kafka.js.org/docs/configuration#sasl
            mechanism: this.configManager.kafkaAuthMechanism,
            authorizationIdentity: this.configManager.kafkaIdentity, // UserId or RoleId
            username: this.configManager.kafkaUserName || null,
            password: this.configManager.kafkaPassword || null,
            accessKeyId: this.configManager.kafkaAccessKeyId || null,
            secretAccessKey: this.configManager.kafkaAccessKeySecret || null
        } : null;
        if (this.configManager.kafkaUseSasl && this.configManager.kafkaAwsSecretName) {
            if (!this.userName || !this.password) {
                if (env.KAFKA_SASL_USERNAME && env.KAFKA_SASL_PASSWORD) {
                    this.userName = env.KAFKA_SASL_USERNAME;
                    this.password = env.KAFKA_SASL_PASSWORD;
                } else {
                    const {
                        username,
                        password,
                    } = await this.secretsManager.getSecretValueAsync({ secretName: this.configManager.kafkaAwsSecretName });
                    this.userName = username;
                    this.password = password;
                }
            }
            sasl.username = this.userName;
            sasl.password = this.password;
        }
        return {
            clientId: this.configManager.kafkaClientId,
            brokers: this.configManager.kafkaBrokers,
            ssl: this.configManager.kafkaUseSsl || null,
            sasl: sasl,
        };
    }

    async createKafkaClientAsync() {
        if (!this.configManager.kafkaEnableEvents) {
            return new DummyKafkaClient({clientId: '', brokers: []});
        }

        const config = await this.getKafkaClientConfigAsync();
        return new KafkaClient(config);
    }
}

module.exports = {
    KafkaClientFactory
};
