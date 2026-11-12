'use strict';

const { logDebug, logError, logWarn } = require('../operations/common/logging');
const { generateUUIDv5 } = require('../utils/uid.util');
const { SECURITY_TAG_SYSTEMS } = require('../constants/securityTagSystems');
const { assertTypeEquals } = require('../utils/assertType');
const { ConfigManager } = require('../utils/configManager');
const { KafkaClientV2, getKafkaCompressionType } = require('../utils/kafkaClientV2');
const { retryWithBackoff } = require('../utils/retryWithBackoff');
const metrics = require('../utils/metrics');
const { withProduceTimeoutAsync } = require('../utils/kafkaProduceTimeout');

const CLOUD_EVENT_TYPE = 'FhirResourceHistory';
const CLOUD_EVENT_SOURCE = '/fhir-server';
const FALLBACK_REASON_PRODUCE_FAILED = 'produce_failed';

/**
 * Produces history records to Kafka, beside the MongoDB history write, or instead of it for resource
 * types listed in RESOURCE_HISTORY_MONGO_DISABLED_RESOURCES (see produceWithMongoFallbackAsync, which
 * hands back the records that did not reach Kafka so the caller writes them to MongoDB).
 *
 * Called from the history flush (a post-request task, or inline for delete).
 * Every failure is logged and counted but never thrown, so a Kafka problem cannot fail
 * a FHIR write or disturb the MongoDB history. Flags are read from ConfigManager on each
 * call, so a change to RESOURCE_HISTORY_KAFKA_RESOURCES takes effect
 * as soon as the process sees the new environment (a config roll-out, no code change).
 *
 * A chunk the broker rejects for its own contents is resent one record at a time, so only the bad
 * record is lost from the stream. Records that still fail are logged and counted (ids never
 * logged), and remain in the MongoDB history.
 *
 * Event: CloudEvent in Kafka binary mode (`ce_` headers). Key is `<resourceType>:<_uuid>`;
 * the body is the flat history row (`resource_type`, `_uuid`, `_recorded`, `version_id`,
 * `access_tags`, `raw`). `_recorded` was stamped once when the history entry was created, so
 * retries and replays carry the same value.
 */
class HistoryKafkaProducer {
    /**
     * @param {Object} params
     * @param {ConfigManager} params.configManager
     * @param {KafkaClientV2} params.kafkaClientV2
     * @param {number} [params.maxRetries=3]
     * @param {number} [params.initialRetryDelayMs=1000]
     * @param {number} [params.produceTimeoutMs] - Per attempt; defaults to configManager.kafkaProducerTimeoutMs
     */
    constructor ({ configManager, kafkaClientV2, maxRetries = 3, initialRetryDelayMs = 1000, produceTimeoutMs = null }) {
        assertTypeEquals(configManager, ConfigManager);
        this.configManager = configManager;
        assertTypeEquals(kafkaClientV2, KafkaClientV2);
        this.kafkaClientV2 = kafkaClientV2;
        this.maxRetries = maxRetries;
        this.initialRetryDelayMs = initialRetryDelayMs;
        this._produceTimeoutMsOverride = produceTimeoutMs;
    }

    /**
     * @param {string} resourceType
     * @returns {boolean}
     */
    isEnabledFor (resourceType) {
        return this.configManager.kafkaV2EnableEvents &&
            this.configManager.resourceHistoryKafkaResources.includes(resourceType);
    }

    /**
     * True when the MongoDB history write is replaced by the Kafka produce for this resource type.
     * Requires the produce itself to be enabled for the type, so the flag can never leave a type
     * with no history destination.
     * @param {string} resourceType
     * @returns {boolean}
     */
    isMongoWriteDisabledFor (resourceType) {
        return this.isEnabledFor(resourceType) &&
            this.configManager.resourceHistoryMongoDisabledResources.includes(resourceType);
    }

