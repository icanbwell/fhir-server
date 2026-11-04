const { buildOperationOutcome, buildOperationOutcomeFromIssues } = require('./operationOutcomeBuilder');

const cloneIssues = (issues) => JSON.parse(JSON.stringify(issues));

/**
 * Creates an OperationOutcome issue
 * @param {Error} error
 * @param {boolean | undefined} internalError Indicates the error as an internal server error
 * @return {Object}
 */
function createOperationOutcomeIssue ({ error, internalError }) {
    return {
        severity: 'error',
        code: 'internal',
        details: {
            text: internalError ? 'Internal Server Error' : `Unexpected Error: ${error.message}`
        }
    };
}

/**
 * Converts Error to OperationOutcome
 * @param {Error} error
 * @param {boolean | undefined} internalError Indicates the error as an internal server error
 * @returns {Object}
 */
function convertErrorToOperationOutcome ({ error, internalError }) {
    if (internalError) {
        return buildOperationOutcome(createOperationOutcomeIssue({ error, internalError }));
    }

    return Object.hasOwn(error, 'issue') && error.issue && error.issue.length > 0
        ? buildOperationOutcomeFromIssues(cloneIssues(error.issue))
        : buildOperationOutcome(createOperationOutcomeIssue({ error }));
}

module.exports = {
    convertErrorToOperationOutcome
};
