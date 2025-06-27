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
        this.cloudEventMessages = [];
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

    async sendCloudEventMessageAsync({ topic, messages }) {
        this.cloudEventMessages = this.cloudEventMessages.concat(messages);
    }

    /**
     * Returns current messages
     * @return {KafkaClientMessage[]}
     */
    getMessages () {
        return this.messages;
    }

    /**
     * Returns current cloud event messages
     */
    getCloudEventMessages () {
        return this.cloudEventMessages;
    }
}

module.exports = {
    MockKafkaClient
};
