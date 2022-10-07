const {validateResource} = require('../../utils/validator.util');
const {validationsFailedCounter} = require('../../utils/prometheus.utils');
const sendToS3 = require('../../utils/aws-s3');
const Resource = require('../../fhir/classes/4_0_0/resources/resource');
const env = require('var');
const {isTrue} = require('../../utils/isTrue');

class ResourceValidator {

    /**
     * validates a resource
     * @param {string} id
     * @param {string} resourceType
     * @param {Object|Resource} resourceToValidate
     * @param {string} path
     * @param {string} currentDate
     * @returns {OperationOutcome | null}
     */
    async validateResourceAsync({id, resourceType, resourceToValidate, path, currentDate}) {
        resourceToValidate = (resourceToValidate instanceof Resource) ? resourceToValidate.toJSON() : resourceToValidate;
        /**
         * @type {OperationOutcome | null}
         */
        const validationOperationOutcome = validateResource(resourceToValidate, resourceType, path);
        if (validationOperationOutcome) {
            validationsFailedCounter.inc({action: 'merge', resourceType: resourceType}, 1);
            validationOperationOutcome['expression'] = [
                resourceType + '/' + id
            ];
            if (!(validationOperationOutcome['details']) || !(validationOperationOutcome['details']['text'])) {
                validationOperationOutcome['details'] = {
                    text: ''
                };
            }
            validationOperationOutcome['details']['text'] = validationOperationOutcome['details']['text'] +
                ',' + JSON.stringify(resourceToValidate);

            if (isTrue(env.LOG_VALIDATION_FAILURES)) {
                await sendToS3('validation_failures',
                    resourceType,
                    resourceToValidate,
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
}

module.exports = {
    ResourceValidator
};
