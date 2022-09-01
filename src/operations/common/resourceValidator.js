const {validateResource} = require('../../utils/validator.util');
const {validationsFailedCounter} = require('../../utils/prometheus.utils');
const sendToS3 = require('../../utils/aws-s3');

class ResourceValidator {

    /**
     * validates a resource
     * @param {string} id
     * @param {string} resourceType
     * @param {Object} resourceToValidate
     * @param {string} path
     * @param {string} currentDate
     * @returns {OperationOutcome | null}
     */
    async validateResourceObjectAsync({id, resourceType, resourceToValidate, path, currentDate}) {
        /**
         * @type {OperationOutcome | null}
         */
        const validationOperationOutcome = validateResource(resourceToValidate, resourceType, path);
        if (validationOperationOutcome && validationOperationOutcome.statusCode === 400) {
            validationsFailedCounter.inc({action: 'merge', resourceType: resourceType}, 1);
            validationOperationOutcome['expression'] = [
                resourceType + '/' + id
            ];
            if (!(validationOperationOutcome['details']) || !(validationOperationOutcome['details']['text'])) {
                validationOperationOutcome['details'] = {
                    text: ''
                };
            }
            validationOperationOutcome['details']['text'] = validationOperationOutcome['details']['text'] + ',' + JSON.stringify(resourceToValidate.toJSON());

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
        return null;
    }
}

module.exports = {
    ResourceValidator
};
