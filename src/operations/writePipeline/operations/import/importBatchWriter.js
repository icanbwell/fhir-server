const { assertTypeEquals } = require('../../../../utils/assertType');
const { CustomTracer } = require('../../../../utils/customTracer');
const { OwnerColumnHandler } = require('../../../../preSaveHandlers/handlers/ownerColumnHandler');
const { ParsedArgs } = require('../../../query/parsedArgs');
const { WritePipeline } = require('../../writePipeline');
const { WriteContext } = require('../../writeContext');
const { WriteItem, WRITE_ITEM_STATUS } = require('../../writeItem');
const { WriteFailure, WRITE_FAILURE_STAGE } = require('../../writeFailure');
const { ResourceStructureChecker } = require('../../resourceStructureChecker');
const { IMPORT_WRITE_PROFILE } = require('./profile');
const { ImportResponder } = require('./responder');
const { ImportBatchFlushError } = require('./importBatchFlushError');

const BASE_VERSION = '4_0_0';

/**
 * One line the `$import` worker's reader buffered for a flush: the serialized resource and the
 * absolute byte offset of its line in the source file.
 * @typedef {Object} ImportBatchResource
 * @property {Object} fhirResource
 * @property {number} byteOffset
 */

/**
 * Writes the lines of one `$import` flush on the new write path. It backfills each resource's
 * owner tag from its first access tag, as the old worker does before its checks, failing only the
 * line whose backfill throws, and drops each resource's incoming `meta.versionId`, which the build
 * always replaces and the old worker's schema check therefore never saw. It fails each other line
 * with a structural error (no id, no or an unsupported resourceType, neither a UUID id nor an
 * owner or source assigning authority tag) before any write step, as the old worker's first
 * pre-merge check did, runs the shared write steps on the other lines with
 * `WritePipeline.processAsync` under the `import` profile, flushes the queued writes once with
 * `WritePipeline.executeAsync`, and returns the import responder's entries, one per line in line
 * order, each with its line's byte offset. A flush that throws is thrown as an
 * `ImportBatchFlushError` with those entries. It does not audit: the worker audits each range from
 * the entries.
 */
class ImportBatchWriter {
    /**
     * @param {WritePipeline} writePipeline
     * @param {OwnerColumnHandler} ownerColumnHandler
     * @param {ImportResponder} importResponder
     * @param {ResourceStructureChecker} resourceStructureChecker
     * @param {CustomTracer} customTracer
     */
    constructor ({
        writePipeline,
        ownerColumnHandler,
        importResponder,
        resourceStructureChecker,
        customTracer
    }) {
        /**
         * @type {WritePipeline}
         */
        this.writePipeline = writePipeline;
        assertTypeEquals(writePipeline, WritePipeline);
        /**
         * @type {OwnerColumnHandler}
         */
        this.ownerColumnHandler = ownerColumnHandler;
        assertTypeEquals(ownerColumnHandler, OwnerColumnHandler);
        /**
         * @type {ImportResponder}
         */
        this.importResponder = importResponder;
        assertTypeEquals(importResponder, ImportResponder);
        /**
         * @type {ResourceStructureChecker}
         */
        this.resourceStructureChecker = resourceStructureChecker;
        assertTypeEquals(resourceStructureChecker, ResourceStructureChecker);
        /**
         * @type {CustomTracer}
         */
        this.customTracer = customTracer;
        assertTypeEquals(customTracer, CustomTracer);
    }

    /**
     * Writes the buffered lines of one flush in one smart-merge write context and returns one
     * entry per line, in line order. A line whose owner backfill throws, or with a structural
     * error, fails before the write steps, so nothing is checked, uploaded or written for it. An
     * empty batch writes nothing and returns no entries. An error thrown by the flush is thrown as an `ImportBatchFlushError`, which
     * carries the batch's entries, and no entries are returned.
     * @param {import('../../../../utils/fhirRequestInfo').FhirRequestInfo} requestInfo
     * @param {ImportBatchResource[]} resources
     * @returns {Promise<import('../../../common/mergeResultEntry').MergeResultEntry[]>}
     */
    async writeBatchAsync ({ requestInfo, resources }) {
        if (resources.length === 0) {
            return [];
        }
        const context = new WriteContext({
            requestInfo,
            base_version: BASE_VERSION,
            parsedArgs: new ParsedArgs({ base_version: BASE_VERSION }),
            smartMerge: true
        });
        const items = resources.map(
            ({ fhirResource, byteOffset }, index) =>
                new WriteItem({ index, incoming: fhirResource, importLine: { byteOffset } })
        );
        for (const item of items) {
            await this.backfillOwnerAsync(item);
            delete item.incoming.meta?.versionId;
        }
        this.resourceStructureChecker.failItemsWithStructuralError({
            items: items.filter((item) => item.isActive)
        });
        await this.writePipeline.processAsync({ profile: IMPORT_WRITE_PROFILE, context, items });
        const executedResults = await this.executeOrThrowFlushErrorAsync({ context, items });
        return this.importResponder.results({ context, items, executedResults });
    }

    /**
     * Flushes the queued writes of the batch and returns the flush results. When the flush throws,
     * throws an `ImportBatchFlushError` with that error as its cause, the entries the responder
     * builds from no flush results (a line that failed a check failed, a queued line created or
     * updated), and the number of distinct resource types of the queued items, because only a queued
     * item writes anything: a line that failed a check or is unchanged queues no write.
     * @param {WriteContext} context
     * @param {WriteItem[]} items
     * @returns {Promise<import('../../../common/mergeResultEntry').MergeResultEntry[]>}
     */
    async executeOrThrowFlushErrorAsync ({ context, items }) {
        try {
            return await this.customTracer.trace({
                name: `WritePipeline.${IMPORT_WRITE_PROFILE.name}.executeAsync`,
                func: async () => await this.writePipeline.executeAsync({ context })
            });
        } catch (error) {
            const resourceTypesReachingFlush = new Set(
                items
                    .filter((item) => item.status === WRITE_ITEM_STATUS.QUEUED)
                    .map((item) => item.incoming.resourceType)
            );
            throw new ImportBatchFlushError({
                error,
                entries: this.importResponder.results({ items, executedResults: [] }),
                resourceTypeCount: resourceTypesReachingFlush.size
            });
        }
    }

    /**
     * Backfills the item's owner tag from its first access tag, and fails the item at the
     * `IDENTITY` stage with the error the backfill throws, so only that line fails.
     * @param {WriteItem} item
     * @returns {Promise<void>}
     */
    async backfillOwnerAsync (item) {
        try {
            await this.ownerColumnHandler.preSaveAsync({ resource: item.incoming });
        } catch (error) {
            item.fail({
                failure: new WriteFailure({
                    stage: WRITE_FAILURE_STAGE.IDENTITY,
                    subject: WriteFailure.subjectOf(item.incoming),
                    error
                })
            });
        }
    }
}

module.exports = {
    ImportBatchWriter
};
