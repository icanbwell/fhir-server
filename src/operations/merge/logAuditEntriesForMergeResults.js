const {logAuditEntryAsync} = require('../../utils/auditLogger');

/**
 * logs audit entries for merge result entries
 * @param {import('../../utils/requestInfo').RequestInfo} requestInfo
 * @param {string} base_version
 * @param {Object} args
 * @param {MergeResultEntry[]} mergeResults
 * @returns {Promise<void>}
 */
async function logAuditEntriesForMergeResults(requestInfo, base_version, args, mergeResults) {
    // group by resource name
    const groupByResourceType = mergeResults.groupBy(mergeResult => {
        return mergeResult.resourceType;
    });

    for (const [resourceType, mergeResultsForResourceType] of groupByResourceType) {
        if (resourceType !== 'AuditEvent') { // we don't log queries on AuditEvent itself
            /**
             * @type {MergeResultEntry[]}
             */
            const createdItems = mergeResultsForResourceType.filter(r => r.created === true);
            /**
             * @type {MergeResultEntry[]}
             */
            const updatedItems = mergeResultsForResourceType.filter(r => r.updated === true);
            if (createdItems && createdItems.length > 0) {
                await logAuditEntryAsync(requestInfo, base_version, resourceType, 'create', args, createdItems.map(r => r['id']));
            }
            if (updatedItems && updatedItems.length > 0) {
                await logAuditEntryAsync(requestInfo, base_version, resourceType, 'update', args, updatedItems.map(r => r['id']));
            }
        }
    }
}

module.exports = {
    logAuditEntriesForMergeResults
};
