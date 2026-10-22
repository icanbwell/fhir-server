'use strict';

const { logDebug, logError, logWarn } = require('../../operations/common/logging');
const OperationOutcomeIssue = require('../../fhir/classes/4_0_0/backbone_elements/operationOutcomeIssue');
const CodeableConcept = require('../../fhir/classes/4_0_0/complex_types/codeableConcept');
const { MergeResultEntry } = require('../../operations/common/mergeResultEntry');
const { BulkWriteExecutor } = require('./bulkWriteExecutor');
const { WRITE_STRATEGIES } = require('../../constants/clickHouseConstants');
const { assertIsValid, assertTypeEquals } = require('../../utils/assertType');
const { retryWithBackoff } = require('../../utils/retryWithBackoff');
const { CompressionTypes } = require('kafkajs');

// Broker rejections caused by the chunk's own contents. Resending the same chunk
// cannot succeed, and the next chunk may be fine, so these fall back per chunk.
// Anything else (connection, timeout, broker errors) means Kafka is unavailable.
const CHUNK_SPECIFIC_KAFKA_ERROR_TYPES = new Set([
    'MESSAGE_TOO_LARGE',
    'RECORD_LIST_TOO_LARGE',
    'INVALID_RECORD'
]);

/**
 * kafkajs wraps protocol errors (e.g. in KafkaJSNonRetriableError), with the
 * original error and its `type` on `cause`, so walk the cause chain.
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
 * Executes bulk write operations by producing to Kafka (AWS MSK, V2 cluster) for
 * resources whose ClickHouse schema declares the KAFKA_CLICKPIPE write strategy.
 *
 * Instead of a synchronous ClickHouse insert, each resource is transformed into
 * the same flat row the direct path would insert, serialized to JSON, and
 * produced as one Kafka message. A ClickPipes source consumes the topic and
 * performs the ClickHouse insert asynchronously. The Kafka ACK is sub-second and
 * frees pod memory immediately, moving the slow insert leg into ClickPipes.
 *
 * The message body is the raw flat-row JSON (not a CloudEvent envelope) so
 * ClickPipes can map JSON keys directly to table columns.
 *
 * Operations are produced in chunks of `batchSize` messages so a single large
 * flush doesn't become one oversized Kafka request. On Kafka failure a chunk is
 * retried with backoff, then delegated to the fallbackExecutor (the existing
 * MongoDB write path) — mirroring how ClickHouseBulkWriteExecutor retries before
 * falling back. A chunk-specific rejection (e.g. MESSAGE_TOO_LARGE) is not
 * retried and falls back that chunk only; any other failure sends the remaining
 * chunks straight to the fallback without attempting Kafka again.
 * Append-only: no history writes; change events controlled by
 * schema.fireChangeEvents.
 */
class KafkaClickPipeBulkWriteExecutor extends BulkWriteExecutor {
    /**
     * @param {Object} params
     * @param {import('../../utils/kafkaClientV2').KafkaClientV2} params.kafkaClientV2
     * @param {import('../clickHouse/schemaRegistry').ClickHouseSchemaRegistry} params.schemaRegistry
     * @param {import('./bulkWriteExecutor').BulkWriteExecutor|null} [params.fallbackExecutor] - Executor to use if the Kafka produce fails
     * @param {number} [params.maxRetries=3] - Maximum retry attempts before fallback
     * @param {number} [params.initialRetryDelayMs=2000] - Initial delay in ms (doubles each retry)
     * @param {number} [params.batchSize=50] - Maximum messages per Kafka produce call
     * @param {number} [params.compression=CompressionTypes.None] - kafkajs CompressionTypes value
     */
    constructor ({
        kafkaClientV2,
        schemaRegistry,
        fallbackExecutor = null,
        maxRetries = 3,
        initialRetryDelayMs = 2000,
        batchSize = 50,
        compression = CompressionTypes.None
    }) {
        super();
        this.kafkaClientV2 = kafkaClientV2;
        assertIsValid(kafkaClientV2, 'kafkaClientV2 is required');
        this.schemaRegistry = schemaRegistry;
        assertIsValid(schemaRegistry, 'schemaRegistry is required');
        this.fallbackExecutor = fallbackExecutor;
        if (fallbackExecutor) {
            assertTypeEquals(fallbackExecutor, BulkWriteExecutor, 'fallbackExecutor must be a BulkWriteExecutor');
        }
        this.maxRetries = maxRetries;
        assertIsValid(maxRetries != null, 'maxRetries is required');
        this.initialRetryDelayMs = initialRetryDelayMs;
        assertIsValid(initialRetryDelayMs != null, 'initialRetryDelayMs is required');
        this.batchSize = batchSize;
        assertIsValid(Number.isInteger(batchSize) && batchSize > 0, 'batchSize must be a positive integer');
        this.compression = compression;
    }