    /**
     * Produces the history documents of a bulk history operation. Never throws.
     * @param {Object} params
     * @param {string} params.resourceType
     * @param {import('./bulkInsertUpdateEntry').BulkInsertUpdateEntry[]} params.operations history insertOne operations
     * @param {string} params.requestId
     * @param {boolean} [params.stopOnBrokerFailure=false] after a broker-level failure (retries used up or timed
     * out), skip the remaining chunks and return them as failed, so a caller that falls back to MongoDB does not
     * wait for every chunk to time out in turn
     * @param {number|null} [params.batchSize] messages per produce call; defaults to RESOURCE_HISTORY_KAFKA_BATCH_SIZE
     * @returns {Promise<import('./bulkInsertUpdateEntry').BulkInsertUpdateEntry[]>} the operations that did NOT reach Kafka
     */
    async produceAsync ({ resourceType, operations, requestId, stopOnBrokerFailure = false, batchSize: batchSizeOverride = null }) {
        /** @type {import('./bulkInsertUpdateEntry').BulkInsertUpdateEntry[]} */
        const failedOperations = [];
        try {
            if (!operations || operations.length === 0 || !this.isEnabledFor(resourceType)) {
                return failedOperations;
            }
            const topic = this.configManager.resourceHistoryKafkaTopic;
            const batchSize = batchSizeOverride ?? this.configManager.resourceHistoryKafkaBatchSize;
            const compression = getKafkaCompressionType(this.configManager.kafkaProducerCompression);
            for (let i = 0; i < operations.length; i += batchSize) {
                const brokerFailed = await this._produceChunkAsync({
                    resourceType,
                    operations: operations.slice(i, i + batchSize),
                    requestId,
                    topic,
                    compression,
                    failedOperations
                });
                if (brokerFailed && stopOnBrokerFailure) {
                    const skipped = operations.slice(i + batchSize);
                    if (skipped.length > 0) {
                        failedOperations.push(...skipped);
                        metrics.recordHistoryKafkaProduce(resourceType, skipped.length, false, 0);
                        logWarn('HistoryKafkaProducer: skipping remaining chunks after a broker failure', {
                            resourceType, count: skipped.length, requestId
                        });
                    }
                    break;
                }
            }
            return failedOperations;
        } catch (err) {
            // Logged without the resource: payloads and ids are PHI-adjacent.
            metrics.recordHistoryKafkaProduce(resourceType, operations?.length || 1, false, 0);
            logError('HistoryKafkaProducer: unexpected failure', { resourceType, requestId, error: err.message });
            return operations || [];
        }
    }

    /**
     * Produces the history documents of a resource type whose MongoDB history write is disabled.
     * Documents that could not be produced are returned so the caller writes them to MongoDB instead,
     * which means no history is lost when Kafka is unavailable. Never throws.
     * @param {Object} params
     * @param {string} params.resourceType
     * @param {import('./bulkInsertUpdateEntry').BulkInsertUpdateEntry[]} params.operations history insertOne operations
     * @param {string} params.requestId
     * @returns {Promise<import('./bulkInsertUpdateEntry').BulkInsertUpdateEntry[]>} the operations to write to MongoDB
     */
    async produceWithMongoFallbackAsync ({ resourceType, operations, requestId }) {
        const fallbackOperations = await this.produceAsync({ resourceType, operations, requestId, stopOnBrokerFailure: true });
        if (fallbackOperations.length > 0) {
            metrics.recordHistoryMongoFallback(resourceType, fallbackOperations.length, FALLBACK_REASON_PRODUCE_FAILED);
            logWarn('HistoryKafkaProducer: writing history to MongoDB because the Kafka produce failed', {
                resourceType, count: fallbackOperations.length, requestId, reason: FALLBACK_REASON_PRODUCE_FAILED
            });
        }
        return fallbackOperations;
    }

