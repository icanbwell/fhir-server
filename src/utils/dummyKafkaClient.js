/**
 * This class implements a client to Kafka
 */
const {KafkaClient} = require('./kafkaClient');

class DummyKafkaClient extends KafkaClient {
    /**
     * constructor
     * @param {string|undefined} clientId
     * @param {string[]|undefined} brokers
     */
    constructor({clientId, brokers}) {
        super({clientId, brokers, ssl: false});
    }

    /**
     * init
     * @param {string} clientId
     * @param {string[]} brokers
     * @param ssl
     */
    // eslint-disable-next-line no-unused-vars
    init(clientId, brokers, ssl) {
    }

    /**
     * Sends a message to Kafka
     * @param {string} topic
     * @param {KafkaClientMessage[]} messages
     * @return {Promise<void>}
     */
    // eslint-disable-next-line no-unused-vars
    async sendMessagesAsync(topic, messages) {
    }
}

module.exports = {
    DummyKafkaClient
};
