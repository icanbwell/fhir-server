const OperationOutcome = require('../fhir/classes/4_0_0/resources/operationOutcome');
const OperationOutcomeIssue = require('../fhir/classes/4_0_0/backbone_elements/operationOutcomeIssue');
const CodeableConcept = require('../fhir/classes/4_0_0/complex_types/codeableConcept');

/**
 * Converts Error to OperationOutcome
 * @param {Error} error
 * @returns {OperationOutcome}
 */
function convertErrorToOperationOutcome ({ error }) {
    /**
     * @type {string}
     */
    const message = Object.hasOwn(error, 'stack') ? error.message + '\n' + error.stack : error.message;
    return Object.hasOwn(error, 'issue') && error.issue && error.issue.length > 0
        ? new OperationOutcome({
            issue: error.issue
        })
        : new OperationOutcome({
            issue: [
                new OperationOutcomeIssue({
                    severity: 'error',
                    code: 'internal',
                    details: new CodeableConcept({
                        text: `Unexpected Error: ${message}`
                    })
                })
            ]
        });
}

module.exports = {
    convertErrorToOperationOutcome
};
