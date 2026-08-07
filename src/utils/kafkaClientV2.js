const { Kafka, KafkaJSProtocolError, KafkaJSNonRetriableError } = require('kafkajs');
const { assertIsValid, assertTypeEquals } = require('./assertType');
const { logSystemErrorAsync, logTraceSystemEventAsync, logSystemEventAsync } = require('../operations/common/systemEventLogging');
const { logError } = require('../operations/common/logging');
const { RethrownError } = require('./rethrownError');
const { ConfigManager } = require('./configManager');
const { recordKafkaRetryExhausted } = require('./metrics');
const { retryWithBackoff } = require('./retryWithBackoff');

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
        let lastError = null;
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
                        lastError = e;
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
            // Every attempt hit the retriable code-72 case and none ultimately succeeded --
            // must throw rather than resolve, otherwise callers (e.g. sendToDeadLetterTopicAsync)
            // that rely on "resolves means it was actually sent" would treat this as success
            // and lose the message.
            recordKafkaRetryExhausted(topic, lastErrorCode);
            throw new RethrownError({
                message: `Failed to send CloudEvent message to topic "${topic}" after ${maxRetries} attempts (last error code: ${lastErrorCode})`,
                error: lastError,
                config: this.client.config
            });
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
            // This listener is only meant to guard the initial join wait. Since consumer.on(...)
            // is never removed, it stays attached for the consumer's whole lifetime — without this
            // flag it would keep calling disconnect() on every crash for as long as the process
            // runs, including retriable crashes kafkajs is already restarting in-process, which
            // could race with and break that self-heal. Once settled, crash handling is the
            // entrypoint's responsibility (it registers its own CRASH listener after joining).
            let settled = false;
            const timeoutId = setTimeout(() => {
                if (settled) {
                    return;
                }
                settled = true;
                consumer.disconnect().then(() => {
                    reject(new Error(`Timeout ${label}`.trim()));
                });
            }, maxWait);
            consumer.on(consumer.events.GROUP_JOIN, (event) => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timeoutId);
                resolve(event);
            });
            consumer.on(consumer.events.CRASH, async (event) => {
                // Log unconditionally — a crash after the join promise has already settled would
                // otherwise vanish silently, since rejecting an already-settled promise is a no-op.
                // logError (not just logSystemErrorAsync) because the latter's fhirLogger
                // transport is a no-op whenever LOGLEVEL=DEBUG, and even outside that its
                // AuditEvent-shaped JSON output isn't guaranteed to parse into a log
                // aggregator's level/message fields the way logInfo/logError already reliably do.
                logError(`Consumer crashed${label ? ` (${label})` : ''}`, {
                    error: event.payload.error?.message,
                    restart: event.payload.restart
                });
                await logSystemErrorAsync({
                    event: 'kafkaClientV2',
                    message: `Consumer crashed${label ? ` (${label})` : ''}`,
                    args: {},
                    error: event.payload.error
                });
                if (settled) {
                    return;
                }
                settled = true;
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
    async receiveMessagesAsync({
        consumer,
        topic,
        fromBeginning = false,
        onMessageAsync,
        maxRetries = 3,
        deadLetterTopic,
        // Kept short (max ~1.4s total across 3 retries) as a floor for the backoff delay
        // itself, on top of a heartbeat() before every attempt (see below) -- together these
        // bound how much a slow-but-eventually-successful handler can drift the consumer
        // toward its session/poll timeout during retries.
        retryInitialDelayMs = 200
    }) {
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
                    const parsedMessage = {
                        key: message.key.toString(),
                        value: message.value.toString(),
                        headers: Object.entries(message.headers).map(([k, v]) => ({
                            key: k,
                            value: v ? v.toString() : ''
                        }))
                    };

                    // Without a deadLetterTopic, behave exactly as before: a failure
                    // propagates straight out of eachMessage, no retry, no DLT.
                    if (!deadLetterTopic) {
                        await onMessageAsync(parsedMessage);
                        return;
                    }

                    try {
                        await retryWithBackoff({
                            // Heartbeat before every attempt (including the first), not just
                            // during the backoff delay -- a handler's own processing time (e.g.
                            // S3 reads + Mongo writes) can be several seconds per attempt, and
                            // replaying that up to maxRetries+1 times with no heartbeat in
                            // between risks exceeding the consumer's session timeout and
                            // triggering a rebalance mid-retry, independent of how short the
                            // backoff itself is.
                            fn: async () => {
                                await heartbeat();
                                return onMessageAsync(parsedMessage);
                            },
                            maxRetries,
                            initialDelayMs: retryInitialDelayMs,
                            onRetry: ({ attempt, error }) => {
                                // onRetry is invoked synchronously (not awaited) by retryWithBackoff,
                                // so this log write races the retry delay -- best-effort only.
                                logSystemEventAsync({
                                    event: 'kafkaClientV2',
                                    message: 'Retrying failed message processing',
                                    args: { topic: t, partition, key: parsedMessage.key, attempt, maxRetries, error: error.message }
                                }).catch(() => {});
                            }
                        });
                    } catch (finalError) {
                        // Retries exhausted -- this message can't be processed. Publish it to
                        // the dead-letter topic (with the failure reason) and let eachMessage
                        // return normally so the offset commits; otherwise a single poison
                        // message would block this partition forever. If the DLT publish
                        // itself fails, sendToDeadLetterTopicAsync rethrows so the offset does
                        // NOT commit -- losing the message's only record would be worse than
                        // redelivering it.
                        await logSystemErrorAsync({
                            event: 'kafkaClientV2',
                            message: 'Message failed after exhausting retries, sending to dead-letter topic',
                            args: { topic: t, partition, key: parsedMessage.key, deadLetterTopic, maxRetries },
                            error: finalError
                        });
                        await this.sendToDeadLetterTopicAsync({ deadLetterTopic, message: parsedMessage, error: finalError });
                    }
                }
            });
        } catch (e) {
            // consumer.run() resolves as soon as it has started the consumer's background
            // fetch loop -- it does NOT block for the consumer's lifetime, so reaching this
            // catch means subscribe()/run() itself failed to even start, not that consumption
            // has finished. Disconnect here to clean up that failed setup. Disconnecting
            // unconditionally in a `finally` instead (the previous behavior) tore down the
            // consumer moments after every SUCCESSFUL run() call too, silently killing a
            // healthy, just-started long-running consumer with no error or crash event.
            logError('Error receiving message', {
                clientId: this.clientId,
                brokers: this.brokers,
                error: e.message
            });
            await logSystemErrorAsync({
                event: 'kafkaClientV2',
                message: 'Error receiving message',
                args: { clientId: this.clientId, brokers: this.brokers, ssl: this.ssl },
                error: e
            });
            await consumer.disconnect();
            throw e;
        }
    }

    /**
     * Publishes a message that exhausted its processing retries to a dead-letter topic,
     * wrapped with the failure reason, so it can be inspected/replayed later instead of
     * being silently lost when the caller lets eachMessage return normally to commit past it.
     * Deliberately does not catch/swallow: if the DLT publish itself fails, the caller must
     * NOT commit the original offset, since that would lose the message with no record of
     * it anywhere.
     * @param {Object} params
     * @param {string} params.deadLetterTopic
     * @param {{ key: string, value: string, headers: Array<{key: string, value: string}> }} params.message
     * @param {Error} params.error
     * @returns {Promise<void>}
     */
    async sendToDeadLetterTopicAsync({ deadLetterTopic, message, error }) {
        await this.sendCloudEventMessageAsync({
            topic: deadLetterTopic,
            messages: [{
                key: message.key,
                value: JSON.stringify({
                    originalValue: message.value,
                    originalHeaders: message.headers,
                    error: { name: error.name, message: error.message },
                    failedAt: new Date().toISOString()
                })
            }]
        });
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

    /**
     * Creates a Kafka admin client that reuses this client's broker/auth
     * configuration. Caller is responsible for connect()/disconnect().
     * @returns {import('kafkajs').Admin}
     */
    createAdminClient() {
        return this.client.admin();
    }
}

module.exports = { KafkaClientV2 };
