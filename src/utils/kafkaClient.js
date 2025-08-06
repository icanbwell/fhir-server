const { Kafka, KafkaJSProtocolError, KafkaJSNonRetriableError } = require('kafkajs');
const { assertIsValid, assertTypeEquals } = require('./assertType');
const { logSystemErrorAsync, logTraceSystemEventAsync, logSystemEventAsync } = require('../operations/common/systemEventLogging');
const { RethrownError } = require('./rethrownError');
const { ConfigManager } = require('./configManager');

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
     * @param {ConfigManager} configManager
     */
    constructor ({ configManager }) {
        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);

        /**
         * This connected property will denote if the producer is connect or not
         * @type {boolean}
         */
        this.producerConnected = false;

        // there is an open discussion regarding negative timeout being set in kafkajs for which warning is now being logged
        // (https://github.com/tulios/kafkajs/issues/1751)
        this.init(this.getConfigAsync());
    }

    /**
     * returns config for kafka
     * @return {{sasl: {accessKeyId: (string|null), secretAccessKey: (string|null), authorizationIdentity: (string|undefined), password: (string|null), mechanism: (string|undefined), username: (string|null)}, clientId: (string|undefined), brokers: string[], ssl: boolean}}
     */
    getConfigAsync () {
        const sasl = this.configManager.kafkaUseSasl ? {
            // https://kafka.js.org/docs/configuration#sasl
            mechanism: this.configManager.kafkaAuthMechanism,
            username: this.configManager.kafkaUserName || null,
            password: this.configManager.kafkaPassword || null
        } : null;
        if (this.configManager.kafkaUseSasl) {
            if (!this.userName || !this.password) {
                this.userName = process.env.KAFKA_SASL_USERNAME;
                this.password = process.env.KAFKA_SASL_PASSWORD;
            }
            sasl.username = this.userName;
            sasl.password = this.password;
        }
        return {
            clientId: this.configManager.kafkaClientId,
            brokers: this.configManager.kafkaBrokers,
            ssl: this.configManager.kafkaUseSsl || null,
            sasl
        };
    }

    /**
     * init
     * @typedef {Object} InitProps
     * @property {string} clientId
     * @property {string[]} brokers
     * @property {boolean} ssl
     * @property {import('kafkajs').SASLOptions} sasl
     *
     * @param {InitProps}
     */
    init ({ clientId, brokers, ssl, sasl }) {
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
            clientId,
            brokers,
            // Timeout in ms for authentication requests
            authenticationTimeout: 60000,
            ssl,
            sasl,
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

        // Note: Might create some warning while retrying to send messages due to invalid client
        this.producer = this.client.producer();
        this.producerConnected = false;

        this.producer.on(this.producer.events.DISCONNECT, () => (this.producerConnected = false));
    }

    /**
     * Disconnects the kafka producer
     */
    async disconnect () {
        if (this.producerConnected) {
            await this.producer.disconnect();
        }
    }

    /**
     * Sends a message to Kafka
     * @param {string} topic
     * @param {KafkaClientMessage[]} messages
     * @return {Promise<void>}
     */
    async sendMessagesAsync (topic, messages) {
        const maxRetries = parseInt(process.env.KAFKA_MAX_RETRY) || 3;
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
                                brokers: reorderedBrokers
                            }
                        });
                        this.init({
                            clientId: this.clientId,
                            brokers: reorderedBrokers,
                            ssl: this.ssl,
                            sasl: this.sasl
                        });
                        // should retry again
                        shouldRetry = true;
                    } else {
                        this.producerConnected = false;
                        throw e;
                    }
                } else {
                    this.producerConnected = false;
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
    async sendMessagesAsyncHelper (topic, messages) {
        if (!this.producerConnected) {
            try {
                await this.producer.connect();
                this.producerConnected = true;
            } catch (e) {
                throw new RethrownError({
                    message: 'Error in connecting producer to kafka',
                    error: e,
                    config: this.client.config
                });
            }
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
                        b3: m.requestId,
                        version: m.fhirVersion
                    }
                };
            });
            if (process.env.LOGLEVEL === 'DEBUG') {
                await logTraceSystemEventAsync({
                    event: 'kafkaClient',
                    message: 'Sending message',
                    args: {
                        clientId: this.clientId,
                        brokers: this.brokers,
                        ssl: this.ssl,
                        topic,
                        messages: kafkaMessages
                    }
                });
            }
            /**
             * @type {import('kafkajs').RecordMetadata[]}
             */
            const result = await this.producer.send({
                topic,
                messages: kafkaMessages
            });
            if (process.env.LOGLEVEL === 'DEBUG') {
                await logTraceSystemEventAsync({
                    event: 'kafkaClient',
                    message: 'Sent message',
                    args: {
                        clientId: this.clientId,
                        brokers: this.brokers,
                        ssl: this.ssl,
                        topic,
                        messages: kafkaMessages,
                        result
                    }
                });
            }
        } catch (e) {
            await logSystemErrorAsync({
                event: 'kafkaClient',
                message: 'Error sending message',
                args: { clientId: this.clientId, brokers: this.brokers, ssl: this.ssl },
                error: e
            });
            throw e;
        }
    }

    /**
     * Helper function for sendCloudEventMessageAsync
     * @param {Object} params
     * @param {string} params.topic
     * @param {import('kafkajs').Message[]} params.messages
     * @return {Promise<void>}
     */
    async sendCloudEventMessageHelperAsync({ topic, messages }) {
        if (!this.producerConnected) {
            try {
                await this.producer.connect();
                this.producerConnected = true;
            } catch (e) {
                throw new RethrownError({
                    message: 'Error in connecting producer to kafka',
                    error: e,
                    config: this.client.config
                });
            }
        }
        try {
            if (process.env.LOGLEVEL === 'DEBUG') {
                await logTraceSystemEventAsync({
                    event: 'kafkaClient',
                    message: 'Sending CloudEvent messages',
                    args: {
                        clientId: this.clientId,
                        brokers: this.brokers,
                        ssl: this.ssl,
                        topic,
                        messages
                    }
                });
            }
            const result = await this.producer.send({
                topic,
                messages
            });
            if (process.env.LOGLEVEL === 'DEBUG') {
                await logTraceSystemEventAsync({
                    event: 'kafkaClient',
                    message: 'Sent CloudEvent messages',
                    args: {
                        clientId: this.clientId,
                        brokers: this.brokers,
                        ssl: this.ssl,
                        topic,
                        messages,
                        result
                    }
                });
            }
        } catch (e) {
            await logSystemErrorAsync({
                event: 'kafkaClient',
                message: 'Error sending CloudEvent messages',
                args: { clientId: this.clientId, brokers: this.brokers, ssl: this.ssl },
                error: e
            });
            throw e;
        }
    }

    /**
     * Sends multiple CloudEvent messages to Kafka with retry support
     * @param {Object} params
     * @param {string} params.topic - Kafka topic name
     * @param {import('kafkajs').Message[]} params.messages - Array of messages, each with key, value, and headers
     * @return {Promise<void>}
     */
    async sendCloudEventMessageAsync({ topic, messages }) {
        const maxRetries = parseInt(process.env.KAFKA_MAX_RETRY) || 3;
        let iteration = 1;
        let shouldRetry = false;
        do {
            try {
                await this.sendCloudEventMessageHelperAsync({ topic, messages });
                shouldRetry = false;
                return;
            } catch (e) {
                if (e instanceof KafkaJSNonRetriableError) {
                    const cause = e.cause;
                    if (cause instanceof KafkaJSProtocolError && cause.code === 72) {
                        const oldBrokers = this.brokers || [];
                        const reorderedBrokers = oldBrokers.length > 1 ? [...oldBrokers.slice(1), oldBrokers[0]] : [...oldBrokers];
                        await logSystemEventAsync({
                            event: 'kafkaClientRetry',
                            message: 'Retrying sending the CloudEvent message by creating new client',
                            args: {
                                iteration,
                                brokers: reorderedBrokers
                            }
                        });
                        this.init({
                            clientId: this.clientId,
                            brokers: reorderedBrokers,
                            ssl: this.ssl,
                            sasl: this.sasl
                        });
                        shouldRetry = true;
                    } else {
                        this.producerConnected = false;
                        throw e;
                    }
                } else {
                    this.producerConnected = false;
                    throw e;
                }
            }
        } while (++iteration <= maxRetries && shouldRetry);
    }

    /**
     * waits for consumer to join group
     * @param consumer
     * @param maxWait
     * @param label
     * @returns {Promise<void>}
     */
    waitForConsumerToJoinGroupAsync (consumer, { maxWait = 10000, label = '' } = {}) {
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
    async receiveMessagesAsync ({ consumer, topic, fromBeginning = false, onMessageAsync }) {
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
            await consumer.subscribe({ topics: [topic], fromBeginning });
            await consumer.run({

                eachMessage: async ({ topic1, partition, message, heartbeat, pause }) => {
                    await onMessageAsync({
                        key: message.key.toString(),
                        value: message.value.toString(),
                        headers: Object.entries(message.headers).map(([k, v]) => {
                                return {
                                    key: k,
                                    value: v ? v.toString() : ''
                                };
                            }
                        )
                    });
                }
            });
        } catch (e) {
            await logSystemErrorAsync({
                event: 'kafkaClient',
                message: 'Error receiving message',
                args: { clientId: this.clientId, brokers: this.brokers, ssl: this.ssl },
                error: e
            });
            throw e;
        } finally {
            await consumer.disconnect();
        }
    }

    /**
     * disconnects consumer
     * @param {import('kafkajs').Consumer} consumer
     * @returns {Promise<void>}
     */
    async removeConsumerAsync ({ consumer }) {
        await consumer.disconnect();
    }

    /**
     * @param {string} groupId
     * @returns {Promise<import('kafkajs').Consumer>}
     */
    async createConsumerAsync ({ groupId }) {
        return this.client.consumer({ groupId });
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
