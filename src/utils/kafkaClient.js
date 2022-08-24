const {Kafka} = require('kafkajs');
const {assertIsValid} = require('./assertType');
const {logSystemErrorAsync} = require('../operations/common/logging');

/**
 * @typedef KafkaClientMessage
 * @type {object}
 * @property {string|null|undefined} key
 * @property {string} requestId
 * @property {string} fhirVersion
 * @property {string} value
 */

/**
 * This class implements a client to Kafka
 */
class KafkaClient {
    /**
     * constructor
     * @param {string|undefined} clientId
     * @param {string[]|undefined} brokers
     */
    constructor({clientId, brokers}) {
        this.init(clientId, brokers);
    }

    /**
     * init
     * @param {string} clientId
     * @param {string[]} brokers
     */
    init(clientId, brokers) {
        assertIsValid(clientId !== undefined);
        assertIsValid(brokers !== undefined);
        assertIsValid(Array.isArray(brokers));
        assertIsValid(brokers.length > 0);
        this.clientId = clientId;
        this.brokers = brokers;
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
        } catch (e) {
            await logSystemErrorAsync({
                event: 'kafkaClient',
                message: 'Error sending message',
                args: {clientId: this.clientId, brokers: this.brokers},
                error: e
            });
            throw e;
        }
        finally {
            await producer.disconnect();
        }
    }
}

module.exports = {
    KafkaClient
};
