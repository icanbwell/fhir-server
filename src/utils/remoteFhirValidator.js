const { assertIsValid, assertTypeEquals } = require('./assertType');
const OperationOutcome = require('../fhir/classes/4_0_0/resources/operationOutcome');
const OperationOutcomeIssue = require('../fhir/classes/4_0_0/backbone_elements/operationOutcomeIssue');
const CodeableConcept = require('../fhir/classes/4_0_0/complex_types/codeableConcept');
const { ConfigManager } = require('./configManager');
const { logInfo, logError } = require('../operations/common/logging');
const request = require('superagent');
const { ProfileUrlMapper } = require('./profileMapper');
const { EXTERNAL_REQUEST_RETRY_COUNT } = require('../constants');
const { ExternalTimeoutError } = require('./httpErrors');

class RemoteFhirValidator {
    /**
     * constructor
     * @param {ConfigManager} configManager
     * @param {ProfileUrlMapper} profileUrlMapper
     */
    constructor (
        {
            configManager,
            profileUrlMapper
        }
    ) {
        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);

        /**
         * @type {ProfileUrlMapper}
         */
        this.profileUrlMapper = profileUrlMapper;
        assertTypeEquals(profileUrlMapper, ProfileUrlMapper);
    }

    /**
     * fetches a profile from a remote FHIR server
     * @param {string} url
     * @returns {Promise<Object>}
     */
    async fetchProfileAsync ({ url }) {
        assertIsValid(url, 'url must be specified');
        const originalUrl = this.profileUrlMapper.getOriginalUrl(url);
        try {
            const response = await request
                .get(originalUrl.toString())
                .set('Accept', 'application/json')
                .set('User-Agent', `fhir-server/${this.configManager.environmentValue}`)
                .retry(EXTERNAL_REQUEST_RETRY_COUNT)
                .timeout(this.configManager.requestTimeoutMs);
            return response.body;
        } catch (err) {
            if (err.timeout) {
                // log the error and send 504 as response
                logError(`Request timeout while fetching profile for url: ${url}, originalUrl: ${originalUrl}`, {
                    source: 'RemoteFhirValidator.fetchProfileAsync',
                    args: {
                        originalUrl,
                        url,
                        timeout: this.configManager.requestTimeoutMs
                    }
                });
                throw new ExternalTimeoutError('Unexpected: Request timeout while fetching profile info', { timeout: this.configManager.requestTimeoutMs, profileUrl: originalUrl });
            }
            throw err;
        }
    }

    /**
     * updates a profile on a remote FHIR server
     * @param {Object} profileJson
     * @returns {Promise<void>}
     */
    async updateProfileAsync ({ profileJson }) {
        const fhirValidationUrl = this.configManager.fhirValidationUrl;
        assertIsValid(fhirValidationUrl, 'fhirValidationUrl must be specified');
        const url = new URL(fhirValidationUrl);
        url.pathname += `/StructureDefinition/${profileJson.id}`;
        try {
            const response = await request
            .put(url.toString())
            .set('Accept', 'application/json')
            .set('Content-Type', 'application/fhir+json')
            .retry(EXTERNAL_REQUEST_RETRY_COUNT)
            .timeout(this.configManager.requestTimeoutMs)
            .send(profileJson);

            return response.body;
        } catch (err) {
            if (err.timeout) {
                // log the error and send 504 as response
                logError(`Request timeout while updating profile in hapi-fhir for profileId: ${profileJson?.id}`, {
                    source: 'RemoteFhirValidator.updateProfileAsync',
                    args: {
                        fhirValidationUrl: url,
                        timeout: this.configManager.requestTimeoutMs
                    }
                });
                throw new ExternalTimeoutError('Unexpected: Request timeout while validating resource', { timeout: this.configManager.requestTimeoutMs });
            }
            throw err;
        }
    }

    /**
     * @function validateResource
     * @description - validates name is correct for resource body and resource body conforms to FHIR specification
     * @param {Object} resourceBody - payload of req.body
     * @param {string} resourceName - name of resource in url
     * @param {string} path - req.path from express
     * @param {Object} resourceObj - fhir resource object
     * @param {string|undefined} profile
     * @returns {OperationOutcome|null} Response<null|OperationOutcome> - either null if no errors or response to send client.
     */
    async validateResourceAsync ({ resourceBody, resourceName, path, profile }) {
        if (resourceBody.resourceType !== resourceName) {
            return new OperationOutcome({
                issue: [
                    new OperationOutcomeIssue({
                        severity: 'error',
                        code: 'invalid',
                        details: new CodeableConcept({
                            text: `Validation failed for data posted to ${path} for resource ${resourceBody.resourceType}.` +
                                ' ResourceType does not match the endpoint you are posting to.'
                        })
                    })
                ]
            });
        }
        const fhirValidationUrl = this.configManager.fhirValidationUrl;
        assertIsValid(fhirValidationUrl, 'fhirValidationUrl must be specified');
        const url = new URL(fhirValidationUrl);
        url.pathname += `/${resourceName}/$validate`;
        if (profile) {
            url.searchParams.append('profile', profile);
        }
        logInfo(`validateResourceAsync: Calling HAPI FHIR ${url.toString()}`, { url });

        try {
            const response = await request
                .post(url.toString())
                .set('Accept', 'application/json')
                .set('Content-Type', 'application/fhir+json')
                .retry(EXTERNAL_REQUEST_RETRY_COUNT)
                .timeout(this.configManager.requestTimeoutMs)
                .send(resourceBody);
            return response.body;
        } catch (err) {
            if (err.timeout) {
                // log the error and send 504 as response
                logError('Request timeout while validating the resource', {
                    source: 'RemoteFhirValidator.validateResourceAsync',
                    args: {
                        fhirValidationUrl: url,
                        timeout: this.configManager.requestTimeoutMs
                    }
                });
                throw new ExternalTimeoutError('Unexpected: Request timeout while validating resource', { timeout: this.configManager.requestTimeoutMs });
            }
            throw err;
        }
    }
}

module.exports = {
    RemoteFhirValidator
};
