const { MergeResultEntry } = require('../../../common/mergeResultEntry');
const { buildOperationOutcomeFromIssues } = require('../../../../utils/operationOutcomeBuilder');
const { WRITE_FAILURE_STAGE } = require('../../writeFailure');
const { WRITE_ITEM_STATUS } = require('../../writeItem');

/**
 * The stages of the checks that run before the merge step. An error thrown there is reported with
 * `MergeResultEntry.createFromError`, with the line's byte offset, as the old worker reported an
 * error of its pre-merge checks; an error thrown at a later stage, as the old worker's merge code
 * did, gets the merge code's own entry. The incoming schema check is the one stage the old worker
 * ran inside its merge code.
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
 * Returns the text a flush failure entry carries for the text the bulk write executor reported.
 * The executor reports a write error as the JSON array of its write errors, whose elements hold
 * the written resource, so a text that parses to an array is replaced by a fixed message with the
 * distinct error codes and nothing else. Any other text, such as the document size error text, is
 * returned unchanged.
 * @param {string|undefined} text
 * @param {string} resourceType
 * @returns {string|undefined}
 */
const flushFailureText = (text, resourceType) => {
    if (typeof text !== 'string') {
        return text;
    }
    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch {
        return text;
    }
    if (!Array.isArray(parsed)) {
        return text;
    }
    const codes = [
        ...new Set(
            parsed
                .map((writeError) => writeError?.code)
                .filter((code) => typeof code === 'number' || typeof code === 'string')
        )
    ];
    const message = `Bulk write failed for ${resourceType}`;
    return codes.length > 0 ? `${message}: error code ${codes.join(', ')}` : message;
};

/**
 * Holds everything that depends on the `$import` worker's result format. The worker's reader
 * builds the items and the worker records the metrics, so this is a plain class and not a
 * `WriteResponder`: it only builds one result entry per line, in line order, in the shapes the old
 * worker wrote (created, updated, failed, and not-created, not-updated for an unchanged line),
 * each carrying its line's byte offset. The batch writer asks it for the entries after the flush;
 * the pipeline does not audit them.
 */
class ImportResponder {
    /**
     * Returns one entry per item in line order, matched by the item's position and not by its
     * `resourceType` and `_uuid`, so two lines of one resource give two entries. A failed item
     * gets its failure entry and an unchanged item an entry that is neither created nor updated.
     * Any other item gets the next flush result for its `resourceType` and `_uuid`, or, when none
     * is left, the last one an earlier line of that resource got, because the bulk inserter folds
     * the writes of one resource in a flush into one document and returns one result for it: a
     * failed entry when that result carries an issue, an entry that is neither created nor updated
     * when it carries no issue and neither flag (the stored resource already equals the write),
     * otherwise a created entry, or an updated entry when the item updates a stored resource or
     * repeats an earlier line's resource. A line repeats a resource when an earlier line of the
     * batch with the same `resourceType` and `_uuid` was queued or found unchanged; an earlier
     * line that failed a check wrote nothing, so it does not make a repeat.
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
        /**
         * The keys of the resources an earlier line queued or found unchanged.
         * @type {Set<string>}
         */
        const keysOfEarlierWrites = new Set();
        return [...items].sort(byIndex).map((item) => {
            if (item.status === WRITE_ITEM_STATUS.FAILED) {
                return this.toFailureEntry(item);
            }
            const key = itemKey(item);
            const repeats = keysOfEarlierWrites.has(key);
            if (item.status !== WRITE_ITEM_STATUS.ACTIVE) {
                keysOfEarlierWrites.add(key);
            }
            if (item.status === WRITE_ITEM_STATUS.UNCHANGED) {
                return this.toSuccessEntry({ item, created: false, updated: false });
            }
            const flushResult =
                flushResultsByKey.get(key)?.shift() ?? lastFlushResultByKey.get(key);
            if (flushResult) {
                lastFlushResultByKey.set(key, flushResult);
            }
            if (flushResult?.issue) {
                return this.toFlushFailureEntry({ item, flushResult });
            }
            if (flushResult && !flushResult.created && !flushResult.updated) {
                return this.toSuccessEntry({ item, created: false, updated: false });
            }
            const updated = repeats || item.writeMode === 'update';
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
     * The copy has no resource content: the executor's write error text, a JSON array that holds
     * the written resource, is replaced by a message with the error codes.
     * @param {import('../../writeItem').WriteItem} item
     * @param {MergeResultEntry} flushResult
     * @returns {MergeResultEntry}
     */
    toFlushFailureEntry ({ item, flushResult }) {
        const { resourceType } = item.incoming;
        const issue = { ...flushResult.issue };
        if (issue.details) {
            issue.details = {
                ...issue.details,
                text: flushFailureText(issue.details.text, resourceType)
            };
        }
        if (issue.diagnostics !== undefined) {
            issue.diagnostics = flushFailureText(issue.diagnostics, resourceType);
        }
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
}

module.exports = {
    ImportResponder
};
