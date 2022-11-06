const deepEqual = require('fast-deep-equal');
const {mergeObject} = require('../../utils/mergeHelper');
const {compare, applyPatch} = require('fast-json-patch');
const moment = require('moment-timezone');
const {PreSaveManager} = require('./preSave');
const {assertTypeEquals} = require('../../utils/assertType');

/**
 * @description This class merges two resources
 */
class ResourceMerger {
    /**
     * constructor
     * @param {PreSaveManager} preSaveManager
     */
    constructor({preSaveManager}) {
        /**
         * @type {PreSaveManager}
         */
        this.preSaveManager = preSaveManager;
        assertTypeEquals(preSaveManager, PreSaveManager);
    }

    /**
     * Merges two resources and returns either a merged resource or null (if there were no changes)
     * @param {Resource} currentResource
     * @param {Resource} resourceToMerge
     * @returns {Resource|null}
     */
    async mergeResourceAsync({currentResource, resourceToMerge}) {
        // create metadata structure if not present
        if (!resourceToMerge.meta) {
            resourceToMerge.meta = {};
        }
        // compare without checking source, so we don't create a new version just because of a difference in source
        /**
         * @type {string}
         */
        const original_source = resourceToMerge.meta.source;
        resourceToMerge.meta.versionId = currentResource.meta.versionId;
        resourceToMerge.meta.lastUpdated = currentResource.meta.lastUpdated;
        resourceToMerge.meta.source = currentResource.meta.source;

        // fix up any data that we normally fix up before saving so the comparison is correct
        await this.preSaveManager.preSaveAsync(resourceToMerge);

        // for speed, first check if the incoming resource is exactly the same
        if (deepEqual(currentResource.toJSON(), resourceToMerge.toJSON()) === true) {
            return null;
        }

        /**
         * @type {Object}
         */
        let mergedObject = mergeObject(currentResource.toJSON(), resourceToMerge.toJSON());

        // now create a patch between the document in db and the incoming document
        //  this returns an array of patches
        /**
         * @type {Operation[]}
         */
        let patchContent = compare(currentResource.toJSON(), mergedObject);
        // ignore any changes to _id since that's an internal field
        patchContent = patchContent.filter(item => item.path !== '/_id');
        // see if there are any changes
        if (patchContent.length === 0) {
            return null;
        }
        // now apply the patches to the found resource
        // noinspection JSCheckFunctionSignatures
        /**
         * @type {Object}
         */
        let patched_incoming_data = applyPatch(currentResource.toJSONInternal(), patchContent).newDocument;
        // Create a new resource to store the merged data
        /**
         * @type {Resource}
         */
        let patched_resource_incoming = currentResource.create(patched_incoming_data);
        // update the metadata to increment versionId
        /**
         * @type {Meta}
         */
        let meta = currentResource.meta;
        meta.versionId = `${parseInt(currentResource.meta.versionId) + 1}`;
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

        return patched_resource_incoming;
    }
}

module.exports = {
    ResourceMerger
};
