const OperationOutcome = require('../fhir/classes/4_0_0/resources/operationOutcome');
const OperationOutcomeIssue = require('../fhir/classes/4_0_0/backbone_elements/operationOutcomeIssue');
const CodeableConcept = require('../fhir/classes/4_0_0/complex_types/codeableConcept');

/**
 * Creates an OperationOutcomeIssue
 * @param {Error} error
 * @param {boolean | undefined} internalError Indicates the error as an internal server error
 * @return {OperationOutcomeIssue}
 */
function createOperationOutcomeIssue ({ error, internalError }) {
    const operationOutcomeIssue = new OperationOutcomeIssue({
        severity: 'error',
        code: 'internal',
        details: new CodeableConcept({
            text: internalError ? 'Internal Server Error' : `Unexpected Error: ${error.message}`
        })
    });
    if (Object.hasOwn(error, 'stack') && !internalError) {
        operationOutcomeIssue.diagnostics = error.stack;
    }
    return operationOutcomeIssue;
}

/**
 * Converts Error to OperationOutcome
 * @param {Error} error
 * @param {boolean | undefined} internalError Indicates the error as an internal server error
 * @returns {OperationOutcome}
 */
function convertErrorToOperationOutcome ({ error, internalError }) {
    if (internalError) {
        return new OperationOutcome({
            issue: [createOperationOutcomeIssue({ error, internalError })]
        });
    }

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
