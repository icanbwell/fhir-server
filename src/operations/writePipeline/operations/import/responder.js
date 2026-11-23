const { MergeResultEntry } = require('../../../common/mergeResultEntry');
const { buildOperationOutcomeFromIssues } = require('../../../../utils/operationOutcomeBuilder');
const { WRITE_FAILURE_STAGE } = require('../../writeFailure');
const { WRITE_ITEM_STATUS } = require('../../writeItem');
const { WriteResponder } = require('../../writeResponder');

/**
 * The stages of the checks the old worker ran before it called the merge code. An error thrown
 * there was reported with `MergeResultEntry.createFromError`, with the line's byte offset; an error
 * thrown at a later stage, inside the merge code, with the merge code's own entry.
 */
const STAGES_BEFORE_MERGE = Object.freeze([
    WRITE_FAILURE_STAGE.STRUCTURE,
    WRITE_FAILURE_STAGE.SCOPE,
    WRITE_FAILURE_STAGE.SIZE,
    WRITE_FAILURE_STAGE.IDENTITY,
    WRITE_FAILURE_STAGE.INCOMING_SCHEMA,
    WRITE_FAILURE_STAGE.INCOMING_META,
    WRITE_FAILURE_STAGE.ACCESS
]);

/**
 * The stages whose failure `ValidateIncomingStep` records on the body `PrepareBodyStep` stripped of
 * its `_` fields, so the failure's subject has no `_uuid` or source assigning authority.
 */
const STAGES_ON_STRIPPED_BODY = Object.freeze([
    WRITE_FAILURE_STAGE.SIZE,
    WRITE_FAILURE_STAGE.IDENTITY
]);

/**
 * Compares two items by their position in the batch, for `sort`.
 */
const byIndex = (a, b) => a.index - b.index;
/**
 * Builds the `resourceType|uuid` key that matches flush results to items.
 */
const keyOf = ({ resourceType, uuid }) => `${resourceType}|${uuid}`;
/**
 * Returns a flush result's key, from its `resourceType` and `_uuid`.
 */
const resultKey = (result) => keyOf({ resourceType: result?.resourceType, uuid: result?._uuid });
/**
 * Returns an item's key, from its body's `resourceType` and `_uuid`.
 */
const itemKey = (item) => keyOf({ resourceType: item.incoming.resourceType, uuid: item.incoming._uuid });

/**
 * Holds everything that depends on the `$import` worker's result format. The worker's reader
 * builds the items, so this responder reads nothing and builds no response: it builds one result
 * entry per line, in line order, in the shapes the old worker wrote (created, updated, failed, and
 * not-created, not-updated for an unchanged line), each carrying its line's byte offset, and does
 * not record metrics, which the worker records from the entries. The batch writer asks it for the
 * entries after the flush; the pipeline does not audit them.
 */
class ImportResponder extends WriteResponder {
    /**
     * Always throws: the worker's reader builds the items, so no import run reads a request.
     * @returns {Promise<never>}
     */
    async readAsync () {
        throw new Error('ImportResponder does not read a request: the import reader builds the items');
    }

    /**
     * Returns one entry per failed item in line order, so the batch has them if the flush throws.
     * @param {import('../../writeItem').WriteItem[]} items
     * @returns {MergeResultEntry[]}
     */
    failureResults ({ items }) {
        return [...items]
            .sort(byIndex)
            .filter((item) => item.status === WRITE_ITEM_STATUS.FAILED)
            .map((item) => this.toFailureEntry(item));
    }

    /**
     * Returns one entry per item in line order, matched by the item's position and not by its
     * `resourceType` and `_uuid`, so two lines of one resource give two entries. A failed item
     * gets its failure entry and an unchanged item an entry that is neither created nor updated.
     * Any other item gets the next flush result for its `resourceType` and `_uuid`, or, when none
     * is left, the last one an earlier line of that resource got, because the bulk inserter folds
     * the writes of one resource in a flush into one document and returns one result for it: a
     * failed entry when that result carries an issue, otherwise a created entry, or an updated
     * entry when the item updates a stored resource or repeats an earlier line's resource.
     * @param {import('../../writeItem').WriteItem[]} items
     * @param {MergeResultEntry[]} executedResults
     * @returns {MergeResultEntry[]}
     */
    results ({ items, executedResults }) {
        /**
         * @type {Map<string, MergeResultEntry[]>}
         */
        const flushResultsByKey = new Map();
        for (const executedResult of executedResults ?? []) {
            const key = resultKey(executedResult);
            flushResultsByKey.set(key, [...(flushResultsByKey.get(key) ?? []), executedResult]);
        }
        /**
         * @type {Map<string, MergeResultEntry>}
         */
        const lastFlushResultByKey = new Map();
        return [...items].sort(byIndex).map((item) => {
            if (item.status === WRITE_ITEM_STATUS.FAILED) {
                return this.toFailureEntry(item);
            }
            if (item.status === WRITE_ITEM_STATUS.UNCHANGED) {
                return this.toSuccessEntry({ item, created: false, updated: false });
            }
            const key = itemKey(item);
            const flushResult =
                flushResultsByKey.get(key)?.shift() ?? lastFlushResultByKey.get(key);
            if (flushResult) {
                lastFlushResultByKey.set(key, flushResult);
            }
            if (flushResult?.issue) {
                return this.toFlushFailureEntry({ item, flushResult });
            }
            const updated = item.importLine?.forceUpdated === true || item.writeMode === 'update';
            return this.toSuccessEntry({ item, created: !updated, updated });
        });
    }

