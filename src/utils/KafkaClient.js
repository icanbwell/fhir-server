const {Kafka} = require('kafkajs');
const env = require('var');

/**
 * @typedef KafkaClientMessage
 * @type {object}
 * @property {string|null|undefined} key
 * @property {string} requestId
 * @property {string} fhirVersion
 * @property {string} value
 */

class KafkaClient {
    constructor() {
        this.client = new Kafka({
            clientId: env.KAFKA_CLIENT_ID,
            brokers: env.KAFKA_URLS.split(','),
        });
    }

    /**
     * Sends a message to Kafka
     * @param {string} topic
     * @param {KafkaClientMessage[]} messages
     * @return {Promise<void>}
     */
    async sendMessagesAsync(topic, messages) {
        const producer = this.client.producer();

        await producer.connect();
        try {
            await producer.send({
                topic: topic,
                messages: messages.map(m => {
                    return {
                        key: m.key,
                        value: m.value,
                        headers: {
                            'b3': m.requestId,
                            'version': m.fhirVersion,
                        }
                    };
                }),
            });
        } finally {
            await producer.disconnect();
        }
    }
}

module.exports = {
    KafkaClient
};
