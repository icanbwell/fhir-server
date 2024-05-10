const { KafkaClient } = require('../../utils/kafkaClient');

class MockKafkaClient extends KafkaClient {
    /**
     * constructor
     * @param {ConfigManager} configManager
     */
    constructor ({ configManager }) {
        super({ configManager });
        /**
         * @type {KafkaClientMessage[]}
         */

        this.messages = [];
    }

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
        // do nothing
    }

    clear () {
        this.messages = [];
    }

    /**
     * Sends a message to Kafka
     * @param {string} topic
     * @param {KafkaClientMessage[]} messages
     * @return {Promise<void>}
     */

    async sendMessagesAsync (topic, messages) {
        this.messages = this.messages.concat(messages);
    }

    /**
     * Returns current messages
     * @return {KafkaClientMessage[]}
     */
    getMessages () {
        return this.messages;
    }
}

module.exports = {
    MockKafkaClient
};
