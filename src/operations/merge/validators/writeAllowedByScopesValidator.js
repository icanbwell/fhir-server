const { BaseValidator } = require('./baseValidator');
const { assertTypeEquals } = require('../../../utils/assertType');
const { MergeResultEntry } = require('../../common/mergeResultEntry');
const OperationOutcome = require('../../../fhir/classes/4_0_0/resources/operationOutcome');
const { ScopesValidator } = require('../../security/scopesValidator');
const { DatabaseBulkLoader } = require('../../../dataLayer/databaseBulkLoader');

class WriteAllowedByScopesValidator extends BaseValidator {
    /**
     * Checks whether write is allowed for given resources based on patient and access scopes
     * @typedef {Object} ConstructorParams
     * @property {ScopesValidator} scopesValidator
     * @property {DatabaseBulkLoader} databaseBulkLoader
     *
     * @param {ConstructorParams}
     */
    constructor ({ scopesValidator, databaseBulkLoader }) {
        super();

        /**
         * @type {ScopesValidator}
         */
        this.scopesValidator = scopesValidator;
        assertTypeEquals(scopesValidator, ScopesValidator);

        /**
         * @type {DatabaseBulkLoader}
         */
        this.databaseBulkLoader = databaseBulkLoader;
        assertTypeEquals(databaseBulkLoader, DatabaseBulkLoader);
    }

    /**
     * @param {FhirRequestInfo} requestInfo
     * @param {Resource|Resource[]} incomingResources
     * @param {string} base_version
     * @param {boolean} effectiveSmartMerge
     * @returns {Promise<{preCheckErrors: MergeResultEntry[], validatedObjects: Resource[], wasAList: boolean}>}
     */
    async validate ({ requestInfo, incomingResources, base_version, effectiveSmartMerge }) {
        /**
         * @type {MergeResultEntry[]}
         */
        const preCheckErrors = [];
        const validIncomingResources = [];
        for (const resource of incomingResources) {
            try {
                const foundResource = this.databaseBulkLoader.getResourceFromExistingList({
                    requestId: requestInfo.requestId,
                    resourceType: resource.resourceType,
                    uuid: resource._uuid
                });

                if (foundResource) {
                    await this.scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes({
                        resource: foundResource, requestInfo, base_version
                    });
                    // SEC-1580 F2: the check above ran against the resource as stored, so the access tags
                    // on the incoming body still need to be validated before they're merged in. A smart
                    // merge only appends to arrays, so a tag missing from the incoming body isn't a
                    // removal - it just wasn't repeated - so removals are ignored in that mode.
                    this.scopesValidator.isAccessTagChangeAllowedByAccessScopes({
                        requestInfo,
                        currentResource: foundResource,
                        updatedResource: resource,
                        ignoreRemovals: effectiveSmartMerge
                    });
                } else {
                    await this.scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes({
                        resource, requestInfo, base_version
                    });
                    // SEC-1580 F3: this is a create, so the "old" access tag set is empty and every
                    // access tag on the incoming resource counts as an addition
                    this.scopesValidator.isAccessTagChangeAllowedByAccessScopes({
                        requestInfo, currentResource: null, updatedResource: resource
                    });
                }
                validIncomingResources.push(resource);
            } catch (error) {
                if (error.statusCode === 403) {
                    const operationOutcome = new OperationOutcome({
                        resourceType: 'OperationOutcome',
                        issue: error.issue
                    });
                    const issue = (operationOutcome.issue && operationOutcome.issue.length > 0) ? operationOutcome.issue[0] : null;

                    preCheckErrors.push(new MergeResultEntry({
                        id: resource.id,
                        resourceType: resource.resourceType,
                        uuid: resource._uuid,
                        created: false,
                        updated: false,
                        sourceAssigningAuthority: resource.meta?.sourceAssigningAuthority,
                        operationOutcome,
                        issue
                    }));
                } else {
                    throw error;
                }
            }
        }
        return { validatedObjects: validIncomingResources, preCheckErrors, wasAList: false };
    }
}

module.exports = {
    WriteAllowedByScopesValidator
};
