const OperationOutcome = require('../fhir/classes/4_0_0/resources/operationOutcome');
const OperationOutcomeIssue = require('../fhir/classes/4_0_0/backbone_elements/operationOutcomeIssue');
const CodeableConcept = require('../fhir/classes/4_0_0/complex_types/codeableConcept');

/**
 * Creates an OperationOutcomeIssue
 * @param {Error} error
 * @return {OperationOutcomeIssue}
 */
function createOperationOutcomeIssue ({ error }) {
    const operationOutcomeIssue = new OperationOutcomeIssue({
        severity: 'error',
        code: 'internal',
        details: new CodeableConcept({
            text: `Unexpected Error: ${error.message}`
        })
    });
    if (Object.hasOwn(error, 'stack')) {
        operationOutcomeIssue.diagnostics = error.stack;
    }
    return operationOutcomeIssue;
}

/**
 * Converts Error to OperationOutcome
 * @param {Error} error
 * @returns {OperationOutcome}
 */
function convertErrorToOperationOutcome ({ error }) {
    return Object.hasOwn(error, 'issue') && error.issue && error.issue.length > 0
        ? new OperationOutcome({
            issue: error.issue
        })
        : new OperationOutcome({
            issue: [
                createOperationOutcomeIssue({ error })
            ]
        });
}

module.exports = {
    convertErrorToOperationOutcome
};
