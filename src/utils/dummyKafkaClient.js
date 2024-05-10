/**
 * This class implements a client to Kafka
 */
const { KafkaClient } = require('./kafkaClient');

class DummyKafkaClient extends KafkaClient {
    /**
     * init
     * @typedef {Object} InitProps
     * @property {string} clientId
     * @property {string[]} brokers
     * @property {boolean} ssl
     * @property {import('kafkajs').SASLOptions} sasl
     *
     * @param {InitProps}
     */

    init ({ clientId, brokers, ssl, sasl }) {
        // ok to not specify
    }

    /**
     * Sends a message to Kafka
     * @param {string} topic
     * @param {KafkaClientMessage[]} messages
     * @return {Promise<void>}
     */

    async sendMessagesAsync (topic, messages) {
        // ok to not specify
    }
}

module.exports = {
    DummyKafkaClient
};