    /**
     * Turns an item's failure into its entry, with the identity the reader gave the line. A check
     * failure keeps its OperationOutcome and first issue and carries the line's byte offset. An
     * error from a check the old worker ran before the merge gets the entry of
     * `MergeResultEntry.createFromError` with the byte offset; any other error gets the entry the
     * merge code builds for a thrown error, which has no byte offset, as the old worker's has none.
     * @param {import('../../writeItem').WriteItem} item
     * @returns {MergeResultEntry}
     */
    toFailureEntry (item) {
        const { failure } = item;
        const { id, uuid, sourceAssigningAuthority, resourceType } = this.subjectOf(item);
        if (failure.operationOutcome === null && !STAGES_BEFORE_MERGE.includes(failure.stage)) {
            return MergeResultEntry.createFromMergeException({
                error: failure.error,
                resource: item.incoming,
                resourceType: resourceType ?? item.incoming.resourceType
            });
        }
        if (failure.operationOutcome === null) {
            return MergeResultEntry.createFromError({
                error: failure.error,
                resource: {
                    id,
                    _uuid: uuid,
                    _sourceAssigningAuthority: sourceAssigningAuthority,
                    resourceType: resourceType ?? item.incoming.resourceType
                }
            }).withSourceByteOffset(item.importLine?.byteOffset);
        }
        return new MergeResultEntry({
            id,
            uuid,
            sourceAssigningAuthority,
            resourceType,
            created: false,
            updated: false,
            issue: failure.operationOutcome.issue?.[0] || null,
            operationOutcome: failure.operationOutcome
        }).withSourceByteOffset(item.importLine?.byteOffset);
    }

    /**
     * Returns the failure's subject, with the `_uuid` and source assigning authority that
     * `PrepareBodyStep` saved when the failure was recorded on the stripped body: the reader gave
     * the line its identity before any check, so the old worker's entry carries both.
     * @param {import('../../writeItem').WriteItem} item
     * @returns {import('../../writeFailure').WriteFailureSubject}
     */
    subjectOf (item) {
        const { failure, savedIdentity } = item;
        if (!savedIdentity || !STAGES_ON_STRIPPED_BODY.includes(failure.stage)) {
            return failure.subject;
        }
        return {
            ...failure.subject,
            uuid: savedIdentity.uuid,
            sourceAssigningAuthority: savedIdentity.sourceAssigningAuthority
        };
    }

    /**
     * Returns the failed entry for an item whose flush result carries an issue. The bulk inserter
     * reports only the issue, so the entry's OperationOutcome is built from it, which is what puts
     * the entry in the range's error output. The entry gets its own copy of the issue, because
     * several lines of one resource share one flush result and each carries its own byte offset.
     * @param {import('../../writeItem').WriteItem} item
     * @param {MergeResultEntry} flushResult
     * @returns {MergeResultEntry}
     */
    toFlushFailureEntry ({ item, flushResult }) {
        const issue = { ...flushResult.issue };
        return new MergeResultEntry({
            id: item.incoming.id,
            uuid: item.incoming._uuid,
            sourceAssigningAuthority: item.incoming._sourceAssigningAuthority,
            resourceType: item.incoming.resourceType,
            created: false,
            updated: false,
            issue,
            operationOutcome: buildOperationOutcomeFromIssues([issue])
        }).withSourceByteOffset(item.importLine?.byteOffset);
    }

    /**
     * Returns the entry of an item that did not fail, from its body's identity.
     * @param {import('../../writeItem').WriteItem} item
     * @param {boolean} created
     * @param {boolean} updated
     * @returns {MergeResultEntry}
     */
    toSuccessEntry ({ item, created, updated }) {
        return new MergeResultEntry({
            id: item.incoming.id,
            uuid: item.incoming._uuid,
            sourceAssigningAuthority: item.incoming._sourceAssigningAuthority,
            resourceType: item.incoming.resourceType,
            created,
            updated,
            issue: null,
            operationOutcome: null
        }).withSourceByteOffset(item.importLine?.byteOffset);
    }

    /**
     * Returns the results unchanged: an import run has no response.
     * @param {MergeResultEntry[]} results
     * @returns {MergeResultEntry[]}
     */
    toResponse ({ results }) {
        return results;
    }

    /**
     * Does nothing: the worker records the import metrics from the entries.
     * @returns {void}
     */
    recordMetrics () {}
}

module.exports = {
    ImportResponder
};
