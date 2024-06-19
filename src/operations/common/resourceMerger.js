const deepEqual = require('fast-deep-equal');
const moment = require('moment-timezone');
const { compare, applyPatch } = require('fast-json-patch');
const Meta = require('../../fhir/classes/4_0_0/complex_types/meta');
const { FhirRequestInfo } = require('../../utils/fhirRequestInfo');
const { PreSaveManager } = require('../../preSaveHandlers/preSave');
const { assertTypeEquals, assertIsValid } = require('../../utils/assertType');
const { getFirstElementOrNull } = require('../../utils/list.util');
const { isUuid } = require('../../utils/uid.util');
const { mergeObject } = require('../../utils/mergeHelper');
const { IdentifierSystem } = require('../../utils/identifierSystem');
const { SecurityTagSystem } = require('../../utils/securityTagSystem');
const { DateColumnHandler } = require("../../preSaveHandlers/handlers/dateColumnHandler");
const { DELETE, RETRIEVE } = require('../../constants').GRIDFS;
const { logInfo } = require('../../operations/common/logging');

/**
 * @typedef {object} MergePatchEntry
 * @property {string} op
 * @property {string} path
 * @property {*|*[]} value
 */

/**
 * @typedef {Object} MergeResourceAsyncProp
 * @property {import('../../fhir/classes/4_0_0/resources/resource')} currentResource
 * @property {import('../../fhir/classes/4_0_0/resources/resource')} resourceToMerge
 * @property {boolean|undefined} smartMerge
 * @property {boolean|undefined} incrementVersion
 * @property {string[]|undefined} limitToPaths
 * @property {import('../../dataLayer/databaseAttachmentManager').DatabaseAttachmentManager|null} databaseAttachmentManager
 * @property {string} base_version
 * @property {import('../../fhir/classes/4_0_0/requestInfo').FhirRequestInfo} requestInfo
 */

/**
 * @typedef {Object} UpdateSecurityTagProps
 * @property {import('../../fhir/classes/4_0_0/resources/resource')} currentResource
 * @property {import('../../fhir/classes/4_0_0/resources/resource')} resourceToMerge
 * @property {string} system
 */

/**
 * @typedef {Object} OverWriteNonWritableFieldsProp
 * @property {import('../../fhir/classes/4_0_0/resources/resource')} currentResource
 * @property {import('../../fhir/classes/4_0_0/resources/resource')} resourceToMerge
 */

/**
 * @typedef {Object} CompareObjectsProp
 * @property {Object} currentObject
 * @property {Object} mergedObject
 * @property {string[]|undefined} limitToPaths
 */

/**
 * @typedef {Object} UpdateMetaProp
 * @property {import('../../fhir/classes/4_0_0/resources/resource')} patched_resource_incoming
 * @property {import('../../fhir/classes/4_0_0/resources/resource')} currentResource
 * @property {string} original_source
 * @property {boolean} incrementVersion
 */

/**
 * @typedef {Object} ApplyPatchProp
 * @property {import('../../fhir/classes/4_0_0/resources/resource')} currentResource
 * @property {import('fast-json-patch').Operation[]} patchContent
 */

/**
 * @description This class merges two resources
 */
class ResourceMerger {
    /**
     * constructor
     * @typedef {Object} Params
     * @property {PreSaveManager} preSaveManager
     *
     * @param {Params}
     */
    constructor ({ preSaveManager }) {
        /**
         * @type {PreSaveManager}
         */
        this.preSaveManager = preSaveManager;
        assertTypeEquals(preSaveManager, PreSaveManager);
    }

    /**
     * Updates security tag with provided system to system present in current resource
     * @param {UpdateSecurityTagProps}
     * @returns {import('../../fhir/classes/4_0_0/resources/resource')}
     */
    updateSecurityTag ({ system, resourceToMerge, currentResource }) {
        const currentValue = currentResource.meta.security.find(
            s => s.system === system
        );
        if (!currentValue) {
            return;
        }
        if (system === SecurityTagSystem.sourceAssigningAuthority) {
            resourceToMerge._sourceAssigningAuthority = currentValue.code;
        }
        if (!resourceToMerge.meta.security) {
            resourceToMerge.meta.security = [currentValue];
        } else if (!resourceToMerge.meta.security.some(s => s.system === system)) {
            resourceToMerge.meta.security.push(currentValue);
        } else {
            let currentValueInserted = false;
            resourceToMerge.meta.security = resourceToMerge.meta.security.reduce((security, s) => {
                if (s.system === system) {
                    // Added check to make sure duplicate security elements are not inserted in resource.
                    if (!currentValueInserted) {
                        security.push(currentValue);
                        currentValueInserted = true;
                    }
                } else {
                    security.push(s);
                }
                return security;
            }, []);
        }
    }

