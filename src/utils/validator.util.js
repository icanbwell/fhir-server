/**
 * This file implement calling the FHIR validator
 */

const JSONValidator = require('@asymmetrik/fhir-json-schema-validator');
const OperationOutcome = require('../fhir/classes/4_0_0/resources/operationOutcome');
const OperationOutcomeIssue = require('../fhir/classes/4_0_0/backbone_elements/operationOutcomeIssue');
const CodeableConcept = require('../fhir/classes/4_0_0/complex_types/codeableConcept');

// Create this once for the app since it is an expensive operation
const validator = new JSONValidator();
const schema = validator.schema;

/**
 * By default, ajv uses fhir.json.schema but only returns first error it finds.
 * We want it to return all errors to ease user frustration when sending invalid paylaod.
 */
const validatorConfig = {
    allErrors: true,
    logger: {
        log: function log() {
            // do nothing
        },
        warn: function warn() {
            // do nothing
        },
        error: console.error.bind(console),
    },
};
const fhirValidator = new JSONValidator(schema, validatorConfig);

/**
 * @function validateResource
 * @description - validates name is correct for resource body and resource body conforms to FHIR specification
 * @param {Object} resourceBody - payload of req.body
 * @param {string} resourceName - name of resource in url
 * @param {string} path - req.path from express
 * @returns {OperationOutcome|null} Response<null|OperationOutcome> - either null if no errors or response to send client.
 */
function validateResource(resourceBody, resourceName, path) {
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

    const errors = fhirValidator.validate(resourceBody);
    if (errors && errors.length) {
        const issue = errors.map((elm) => {
            return new OperationOutcomeIssue({
                severity: 'error',
                code: 'invalid',
                details: new CodeableConcept({
                    text: `${path} ${elm.message} :${JSON.stringify(elm.params)}: at position ${
                        elm.dataPath ? elm.dataPath : 'root'
                    }`,
                }),
            });
        });

        return new OperationOutcome({
            issue: issue,
        });
    }

    return null;
}

module.exports = {validateResource};
