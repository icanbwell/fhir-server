const { generateUUID } = require('../../utils/uid.util');
const { assertTypeEquals } = require('../../utils/assertType');
const { KafkaClient } = require('../../utils/kafkaClient');
const { ConfigManager } = require('../../utils/configManager');
const { logInfo, logError } = require('../common/logging');

class BulkImportEventProducer {
    /**
     * @typedef {Object} ConstructorParams
     * @property {KafkaClient} kafkaClient
     * @property {ConfigManager} configManager
     *
     * @param {ConstructorParams}
     */
    constructor({ kafkaClient, configManager }) {
        this.kafkaClient = kafkaClient;
        assertTypeEquals(kafkaClient, KafkaClient);

        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);
    }

    /**
     * Calculates byte-range markers for a file of the given size
     * @param {number} fileSize
     * @returns {Array<{start: number, end: number}>}
     */
    calculateByteRanges(fileSize) {
        const rangeSizeBytes = this.configManager.bulkImportRangeSizeMb * 1024 * 1024;
        const ranges = [];
        for (let start = 0; start < fileSize; start += rangeSizeBytes) {
            ranges.push({
                start,
                end: Math.min(start + rangeSizeBytes, fileSize)
            });
        }
        return ranges;
    }

    /**
     * Publishes ImportRangeRequested Kafka messages for each byte-range of each file
     * @param {Object} params
     * @param {string} params.taskId
     * @param {Array<{url: string, fileSize: number}>} params.inputs
     * @param {string} params.requestId
     * @param {string} params.scope
     * @param {string} params.user
     * @returns {Promise<number>} total number of messages published
     */
    async publishImportEventsAsync({ taskId, inputs, requestId, scope, user }) {
        const topic = this.configManager.kafkaBulkImportEventTopic;
        const messages = [];

        for (const input of inputs) {
            const ranges = this.calculateByteRanges(input.fileSize);

            for (let rangeIndex = 0; rangeIndex < ranges.length; rangeIndex++) {
                const range = ranges[rangeIndex];
                const eventId = generateUUID();

                const cloudEvent = {
                    specversion: '1.0',
                    id: eventId,
                    source: 'https://www.icanbwell.com/fhir-server',
                    type: 'ImportRangeRequested',
                    datacontenttype: 'application/json',
                    data: {
                        taskId,
                        filepath: input.url,
                        byteRangeStart: range.start,
                        byteRangeEnd: range.end,
                        rangeIndex,
                        totalRanges: ranges.length,
                        requestId,
                        scope,
                        user
                    }
                };

                messages.push({
                    key: `${taskId}-${rangeIndex}`,
                    value: JSON.stringify(cloudEvent)
                });
            }
        }

        if (messages.length === 0) {
            return 0;
        }

        try {
            await this.kafkaClient.sendCloudEventMessageAsync({ topic, messages });
            logInfo(`Published ${messages.length} ImportRangeRequested message(s)`, {
                taskId,
                topic,
                messageCount: messages.length
            });
        } catch (e) {
            logError('Failed to publish bulk import Kafka events', {
                taskId,
                topic,
                error: e.message
            });
            throw e;
        }

        return messages.length;
    }
}

module.exports = { BulkImportEventProducer };