    /**
     * Returns true if this executor handles the given resource type.
     * Checks the schema registry for a registered schema with KAFKA_CLICKPIPE write strategy.
     *
     * @param {string} resourceType
     * @returns {boolean}
     */
    canHandle (resourceType) {
        if (!this.schemaRegistry.hasSchema(resourceType)) {
            return false;
        }
        return this.schemaRegistry.getSchema(resourceType).writeStrategy === WRITE_STRATEGIES.KAFKA_CLICKPIPE;
    }

    /**
     * Executes bulk write by producing one Kafka message per resource, in chunks
     * of `batchSize`. Chunks are produced sequentially; results are concatenated
     * and the first chunk error (if any) is returned.
     *
     * A chunk-specific failure (see isChunkSpecificError) falls back only that
     * chunk. Any other failure is treated as Kafka being unavailable: the remaining
     * chunks go straight to the fallback without being attempted, so the time to
     * fall back is one retry cycle per flush rather than one per chunk.
     *
     * @param {Object} params
     * @param {string} params.resourceType
     * @param {BulkInsertUpdateEntry[]} params.operations
     * @param {FhirRequestInfo} params.requestInfo
     * @param {string} params.base_version
     * @param {boolean|null} params.useHistoryCollection - ignored (no history for append-only)
     * @param {boolean} params.maintainOrder - ignored
     * @param {boolean} params.isAccessLogOperation - ignored
     * @param {Function} params.insertOneHistoryFn - ignored (no history for append-only)
     * @returns {Promise<BulkResultEntry>}
     */
    async executeBulkAsync (params) {
        const { resourceType, operations, requestInfo } = params;
        const mergeResultEntries = [];
        let error = null;
        let kafkaUnavailableError = null;

        for (let i = 0; i < operations.length; i += this.batchSize) {
            const chunkParams = { ...params, operations: operations.slice(i, i + this.batchSize) };
            let result;
            if (kafkaUnavailableError) {
                result = await this._failChunkAsync(chunkParams, kafkaUnavailableError);
            } else {
                const chunkOutcome = await this._executeChunkAsync(chunkParams);
                result = chunkOutcome.result;
                if (chunkOutcome.kafkaUnavailableError) {
                    kafkaUnavailableError = chunkOutcome.kafkaUnavailableError;
                    const remaining = operations.length - (i + this.batchSize);
                    if (remaining > 0) {
                        logWarn('KafkaClickPipeBulkWriteExecutor: Kafka unavailable; skipping produce for remaining chunks', {
                            resourceType,
                            remaining,
                            requestId: requestInfo.requestId,
                            error: kafkaUnavailableError.message
                        });
                    }
                }
            }
            mergeResultEntries.push(...result.mergeResultEntries);
            error = error || result.error;
        }

        return {
            resourceType,
            mergeResult: null,
            mergeResultEntries,
            error
        };
    }

