/**
 * This file implement calling the FHIR validator
 */
const { fhirSchemaValidator } = require('./fhirSchemaValidator');
const { buildOperationOutcomeFromIssues } = require('./operationOutcomeBuilder');
const { fastValidateReferences } = require('./referenceValidator');

const invalidIssue = (text) => ({ severity: 'error', code: 'invalid', details: { text } });

/**
 * @function validateResource
 * @description - validates name is correct for resource body and resource body conforms to FHIR specification
 * @param {Object} resourceBody - payload of req.body
 * @param {string} resourceName - name of resource in url
 * @param {string} path - req.path from express
 * @param {Object} resourceObj - fhir resource object
 * @param {boolean} excludeRequiredFieldErrors - whether to exclude required field errors from validation results. This is used in merge operation where we want to allow missing required fields as long as they are present in the other resource being merged.
 * @returns {Object|null} Response<null|OperationOutcome> - either null if no errors or response to send client.
 */
function validateResource ({ resourceBody, resourceName, path, resourceObj = null, excludeRequiredFieldErrors = false }) {
    if (resourceBody.resourceType !== resourceName) {
        return buildOperationOutcomeFromIssues([
            invalidIssue(
                `Validation failed for data posted to ${path} for resource ${resourceBody.resourceType}.` +
                ' ResourceType does not match the endpoint you are posting to.'
            )
        ]);
    }

    let errors = fhirSchemaValidator.validate(resourceBody);

    let referenceErrors = null;

    if (resourceObj) {
        referenceErrors = fastValidateReferences(resourceObj);
    }
    let issue;
    if (errors && errors.length) {
        if (excludeRequiredFieldErrors) {
            // when excluding required field errors, we want to exclude both 'required' keyword errors
            // and 'oneOf' errors that are caused by missing required fields in one of the schemas
            // in a oneOf. So we filter out 'required' errors and 'oneOf' errors.
            errors = errors.filter((e) => e.keyword !== 'required' && e.keyword !== 'oneOf');
        }

        issue = errors.map((elm) => {
            return invalidIssue(
                `${path} ${elm.message} :${JSON.stringify(elm.params)}: at position ${
                    elm.dataPath ? elm.dataPath : 'root'
                }`
            );
        });
    }
    if (referenceErrors && referenceErrors.length) {
        issue = issue || [];
        issue.push(...referenceErrors.map(err => invalidIssue(err)));
    }
    if (issue && issue.length) {
        return buildOperationOutcomeFromIssues(issue);
    }

    return null;
}

module.exports = { validateResource };
