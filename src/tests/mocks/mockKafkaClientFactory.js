const {KafkaClientFactory} = require('../../utils/kafkaClientFactory');
const {MockKafkaClient} = require('./mockKafkaClient');

class MockKafkaClientFactory extends KafkaClientFactory {
    /**
     * constructor
     * @param {AwsSecretsManager} secretsManager
     * @param {ConfigManager} configManager
     */
    constructor({
                    secretsManager,
                    configManager
                }) {
        super({
            secretsManager,
            configManager
        });

        this.kafkaClient = new MockKafkaClient();
    }

    /**
     * @return {Promise<MockKafkaClient>}
     */
    async createKafkaClientAsync() {
        return this.kafkaClient;
    }

    /**
     * @return {Promise<MockKafkaClient>}
     */
     async getKafkaClientConfigAsync() {
        return this.kafkaClient;
    }
}

module.exports = {
    MockKafkaClientFactory
};
