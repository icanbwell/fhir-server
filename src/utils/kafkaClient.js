const {Kafka} = require('kafkajs');
const {assertIsValid} = require('./assertType');
const {logSystemErrorAsync, logSystemEventAsync} = require('../operations/common/logging');
const env = require('var');

/**
 * @typedef KafkaClientMessage
 * @type {object}
 * @property {string} key
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
     * @param {boolean} ssl
     */
    constructor({clientId, brokers, ssl}) {
        this.init(clientId, brokers, ssl);
    }

    /**
     * init
     * @param {string} clientId
     * @param {string[]} brokers
     * @param {boolean} ssl
     */
    init(clientId, brokers, ssl) {
        assertIsValid(clientId !== undefined);
        assertIsValid(brokers !== undefined);
        assertIsValid(Array.isArray(brokers));
        assertIsValid(brokers.length > 0);
        this.clientId = clientId;
        this.brokers = brokers;
        this.ssl = ssl;

        const config = {
            clientId: clientId,
            brokers: brokers,
            ssl: ssl
        };
        /**
         * @type {Kafka}
         */
        this.client = new Kafka(config);
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
            /**
             * @type {import('kafkajs').Message[]}
             */
            const kafkaMessages = messages.map(m => {
                return {
                    key: m.key,
                    value: m.value,
                    headers: {
                        'b3': m.requestId,
                        'version': m.fhirVersion,
                    }
                };
            });
            if (env.LOGLEVEL === 'DEBUG') {
                await logSystemEventAsync({
                    event: 'kafkaClient',
                    message: 'Sending message',
                    args: {
                        clientId: this.clientId,
                        brokers: this.brokers,
                        ssl: this.ssl,
                        topic: topic,
                        messages: kafkaMessages
                    }
                });
            }
            /**
             * @type {import('kafkajs').RecordMetadata[]}
             */
            const result = await producer.send({
                topic: topic,
                messages: kafkaMessages,
            });
            if (env.LOGLEVEL === 'DEBUG') {
                await logSystemEventAsync({
                    event: 'kafkaClient',
                    message: 'Sent message',
                    args: {
                        clientId: this.clientId,
                        brokers: this.brokers,
                        ssl: this.ssl,
                        topic: topic,
                        messages: kafkaMessages,
                        result: result
                    }
                });
            }
        } catch (e) {
            await logSystemErrorAsync({
                event: 'kafkaClient',
                message: 'Error sending message',
                args: {clientId: this.clientId, brokers: this.brokers, ssl: this.ssl},
                error: e
            });
            throw e;
        } finally {
            await producer.disconnect();
        }
    }
}

module.exports = {
    KafkaClient
};
