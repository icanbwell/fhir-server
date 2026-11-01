'use strict';

const { logDebug, logError, logWarn } = require('../operations/common/logging');
const { generateUUIDv5 } = require('../utils/uid.util');
const { assertTypeEquals } = require('../utils/assertType');
const { ConfigManager } = require('../utils/configManager');
const { KafkaClientV2, getKafkaCompressionType } = require('../utils/kafkaClientV2');
const { retryWithBackoff } = require('../utils/retryWithBackoff');
const metrics = require('../utils/metrics');

const CLOUD_EVENT_TYPE = 'ResourceHistoryRecorded';
const CLOUD_EVENT_SOURCE = 'fhir-server';

/**
 * Produces history records to Kafka, beside (never instead of) the MongoDB history write.
 *
 * Called from the post-request history flush after the MongoDB write has completed.
 * Every failure is logged and counted but never thrown, so a Kafka problem cannot fail
 * a FHIR write or disturb the MongoDB history. Flags are read from ConfigManager on each
 * call, so a change to KAFKA_HISTORY_RESOURCES takes effect
 * as soon as the process sees the new environment (a config roll-out, no code change).
 *
 * Event: CloudEvent in Kafka binary mode (`ce_` headers). Key is `<resourceType>:<_uuid>`;
 * the body is the history document, whose `_recorded` was stamped once when the history
 * entry was created, so retries and replays carry the same value.
 */
class HistoryKafkaProducer {
    /**
     * @param {Object} params
     * @param {ConfigManager} params.configManager
     * @param {KafkaClientV2} params.kafkaClientV2
     * @param {number} [params.maxRetries=3]
     * @param {number} [params.initialRetryDelayMs=1000]
     * @param {number} [params.produceTimeoutMs=30000] - Per attempt
     */
    constructor ({ configManager, kafkaClientV2, maxRetries = 3, initialRetryDelayMs = 1000, produceTimeoutMs = 30000 }) {
        assertTypeEquals(configManager, ConfigManager);
        this.configManager = configManager;
        assertTypeEquals(kafkaClientV2, KafkaClientV2);
        this.kafkaClientV2 = kafkaClientV2;
        this.maxRetries = maxRetries;
        this.initialRetryDelayMs = initialRetryDelayMs;
        this.produceTimeoutMs = produceTimeoutMs;
    }

    /**
     * @param {string} resourceType
     * @returns {boolean}
     */
    isEnabledFor (resourceType) {
        return this.configManager.kafkaV2EnableEvents &&
            this.configManager.kafkaHistoryResources.includes(resourceType);
    }

    /**
     * Produces the history documents of a bulk history operation. Never throws.
     * @param {Object} params
     * @param {string} params.resourceType
     * @param {import('./bulkInsertUpdateEntry').BulkInsertUpdateEntry[]} params.operations history insertOne operations
     * @param {string} params.requestId
     * @returns {Promise<void>}
     */
    async produceAsync ({ resourceType, operations, requestId }) {
        try {
            if (!operations || operations.length === 0 || !this.isEnabledFor(resourceType)) {
                return;
            }
            const topic = this.configManager.kafkaHistoryEventsTopic;
            const batchSize = this.configManager.historyKafkaBatchSize;
            const compression = getKafkaCompressionType(this.configManager.auditEventClickPipeCompression);
            for (let i = 0; i < operations.length; i += batchSize) {
                await this._produceChunkAsync({
                    resourceType,
                    operations: operations.slice(i, i + batchSize),
                    requestId,
                    topic,
                    compression
                });
            }
        } catch (err) {
            // Logged without the resource: payloads and ids are PHI-adjacent.
            logError('HistoryKafkaProducer: unexpected failure', { resourceType, requestId, error: err.message });
        }
    }

    /**
     * @param {Object} params
     * @returns {Promise<void>}
     * @private
     */
    async _produceChunkAsync ({ resourceType, operations, requestId, topic, compression }) {
        const start = process.hrtime.bigint();
        let messages;
        try {
            messages = operations.map((op) => this._toMessage(op));
        } catch (err) {
            this._recordFailure({ resourceType, count: operations.length, requestId, topic, err, start });
            return;
        }
        try {
            await retryWithBackoff({
                fn: () => this._withTimeoutAsync(this.kafkaClientV2.sendCloudEventMessageAsync({ topic, messages, compression })),
                maxRetries: this.maxRetries,
                initialDelayMs: this.initialRetryDelayMs,
                jitter: true,
                // A rejection caused by the chunk itself cannot be fixed by resending it.
                shouldRetry: (err) => !isChunkSpecificError(err),
                onRetry: ({ attempt, delay }) => logWarn('HistoryKafkaProducer: retrying produce', {
                    attempt, maxRetries: this.maxRetries, resourceType, count: messages.length, requestId, delay
                })
            });
            metrics.recordHistoryKafkaProduce(resourceType, messages.length, true, secondsSince(start));
            logDebug('HistoryKafkaProducer: produced', { resourceType, count: messages.length, topic, requestId });
        } catch (err) {
            this._recordFailure({ resourceType, count: messages.length, requestId, topic, err, start });
        }
    }

    /**
     * @param {import('./bulkInsertUpdateEntry').BulkInsertUpdateEntry} op
     * @returns {import('kafkajs').Message}
     * @private
     */
    _toMessage (op) {
        const document = op.operation.insertOne.document;
        const recorded = document._recorded instanceof Date ? document._recorded : new Date(document._recorded);
        return {
            key: `${op.resourceType}:${op.uuid}`,
            value: JSON.stringify(document),
            headers: {
                ce_specversion: '1.0',
                ce_id: generateUUIDv5(`${op.resourceType}|${op.uuid}|${recorded.getTime()}`),
                ce_type: CLOUD_EVENT_TYPE,
                ce_source: CLOUD_EVENT_SOURCE,
                ce_time: recorded.toISOString(),
                ce_datacontenttype: 'application/json'
            }
        };
    }

    /**
     * @param {Promise<void>} promise
     * @returns {Promise<void>}
     * @private
     */
    _withTimeoutAsync (promise) {
        let timer;
        const timeout = new Promise((resolve, reject) => {
            timer = setTimeout(
                () => reject(new Error(`history Kafka produce timed out after ${this.produceTimeoutMs}ms`)),
                this.produceTimeoutMs
            );
        });
        return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
    }

    /** @private */
    _recordFailure ({ resourceType, count, requestId, topic, err, start }) {
        metrics.recordHistoryKafkaProduce(resourceType, count, false, secondsSince(start));
        logError('HistoryKafkaProducer: produce failed; MongoDB history is unaffected', {
            resourceType, count, topic, requestId, error: err.message
        });
    }
}

// Broker rejections caused by the chunk's own contents (same set as KafkaClickPipeBulkWriteExecutor).
const CHUNK_SPECIFIC_KAFKA_ERROR_TYPES = new Set(['MESSAGE_TOO_LARGE', 'RECORD_LIST_TOO_LARGE', 'INVALID_RECORD']);

/**
 * @param {Error} err
 * @returns {boolean}
 */
function isChunkSpecificError (err) {
    for (let e = err, depth = 0; e && depth < 5; e = e.cause, depth++) {
        if (CHUNK_SPECIFIC_KAFKA_ERROR_TYPES.has(e.type)) {
            return true;
        }
    }
    return false;
}

/**
 * @param {bigint} start process.hrtime.bigint() value
 * @returns {number}
 */
function secondsSince (start) {
    return Number(process.hrtime.bigint() - start) / 1e9;
}

module.exports = { HistoryKafkaProducer, CLOUD_EVENT_TYPE };
