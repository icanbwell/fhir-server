const {getResource} = require('../common/getResource');
const {logDebug, logRequest} = require('../common/logging');
const deepcopy = require('deepcopy');
const {preSaveAsync} = require('../common/preSave');
const {removeNull} = require('../../utils/nullRemover');
const deepEqual = require('fast-deep-equal');
const {mergeObject} = require('../../utils/mergeHelper');
const {compare, applyPatch} = require('fast-json-patch');
const {isAccessToResourceAllowedBySecurityTags} = require('../security/scopes');
const {ForbiddenError} = require('../../utils/httpErrors');
const moment = require('moment-timezone');
const env = require('var');
const sendToS3 = require('../../utils/aws-s3');
const {performMergeDbUpdateAsync} = require('./performMergeDbUpdate');

/**
 * resource to merge
 * @param {Resource} resourceToMerge
 * @param {Object} data
 * @param {string} baseVersion
 * @param {string|null} user
 * @param {string} scope
 * @param {string} currentDate
 * @param {string} requestId
 * @param {DatabaseBulkInserter} databaseBulkInserter
 * @returns {Promise<void>}
 */
async function mergeExistingAsync(resourceToMerge, data,
                                  baseVersion, user, scope,
                                  currentDate,
                                  requestId,
                                  databaseBulkInserter) {
    /**
     * @type {string}
     */
    let id = resourceToMerge.id;
    // create a resource with incoming data
    /**
     * @type {function({Object}):Resource}
     */
    let Resource = getResource(baseVersion, resourceToMerge.resourceType);

    // found an existing resource
    logDebug(user, resourceToMerge.resourceType + ': merge found resource ' + '[' + data.id + ']: ' + JSON.stringify(data));
    /**
     * @type {Resource}
     */
    let foundResource = new Resource(data);
    logDebug(user, '------ found document --------');
    logDebug(user, JSON.stringify(data));
    logDebug(user, '------ end found document --------');
    // use metadata of existing resource (overwrite any passed in metadata)
    if (!resourceToMerge.meta) {
        resourceToMerge.meta = {};
    }
    // compare without checking source, so we don't create a new version just because of a difference in source
    /**
     * @type {string}
     */
    const original_source = resourceToMerge.meta.source;
    resourceToMerge.meta.versionId = foundResource.meta.versionId;
    resourceToMerge.meta.lastUpdated = foundResource.meta.lastUpdated;
    resourceToMerge.meta.source = foundResource.meta.source;
    logDebug(user, '------ incoming document --------');
    logDebug(user, JSON.stringify(resourceToMerge));
    logDebug(user, '------ end incoming document --------');

    /**
     * @type {Object}
     */
    let my_data = deepcopy(data);

    await preSaveAsync(my_data);

    delete my_data['_id']; // remove _id since that is an internal
    // remove any null properties so deepEqual does not consider objects as different because of that
    my_data = removeNull(my_data);
    resourceToMerge = removeNull(resourceToMerge);

    // for speed, first check if the incoming resource is exactly the same
    if (deepEqual(my_data, resourceToMerge) === true) {
        logDebug(user, 'No changes detected in updated resource');
        return {
            id: id,
            created: false,
            updated: false,
            resource_version: foundResource.meta.versionId,
            message: 'No changes detected in updated resource'
        };
    }

    // data seems to get updated below
    /**
     * @type {Object}
     */
    let resource_merged = mergeObject(my_data, resourceToMerge);

    // now create a patch between the document in db and the incoming document
    //  this returns an array of patches
    /**
     * @type {Operation[]}
     */
    let patchContent = compare(my_data, resource_merged);
    // ignore any changes to _id since that's an internal field
    patchContent = patchContent.filter(item => item.path !== '/_id');
    logDebug(user, '------ patches --------');
    logDebug(user, JSON.stringify(patchContent));
    logDebug(user, '------ end patches --------');
    // see if there are any changes
    if (patchContent.length === 0) {
        logDebug(user, 'No changes detected in updated resource');
        return {
            id: id,
            created: false,
            updated: false,
            resource_version: foundResource.meta.versionId,
            message: 'No changes detected in updated resource'
        };
    }
    if (!(isAccessToResourceAllowedBySecurityTags(foundResource, user, scope))) {
        throw new ForbiddenError(
            'user ' + user + ' with scopes [' + scope + '] has no access to resource ' +
            foundResource.resourceType + ' with id ' + id);
    }
    logRequest(user, `${resourceToMerge.resourceType} >>> merging ${id}`);
    // now apply the patches to the found resource
    // noinspection JSCheckFunctionSignatures
    /**
     * @type {Object}
     */
    let patched_incoming_data = applyPatch(data, patchContent).newDocument;
    /**
     * @type {Resource}
     */
    let patched_resource_incoming = new Resource(patched_incoming_data);
    // update the metadata to increment versionId
    /**
     * @type {Meta}
     */
    let meta = foundResource.meta;
    meta.versionId = `${parseInt(foundResource.meta.versionId) + 1}`;
    meta.lastUpdated = new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ssZ'));
    // set the source from the incoming resource
    meta.source = original_source;
    // These properties are set automatically
    patched_resource_incoming.meta.versionId = meta.versionId;
    patched_resource_incoming.meta.lastUpdated = meta.lastUpdated;
    // If not source is provided then use the source of the previous entity
    if (!(patched_resource_incoming.meta.source)) {
        patched_resource_incoming.meta.source = meta.source;
    }
    // If no security tags are provided then use the source of the previous entity
    if (!(patched_resource_incoming.meta.security)) {
        patched_resource_incoming.meta.security = meta.security;
    }
    logDebug(user, '------ patched document --------');
    logDebug(user, JSON.stringify(patched_resource_incoming));
    logDebug(user, '------ end patched document --------');
    // Same as update from this point on
    // const cleaned = JSON.parse(JSON.stringify(patched_resource_incoming));
    // check_fhir_mismatch(cleaned, patched_incoming_data);
    // const cleaned = patched_resource_incoming;

    /**
     * @type {Object}
     */
    const cleaned = patched_resource_incoming.toJSON();
    /**
     * @type {Object}
     */
    const doc = Object.assign(cleaned, {_id: id});
    if (env.LOG_ALL_MERGES) {
        await sendToS3('logs',
            resourceToMerge.resourceType,
            {
                'old': data,
                'new': resourceToMerge,
                'patch': patchContent,
                'after': doc
            },
            currentDate,
            id,
            'merge_' + meta.versionId + '_' + requestId);
    }
    await performMergeDbUpdateAsync(resourceToMerge, doc, cleaned, baseVersion, databaseBulkInserter);
}

module.exports = {
    mergeExistingAsync
};
