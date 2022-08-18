class MockKafkaClient {
    /**
     * constructor
     */
    constructor() {
        /**
         * @type {KafkaClientMessage[]}
         */
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
