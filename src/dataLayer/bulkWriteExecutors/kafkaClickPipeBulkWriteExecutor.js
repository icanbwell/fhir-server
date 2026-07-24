'use strict';

const { logDebug, logError, logWarn } = require('../../operations/common/logging');
const OperationOutcomeIssue = require('../../fhir/classes/4_0_0/backbone_elements/operationOutcomeIssue');
const CodeableConcept = require('../../fhir/classes/4_0_0/complex_types/codeableConcept');
const { MergeResultEntry } = require('../../operations/common/mergeResultEntry');
const { BulkWriteExecutor } = require('./bulkWriteExecutor');
const { WRITE_STRATEGIES } = require('../../constants/clickHouseConstants');
const { assertIsValid, assertTypeEquals } = require('../../utils/assertType');

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
 * On Kafka failure the entire batch is delegated to the fallbackExecutor
 * (the existing MongoDB write path), mirroring how ClickHouseBulkWriteExecutor
 * falls back. Append-only: no history writes; change events controlled by
 * schema.fireChangeEvents.
 */
class KafkaClickPipeBulkWriteExecutor extends BulkWriteExecutor {
    /**
     * @param {Object} params
     * @param {import('../../utils/kafkaClientV2').KafkaClientV2} params.kafkaClientV2
     * @param {import('../clickHouse/schemaRegistry').ClickHouseSchemaRegistry} params.schemaRegistry
     * @param {import('./bulkWriteExecutor').BulkWriteExecutor|null} [params.fallbackExecutor] - Executor to use if the Kafka produce fails
     */
    constructor ({
        kafkaClientV2,
        schemaRegistry,
        fallbackExecutor = null
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
     * Executes bulk write by producing one Kafka message per resource.
     *
     * All-or-nothing per batch: if the produce fails, the whole batch is retried
     * by the fallback executor (Kafka's own client handles produce-level retries,
     * so no extra retry wrapper here).
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
    async executeBulkAsync ({
        resourceType,
        operations,
        requestInfo,
        base_version,
        useHistoryCollection,
        maintainOrder,
        isAccessLogOperation,
        insertOneHistoryFn
    }) {
        const schema = this.schemaRegistry.getSchema(resourceType);
        const mergeResultEntries = [];
        let bulkError = null;

        try {
            // Build the same flat rows the direct path inserts, so ClickPipes lands
            // byte-identical rows. extract() can throw (e.g. missing mandatory fields);
            // keep it inside the try so malformed resources also route to the fallback.
            // Body is the raw row JSON (no CloudEvent envelope) for ClickPipes column mapping.
            const messages = operations.map((op) => ({
                key: op.uuid,
                value: JSON.stringify(schema.fieldExtractor.extract(op.resource)),
                headers: { version: 'R4', requestId: requestInfo.requestId }
            }));

            logDebug('KafkaClickPipeBulkWriteExecutor: producing', {
                resourceType,
                count: messages.length,
                topic: schema.kafkaTopic,
                requestId: requestInfo.requestId
            });

            await this.kafkaClientV2.sendCloudEventMessageAsync({ topic: schema.kafkaTopic, messages });

            for (const entry of operations) {
                mergeResultEntries.push(new MergeResultEntry({
                    id: entry.id,
                    uuid: entry.uuid,
                    sourceAssigningAuthority: entry.sourceAssigningAuthority,
                    resourceType,
                    created: entry.isCreateOperation,
                    updated: entry.isUpdateOperation
                }));
            }
        } catch (err) {
            logError('KafkaClickPipeBulkWriteExecutor: produce failed', {
                error: err.message,
                resourceType,
                count: operations.length,
                topic: schema.kafkaTopic,
                requestId: requestInfo.requestId
            });

            if (this.fallbackExecutor) {
                logWarn('KafkaClickPipeBulkWriteExecutor: falling back to secondary storage', {
                    resourceType,
                    count: operations.length,
                    requestId: requestInfo.requestId
                });
                return this.fallbackExecutor.executeBulkAsync({
                    resourceType,
                    operations,
                    requestInfo,
                    base_version,
                    useHistoryCollection,
                    maintainOrder,
                    isAccessLogOperation,
                    insertOneHistoryFn
                });
            }

            bulkError = err;
            for (const entry of operations) {
                mergeResultEntries.push(new MergeResultEntry({
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
                }));
            }
        }

        // Post-save change events (schema.fireChangeEvents) are not supported on the
        // Kafka path — the only KAFKA_CLICKPIPE resource today is AuditEvent, which
        // has fireChangeEvents: false. Onboarding a change-event resource to this
        // strategy would require wiring postSaveProcessor here (see ClickHouseBulkWriteExecutor).
        if (!bulkError && schema.fireChangeEvents) {
            logWarn('KafkaClickPipeBulkWriteExecutor: fireChangeEvents not supported on Kafka path; skipping', {
                resourceType,
                requestId: requestInfo.requestId
            });
        }

        return {
            resourceType,
            mergeResult: null,
            mergeResultEntries,
            error: bulkError
        };
    }
}

module.exports = { KafkaClickPipeBulkWriteExecutor };