    /**
     * Overwrites resourceToMerge with currentResources fields which should not be updated
     * @param {OverWriteNonWritableFieldsProp}
     * @returns {import('../../fhir/classes/4_0_0/resources/resource')}
     */
    overWriteNonWritableFields ({ currentResource, resourceToMerge }) {
        // create metadata structure if not present
        if (!resourceToMerge.meta) {
            resourceToMerge.meta = {};
        }
        resourceToMerge.id = currentResource.id;
        resourceToMerge.meta.versionId = currentResource.meta.versionId;
        resourceToMerge.meta.lastUpdated = currentResource.meta.lastUpdated;
        resourceToMerge.meta.source = currentResource.meta.source;

        // Override sourceAssigningAuthority and owner in meta security
        this.updateSecurityTag({
            system: SecurityTagSystem.sourceAssigningAuthority,
            currentResource,
            resourceToMerge
        });
        this.updateSecurityTag({
            system: SecurityTagSystem.owner,
            currentResource,
            resourceToMerge
        });

        // copy the identifiers over
        // if an identifier with system=https://www.icanbwell.com/sourceId exists then use that
        if (currentResource.identifier &&
            Array.isArray(currentResource.identifier) &&
            currentResource.identifier.some(s => s.system === IdentifierSystem.sourceId)
        ) {
            if (resourceToMerge.id === resourceToMerge._uuid) {
                if (resourceToMerge.identifier) {
                    /** @type {Identifier} */
                    const currentResourceSourceIdIdentifier = getFirstElementOrNull(
                        currentResource.identifier.filter(s => s.system === IdentifierSystem.sourceId)
                    );
                    /** @type {Identifier} */
                    const resourceToMergeSourceIdIdentifier = getFirstElementOrNull(
                        resourceToMerge.identifier.filter(s => s.system === IdentifierSystem.sourceId)
                    );
                    if (currentResourceSourceIdIdentifier &&
                        resourceToMergeSourceIdIdentifier &&
                        currentResourceSourceIdIdentifier.value !== resourceToMergeSourceIdIdentifier.value
                    ) {
                        const indexInResourceToMerge = resourceToMerge.identifier.findIndex(
                            s => s.system === IdentifierSystem.sourceId
                        );
                        resourceToMerge.identifier[indexInResourceToMerge].value = currentResourceSourceIdIdentifier.value;
                    }
                }
                resourceToMerge.id = currentResource.id;
            }
            if (!resourceToMerge.identifier || !resourceToMerge.identifier.some(s => s.system === IdentifierSystem.sourceId)) {
                if (resourceToMerge.identifier) {
                    resourceToMerge.identifier.push(
                        getFirstElementOrNull(currentResource.identifier.filter(s => s.system === IdentifierSystem.sourceId))
                    );
                } else {
                    resourceToMerge.identifier = [
                        getFirstElementOrNull(currentResource.identifier.filter(s => s.system === IdentifierSystem.sourceId))
                    ];
                }
            }
        }

        if (currentResource.identifier &&
            Array.isArray(currentResource.identifier) &&
            currentResource.identifier.some(s => s.system === IdentifierSystem.uuid) &&
            (!resourceToMerge.identifier ||
                !resourceToMerge.identifier.some(s => s.system === IdentifierSystem.uuid))
        ) {
            if (resourceToMerge.identifier) {
                resourceToMerge.identifier.push(
                    getFirstElementOrNull(
                        currentResource.identifier.filter(s => s.system === IdentifierSystem.uuid)
                    )
                );
            } else {
                resourceToMerge.identifier = [
                    getFirstElementOrNull(
                        currentResource.identifier.filter(s => s.system === IdentifierSystem.uuid)
                    )
                ];
            }
        }

        return resourceToMerge;
    }

    /**
     * Compares objects provided and returns patch to convert first object to second
     * @param {CompareObjectsProp}
     * @returns {import('fast-json-patch').Operation[]}
     */
    compareObjects ({ currentObject, mergedObject, limitToPaths }) {
        /**
         * @type {import('fast-json-patch').Operation[]}
         */
        let patchContent = compare(currentObject, mergedObject);
        // ignore any changes to _id since that's an internal field
        patchContent = patchContent.filter(item => item.path !== '/_id');
        // or any changes to id
        patchContent = patchContent.filter(item => item.path !== '/id');
        // or any changes to uuid
        patchContent = patchContent.filter(
            item => !(
                item.path.startsWith('/identifier') &&
                item.value && (
                    (typeof item.value === 'string' && isUuid(item.value)) ||
                    (typeof item.value === 'object' && item.value.system === IdentifierSystem.uuid)
                )
            )
        );
        // or any changes to sourceId
        patchContent = patchContent.filter(
            item => !(
                item.path.startsWith('/identifier') && item.value &&
                item.value.system === IdentifierSystem.sourceId
            )
        );
        if (limitToPaths && limitToPaths.length > 0) {
            patchContent = patchContent.filter(
                item => limitToPaths.some(path => item.path.startsWith(path))
            );
        }

        return patchContent;
    }

