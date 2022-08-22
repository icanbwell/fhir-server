const {KafkaClient} = require('../../utils/kafkaClient');

class MockKafkaClient extends KafkaClient{
    // noinspection JSAnnotator
    /**
     * constructor
     */
    // eslint-disable-next-line constructor-super
    constructor() {
        /**
         * @type {KafkaClientMessage[]}
         */
        // eslint-disable-next-line no-this-before-super
        this.messages = [];
    }

    clear() {
        this.messages = [];
    }

    /**
     * Sends a message to Kafka
     * @param {string} topic
     * @param {KafkaClientMessage[]} messages
     * @return {Promise<void>}
     */
    // eslint-disable-next-line no-unused-vars
    async sendMessagesAsync(topic, messages) {
        this.messages = this.messages.concat(messages);
    }

    /**
     * Returns current messages
     * @return {KafkaClientMessage[]}
     */
    getMessages() {
        return this.messages;
    }
}

module.exports = {
    MockKafkaClient
};
