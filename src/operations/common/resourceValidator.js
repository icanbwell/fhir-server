const {validateResource} = require('../../utils/validator.util');
const {validationsFailedCounter} = require('../../utils/prometheus.utils');
const sendToS3 = require('../../utils/aws-s3');
const Resource = require('../../fhir/classes/4_0_0/resources/resource');
const {getCircularReplacer} = require('../../utils/getCircularReplacer');
const {assertTypeEquals} = require('../../utils/assertType');
const {ConfigManager} = require('../../utils/configManager');
const {RemoteFhirValidator} = require('../../utils/remoteFhirValidator');
const OperationOutcomeIssue = require('../../fhir/classes/4_0_0/backbone_elements/operationOutcomeIssue');
const {DatabaseQueryFactory} = require('../../dataLayer/databaseQueryFactory');
const {VERSIONS} = require('../../middleware/fhir/utils/constants');

class ResourceValidator {
    /**
     * constructor
     * @param {ConfigManager} configManager
     * @param {RemoteFhirValidator} remoteFhirValidator
     * @param {DatabaseQueryFactory} databaseQueryFactory
     */
    constructor({configManager, remoteFhirValidator, databaseQueryFactory}) {
        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);

        /**
         * @type {RemoteFhirValidator}
         */
        this.remoteFhirValidator = remoteFhirValidator;
        assertTypeEquals(remoteFhirValidator, RemoteFhirValidator);

        /**
         * @type {DatabaseQueryFactory}
         */
        this.databaseQueryFactory = databaseQueryFactory;
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);
    }

    /**
     * validates a resource
     * @param {string} id
     * @param {string} resourceType
     * @param {Object|Resource} resourceToValidate
     * @param {string} path
     * @param {string} currentDate
     * @param {Object} resourceObj
     * @param {boolean|undefined} useRemoteFhirValidatorIfAvailable
     * @param {string|undefined} profile
     * @returns {OperationOutcome | null}
     */
    async validateResourceAsync(
        {
            id,
            resourceType,
            resourceToValidate,
            path,
            currentDate,
            resourceObj = null,
            useRemoteFhirValidatorIfAvailable = false,
            profile
        }
    ) {
        const resourceToValidateJson = (resourceToValidate instanceof Resource) ? resourceToValidate.toJSON() : resourceToValidate;
        /**
         * @type {OperationOutcome | null}
         */
        const validationOperationOutcome = this.configManager.fhirValidationUrl && useRemoteFhirValidatorIfAvailable ?
            await this.validateResourceFromServerAsync(
                {
                    resourceBody: resourceToValidateJson,
                    resourceName: resourceType,
                    path,
                    resourceObj,
                    profile
                }
            ) : validateResource(
                {
                    resourceBody: resourceToValidateJson,
                    resourceName: resourceType,
                    path,
                    resourceObj
                }
            );
        if (validationOperationOutcome) {
            validationsFailedCounter.inc({action: 'validate', resourceType: resourceType}, 1);
            validationOperationOutcome['expression'] = [
                resourceType + '/' + id
            ];
            if (!(validationOperationOutcome['details']) || !(validationOperationOutcome['details']['text'])) {
                validationOperationOutcome['details'] = {
                    text: JSON.stringify(resourceToValidateJson, getCircularReplacer())
                };
            } else {
                validationOperationOutcome['details']['text'] = validationOperationOutcome['details']['text'] +
                    ',' + JSON.stringify(resourceToValidateJson, getCircularReplacer());
            }

            if (this.configManager.logValidationFailures) {
                await sendToS3('validation_failures',
                    resourceType,
                    resourceToValidateJson,
                    currentDate,
                    id,
                    'merge');
                await sendToS3('validation_failures',
                    resourceType,
                    validationOperationOutcome,
                    currentDate,
                    id,
                    'merge_failure');
            }
            return validationOperationOutcome;
        }
        return null;
    }

    /**
     * @function validateResourceFromServerAsync
     * @description - validates name is correct for resource body and resource body conforms to FHIR specification
     * @param {Object} resourceBody - payload of req.body
     * @param {string} resourceName - name of resource in url
     * @param {string} path - req.path from express
     * @param {Object} resourceObj - fhir resource object
     * @param {string|undefined} profile
     * @returns {OperationOutcome|null} Response<null|OperationOutcome> - either null if no errors or response to send client.
     */
    async validateResourceFromServerAsync(
        {
            resourceBody,
            resourceName,
            path,
            resourceObj = null,
            profile
        }) {
        const resourceToValidateJson = (resourceBody instanceof Resource) ? resourceBody.toJSON() : resourceBody;

        if (profile) {
            // see if profile exists in our fhir server already
            /**
             * @type {DatabaseQueryManager}
             */
            const databaseQueryManager = this.databaseQueryFactory.createQuery(
                {resourceType: 'StructureDefinition', base_version: VERSIONS['4_0_0']}
            );
            /**
             * @type {Resource|null}
             */
            const profileResource = await databaseQueryManager.findOneAsync(
                {
                    query: {url: profile}
                }
            );
            const profileJson = profileResource ?
                profileResource.toJSON() :
                await this.remoteFhirValidator.fetchProfile({url: profile});
            if (profileJson) {
                // write profile to our fhir server
                await this.remoteFhirValidator.updateProfile({profileJson});
            }
        }
        // first read the profiles specified in the resource and send to fhir validator
        if (resourceToValidateJson.meta && resourceToValidateJson.meta.profile && resourceToValidateJson.meta.profile.length > 0) {
            /**
             * @type {string[]}
             */
            const metaProfiles = resourceToValidateJson.meta.profile;
            for (const metaProfile of metaProfiles) {
                const profileJson = await this.remoteFhirValidator.fetchProfile({url: metaProfile});
                if (profileJson) {
                    await this.remoteFhirValidator.updateProfile({profileJson});
                }
            }
        }
        /**
         * @type {OperationOutcome|null}
         */
        const operationOutcome = await this.remoteFhirValidator.validateResourceAsync(
            {
                resourceBody: resourceToValidateJson,
                resourceName,
                path,
                resourceObj,
                profile
            }
        );
        if (operationOutcome && operationOutcome.issue && operationOutcome.issue.length > 0) {
            // remove any warnings avoid noise
            operationOutcome.issue = operationOutcome.issue.filter(issue => issue.severity === 'error');
        }
        if (!operationOutcome.issue || operationOutcome.issue.length === 0) {
            operationOutcome.issue = new OperationOutcomeIssue({
                'code': 'informational',
                'details': {
                    'text': 'OK'
                },
                'expression': [
                    'Practitioner'
                ],
                'severity': 'information'
            });
        }
        return operationOutcome;
    }

}

module.exports = {
    ResourceValidator
};
