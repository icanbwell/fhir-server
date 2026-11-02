const { describe, test, expect } = require('@jest/globals');

const { notFound, internal } = require('../../../../../middleware/fhir/utils/error.utils');

describe('error.utils notFound', () => {
    test.each([
        [undefined, 'Not found', '404: Not found'],
        ['Resource missing', 'Resource missing', 'Resource missing']
    ])('message %p produces the not-found OperationOutcome', (message, expectedDivText, expectedDiagnostics) => {
        const result = notFound(message);

        expect(result.resourceType).toBe('OperationOutcome');
        expect(result.issue).toEqual([
            { severity: 'error', code: 'not-found', diagnostics: expectedDiagnostics }
        ]);
        expect(result.text.status).toBe('generated');
        expect(result.text.div).toContain(`<pre>${expectedDivText}</pre>`);
        expect(result.text.div).toContain('<td style="font-weight: bold;">error</td>');
    });

    test('carries a 404 status code that is not serialized into the response body', () => {
        const result = notFound();

        expect(result.statusCode).toBe(404);
        expect(JSON.parse(JSON.stringify(result))).not.toHaveProperty('statusCode');
        expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    });
});

describe('error.utils internal', () => {
    test.each([
        [undefined],
        ['Unsupported FHIR specification version requested.']
    ])('message %p produces the generic internal-error OperationOutcome', (message) => {
        const result = internal(message);

        expect(result.resourceType).toBe('OperationOutcome');
        expect(result.issue).toEqual([
            { severity: 'error', code: 'exception', diagnostics: 'Internal Server Error' }
        ]);
        expect(result.text.status).toBe('generated');
        expect(result.text.div).toContain('<pre>Internal Server Error</pre>');
    });

    test('carries a 500 status code that is not serialized into the response body', () => {
        const result = internal();

        expect(result.statusCode).toBe(500);
        expect(JSON.parse(JSON.stringify(result))).not.toHaveProperty('statusCode');
        expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    });
});
