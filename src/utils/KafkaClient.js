const {Kafka} = require('kafkajs');

class KafkaClient {
    constructor() {
        this.client = new Kafka({
            clientId: 'my-app',
            brokers: ['kafka:9092'],
        });
    }

    /**
     * Sends a message to Kafka
     * @param {string} topic
     * @param {Object[]} messages
     * @return {Promise<void>}
     */
    async sendMessageAsync(topic, messages) {
        const producer = this.client.producer();

        await producer.connect();
        try {
            await producer.send({
                topic: topic,
                messages: messages,
            });
        } finally {
            await producer.disconnect();
        }
    }
}

module.exports = {
    KafkaClient
};
