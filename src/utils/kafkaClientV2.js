const { Kafka, KafkaJSProtocolError, KafkaJSNonRetriableError } = require('kafkajs');
const { assertIsValid, assertTypeEquals } = require('./assertType');
const { logSystemErrorAsync, logTraceSystemEventAsync, logSystemEventAsync } = require('../operations/common/systemEventLogging');
const { RethrownError } = require('./rethrownError');
const { ConfigManager } = require('./configManager');
const { recordKafkaRetryExhausted } = require('./metrics');

class KafkaClientV2 {
    /**
     * @param {ConfigManager} configManager
     */
    constructor({ configManager }) {
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);

        this.producerConnected = false;
        this.init(this.getConfigAsync());
    }

    /**
     * @return {{clientId: string, brokers: string[], ssl: boolean, sasl: Object|null}}
     */
    getConfigAsync() {
        const authType = this.configManager.kafkaV2AuthType;
        let sasl = null;

        if (authType === 'iam') {
            const { generateAuthToken } = require('aws-msk-iam-sasl-signer-js');
            const region = this.configManager.kafkaV2AwsRegion;
            sasl = {
                mechanism: 'oauthbearer',
                oauthBearerProvider: async () => {
                    const { token } = await generateAuthToken({ region });
                    return { value: token };
                }
            };
        } else if (this.configManager.kafkaV2UseSasl) {
            sasl = {
                mechanism: this.configManager.kafkaV2AuthMechanism,
                username: this.configManager.kafkaV2UserName || null,
                password: this.configManager.kafkaV2Password || null
            };
        }

        return {
            clientId: this.configManager.kafkaV2ClientId,
            brokers: this.configManager.kafkaV2Brokers,
            ssl: this.configManager.kafkaV2UseSsl || authType === 'iam',
            sasl
        };
    }

    /**
     * @param {{clientId: string, brokers: string[], ssl: boolean, sasl: Object|null}} config
     */
    init({ clientId, brokers, ssl, sasl }) {
        assertIsValid(clientId !== undefined);
        assertIsValid(brokers !== undefined);
        assertIsValid(Array.isArray(brokers));
        assertIsValid(brokers.length > 0);

        this.clientId = clientId;
        this.brokers = brokers;
        this.ssl = ssl;
        this.sasl = sasl;

        /** @type {import('kafkajs').KafkaConfig} */
        const config = {
            clientId,
            brokers,
            authenticationTimeout: 60000,
            ssl,
            sasl,
            connectionTimeout: 10000,
            retry: {
                initialRetryTime: 500,
                retries: 3
            }
        };

        this.client = new Kafka(config);
        this.producer = this.client.producer();
        this.producerConnected = false;

        this.producer.on(this.producer.events.DISCONNECT, () => (this.producerConnected = false));
    }

    async disconnect() {
        if (this.producerConnected) {
            await this.producer.disconnect();
        }
    }

    /**
     * @param {Object} params
     * @param {string} params.topic
     * @param {import('kafkajs').Message[]} params.messages
     * @return {Promise<void>}
     */
    async sendCloudEventMessageAsync({ topic, messages }) {
        const maxRetries = parseInt(process.env.KAFKA_MAX_RETRY) || 3;
        let iteration = 1;
        let shouldRetry = false;
        let lastErrorCode = null;
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
                        const reorderedBrokers = oldBrokers.length > 1
                            ? [...oldBrokers.slice(1), oldBrokers[0]]
                            : [...oldBrokers];
                        await logSystemEventAsync({
                            event: 'kafkaClientV2Retry',
                            message: 'Retrying sending the CloudEvent message by creating new client',
                            args: { iteration, brokers: reorderedBrokers }
                        });
                        this.init({
                            clientId: this.clientId,
                            brokers: reorderedBrokers,
                            ssl: this.ssl,
                            sasl: this.sasl
                        });
                        shouldRetry = true;
                        lastErrorCode = cause.code;
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
        if (shouldRetry) {
            recordKafkaRetryExhausted(topic, lastErrorCode);
        }
    }

    /**
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
                    message: 'Error in connecting producer to kafka v2',
                    error: e,
                    config: this.client.config
                });
            }
        }
        try {
            if (process.env.LOGLEVEL === 'DEBUG') {
                await logTraceSystemEventAsync({
                    event: 'kafkaClientV2',
                    message: 'Sending CloudEvent messages',
                    args: { clientId: this.clientId, brokers: this.brokers, ssl: this.ssl, topic, messages }
                });
            }
            const result = await this.producer.send({ topic, messages });
            if (process.env.LOGLEVEL === 'DEBUG') {
                await logTraceSystemEventAsync({
                    event: 'kafkaClientV2',
                    message: 'Sent CloudEvent messages',
                    args: { clientId: this.clientId, brokers: this.brokers, ssl: this.ssl, topic, messages, result }
                });
            }
        } catch (e) {
            await logSystemErrorAsync({
                event: 'kafkaClientV2',
                message: 'Error sending CloudEvent messages',
                args: { clientId: this.clientId, brokers: this.brokers, ssl: this.ssl },
                error: e
            });
            throw e;
        }
    }

    /**
     * @param consumer
     * @param {number} maxWait
     * @param {string} label
     * @returns {Promise<void>}
     */
    waitForConsumerToJoinGroupAsync(consumer, { maxWait = 10000, label = '' } = {}) {
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                consumer.disconnect().then(() => {
                    reject(new Error(`Timeout ${label}`.trim()));
                });
            }, maxWait);
            consumer.on(consumer.events.GROUP_JOIN, (event) => {
                clearTimeout(timeoutId);
                resolve(event);
            });
            consumer.on(consumer.events.CRASH, (event) => {
                clearTimeout(timeoutId);
                consumer.disconnect().then(() => {
                    reject(event.payload.error);
                });
            });
        });
    }

    /**
     * @param {import('kafkajs').Consumer} consumer
     * @param {string} topic
     * @param {boolean} [fromBeginning]
     * @param {function} onMessageAsync
     * @return {Promise<void>}
     */
    async receiveMessagesAsync({ consumer, topic, fromBeginning = false, onMessageAsync }) {
        try {
            await consumer.connect();
        } catch (e) {
            throw new RethrownError({
                message: 'Error in receiveMessageAsync() v2',
                error: e,
                config: this.client.config
            });
        }
        try {
            await consumer.subscribe({ topics: [topic], fromBeginning });
            await consumer.run({
                eachMessage: async ({ topic: t, partition, message, heartbeat, pause }) => {
                    await onMessageAsync({
                        key: message.key.toString(),
                        value: message.value.toString(),
                        headers: Object.entries(message.headers).map(([k, v]) => ({
                            key: k,
                            value: v ? v.toString() : ''
                        }))
                    });
                }
            });
        } catch (e) {
            await logSystemErrorAsync({
                event: 'kafkaClientV2',
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
     * @param {import('kafkajs').Consumer} consumer
     * @returns {Promise<void>}
     */
    async removeConsumerAsync({ consumer }) {
        await consumer.disconnect();
    }

    /**
     * @param {string} groupId
     * @returns {Promise<import('kafkajs').Consumer>}
     */
    async createConsumerAsync({ groupId }) {
        return this.client.consumer({ groupId });
    }
}

module.exports = { KafkaClientV2 };
