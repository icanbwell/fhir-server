const deepEqual = require('fast-deep-equal');
const moment = require('moment-timezone');
const { compare, applyPatch } = require('fast-json-patch');
const { FhirRequestInfo } = require('../../utils/fhirRequestInfo');
const { PreSaveManager } = require('../../preSaveHandlers/preSave');
const { PreSaveOptions } = require('../../preSaveHandlers/preSaveOptions');
const { assertTypeEquals, assertIsValid } = require('../../utils/assertType');
const { getFirstElementOrNull } = require('../../utils/list.util');
const { mergeObject } = require('../../utils/mergeHelper');
const { IdentifierSystem } = require('../../utils/identifierSystem');
const { SecurityTagSystem } = require('../../utils/securityTagSystem');
const { DateColumnHandler } = require("../../preSaveHandlers/handlers/dateColumnHandler");
const { GroupMemberMerger } = require('./groupMemberMerger');
const deepcopy = require('deepcopy');
const { logInfo } = require('./logging');
const { FhirResourceWriteNormalizeSerializer } = require('../../fhir/fhirResourceWriteNormalizeSerializer');
const { DELETE, RETRIEVE } = require('../../constants').GRIDFS;

/**
 * @typedef {object} MergePatchEntry
 * @property {string} op
 * @property {string} path
 * @property {*|*[]} value
 */

/**
 * @typedef {Object} UpdateSecurityTagProps
 * @property {Object} currentResource
 * @property {Object} resourceToMerge
 * @property {string} system
 */

/**
 * @typedef {Object} OverWriteNonWritableFieldsProp
 * @property {Object} currentResource
 * @property {Object} resourceToMerge
 */

/**
 * @typedef {Object} CompareObjectsProp
 * @property {Object} currentObject
 * @property {Object} mergedObject
 * @property {string[]|undefined} limitToPaths
 */

/**
 * @typedef {Object} UpdateMetaProp
 * @property {Object} patched_resource_incoming
 * @property {Object} currentResource
 * @property {string} original_source
 * @property {boolean} incrementVersion
 */

/**
 * @typedef {Object} ApplyPatchProp
 * @property {Object} currentResource
 * @property {import('fast-json-patch').Operation[]} patchContent
 */

/**
 * @typedef {Object} RemoveOwnerTagIfDisplayFieldMissingProp
 * @property {Object} currentResource
 * @property {Object} resourceToMerge
 */

/**
 * @description This class merges two resources
 */
class ResourceMerger {
    /**
     * constructor
     * @typedef {Object} Params
     * @property {PreSaveManager} preSaveManager
     * @property {import('../../utils/configManager').ConfigManager|null} [configManager]
     * @property {GroupMemberMerger} groupMemberMerger
     *
     * @param {Params}
     */
    constructor ({ preSaveManager, configManager = null, groupMemberMerger }) {
        /**
         * @type {PreSaveManager}
         */
        this.preSaveManager = preSaveManager;
        assertTypeEquals(preSaveManager, PreSaveManager);
        /**
         * @type {import('../../utils/configManager').ConfigManager|null}
         */
        this.configManager = configManager;
        /**
         * @type {GroupMemberMerger}
         */
        this.groupMemberMerger = groupMemberMerger;
        assertTypeEquals(groupMemberMerger, GroupMemberMerger);
    }

