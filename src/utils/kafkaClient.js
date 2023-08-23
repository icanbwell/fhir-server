const {Kafka, KafkaJSProtocolError, KafkaJSNonRetriableError} = require('kafkajs');
const {assertIsValid} = require('./assertType');
const {logSystemErrorAsync, logTraceSystemEventAsync, logSystemEventAsync} = require('../operations/common/systemEventLogging');
const env = require('var');
const {RethrownError} = require('./rethrownError');

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
 * https://icanbwell.atlassian.net/wiki/spaces/ENTARCH/pages/3812556821/Health+Programs+Team+Event+Strategy+Proposal
 */
class KafkaClient {
    /**
     * constructor
     * @param {string|undefined} clientId
     * @param {string[]|undefined} brokers
     * @param {boolean} ssl
     * @param {import('kafkajs').SASLOptions} sasl
     */
    constructor({clientId, brokers, ssl, sasl}) {
        this.init(clientId, brokers, ssl, sasl);
    }

    /**
     * init
     * @param {string} clientId
     * @param {string[]} brokers
     * @param {boolean} ssl
     * @param {import('kafkajs').SASLOptions} sasl
     */
    init(clientId, brokers, ssl, sasl) {
        assertIsValid(clientId !== undefined);
        assertIsValid(brokers !== undefined);
        assertIsValid(Array.isArray(brokers));
        assertIsValid(brokers.length > 0);

        this.clientId = clientId;
        this.brokers = brokers;
        this.ssl = ssl;
        this.sasl = sasl;

        /**
         * @type {import('kafkajs').KafkaConfig}
         */
        const config = {
            clientId: clientId,
            brokers: brokers,
            // Timeout in ms for authentication requests
            authenticationTimeout: 60000,
            ssl: ssl,
            sasl: sasl,
            // connectionTimeout in milliseconds(10 seconds), to wait for a successful connection
            connectionTimeout: 10000,
            retry: {
                // initialRetryTime in ms to wait before retrying. Used in randomization function
                initialRetryTime: 500,
                // Number of times to retry before raising an error.
                retries: 3
            }
        };
        /**
         * @type {import('kafkajs').Kafka}
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
        let maxRetries = parseInt(env.KAFKA_MAX_RETRY) || 3;
        let iteration = 1;

        // by default shouldn't retry
        let shouldRetry = false;
        do {
            try {
                await this.sendMessagesAsyncHelper(topic, messages);
                // if successful then don't retry
                shouldRetry = false;
                return;
            } catch (e) {
                if (e instanceof KafkaJSNonRetriableError) {
                    const cause = e.cause;
                    /**
                     * Error code 72 represents LISTENER_NOT_FOUND error. It can be considered as transient error
                     * For more info about it check: https://kafka.apache.org/20/javadoc/index.html?org/apache/kafka/common/errors/ListenerNotFoundException.html
                     */
                    if (cause instanceof KafkaJSProtocolError && cause.code === 72) {
                        // reconfigure the client by reordering brokers array
                        const oldBrokers = this.brokers || [];
                        const reorderedBrokers = oldBrokers.length > 1 ? [...oldBrokers.slice(1), oldBrokers[0]] : [...oldBrokers];
                        await logSystemEventAsync({
                            event: 'kafkaClientRetry',
                            message: 'Retrying sending the message by creating new client',
                            args: {
                                iteration,
                                brokers: reorderedBrokers,
                            }
                        });
                        this.init(this.clientId, reorderedBrokers, this.ssl, this.sasl);
                        // should retry again
                        shouldRetry = true;
                    } else {
                        shouldRetry = false;
                        throw e;
                    }
                } else {
                    shouldRetry = false;
                    throw e;
                }
            }
        } while (++iteration <= maxRetries && shouldRetry);
    }

    /**
     * Helper function for sendMessagesAsync
     * @param {string} topic
     * @param {KafkaClientMessage[]} messages
     * @return {Promise<void>}
     */
    async sendMessagesAsyncHelper(topic, messages) {
        /**
         * @type {import('kafkajs').Producer}
         */
        const producer = this.client.producer();

        try {
            await producer.connect();
        } catch (e) {
            throw new RethrownError({
                message: 'Error in sendMessageAsync()',
                error: e,
                config: this.client.config
            });
        }
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
                await logTraceSystemEventAsync({
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
                await logTraceSystemEventAsync({
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

    /**
     * waits for consumer to join group
     * @param consumer
     * @param maxWait
     * @param label
     * @returns {Promise<void>}
     */
    waitForConsumerToJoinGroupAsync(consumer, {maxWait = 10000, label = ''} = {}) {
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                consumer.disconnect().then(() => {
                    reject(new Error(`Timeout ${label}`.trim()));
                });
            }, maxWait);
            consumer.on(consumer.events.GROUP_JOIN, event => {
                clearTimeout(timeoutId);
                resolve(event);
            });
            consumer.on(consumer.events.CRASH, event => {
                clearTimeout(timeoutId);
                consumer.disconnect().then(() => {
                    reject(event.payload.error);
                });
            });
        });
    }

    /**
     * Receives a message from Kafka
     * @param {import('kafkajs').Consumer} consumer
     * @param {string} topic
     * @param {boolean} [fromBeginning]
     * @param {function(message: {key: string, value: string, headers: {key: string, value: string}[]}): Promise<void>} onMessageAsync
     * @return {Promise<void>}
     */
    async receiveMessagesAsync({consumer, topic, fromBeginning = false, onMessageAsync}) {
        try {
            await consumer.connect();
        } catch (e) {
            throw new RethrownError({
                message: 'Error in receiveMessageAsync()',
                error: e,
                config: this.client.config
            });
        }
        try {
            await consumer.subscribe({topics: [topic], fromBeginning: fromBeginning});
            await consumer.run({
                // eslint-disable-next-line no-unused-vars
                eachMessage: async ({topic1, partition, message, heartbeat, pause}) => {
                    await onMessageAsync({
                        key: message.key.toString(),
                        value: message.value.toString(),
                        headers: Object.entries(message.headers).map(([k, v]) => {
                                return {
                                    key: k,
                                    value: v ? v.toString() : ''
                                };
                            }
                        ),
                    });
                },
            });
        } catch (e) {
            await logSystemErrorAsync({
                event: 'kafkaClient',
                message: 'Error receiving message',
                args: {clientId: this.clientId, brokers: this.brokers, ssl: this.ssl},
                error: e
            });
            throw e;
        } finally {
            consumer.disconnect();
        }
    }

    /**
     * disconnects consumer
     * @param {import('kafkajs').Consumer} consumer
     * @returns {Promise<void>}
     */
    async removeConsumerAsync({consumer}) {
        await consumer.disconnect();
    }

    /**
     * @param {string} groupId
     * @returns {Promise<import('kafkajs').Consumer>}
     */
    async createConsumerAsync({groupId}) {
        return this.client.consumer({groupId: groupId});
    }

    /**
     * Receives a message to Kafka
     * @param {string} topic
     * @param {number} limit
     * @return {Promise<void>}
     */
    // async receiveLastXMessagesAsync(topic, limit) {
    //     /**
    //      * @type {import('kafkajs').Admin}
    //      */
    //     const admin = this.client.admin();
    //
    //     await admin.connect();
    //     try {
    //         /**
    //          * @type {string[]}
    //          */
    //         const topics = await admin.listTopics();
    //         /**
    //          * @type {Array<{high: string, low: string}>}
    //          */
    //         const offsets = await admin.fetchTopicOffsets(topic);
    //         /**
    //          * @type {{brokers: Array<{nodeId: number, host: string, port: number}>, controller: number | null, clusterId: string}}
    //          */
    //         const cluster = await admin.describeCluster();
    //         /**
    //          * @type {{groups: import('kafkajs').GroupOverview[]}}
    //          */
    //         const groups = await admin.listGroups();
    //
    //     } catch (e) {
    //         await logSystemErrorAsync({
    //             event: 'kafkaClient',
    //             message: 'Error sending message',
    //             args: {clientId: this.clientId, brokers: this.brokers, ssl: this.ssl},
    //             error: e
    //         });
    //         throw e;
    //     } finally {
    //         await admin.disconnect();
    //     }
    // }
}

module.exports = {
    KafkaClient
};