    /**
     * @param {Object} params
     * @returns {Promise<boolean>} true when the chunk failed for a reason other than its own contents
     * (broker unavailable, retries used up, timeout), so the remaining chunks would likely fail too
     * @private
     */
    async _produceChunkAsync ({ resourceType, operations, requestId, topic, compression, failedOperations }) {
        const start = process.hrtime.bigint();
        let messages;
        try {
            messages = operations.map((op) => this._toMessage(op));
        } catch (err) {
            this._recordFailure({ resourceType, count: operations.length, requestId, topic, err, start });
            failedOperations.push(...operations);
            return false;
        }
        try {
            await retryWithBackoff({
                fn: () => this._withTimeoutAsync(this.kafkaClientV2.sendCloudEventMessageAsync({ topic, messages, compression })),
                maxRetries: this.maxRetries,
                initialDelayMs: this.initialRetryDelayMs,
                jitter: true,
                // Resending cannot fix a rejection caused by the chunk itself. A timed-out send is not
                // cancelled and may still deliver, so resending it would only create duplicates.
                shouldRetry: (err) => !isChunkSpecificError(err) && !err.isProduceTimeout,
                onRetry: ({ attempt, delay }) => logWarn('HistoryKafkaProducer: retrying produce', {
                    attempt, maxRetries: this.maxRetries, resourceType, count: messages.length, requestId, delay
                })
            });
            metrics.recordHistoryKafkaProduce(resourceType, messages.length, true, secondsSince(start));
            logDebug('HistoryKafkaProducer: produced', { resourceType, count: messages.length, topic, requestId });
            return false;
        } catch (err) {
            if (isChunkSpecificError(err) && operations.length > 1) {
                // Isolate the bad record so the rest of the chunk still reaches the stream.
                let brokerFailed = false;
                for (const op of operations) {
                    brokerFailed = await this._produceChunkAsync({ resourceType, operations: [op], requestId, topic, compression, failedOperations }) || brokerFailed;
                }
                return brokerFailed;
            }
            this._recordFailure({ resourceType, count: messages.length, requestId, topic, err, start });
            failedOperations.push(...operations);
            return !isChunkSpecificError(err);
        }
    }

    /**
     * @param {import('./bulkInsertUpdateEntry').BulkInsertUpdateEntry} op
     * @returns {import('kafkajs').Message}
     * @private
     */
    _toMessage (op) {
        // `_id` is MongoDB's internal row id (added to the document by insertOne), so it is left out of
        // `raw`. `_recorded` stays in `raw` as well as in its own column.
        const { _id, ...raw } = op.operation.insertOne.document;
        const recorded = raw._recorded instanceof Date ? raw._recorded : new Date(raw._recorded);
        const versionId = String(raw.resource.meta.versionId);
        // The flat row the history table maps column by column (binary mode: the value is the CloudEvent data).
        const row = {
            resource_type: op.resourceType,
            _uuid: op.uuid,
            _recorded: recorded.toISOString(),
            version_id: versionId,
            access_tags: (raw.resource.meta.security || [])
                .filter((s) => s.system === SECURITY_TAG_SYSTEMS.ACCESS)
                .map((s) => s.code),
            raw
        };
        return {
            key: `${op.resourceType}:${op.uuid}`,
            value: JSON.stringify(row),
            headers: {
                ce_specversion: '1.0',
                ce_id: generateUUIDv5(`${op.resourceType}|${op.uuid}|${versionId}|${recorded.getTime()}`),
                ce_type: CLOUD_EVENT_TYPE,
                ce_source: CLOUD_EVENT_SOURCE,
                ce_time: recorded.toISOString(),
                'content-type': 'application/json'
            }
        };
    }

    /**
     * @param {Promise<void>} promise
     * @returns {Promise<void>}
     * @private
     */
    _withTimeoutAsync (promise) {
        return withProduceTimeoutAsync(promise, this._produceTimeoutMsOverride ?? this.configManager.kafkaProducerTimeoutMs);
    }

    /** @private */
    _recordFailure ({ resourceType, count, requestId, topic, err, start }) {
        metrics.recordHistoryKafkaProduce(resourceType, count, false, secondsSince(start));
        logError('HistoryKafkaProducer: produce failed', {
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
