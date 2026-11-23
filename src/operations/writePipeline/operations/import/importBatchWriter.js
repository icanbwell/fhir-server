const { assertTypeEquals } = require('../../../../utils/assertType');
const { CustomTracer } = require('../../../../utils/customTracer');
const { OwnerColumnHandler } = require('../../../../preSaveHandlers/handlers/ownerColumnHandler');
const { ParsedArgs } = require('../../../query/parsedArgs');
const { WritePipeline } = require('../../writePipeline');
const { WriteContext } = require('../../writeContext');
const { WriteItem } = require('../../writeItem');
const { ResourceStructureChecker } = require('../../resourceStructureChecker');
const { IMPORT_WRITE_PROFILE } = require('./profile');
const { ImportResponder } = require('./responder');

const BASE_VERSION = '4_0_0';

/**
 * One line the `$import` worker's reader buffered for a flush: the serialized resource, the
 * absolute byte offset of its line in the source file, and whether an earlier line of the same
 * flush already had the resource's `_uuid`.
 * @typedef {Object} ImportBatchResource
 * @property {Object} fhirResource
 * @property {number} byteOffset
 * @property {boolean} forceUpdated
 */

/**
 * Writes the lines of one `$import` flush on the new write path. It backfills each resource's
 * owner tag from its first access tag, as the old worker does before its checks, and drops each
 * resource's incoming `meta.versionId`, which the build always replaces and the old worker's
 * schema check therefore never saw. It fails each line with a structural error (no id, no or an
 * unsupported resourceType, neither a UUID id nor an owner or source assigning authority tag)
 * before any write step, as the old worker's first pre-merge check did, runs the shared write
 * steps on the other lines with `WritePipeline.processAsync` under the `import` profile, flushes
 * the queued writes once with `WritePipeline.executeAsync`, and returns the import responder's
 * entries, one per line in line order, each with its line's byte offset. It does not audit: the
 * worker audits each range from the entries.
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
     * entry per line, in line order. A line with a structural error fails before the write steps,
     * so nothing is checked, uploaded or written for it. An empty batch writes nothing and returns
     * no entries. An error thrown by the flush is rethrown, and no entries are returned.
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
        for (const { fhirResource } of resources) {
            await this.ownerColumnHandler.preSaveAsync({ resource: fhirResource });
            delete fhirResource.meta?.versionId;
        }
        const items = resources.map(
            ({ fhirResource, byteOffset, forceUpdated }, index) =>
                new WriteItem({
                    index,
                    incoming: fhirResource,
                    importLine: { byteOffset, forceUpdated }
                })
        );
        this.resourceStructureChecker.failItemsWithStructuralError({ items });
        await this.writePipeline.processAsync({ profile: IMPORT_WRITE_PROFILE, context, items });
        const executedResults = await this.customTracer.trace({
            name: `WritePipeline.${IMPORT_WRITE_PROFILE.name}.executeAsync`,
            func: async () => await this.writePipeline.executeAsync({ context })
        });
        return this.importResponder.results({ context, items, executedResults });
    }
}

module.exports = {
    ImportBatchWriter
};
