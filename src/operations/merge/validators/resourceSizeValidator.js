const { assertTypeEquals } = require('../../../utils/assertType');
const { BaseValidator } = require('./baseValidator');
const { MergeResultEntry } = require('../../common/mergeResultEntry');
const { ResourceValidator } = require('../../common/resourceValidator');

/**
 * Rejects resources whose payload exceeds the configured size limit (currently only
 * AuditEvent, see ResourceValidator.validateResourceSizeSync). This runs before
 * MergeResourceValidator so the size is measured on the raw client payload, before
 * _uuid / _sourceAssigningAuthority and reference enrichment inflate it. This keeps
 * $merge in parity with create, which also bounds the raw incoming resource.
 */
class ResourceSizeValidator extends BaseValidator {
    /**
     * @param {ResourceValidator} resourceValidator
     */
    constructor ({ resourceValidator }) {
        super();

        /**
         * @type {ResourceValidator}
         */
        this.resourceValidator = resourceValidator;
        assertTypeEquals(resourceValidator, ResourceValidator);
    }

    /**
     * @param {FhirRequestInfo} requestInfo
     * @param {Resource|Resource[]} incomingResources
     * @param {string} base_version
     * @param {boolean} effectiveSmartMerge
     * @returns {Promise<{preCheckErrors: MergeResultEntry[], validatedObjects: Resource[], wasAList: boolean}>}
     */
    async validate ({ requestInfo, incomingResources, base_version, effectiveSmartMerge }) {
        const wasAList = Array.isArray(incomingResources);
        /**
         * @type {Resource[]}
         */
        const resources = wasAList ? incomingResources : [incomingResources];

        /**
         * @type {MergeResultEntry[]}
         */
        const preCheckErrors = [];
        /**
         * @type {Resource[]}
         */
        const validatedObjects = [];

        for (const resource of resources) {
            const sizeOperationOutcome = this.resourceValidator.validateResourceSizeSync({
                resource,
                resourceType: resource && resource.resourceType
            });
            if (sizeOperationOutcome) {
                preCheckErrors.push(new MergeResultEntry({
                    id: resource && resource.id,
                    uuid: resource && resource._uuid,
                    sourceAssigningAuthority: resource && resource._sourceAssigningAuthority,
                    resourceType: resource && resource.resourceType,
                    created: false,
                    updated: false,
                    issue: (sizeOperationOutcome.issue && sizeOperationOutcome.issue.length > 0)
                        ? sizeOperationOutcome.issue[0]
                        : null,
                    operationOutcome: sizeOperationOutcome
                }));
            } else {
                validatedObjects.push(resource);
            }
        }

        // Preserve single-vs-list shape for survivors: a single resource that passes flows on
        // as a single object (single response). A single oversized resource leaves nothing, so
        // return an empty array (list response with the pre-check error) rather than null, which
        // MergeResourceValidator would dereference and crash on.
        return {
            validatedObjects: wasAList ? validatedObjects : (validatedObjects[0] ?? []),
            preCheckErrors,
            wasAList
        };
    }
}

module.exports = {
    ResourceSizeValidator
};
