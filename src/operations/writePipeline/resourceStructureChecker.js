const { assertTypeEquals } = require('../../utils/assertType');
const { MergeManager } = require('../merge/mergeManager');
const { ScopesManager } = require('../security/scopesManager');
const { COLLECTION } = require('../../constants');
const { isUuid } = require('../../utils/uid.util');
const { WriteFailure, WRITE_FAILURE_STAGE } = require('./writeFailure');

/**
 * Runs the structural checks `$merge` and `$import` apply to each incoming resource before any
 * write step: an id, a resourceType, a supported resourceType, and either a UUID id or an owner or
 * source assigning authority tag. They are the checks `MergeManager.preMergeChecksAsync` runs
 * first, with the same error entries.
 */
class ResourceStructureChecker {
    /**
     * @param {MergeManager} mergeManager
     * @param {ScopesManager} scopesManager
     */
    constructor ({ mergeManager, scopesManager }) {
        /**
         * @type {MergeManager}
         */
        this.mergeManager = mergeManager;
        assertTypeEquals(mergeManager, MergeManager);
        /**
         * @type {ScopesManager}
         */
        this.scopesManager = scopesManager;
        assertTypeEquals(scopesManager, ScopesManager);
    }

    /**
     * Fails, at the `STRUCTURE` stage, each item whose body has a structural error, with that
     * error's OperationOutcome and the body's identity as the subject, so no write step runs for
     * it.
     * @param {import('./writeItem').WriteItem[]} items
     * @returns {void}
     */
    failItemsWithStructuralError ({ items }) {
        for (const item of items) {
            const structuralError = this.findStructuralError(item.incoming);
            if (structuralError) {
                item.fail({
                    failure: new WriteFailure({
                        stage: WRITE_FAILURE_STAGE.STRUCTURE,
                        subject: {
                            id: structuralError.id,
                            uuid: structuralError._uuid,
                            sourceAssigningAuthority: structuralError._sourceAssigningAuthority,
                            resourceType: structuralError.resourceType
                        },
                        operationOutcome: structuralError.operationOutcome
                    })
                });
            }
        }
    }

    /**
     * Returns a merge error entry if the resource has no id, no resourceType, an unsupported
     * resourceType, or neither a UUID id nor an owner or source assigning authority tag; otherwise
     * null.
     * @param {Object} resource
     * @returns {import('../common/mergeResultEntry').MergeResultEntry|null}
     */
    findStructuralError (resource) {
        const resourceType = resource.resourceType;
        const id = resource.id;

        if (!id) {
            return this.mergeManager.createMergeError(resource, resourceType, 'resource is missing id', resourceType);
        }

        if (!resource.resourceType) {
            return this.mergeManager.createMergeError(
                resource, resourceType, 'resource is missing resourceType', `${resourceType}/${id}`
            );
        }

        if (COLLECTION[resource.resourceType.toUpperCase()] !== resource.resourceType) {
            return this.mergeManager.createMergeError(
                resource, resourceType, 'resourceType is not supported', `${resourceType}/${id}`
            );
        }

        if (
            !isUuid(resource.id) &&
            !this.scopesManager.doesResourceHaveSourceAssigningAuthority(resource) &&
            !this.scopesManager.doesResourceHaveOwnerTags(resource)
        ) {
            return this.mergeManager.createMergeError(
                resource,
                resourceType,
                'Either id passed in resource should be uuid or meta.security tag with system: https://www.icanbwell.com/owner or https://www.icanbwell.com/sourceAssigningAuthority should be present',
                `${resourceType}/${id}`
            );
        }

        return null;
    }
}

module.exports = {
    ResourceStructureChecker
};
