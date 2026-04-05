const { logInfo, logError } = require('../../operations/common/logging');
const { generateUUID } = require('../../utils/uid.util');

class HistorySyncConsumer {
    /**
     * @param {Object} params
     * @param {import('../../utils/kafkaClient').KafkaClient} params.kafkaClient
     * @param {import('./historySyncJob').HistorySyncJob} params.historySyncJob
     * @param {import('../../utils/configManager').ConfigManager} params.configManager
     */
    constructor({ kafkaClient, historySyncJob, configManager }) {
        this.kafkaClient = kafkaClient;
        this.historySyncJob = historySyncJob;
        this.configManager = configManager;

        /** @type {import('kafkajs').Consumer|null} */
        this.consumer = null;
        /** @type {boolean} */
        this.shuttingDown = false;
        /** @type {Promise|null} */
        this.currentJob = null;
    }

    /**
     * Starts the Kafka consumer
     * @returns {Promise<void>}
     */
    async startAsync() {
        const groupId = this.configManager.historySyncConsumerGroup;
        const topic = this.configManager.historySyncKafkaTopic;

        logInfo('HistorySyncConsumer: starting', { args: { groupId, topic } });

        this.consumer = await this.kafkaClient.createConsumerAsync({ groupId });
        await this.consumer.connect();
        await this.consumer.subscribe({ topics: [topic], fromBeginning: false });

        await this.consumer.run({
            autoCommit: false,
            eachMessage: async ({ topic: msgTopic, partition, message, heartbeat }) => {
                await this._handleMessageAsync({ message, partition, heartbeat });
            }
        });

        logInfo('HistorySyncConsumer: running', { args: { groupId, topic } });
    }

    /**
     * Handles a single Kafka message with retry and DLQ
     * @param {Object} params
     * @param {import('kafkajs').KafkaMessage} params.message
     * @param {number} params.partition
     * @param {function(): Promise<void>} params.heartbeat
     * @returns {Promise<void>}
     */
    async _handleMessageAsync({ message, partition, heartbeat }) {
        let command;
        try {
            command = JSON.parse(message.value.toString());
        } catch (parseError) {
            logError('HistorySyncConsumer: invalid JSON message', {
                args: { error: parseError.message, offset: message.offset }
            });
            await this._commitOffsetAsync(partition, message.offset);
            return;
        }

        if (!command.jobId) {
            logError('HistorySyncConsumer: missing jobId in command', {
                args: { command, offset: message.offset }
            });
            await this._commitOffsetAsync(partition, message.offset);
            return;
        }

        logInfo('HistorySyncConsumer: received job command', {
            args: { jobId: command.jobId, resourceType: command.resourceType }
        });

        const maxRetries = this.configManager.historySyncMaxRetries;
        let lastError;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                // Pass heartbeat to job so it can call it between batches
                this.currentJob = this.historySyncJob.executeAsync(command);
                await this.currentJob;
                this.currentJob = null;

                // Success — commit offset
                await this._commitOffsetAsync(partition, message.offset);
                logInfo('HistorySyncConsumer: job completed', {
                    args: { jobId: command.jobId, attempt }
                });
                return;
            } catch (error) {
                lastError = error;
                this.currentJob = null;
                logError('HistorySyncConsumer: job attempt failed', {
                    args: { jobId: command.jobId, attempt, maxRetries, error: error.message }
                });

                if (attempt < maxRetries && !this.shuttingDown) {
                    const delay = Math.pow(2, attempt) * 1000;
                    await new Promise(resolve => setTimeout(resolve, delay));
                    // Send heartbeat to prevent rebalance during retry wait
                    await heartbeat();
                }
            }
        }

        // All retries exhausted — send to DLQ
        await this._sendToDlqAsync(command, lastError);
        await this._commitOffsetAsync(partition, message.offset);
    }

    /**
     * Commits offset for a partition
     * @param {number} partition
     * @param {string} offset
     * @returns {Promise<void>}
     */
    async _commitOffsetAsync(partition, offset) {
        try {
            await this.consumer.commitOffsets([{
                topic: this.configManager.historySyncKafkaTopic,
                partition,
                offset: String(Number(offset) + 1)
            }]);
        } catch (error) {
            logError('HistorySyncConsumer: offset commit failed', {
                args: { partition, offset, error: error.message }
            });
        }
    }

    /**
     * Sends a failed command to the dead letter queue
     * @param {Object} command
     * @param {Error} error
     * @returns {Promise<void>}
     */
    async _sendToDlqAsync(command, error) {
        const dlqTopic = this.configManager.historySyncDlqTopic;
        try {
            await this.kafkaClient.sendMessagesAsync(dlqTopic, [{
                key: command.jobId,
                requestId: generateUUID(),
                fhirVersion: 'R4',
                value: JSON.stringify({
                    originalCommand: command,
                    error: error?.message,
                    failedAt: new Date().toISOString()
                })
            }]);
            logInfo('HistorySyncConsumer: sent to DLQ', {
                args: { jobId: command.jobId, dlqTopic }
            });
        } catch (dlqError) {
            logError('HistorySyncConsumer: DLQ publish failed', {
                args: { jobId: command.jobId, error: dlqError.message }
            });
        }
    }

    /**
     * Gracefully shuts down the consumer
     * @returns {Promise<void>}
     */
    async shutdownAsync() {
        logInfo('HistorySyncConsumer: shutting down');
        this.shuttingDown = true;
        this.historySyncJob.shuttingDown = true;

        // Wait for current job to finish
        if (this.currentJob) {
            logInfo('HistorySyncConsumer: waiting for current job to complete');
            try {
                await this.currentJob;
            } catch (error) {
                logError('HistorySyncConsumer: current job failed during shutdown', {
                    args: { error: error.message }
                });
            }
        }

        if (this.consumer) {
            await this.consumer.disconnect();
        }
        logInfo('HistorySyncConsumer: shutdown complete');
    }
}

module.exports = { HistorySyncConsumer };
