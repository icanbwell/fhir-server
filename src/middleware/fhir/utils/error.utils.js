const {
    ISSUE,
    VERSIONS
} = require('./constants');

const {
    resolveSchema
} = require('./schema.utils');
const OperationOutcome = require('../../../fhir/classes/4_0_0/resources/operationOutcome');
const OperationOutcomeIssue = require('../../../fhir/classes/4_0_0/backbone_elements/operationOutcomeIssue');
const Narrative = require('../../../fhir/classes/4_0_0/complex_types/narrative'); // Helper to determine which operation outcome to retrieve

const getErrorConstructor = baseVersion => {
    if (!baseVersion || !Object.prototype.hasOwnProperty.call(VERSIONS, baseVersion)) {
        return resolveSchema(VERSIONS['3_0_1'], 'OperationOutcome');
    } else {
        return resolveSchema(baseVersion, 'OperationOutcome');
    }
};
/* eslint-disable no-useless-escape */

const div_content = (severity, diagnostics) => '<div xmlns="http://www.w3.org/1999/xhtml"><h1>Operation Outcome</h1><table border="0">' + `<table border=\"0\"><tr><td style=\"font-weight: bold;\">${severity}</td>` + `<td><pre>${diagnostics}</pre></td></tr></table></div>`;
/* eslint-enable no-useless-escape */
// Invalid or Missing parameter from request

const invalidParameter = (message, base_version) => {
    return new OperationOutcome({
        // statusCode: 400,
        text: new Narrative({
            status: 'generated',
            div: div_content(ISSUE.SEVERITY.ERROR, message)
        }),
        issue: [new OperationOutcomeIssue({
            code: ISSUE.CODE.INVALID,
            severity: ISSUE.SEVERITY.ERROR,
            diagnostics: message
        })]
    });
}; // Unauthorized request of some resource

const unauthorized = (message, base_version) => {
    const ErrorConstructor = getErrorConstructor(base_version);
    const err = new ErrorConstructor({
        text: {
            status: 'generated',
            div: div_content(ISSUE.SEVERITY.ERROR, message || 'Unauthorized request')
        },
        issue: {
            code: ISSUE.CODE.FORBIDDEN,
            severity: ISSUE.SEVERITY.ERROR,
            diagnostics: message || '401: Unauthorized request'
        }
    });
    err.statusCode = 401;
    return err;
};

const insufficientScope = (message, base_version) => {
    const ErrorConstructor = getErrorConstructor(base_version);
    const err = new ErrorConstructor({
        text: {
            status: 'generated',
            div: div_content(ISSUE.SEVERITY.ERROR, message || 'Insufficient scope')
        },
        issue: {
            code: ISSUE.CODE.FORBIDDEN,
            severity: ISSUE.SEVERITY.ERROR,
            diagnostics: message || '403: Insufficient scope'
        }
    });
    err.statusCode = 403;
    return err;
};

const notFound = (message, base_version) => {
    let ErrorConstructor = getErrorConstructor(base_version);
    if (!ErrorConstructor) {
        ErrorConstructor = getErrorConstructor('4_0_0');
    }
    const err = new ErrorConstructor({
        text: {
            status: 'generated',
            div: div_content(ISSUE.SEVERITY.ERROR, message || 'Not found')
        },
        issue: {
            code: ISSUE.CODE.NOT_FOUND,
            severity: ISSUE.SEVERITY.ERROR,
            diagnostics: message || '404: Not found'
        }
    });
    err.statusCode = 404;
    return err;
};

const methodNotAllowed = (message, base_version) => {
    const ErrorConstructor = getErrorConstructor(base_version);
    const err = new ErrorConstructor({
        text: {
            status: 'generated',
            div: div_content(ISSUE.SEVERITY.ERROR, message || 'Method not allowed')
        },
        issue: {
            code: ISSUE.CODE.NOT_SUPPORTED,
            severity: ISSUE.SEVERITY.ERROR,
            diagnostics: message || '405: Method not allowed'
        }
    });
    err.statusCode = 405;
    return err;
};

const deleteConflict = (message, base_version) => {
    const ErrorConstructor = getErrorConstructor(base_version);
    const err = new ErrorConstructor({
        text: {
            status: 'generated',
            div: div_content(ISSUE.SEVERITY.ERROR, message || 'Conflict')
        },
        issue: {
            code: ISSUE.CODE.CONFLICT,
            severity: ISSUE.SEVERITY.ERROR,
            diagnostics: message || '409: Conflict'
        }
    });
    err.statusCode = 409;
    return err;
};

const deleted = (message, base_version) => {
    const ErrorConstructor = getErrorConstructor(base_version);
    const err = new ErrorConstructor({
        text: {
            status: 'generated',
            div: div_content(ISSUE.SEVERITY.ERROR, message || 'Resource deleted')
        },
        issue: {
            code: ISSUE.CODE.NOT_FOUND,
            severity: ISSUE.SEVERITY.ERROR,
            diagnostics: message || '410: Resource deleted'
        }
    });
    err.statusCode = 410;
    return err;
};
/**
 * @function customError
 * @description Take a custom error from user implementation and return an operation outcome
 * @param {Error<statusCode, code, severity, message>} err - error or custom error object
 * @param {String} base_version - dstu2 or stu3
 * @return {OperationOutcome}
 */

const customError = (err, base_version) => {
    return new OperationOutcome({
        // statusCode: err.statusCode,
        text: new Narrative({
            status: 'generated',
            div: div_content(err.severity, err.message)
        }),
        issue: [new OperationOutcomeIssue({
            code: err.code,
            severity: err.severity,
            diagnostics: err.message
        })],
        isCustom: true
    });
};

const internal = (err, base_version) => {
    if (err.isCustom) {
        return customError(err, base_version);
    }

    const ErrorConstructor = getErrorConstructor(base_version);
    const error = new ErrorConstructor({
        text: {
            status: 'generated',
            div: div_content(ISSUE.SEVERITY.ERROR, err.message || 'Internal server error')
        },
        issue: {
            code: ISSUE.CODE.EXCEPTION,
            severity: ISSUE.SEVERITY.ERROR,
            diagnostics: err.message || '500: Internal server error'
        }
    });
    error.statusCode = 500;
    return error;
};

const isServerError = (err, base_version) => err instanceof getErrorConstructor(base_version);
/**
 * @name exports
 * @static
 * @summary Error Configurations
 */

module.exports = {
    invalidParameter,
    unauthorized,
    insufficientScope,
    methodNotAllowed,
    deleteConflict,
    notFound,
    deleted,
    internal,
    customError,
    isServerError
};
