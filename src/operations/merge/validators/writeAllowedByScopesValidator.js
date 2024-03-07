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
     * @param {date} currentDate
     * @param {string} currentOperationName
     * @param {Resource|Resource[]} incomingResources
     * @param {string} base_version
     * @returns {Promise<{preCheckErrors: MergeResultEntry[], validatedObjects: Resource[], wasAList: boolean}>}
     */
    async validate ({ requestInfo, currentDate, currentOperationName, incomingResources, base_version }) {
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
                } else {
                    await this.scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes({
                        resource, requestInfo, base_version
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
