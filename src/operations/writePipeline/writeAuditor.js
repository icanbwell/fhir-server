const { assertTypeEquals, assertIsValid } = require('../../utils/assertType');
const { AuditLogger } = require('../../utils/auditLogger');
const { PostRequestProcessor } = require('../../utils/postRequestProcessor');
const { RethrownError } = require('../../utils/rethrownError');
const { groupByLambda } = require('../../utils/list.util');

/**
 * Writes the AuditEvents for one write request, the same way for every operation the pipeline
 * runs: from the request's result entries, in a post-request task.
 */
class WriteAuditor {
    /**
     * Takes the audit logger that writes the AuditEvents and the post-request processor that runs
     * the audit task.
     * @param {AuditLogger} auditLogger
     * @param {PostRequestProcessor} postRequestProcessor
     */
    constructor ({ auditLogger, postRequestProcessor }) {
        /**
         * @type {AuditLogger}
         */
        this.auditLogger = auditLogger;
        assertTypeEquals(auditLogger, AuditLogger);
        /**
         * @type {PostRequestProcessor}
         */
        this.postRequestProcessor = postRequestProcessor;
        assertTypeEquals(postRequestProcessor, PostRequestProcessor);
    }

    /**
     * Audits write result entries in the shape the bulk inserter returns (`resourceType`, `id`,
     * `_uuid`, `created`, `updated` and `issue`), in a post-request task for the request. Per
     * resource type, it logs one `create` audit with the `_uuid`s of the created entries and one
     * `update` audit with those of the updated entries, then one error audit per entry with an
     * `issue`: 413 for a `too-long` issue and 400 otherwise. AuditEvent resources get error audits
     * but no success audits. An error while queueing the task is rethrown as a `RethrownError`.
     * @param {import('./writeContext').WriteContext} context
     * @param {Object[]} results
     * @returns {Promise<void>}
     */
    async auditAsync ({ context, results }) {
        const { requestInfo, base_version, parsedArgs } = context;
        try {
            assertIsValid(requestInfo);
            this.postRequestProcessor.add({
                requestId: requestInfo.requestId,
                fnTask: async () => {
                    /**
                     * @type {Object}
                     */
                    const groupByResourceType = groupByLambda(results, (result) => {
                        return result.resourceType;
                    });

                    for (const [resourceType, resultsForResourceType] of Object.entries(
                        groupByResourceType
                    )) {
                        /**
                         * @type {Object[]}
                         */
                        const failedItems = resultsForResourceType.filter(
                            (r) => r.issue
                        );
                        if (resourceType !== 'AuditEvent') {
                            /**
                             * @type {Object[]}
                             */
                            const createdItems = resultsForResourceType.filter(
                                (r) => r.created === true
                            );
                            /**
                             * @type {Object[]}
                             */
                            const updatedItems = resultsForResourceType.filter(
                                (r) => r.updated === true
                            );
                            if (createdItems && createdItems.length > 0) {
                                await this.auditLogger.logAuditEntryAsync({
                                    requestInfo,
                                    base_version,
                                    resourceType,
                                    operation: 'create',
                                    args: parsedArgs.getRawArgs(),
                                    ids: createdItems.map((r) => r._uuid)
                                });
                            }
                            if (updatedItems && updatedItems.length > 0) {
                                await this.auditLogger.logAuditEntryAsync({
                                    requestInfo,
                                    base_version,
                                    resourceType,
                                    operation: 'update',
                                    args: parsedArgs.getRawArgs(),
                                    ids: updatedItems.map((r) => r._uuid)
                                });
                            }
                        }
                        if (failedItems && failedItems.length > 0) {
                            for (const entry of failedItems) {
                                await this.auditLogger.logErrorAuditEntryAsync({
                                    requestInfo,
                                    resourceType,
                                    errorCode: entry.issue?.code === 'too-long' ? 413 : 400,
                                    errorMessage: `${resourceType}/${entry.id}: Bad Request`
                                });
                            }
                        }
                    }
                }
            });
        } catch (e) {
            throw new RethrownError({
                error: e
            });
        }
    }
}

module.exports = {
    WriteAuditor
};