    /**
     * Updates security tag with provided system to system present in current resource
     * @param {UpdateSecurityTagProps}
     * @returns {Object | undefined}
     */
    updateSecurityTag ({ system, resourceToMerge, currentResource }) {
        let currentValue = currentResource.meta.security.find(
            s => s.system === system
        );
        if (!currentValue) {
            return;
        }

        // For owner security tag, merge display field only if not already present in current resource
        if (system === SecurityTagSystem.owner && !currentValue.display) {
            const incomingValue = resourceToMerge.meta?.security?.find(s => s.system === system);
            if (incomingValue?.display) {
                currentValue = { ...currentValue, display: incomingValue.display };
            }
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
     * @returns {Object}
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
        if (currentResource.resourceType === 'Group') {
            resourceToMerge._extended = currentResource._extended;
        }

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

        // deduplicate meta.security by system+code
        if (resourceToMerge.meta && resourceToMerge.meta.security && Array.isArray(resourceToMerge.meta.security)) {
            const seen = new Set();
            resourceToMerge.meta.security = resourceToMerge.meta.security.filter(tag => {
                const key = `${tag.system}|${tag.code}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
        }

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
    compareObjects ({ currentObject, mergedObject, limitToPaths, ignoreDateOnlyChange = false }) {
        /**
         * @type {import('fast-json-patch').Operation[]}
         */
        let patchContent = compare(currentObject, mergedObject);
        // ignore any changes to _id, id, identifier (uuid or sourceId)
        patchContent = patchContent.filter(
            (item) =>
                item.path !== '/_id' &&
                item.path !== '/id' &&
                !(
                    item.path.startsWith('/identifier') &&
                    item.value &&
                    ((typeof item.value === 'object' && item.value.system === IdentifierSystem.uuid) ||
                        item.value.system === IdentifierSystem.sourceId)
                )
        );

        if (limitToPaths && limitToPaths.length > 0) {
            patchContent = patchContent.filter(
                item => limitToPaths.some(path => item.path.startsWith(path))
            );
        }

        // A change to `date` alone is not a change worth a new version: writers that stamp it with
        // "now" on every run would otherwise create a version, history row and event each time.
        // When anything else changed, the `date` patch is kept so the new date is stored with it.
        // Only merge asks for this; other callers (PATCH) must always see an explicit date change.
        if (
            ignoreDateOnlyChange &&
            patchContent.length > 0 &&
            this.ignoresDateOnlyChange(currentObject.resourceType) &&
            patchContent.every(item => item.path === '/date')
        ) {
            logInfo('Ignoring merge: only the top-level date changed', {
                args: {
                    resourceType: currentObject.resourceType,
                    uuid: currentObject._uuid
                }
            });
            return [];
        }

        return patchContent;
    }

    /**
     * Whether a change to only the top-level `date` is ignored for this resource type
     * @param {string|undefined} resourceType
     * @returns {boolean}
     */
    ignoresDateOnlyChange (resourceType) {
        return (
            !!resourceType &&
            !!this.configManager &&
            this.configManager.mergeIgnoreDateOnlyChangeResourceTypes.includes(resourceType)
        );
    }

    /**
     * Updated meta of the resource with meta of current resource
     * @param {UpdateMetaProp}
     * @returns {Object}
     */
    fastUpdateMeta ({ patched_resource_incoming, currentResource, original_source, incrementVersion }) {
        const currentMeta = currentResource.meta;
        // The incoming resource may not carry meta; create it so the assignments below are safe
        if (!patched_resource_incoming.meta) {
            patched_resource_incoming.meta = {};
        }
        const currentVersion = parseInt(currentMeta?.versionId, 10);
        patched_resource_incoming.meta.versionId = incrementVersion
            ? `${(Number.isNaN(currentVersion) ? 0 : currentVersion) + 1}`
            : currentMeta?.versionId;
        patched_resource_incoming.meta.lastUpdated = new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ss.SSSZ'));
        // If no source is provided then use the source from the incoming resource
        if (!(patched_resource_incoming.meta.source)) {
            patched_resource_incoming.meta.source = original_source;
        }
        // If no security tags are provided then use those of the previous entity
        if (!(patched_resource_incoming.meta.security)) {
            patched_resource_incoming.meta.security = deepcopy(currentMeta.security);
        }

        return patched_resource_incoming;
    }

    /**
     * Applies patch to the resource provided
     * @param {ApplyPatchProp}
     * @returns {Object}
     */
    fastApplyPatch ({ currentResource, patchContent }) {
        /**
         * @type {import('fast-json-patch').PatchResult<Object>}
         */
        const patchResult = applyPatch(currentResource, patchContent);
        return patchResult.newDocument;
    }

    /**
     * Removes owner tag if display field exists in resourceToMerge but missing in currentResource
     * @param {RemoveOwnerTagIfDisplayFieldMissingProp}
     * @return {Object}
     */
    removeOwnerTagIfDisplayFieldMissing({currentResource, resourceToMerge}) {
        // if resourceToMerge has display field in the owner security tag, but the current resource
        // does not have the display field, then remove the owner tag from currentResourceWithAttachment
        const isDisplayFieldExistsInResourceToMerge = resourceToMerge.meta?.security?.some(s => {
            return s.system === SecurityTagSystem.owner && s.display;
        });
        const isDisplayFieldExistsInCurrentResource = currentResource.meta?.security?.some(s => {
            return s.system === SecurityTagSystem.owner && s.display;
        });
        if (isDisplayFieldExistsInResourceToMerge && (!isDisplayFieldExistsInCurrentResource)) {
            currentResource.meta.security = currentResource.meta.security.filter(
                s => s.system !== SecurityTagSystem.owner
            );
        }

        return currentResource;
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
     * @param {import('../../dataLayer/base64DataManager').Base64DataManager|null} [base64DataManager]
     * @param {boolean|undefined} [ignoreDateOnlyChange] treat a change to only the top-level date as no change (merge only)
     * @returns {Promise<{updatedResource:Resource|null, patches: MergePatchEntry[]|null }>} resource and patches
     */
    async fastMergeResourceAsync (
        {
            base_version,
            requestInfo,
            currentResource,
            resourceToMerge,
            smartMerge = true,
            incrementVersion = true,
            limitToPaths,
            databaseAttachmentManager = null,
            base64DataManager = null,
            ignoreDateOnlyChange = false
        }
    ) {
        assertTypeEquals(requestInfo, FhirRequestInfo);
        const preSaveOptions = PreSaveOptions.fromRequestInfo(requestInfo);
        // confirm the resource has been run through preSave
        if (!resourceToMerge._uuid) {
            resourceToMerge = await this.preSaveManager.preSaveAsync({ resource: resourceToMerge, options: preSaveOptions });
        }
        assertIsValid(resourceToMerge._uuid, 'resource._uuid is required.  Be sure to run preSave on the resource before calling this method.');
        /**
         * @type {string}
         */
        const original_source = resourceToMerge?.meta?.source;

        // overwrite fields that should not be changed once resource is created
        resourceToMerge = this.overWriteNonWritableFields({ currentResource, resourceToMerge });

        resourceToMerge = await this.preSaveManager.preSaveAsync({ resource: resourceToMerge, options: preSaveOptions });

        // for speed, first check if the incoming resource is exactly the same. Skipped when a
        // configured base64 leaf is externalized on currentResource — the naive comparison can't
        // correctly see a data-only hash-based change or an omission-as-removal; the full diff +
        // explicit reconciliation below handles both directly regardless.
        const hasExternalizedLeaf = !!base64DataManager && base64DataManager.hasExternalizedLeaf(currentResource);
        if (!hasExternalizedLeaf && deepEqual(currentResource, resourceToMerge) === true) {
            return { updatedResource: null, patches: null };
        }

        let currentResourceWithAttachmentData = deepcopy(currentResource);
        if (databaseAttachmentManager) {
            await databaseAttachmentManager.transformAttachments(
                currentResourceWithAttachmentData, RETRIEVE
            );
        }

        /**
         * @type {Object}
         */
        let mergedObject;
        if (smartMerge) {
            const currentResourceWithAttachmentDataObject = this.removeOwnerTagIfDisplayFieldMissing({
                currentResource: deepcopy(currentResourceWithAttachmentData),
                resourceToMerge
            });
            mergedObject = mergeObject(currentResourceWithAttachmentDataObject, resourceToMerge);
        }
        else {
            mergedObject = deepcopy(resourceToMerge);
        }
        // mergeObject appends a member that differs from every stored entry, and two $merge
        // entries for one Group are combined the same way, so a member can have a second entry
        // here; merge such entries before the diff, so a merge that ends up equal to the stored
        // Group is still no change.
        mergedObject = this.groupMemberMerger.mergeMembers({ resource: mergedObject, requestInfo });

        // now create a patch between the document in db and the incoming document
        // this returns an array of patchecurrentResources
        /**
         * @type {DateColumnHandler}
         */
        const dateColumnHandler = new DateColumnHandler();
        dateColumnHandler.setFlag(true);
        currentResourceWithAttachmentData = await dateColumnHandler.preSaveAsync({ resource: currentResourceWithAttachmentData });
        mergedObject = await dateColumnHandler.preSaveAsync({ resource: mergedObject });

        // serialize to remove internal fields
        FhirResourceWriteNormalizeSerializer.serialize({obj: currentResourceWithAttachmentData});
        FhirResourceWriteNormalizeSerializer.serialize({obj: mergedObject});

        if (base64DataManager) {
            base64DataManager.excludeExternalizedLeaves(currentResourceWithAttachmentData, currentResource);
            base64DataManager.excludeExternalizedLeaves(mergedObject, currentResource);
        }

        const patchContent = this.compareObjects({
            currentObject: currentResourceWithAttachmentData,
            mergedObject,
            limitToPaths,
            ignoreDateOnlyChange
        });

        // now apply the patches to the found resource
        if (databaseAttachmentManager) {
            await databaseAttachmentManager.transformAttachments(
                currentResource, DELETE, patchContent.filter(patch => patch.op !== 'add')
            );
            await databaseAttachmentManager.transformAttachments(
                currentResource, RETRIEVE, patchContent
            );
        }

        let patched_resource_incoming = this.fastApplyPatch({
            currentResource: deepcopy(currentResource), patchContent: deepcopy(patchContent)
        });

        let base64Patches = [];
        if (base64DataManager) {
            base64Patches = await base64DataManager.reconcileLeavesAsync(
                patched_resource_incoming, currentResource, resourceToMerge, smartMerge, requestInfo
            );
        }

        // see if there are any changes (generic diff, or the base64 leaf reconciled above)
        if (patchContent.length === 0 && base64Patches.length === 0) {
            return { updatedResource: null, patches: null };
        }

        patched_resource_incoming = this.fastUpdateMeta({
            patched_resource_incoming,
            currentResource,
            original_source,
            incrementVersion
        });

        return {
            updatedResource: patched_resource_incoming,
            patches: [...patchContent, ...base64Patches].map(p => {
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
