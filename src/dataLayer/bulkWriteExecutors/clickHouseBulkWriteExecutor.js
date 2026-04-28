'use strict';

const { logDebug, logError, logWarn } = require('../../operations/common/logging');
const OperationOutcomeIssue = require('../../fhir/classes/4_0_0/backbone_elements/operationOutcomeIssue');
const CodeableConcept = require('../../fhir/classes/4_0_0/complex_types/codeableConcept');
const { MergeResultEntry } = require('../../operations/common/mergeResultEntry');
const { BulkWriteExecutor } = require('./bulkWriteExecutor');
const { WRITE_STRATEGIES } = require('../../constants/clickHouseConstants');
const { assertIsValid, assertTypeEquals } = require('../../utils/assertType');
const { retryWithBackoff } = require('../../utils/retryWithBackoff');

/**
 * Executes bulk write operations against ClickHouse for ClickHouse-only resources.
 *
 * Append-only: inserts resources via genericClickHouseRepository.
 * No history writes (append-only resources don't version).
 * No MongoDB coupling (no bulkWriteResult.hasWriteErrors).
 * Change events controlled by schema.fireChangeEvents.
 */
class ClickHouseBulkWriteExecutor extends BulkWriteExecutor {
    /**
     * @param {Object} params
     * @param {import('../repositories/genericClickHouseRepository').GenericClickHouseRepository} params.genericClickHouseRepository
     * @param {import('../clickHouse/schemaRegistry').ClickHouseSchemaRegistry} params.schemaRegistry
     * @param {import('../postSaveProcessor').PostSaveProcessor} params.postSaveProcessor
     * @param {import('./bulkWriteExecutor').BulkWriteExecutor|null} [params.fallbackExecutor] - Executor to use if ClickHouse write fails
     * @param {number} [params.maxRetries=3] - Maximum retry attempts before fallback
     * @param {number} [params.initialRetryDelayMs=2000] - Initial delay in ms (doubles each retry)
     */
    constructor ({
        genericClickHouseRepository,
        schemaRegistry,
        postSaveProcessor,
        fallbackExecutor = null,
        maxRetries = 3,
        initialRetryDelayMs = 2000
    }) {
        super();
        this.repository = genericClickHouseRepository;
        assertIsValid(genericClickHouseRepository, 'genericClickHouseRepository is required');
        this.schemaRegistry = schemaRegistry;
        assertIsValid(schemaRegistry, 'schemaRegistry is required');
        this.postSaveProcessor = postSaveProcessor;
        assertIsValid(postSaveProcessor, 'postSaveProcessor is required');
        this.fallbackExecutor = fallbackExecutor;
        if (fallbackExecutor) {
            assertTypeEquals(fallbackExecutor, BulkWriteExecutor, 'fallbackExecutor must be a BulkWriteExecutor');
        }
        this.maxRetries = maxRetries;
        assertIsValid(maxRetries != null, 'maxRetries is required');
        this.initialRetryDelayMs = initialRetryDelayMs;
        assertIsValid(initialRetryDelayMs != null, 'initialRetryDelayMs is required');
    }

    /**
     * Returns true if this executor handles the given resource type.
     * Checks the schema registry for a registered schema with SYNC_DIRECT write strategy.
     *
     * @param {string} resourceType
     * @returns {boolean}
     */
    canHandle (resourceType) {
        if (!this.schemaRegistry.hasSchema(resourceType)) {
            return false;
        }
        return this.schemaRegistry.getSchema(resourceType).writeStrategy === WRITE_STRATEGIES.SYNC_DIRECT;
    }

    /**
     * Executes bulk write for ClickHouse-only resources.
     *
     * All-or-nothing: ClickHouse guarantees an insert either commits all rows or none.
     * No per-row success/failure reconciliation (unlike MongoDB bulkWrite).
     *
     * @param {Object} params
     * @param {string} params.resourceType
     * @param {BulkInsertUpdateEntry[]} params.operations
     * @param {FhirRequestInfo} params.requestInfo
     * @param {string} params.base_version
     * @param {boolean|null} params.useHistoryCollection - ignored (no history for append-only)
     * @param {boolean} params.maintainOrder - ignored (ClickHouse inserts are atomic)
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
            const resources = operations.map(op => op.resource);

            logDebug('ClickHouseBulkWriteExecutor: inserting', {
                resourceType,
                count: resources.length,
                requestId: requestInfo.requestId
            });

            await retryWithBackoff({
                fn: () => this.repository.insertAsync({ resourceType, resources }),
                maxRetries: this.maxRetries,
                initialDelayMs: this.initialRetryDelayMs,
                onRetry: ({ attempt, delay }) => {
                    logWarn('ClickHouseBulkWriteExecutor: retrying insert', {
                        attempt,
                        maxRetries: this.maxRetries,
                        resourceType,
                        count: resources.length,
                        requestId: requestInfo.requestId,
                        delay
                    });
                }
            });

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
            logError('ClickHouseBulkWriteExecutor: insert failed after retries', {
                error: err.message,
                resourceType,
                count: operations.length,
                requestId: requestInfo.requestId,
                maxRetries: this.maxRetries
            });

            if (this.fallbackExecutor) {
                logWarn('ClickHouseBulkWriteExecutor: falling back to secondary storage', {
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

        // Post-save: no history (append-only), fireChangeEvents from schema
        if (!bulkError && schema.fireChangeEvents) {
            for (const entry of operations) {
                try {
                    await this.postSaveProcessor.afterSaveAsync({
                        requestId: requestInfo.requestId,
                        eventType: entry.isCreateOperation ? 'C' : 'U',
                        resourceType,
                        doc: entry.resource,
                        contextData: entry.contextData
                    });
                } catch (postSaveErr) {
                    logError('ClickHouseBulkWriteExecutor: change event failed', {
                        error: postSaveErr.message,
                        resourceType,
                        id: entry.id,
                        requestId: requestInfo.requestId
                    });
                }
            }
        }

        return {
            resourceType,
            mergeResult: null,
            mergeResultEntries,
            error: bulkError
        };
    }
}

module.exports = { ClickHouseBulkWriteExecutor };