    /**
     * Updated meta of the resource with meta of current resource
     * @param {UpdateMetaProp}
     * @returns {import('../../fhir/classes/4_0_0/resources/resource')}
     */
    updateMeta ({ patched_resource_incoming, currentResource, original_source, incrementVersion }) {
        // update the metadata to increment versionId
        /**
         * @type {Meta}
         */
        const meta = new Meta(currentResource.meta);
        meta.versionId = incrementVersion
            ? `${parseInt(currentResource.meta.versionId) + 1}`
            : currentResource.meta.versionId;
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

    /**
     * Applies patch to the resource provided
     * @param {ApplyPatchProp}
     * @returns {import('../../fhir/classes/4_0_0/resources/resource')}
     */
    applyPatch ({ currentResource, patchContent }) {
        /**
         * @type {import('fast-json-patch').PatchResult<import('../../fhir/classes/4_0_0/resources/resource')>}
         */
        const patchResult = applyPatch(currentResource.toJSONInternal(), patchContent);
        /**
         * @type {import('../../fhir/classes/4_0_0/resources/resource')}
         */
        const patched_incoming_data = patchResult.newDocument;

        // Create a new resource to store the merged data
        return currentResource.create(patched_incoming_data);
    }

    /**
     * Merges two resources and returns either a merged resource or null (if there were no changes)
     * Note: Make sure to run preSave on the updatedResource before inserting/updating the resource into database
     * @param {string} base_version
     * @param {FhirRequestInfo} requestInfo
     * @param {Resource} currentResource
     * @param {Resource} resourceToMerge
     * @param {boolean|undefined} [smartMerge]
     * @param {boolean|undefined} [incrementVersion]
     * @param {string[]|undefined} [limitToPaths]
     * @param {DatabaseAttachmentManager|null} databaseAttachmentManager
     * @returns {Promise<{updatedResource:Resource|null, patches: MergePatchEntry[]|null }>} resource and patches
     */
    async mergeResourceAsync (
        {
            base_version,
            requestInfo,
            currentResource,
            resourceToMerge,
            smartMerge = true,
            incrementVersion = true,
            limitToPaths,
            databaseAttachmentManager = null
        }
    ) {
        assertTypeEquals(requestInfo, FhirRequestInfo);

        logInfo('6.', {
            currentResource: currentResource,
            resourceToMerge: resourceToMerge
        });
        // confirm the resource has been run through preSave
        if (!resourceToMerge._uuid) {
            resourceToMerge = await this.preSaveManager.preSaveAsync({ resource: resourceToMerge });
            logInfo('9.', {
                resourceToMerge: resourceToMerge
            });
        }
        assertIsValid(resourceToMerge._uuid, 'resource._uuid is required.  Be sure to run preSave on the resource before calling this method.');
        /**
         * @type {string}
         */
        const original_source = resourceToMerge?.meta?.source;

        // overwrite fields that should not be changed once resource is created
        resourceToMerge = this.overWriteNonWritableFields({ currentResource, resourceToMerge });

        resourceToMerge = await this.preSaveManager.preSaveAsync({ resource: resourceToMerge });

        // for speed, first check if the incoming resource is exactly the same
        if (deepEqual(currentResource.toJSON(), resourceToMerge.toJSON()) === true) {
            return { updatedResource: null, patches: null };
        }

        let currentResourceWithAttachmentData = currentResource.clone();
        if (databaseAttachmentManager) {
            await databaseAttachmentManager.transformAttachments(
                currentResourceWithAttachmentData, RETRIEVE
            );
        }

        /**
         * @type {Object}
         */
        let mergedObject;
        mergedObject = smartMerge
            ? mergeObject(currentResourceWithAttachmentData.toJSON(), resourceToMerge.toJSON())
            : resourceToMerge.toJSON();

        // now create a patch between the document in db and the incoming document
        // this returns an array of patchecurrentResources
        /**
         * @type {DateColumnHandler}
         */
        const dateColumnHandler = new DateColumnHandler();
        dateColumnHandler.setFlag(true);
        currentResourceWithAttachmentData = await dateColumnHandler.preSaveAsync({ resource: currentResourceWithAttachmentData });
        mergedObject = await dateColumnHandler.preSaveAsync({ resource: mergedObject });
        const patchContent = this.compareObjects({
            currentObject: currentResourceWithAttachmentData.toJSON(),
            mergedObject,
            limitToPaths
        });

        // see if there are any changes
        if (patchContent.length === 0) {
            return { updatedResource: null, patches: null };
        }

        // now apply the patches to the found resource
        if (databaseAttachmentManager) {
            await databaseAttachmentManager.transformAttachments(
                currentResource, DELETE, patchContent.filter(patch => patch.op !== 'add')
            );
            await databaseAttachmentManager.transformAttachments(
                currentResource, RETRIEVE, patchContent
            );
        }

        /**
         * @type {import('../../fhir/classes/4_0_0/resources/resource')}
         */
        let patched_resource_incoming = this.applyPatch({ currentResource, patchContent });

        patched_resource_incoming = this.updateMeta({
            patched_resource_incoming,
            currentResource,
            original_source,
            incrementVersion
        });

        return {
            updatedResource: patched_resource_incoming,
            patches: patchContent.map(p => {
                return {
                    op: p.op, path: p.path, value: p.value
                };
            })
        };
    }
}

module.exports = {
    ResourceMerger
};
