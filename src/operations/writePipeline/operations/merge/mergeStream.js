const { assertTypeEquals } = require('../../../../utils/assertType');
const { CustomTracer } = require('../../../../utils/customTracer');
const { WritePipeline } = require('../../writePipeline');
const { WriteAuditor } = require('../../writeAuditor');
const { MERGE_WRITE_PROFILE } = require('./profile');
const { MergeResponder, PLACEHOLDER_STATUSES } = require('./responder');

/**
 * Streaming (NDJSON) `$merge` on the new write path: the stream handler that
 * `MergeOperation.mergeAsyncStream` calls for each line and each batch commit. It reads each line
 * and builds its failure results with the `$merge` responder, and runs the shared write steps with
 * `WritePipeline.processAsync`. A line's failures are streamed back at once and its unchanged and
 * queued resources wait for the batch commit, which flushes the queued writes with
 * `WritePipeline.executeAsync`, and the results it is given are audited by `WriteAuditor`.
 */
class MergeStream {
    /**
     * @param {MergeResponder} mergeResponder
     * @param {WritePipeline} writePipeline
     * @param {WriteAuditor} writeAuditor
     * @param {CustomTracer} customTracer
     */
    constructor ({ mergeResponder, writePipeline, writeAuditor, customTracer }) {
        /**
         * @type {MergeResponder}
         */
        this.mergeResponder = mergeResponder;
        assertTypeEquals(mergeResponder, MergeResponder);
        /**
         * @type {WritePipeline}
         */
        this.writePipeline = writePipeline;
        assertTypeEquals(writePipeline, WritePipeline);
        /**
         * @type {WriteAuditor}
         */
        this.writeAuditor = writeAuditor;
        assertTypeEquals(writeAuditor, WriteAuditor);
        /**
         * @type {CustomTracer}
         */
        this.customTracer = customTracer;
        assertTypeEquals(customTracer, CustomTracer);
    }

    /**
     * Creates the new path's handler for one streaming `$merge` request, in the request's `merge`
     * write context.
     * @param {import('../../../../utils/fhirRequestInfo').FhirRequestInfo} requestInfo
     * @param {import('../../../query/parsedArgs').ParsedArgs} parsedArgs
     * @param {string} resourceType
     * @returns {import('../../../merge/merge').MergeStreamHandler}
     */
    createStreamHandler ({ requestInfo, parsedArgs, resourceType }) {
        const context = this.mergeResponder.createContext({ requestInfo, parsedArgs });
        return {
            mergeLineAsync: async ({ resource, push }) =>
                await this.mergeLineAsync({ context, resourceType, resource, push }),
            executeAsync: async () => await this.executeBatchAsync({ context }),
            auditAsync: async ({ results }) => await this.auditAsync({ context, results })
        };
    }

    /**
     * Reads one NDJSON line into items, runs the shared write steps on them and pushes the line's
     * request errors and failed items. Returns the resources of its unchanged and queued items,
     * which wait for the next batch commit.
     * @param {import('../../writeContext').WriteContext} context
     * @param {string} resourceType
     * @param {Object} resource
     * @param {function(Object): void} push
     * @returns {Promise<Object[]>}
     */
    async mergeLineAsync ({ context, resourceType, resource, push }) {
        const { items, requestErrors } = await this.mergeResponder.readIncomingAsync({
            context,
            resourceType,
            incomingObjects: resource
        });
        await this.writePipeline.processAsync({ profile: MERGE_WRITE_PROFILE, context, items });
        for (const result of this.mergeResponder.failureResults({ items, requestErrors })) {
            push(result);
        }
        return items
            .filter((item) => PLACEHOLDER_STATUSES.includes(item.status))
            .map((item) => item.incoming);
    }

    /**
     * Flushes the queued writes and returns their results.
     * @param {import('../../writeContext').WriteContext} context
     * @returns {Promise<Object[]>}
     */
    async executeBatchAsync ({ context }) {
        return await this.customTracer.trace({
            name: `WritePipeline.${MERGE_WRITE_PROFILE.name}.stream.executeAsync`,
            func: async () => await this.writePipeline.executeAsync({ context })
        });
    }

    /**
     * Audits the results.
     * @param {import('../../writeContext').WriteContext} context
     * @param {Object[]} results
     * @returns {Promise<void>}
     */
    async auditAsync ({ context, results }) {
        await this.customTracer.trace({
            name: `WritePipeline.${MERGE_WRITE_PROFILE.name}.stream.audit`,
            func: async () => await this.writeAuditor.auditAsync({ context, results })
        });
    }
}

module.exports = {
    MergeStream
};
