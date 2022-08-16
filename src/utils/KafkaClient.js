const {Kafka} = require('kafkajs');
const assert = require('node:assert/strict');

/**
 * @typedef KafkaClientMessage
 * @type {object}
 * @property {string|null|undefined} key
 * @property {string} requestId
 * @property {string} fhirVersion
 * @property {string} value
 */

class KafkaClient {
    /**
     * constructor
     * @param {string} clientId
     * @param {string[]} brokers
     */
    constructor(clientId, brokers) {
        assert(clientId !== undefined);
        assert(brokers !== undefined);
        assert(Array.isArray(brokers));
        assert(brokers.length > 0);
        /**
         * @type {Kafka}
         */
        this.client = new Kafka({
            clientId: clientId,
            brokers: brokers,
        });
    }

    /**
     * Sends a message to Kafka
     * @param {string} topic
     * @param {KafkaClientMessage[]} messages
     * @return {Promise<void>}
     */
    async sendMessagesAsync(topic, messages) {
        /**
         * @type {import('kafkajs').Producer}
         */
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
