const { generateUUID } = require('../../../utils/uid.util');
const { assertTypeEquals } = require('../../../utils/assertType');
const { KafkaClientV2 } = require('../../../utils/kafkaClientV2');
const { ConfigManager } = require('../../../utils/configManager');
const { logInfo, logError } = require('../../common/logging');

class BulkImportEventProducer {
    /**
     * @typedef {Object} ConstructorParams
     * @property {KafkaClientV2} kafkaClientV2
     * @property {ConfigManager} configManager
     *
     * @param {ConstructorParams}
     */
    constructor({ kafkaClientV2, configManager }) {
        this.kafkaClientV2 = kafkaClientV2;
        assertTypeEquals(kafkaClientV2, KafkaClientV2);

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
     * Total byte-range count across every input file -- the same count
     * publishImportEventsAsync will publish one ImportRangeRequested message per. The
     * orchestrator needs this task-wide total (not any single file's own range count) to know
     * when every range of every file has reported completion.
     * @param {Array<{url: string, fileSize: number}>} inputs
     * @returns {number}
     */
    calculateTotalRangeCount(inputs) {
        return inputs.reduce((total, input) => total + this.calculateByteRanges(input.fileSize).length, 0);
    }

    /**
     * Publishes ImportRangeRequested Kafka messages for each byte-range of each file
     * @param {Object} params
     * @param {string} params.taskId
     * @param {Array<{url: string, fileSize: number}>} params.inputs
     * @param {string} params.requestId
     * @param {string} params.scope
     * @param {string} params.user
     * @param {string|undefined} [params.alternateUserId]
     * @param {boolean|undefined} [params.isUser]
     * @param {string|undefined} [params.remoteIpAddress]
     * @returns {Promise<number>} total number of messages published
     */
    async publishImportEventsAsync({ taskId, inputs, requestId, scope, user, alternateUserId, isUser, remoteIpAddress }) {
        if (!this.configManager.kafkaV2EnableEvents) {
            return 0;
        }

        const topic = this.configManager.kafkaBulkImportEventTopic;
        const messages = [];
        // Task-wide total, distinct from each file's own ranges.length below (used for
        // per-file output naming) -- the orchestrator needs this to know when every range of
        // every input file has reported completion, since no single ImportRangeRequested
        // event otherwise carries a task-wide count.
        const taskTotalRanges = this.calculateTotalRangeCount(inputs);

        for (let inputIndex = 0; inputIndex < inputs.length; inputIndex++) {
            const input = inputs[inputIndex];
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
                        fileSize: input.fileSize,
                        byteRangeStart: range.start,
                        byteRangeEnd: range.end,
                        rangeIndex,
                        totalRanges: ranges.length,
                        taskTotalRanges,
                        requestId,
                        scope,
                        user,
                        alternateUserId,
                        isUser,
                        remoteIpAddress
                    }
                };

                messages.push({
                    key: `${taskId}-${inputIndex}-${rangeIndex}`,
                    value: JSON.stringify(cloudEvent)
                });
            }
        }

        if (messages.length === 0) {
            return 0;
        }

        try {
            await this.kafkaClientV2.sendCloudEventMessageAsync({ topic, messages });
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

    /**
     * Publishes a single range-progress CloudEvent onto the worker->orchestrator topic. The
     * orchestrator is the only process that ever writes to a Task once it exists -- workers
     * report progress here instead of touching the Task themselves, so there's exactly one
     * writer and no concurrent-update race to resolve.
     * @param {Object} params
     * @param {'ImportRangeStarted'|'ImportRangeCompleted'|'ImportRangeFailed'} params.type
     * @param {Object} params.data
     * @returns {Promise<void>}
     */
    async publishRangeProgressEventAsync({ type, data }) {
        if (!this.configManager.kafkaV2EnableEvents) {
            return;
        }

        const topic = this.configManager.kafkaBulkImportRangeProgressTopic;
        const cloudEvent = {
            specversion: '1.0',
            id: generateUUID(),
            source: 'https://www.icanbwell.com/fhir-server',
            type,
            datacontenttype: 'application/json',
            data
        };

        try {
            await this.kafkaClientV2.sendCloudEventMessageAsync({
                topic,
                messages: [{
                    // Keyed by taskId alone (not per-range like ImportRangeRequested) so every
                    // progress report for one Task lands on the same partition -- the
                    // orchestrator still processes them one at a time via Kafka's per-partition
                    // ordering, but this keeps a single Task's reports from being reordered
                    // relative to each other across partitions.
                    key: data.taskId,
                    value: JSON.stringify(cloudEvent)
                }]
            });
        } catch (e) {
            logError('Failed to publish bulk import range-progress event', {
                type,
                taskId: data.taskId,
                topic,
                error: e.message
            });
            throw e;
        }
    }
}

module.exports = { BulkImportEventProducer };
