const {KafkaClient} = require('../../utils/kafkaClient');

class MockKafkaClient extends KafkaClient {
    /**
     * constructor
     */
    constructor() {
        super(null, []);
        /**
         * @type {KafkaClientMessage[]}
         */
        // eslint-disable-next-line no-this-before-super
        this.messages = [];
    }

    /**
     * init
     * @param {string} clientId
     * @param {string[]} brokers
     */
    // eslint-disable-next-line no-unused-vars
    init(clientId, brokers) {
        // do nothing
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