    /**
     * Produces one chunk. All-or-nothing per chunk: the produce is retried with
     * backoff (chunk-specific errors are not retried), and only once retries are
     * exhausted is the chunk handed to the fallback executor.
     *
     * @param {Object} params - same as executeBulkAsync, with `operations` limited to one chunk
     * @returns {Promise<{result: BulkResultEntry, kafkaUnavailableError: Error|null}>}
     *   kafkaUnavailableError is set when the failure is not chunk-specific
     */
    async _executeChunkAsync (params) {
        const { resourceType, operations, requestInfo } = params;
        const schema = this.schemaRegistry.getSchema(resourceType);

        let messages;
        try {
            // Build the same flat rows the direct path inserts, so ClickPipes lands
            // byte-identical rows. extract() can throw (e.g. missing mandatory fields);
            // that is a problem with this chunk only, so it falls back just this chunk.
            // Body is the raw row JSON (no CloudEvent envelope) for ClickPipes column mapping.
            messages = operations.map((op) => ({
                key: op.uuid,
                value: JSON.stringify(schema.fieldExtractor.extract(op.resource)),
                headers: { version: 'R4', requestId: requestInfo.requestId }
            }));
        } catch (err) {
            this._logProduceFailure(params, schema, err);
            return { result: await this._failChunkAsync(params, err), kafkaUnavailableError: null };
        }

        logDebug('KafkaClickPipeBulkWriteExecutor: producing', {
            resourceType,
            count: messages.length,
            topic: schema.kafkaTopic,
            requestId: requestInfo.requestId
        });

        try {
            await retryWithBackoff({
                fn: () => this.kafkaClientV2.sendCloudEventMessageAsync({
                    topic: schema.kafkaTopic,
                    messages,
                    compression: this.compression
                }),
                maxRetries: this.maxRetries,
                initialDelayMs: this.initialRetryDelayMs,
                // Resending the same chunk cannot fix a chunk-specific error.
                shouldRetry: (err) => !isChunkSpecificError(err),
                onRetry: ({ attempt, delay }) => {
                    logWarn('KafkaClickPipeBulkWriteExecutor: retrying produce', {
                        attempt,
                        maxRetries: this.maxRetries,
                        resourceType,
                        count: messages.length,
                        requestId: requestInfo.requestId,
                        delay
                    });
                }
            });
        } catch (err) {
            this._logProduceFailure(params, schema, err);
            return {
                result: await this._failChunkAsync(params, err),
                kafkaUnavailableError: isChunkSpecificError(err) ? null : err
            };
        }

        // Post-save change events (schema.fireChangeEvents) are not supported on the
        // Kafka path — the only KAFKA_CLICKPIPE resource today is AuditEvent, which
        // has fireChangeEvents: false. Onboarding a change-event resource to this
        // strategy would require wiring postSaveProcessor here (see ClickHouseBulkWriteExecutor).
        if (schema.fireChangeEvents) {
            logWarn('KafkaClickPipeBulkWriteExecutor: fireChangeEvents not supported on Kafka path; skipping', {
                resourceType,
                requestId: requestInfo.requestId
            });
        }

        return {
            result: {
                resourceType,
                mergeResult: null,
                mergeResultEntries: operations.map((entry) => new MergeResultEntry({
                    id: entry.id,
                    uuid: entry.uuid,
                    sourceAssigningAuthority: entry.sourceAssigningAuthority,
                    resourceType,
                    created: entry.isCreateOperation,
                    updated: entry.isUpdateOperation
                })),
                error: null
            },
            kafkaUnavailableError: null
        };
    }

    /**
     * @param {Object} params - chunk params
     * @param {Object} schema
     * @param {Error} err
     */
    _logProduceFailure ({ resourceType, operations, requestInfo }, schema, err) {
        logError('KafkaClickPipeBulkWriteExecutor: produce failed', {
            error: err.message,
            resourceType,
            count: operations.length,
            topic: schema.kafkaTopic,
            requestId: requestInfo.requestId
        });
    }

    /**
     * Hands a chunk to the fallback executor, or returns error entries for it
     * when no fallback is configured.
     *
     * @param {Object} params - chunk params (same shape as executeBulkAsync)
     * @param {Error} err
     * @returns {Promise<BulkResultEntry>}
     */
    async _failChunkAsync (params, err) {
        const { resourceType, operations, requestInfo } = params;
        if (this.fallbackExecutor) {
            logWarn('KafkaClickPipeBulkWriteExecutor: falling back to secondary storage', {
                resourceType,
                count: operations.length,
                requestId: requestInfo.requestId
            });
            return this.fallbackExecutor.executeBulkAsync(params);
        }

        return {
            resourceType,
            mergeResult: null,
            mergeResultEntries: operations.map((entry) => new MergeResultEntry({
                id: entry.id,
                uuid: entry.uuid,
                sourceAssigningAuthority: entry.sourceAssigningAuthority,
                resourceType,
                created: false,
                updated: false,
                issue: new OperationOutcomeIssue({
                    severity: 'error',
                    code: 'exception',
                    details: new CodeableConcept({ text: err.message }),
                    diagnostics: err.message,
                    expression: [resourceType + '/' + entry.uuid]
                })
            })),
            error: err
        };
    }
}

module.exports = { KafkaClickPipeBulkWriteExecutor };
