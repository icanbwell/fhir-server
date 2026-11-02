const { ISSUE } = require('./constants');
const { FhirResourceWriteNormalizeSerializer } = require('../../../fhir/fhirResourceWriteNormalizeSerializer');

/* eslint-disable no-useless-escape */

const div_content = (severity, diagnostics) => '<div xmlns="http://www.w3.org/1999/xhtml"><h1>Operation Outcome</h1><table border="0">' + `<table border=\"0\"><tr><td style=\"font-weight: bold;\">${severity}</td>` + `<td><pre>${diagnostics}</pre></td></tr></table></div>`;
/* eslint-enable no-useless-escape */

const notFound = (message) => {
    const operationOutcome = FhirResourceWriteNormalizeSerializer.serialize({
        obj: {
            resourceType: 'OperationOutcome',
            text: {
                status: 'generated',
                div: div_content(ISSUE.SEVERITY.ERROR, message || 'Not found')
            },
            issue: [{
                severity: ISSUE.SEVERITY.ERROR,
                code: ISSUE.CODE.NOT_FOUND,
                diagnostics: message || '404: Not found'
            }]
        }
    });
    Object.defineProperty(operationOutcome, 'statusCode', { value: 404 });
    return operationOutcome;
};

const internal = () => {
    const operationOutcome = FhirResourceWriteNormalizeSerializer.serialize({
        obj: {
            resourceType: 'OperationOutcome',
            text: {
                status: 'generated',
                div: div_content(ISSUE.SEVERITY.ERROR, 'Internal Server Error')
            },
            issue: [{
                severity: ISSUE.SEVERITY.ERROR,
                code: ISSUE.CODE.EXCEPTION,
                diagnostics: 'Internal Server Error'
            }]
        }
    });
    Object.defineProperty(operationOutcome, 'statusCode', { value: 500 });
    return operationOutcome;
};

module.exports = {
    notFound,
    internal
};
