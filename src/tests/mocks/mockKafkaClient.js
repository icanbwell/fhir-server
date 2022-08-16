class MockKafkaClient {
    /**
     * constructor
     */
    constructor() {
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
    MockKafkaClient
};
