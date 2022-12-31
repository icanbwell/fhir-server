const deepEqual = require('fast-deep-equal');
const {mergeObject} = require('../../utils/mergeHelper');
const {compare, applyPatch} = require('fast-json-patch');
const moment = require('moment-timezone');
const {assertTypeEquals} = require('../../utils/assertType');
const {PreSaveManager} = require('../../preSaveHandlers/preSave');
const {IdentifierSystem} = require('../../utils/identifierSystem');
const {getFirstElementOrNull} = require('../../utils/list.util');


/**
 * @typedef MergePatchEntry
 * @type {object}
 * @property {string} op
 * @property {string} path
 * @property {*|*[]} value
 */

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
     * @param {boolean|undefined} [smartMerge]
     * @param {boolean|undefined} [incrementVersion]
     * @returns {{updatedResource:Resource|null, patches: MergePatchEntry[]|null }} resource and patches
     */
    async mergeResourceAsync({currentResource, resourceToMerge, smartMerge = true, incrementVersion = true}) {
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

        // copy the identifiers over
        // if an identifier with system=https://www.icanbwell.com/sourceId exists then use that
        if (currentResource.identifier &&
            Array.isArray(currentResource.identifier) &&
            currentResource.identifier.some(s => s.system === IdentifierSystem.sourceId) &&
            (!resourceToMerge.identifier || !resourceToMerge.identifier.some(s => s.system === IdentifierSystem.sourceId))
        ) {
            if (!resourceToMerge.identifier) {
                resourceToMerge.identifier = [
                    getFirstElementOrNull(
                        currentResource.identifier.filter(s => s.system === IdentifierSystem.sourceId))
                ];
            } else {
                resourceToMerge.identifier.push(
                    getFirstElementOrNull(
                        currentResource.identifier.filter(s => s.system === IdentifierSystem.sourceId))
                );
            }
        }

        if (currentResource.identifier &&
            Array.isArray(currentResource.identifier) &&
            currentResource.identifier.some(s => s.system === IdentifierSystem.uuid) &&
            (!resourceToMerge.identifier || !resourceToMerge.identifier.some(s => s.system === IdentifierSystem.uuid))
        ) {
            if (!resourceToMerge.identifier) {
                resourceToMerge.identifier = [
                    getFirstElementOrNull(
                        currentResource.identifier.filter(s => s.system === IdentifierSystem.uuid))
                ];
            } else {
                resourceToMerge.identifier.push(
                    getFirstElementOrNull(
                        currentResource.identifier.filter(s => s.system === IdentifierSystem.uuid))
                );
            }
        }

        // fix up any data that we normally fix up before saving so the comparison is correct
        await this.preSaveManager.preSaveAsync(resourceToMerge);

        // for speed, first check if the incoming resource is exactly the same
        if (deepEqual(currentResource.toJSON(), resourceToMerge.toJSON()) === true) {
            return {updatedResource: null, patches: null};
        }

        /**
         * @type {Object}
         */
        let mergedObject = smartMerge ?
            mergeObject(currentResource.toJSON(), resourceToMerge.toJSON()) :
            resourceToMerge.toJSON();

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
            return {updatedResource: null, patches: null};
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
        meta.versionId = incrementVersion ?
            `${parseInt(currentResource.meta.versionId) + 1}` :
            currentResource.meta.versionId;
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

        return {
            updatedResource: patched_resource_incoming,
            patches: patchContent.map(
                p => {
                    return {
                        op: p.op,
                        path: p.path,
                        value: p.value
                    };
                }
            )
        };
    }
}

module.exports = {
    ResourceMerger
};
