const {assertIsValid, assertTypeEquals} = require('./assertType');
const OperationOutcome = require('../fhir/classes/4_0_0/resources/operationOutcome');
const OperationOutcomeIssue = require('../fhir/classes/4_0_0/backbone_elements/operationOutcomeIssue');
const CodeableConcept = require('../fhir/classes/4_0_0/complex_types/codeableConcept');
const {ConfigManager} = require('./configManager');

class RemoteFhirValidator {
    /**
     * constructor
     * @param {ConfigManager} configManager
     */
    constructor(
        {
            configManager
        }
    ) {
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);
    }

    /**
     * fetches a profile from a remote FHIR server
     * @param {string} url
     * @returns {Promise<void>}
     */
    async fetchProfile({url}) {
        assertIsValid(url, 'url must be specified');
        const response = await fetch(url,
            {
                method: 'GET',
                headers: {
                    'Accept': 'application/json'
                },
            });
        return await response.json();
    }

    /**
     * updates a profile on a remote FHIR server
     * @param {Object} profileJson
     * @returns {Promise<void>}
     */
    async updateProfile({profileJson}) {
        const fhirValidationUrl = this.configManager.fhirValidationUrl;
        assertIsValid(fhirValidationUrl, 'fhirValidationUrl must be specified');
        const url = new URL(fhirValidationUrl);
        url.pathname += '/StructureDefinition';
        const response = await fetch(url,
            {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/fhir+json',
                },
                body: JSON.stringify(profileJson)
            });
        return await response.json();
    }

    /**
     * @function validateResource
     * @description - validates name is correct for resource body and resource body conforms to FHIR specification
     * @param {Object} resourceBody - payload of req.body
     * @param {string} resourceName - name of resource in url
     * @param {string} path - req.path from express
     * @param {Object} resourceObj - fhir resource object
     * @returns {OperationOutcome|null} Response<null|OperationOutcome> - either null if no errors or response to send client.
     */
    async validateResourceAsync({resourceBody, resourceName, path}) {
        if (resourceBody.resourceType !== resourceName) {
            return new OperationOutcome({
                issue: [
                    new OperationOutcomeIssue({
                        severity: 'error',
                        code: 'invalid',
                        details: new CodeableConcept({
                            text: `Validation failed for data posted to ${path} for resource ${resourceBody.resourceType}.` +
                                ' ResourceType does not match the endpoint you are posting to.',
                        }),
                    }),
                ],
            });
        }
        const fhirValidationUrl = this.configManager.fhirValidationUrl;
        assertIsValid(fhirValidationUrl, 'fhirValidationUrl must be specified');
        const url = new URL(fhirValidationUrl);
        url.pathname += `/${resourceName}/$validate`;
        const response = await fetch(url,
            {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/fhir+json',
                },
                body: JSON.stringify(resourceBody)
            });
        return await response.json();
    }
}

module.exports = {
    RemoteFhirValidator
};
