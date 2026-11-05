const { describe, test, expect } = require('@jest/globals');
const {
    buildOperationOutcome,
    buildOperationOutcomeFromIssues,
    buildOperationOutcomeIssue
} = require('../../../utils/operationOutcomeBuilder');

describe('buildOperationOutcome', () => {
    test.each([
        [
            'diagnostics',
            [{ severity: 'error', code: 'not-found', diagnostics: 'Resource with type: Patient and id: 1 was not found' }]
        ],
        ['details text', [{ severity: 'error', code: 'not-found', details: { text: 'Page not found' } }]],
        [
            'details and diagnostics',
            [
                {
                    severity: 'error',
                    code: 'forbidden',
                    details: { text: 'Cannot access Patient with scope x' },
                    diagnostics: 'Cannot access Patient with scope x'
                }
            ]
        ],
        [
            'coding details and expression',
            [
                {
                    severity: 'information',
                    code: 'informational',
                    details: {
                        coding: [{ system: 'https://www.rfc-editor.org/rfc/rfc9110.html', code: '201', display: 'Created' }]
                    },
                    expression: ['Patient/1']
                }
            ]
        ],
        [
            'extension',
            [
                {
                    extension: [{ url: 'https://example.test/source-byte-offset', valueInteger: 12 }],
                    severity: 'error',
                    code: 'exception',
                    details: { text: 'boom' },
                    diagnostics: 'boom',
                    expression: ['Patient']
                }
            ]
        ],
        [
            'multiple issues',
            [
                { severity: 'error', code: 'invalid', diagnostics: 'first' },
                { severity: 'warning', code: 'informational', diagnostics: 'second' }
            ]
        ]
    ])('keeps %s', (_name, issues) => {
        const result = buildOperationOutcome(...issues);

        expect(result).toStrictEqual({ resourceType: 'OperationOutcome', issue: issues });
    });

    test('returns a plain object with the OperationOutcome resourceType', () => {
        const result = buildOperationOutcome({ severity: 'error', code: 'exception', diagnostics: 'boom' });

        expect(result.constructor).toBe(Object);
        expect(result).toStrictEqual({
            resourceType: 'OperationOutcome',
            issue: [{ severity: 'error', code: 'exception', diagnostics: 'boom' }]
        });
    });

    test('drops fields that are not part of the OperationOutcome issue', () => {
        const result = buildOperationOutcome({
            severity: 'error',
            code: 'exception',
            diagnostics: 'boom',
            notAFhirField: 'x'
        });

        expect(result.issue[0].notAFhirField).toBeUndefined();
    });

    test.each([
        ['an id', 'validationfail', { id: 'validationfail' }],
        ['no id', undefined, {}]
    ])('buildOperationOutcomeFromIssues with %s keeps the issues', (_name, id, expectedId) => {
        const issues = [{ severity: 'error', code: 'structure', details: { text: 'Invalid parameter list' } }];

        const result = buildOperationOutcomeFromIssues(issues, id);

        expect(result).toStrictEqual({ resourceType: 'OperationOutcome', ...expectedId, issue: issues });
    });

    test.each([[undefined], [[]]])(
        'buildOperationOutcomeFromIssues with issues %j has no issue element',
        (issues) => {
            const result = buildOperationOutcomeFromIssues(issues);

            expect(result).toStrictEqual({ resourceType: 'OperationOutcome' });
        }
    );

    test('buildOperationOutcomeIssue keeps a valid issue', () => {
        const issue = {
            severity: 'error',
            code: 'exception',
            details: { text: 'boom' },
            diagnostics: 'boom',
            expression: ['Patient/1']
        };

        const result = buildOperationOutcomeIssue({ ...issue });

        expect(result).toStrictEqual(issue);
    });

    test('buildOperationOutcomeIssue drops fields that are not part of an OperationOutcome issue', () => {
        const result = buildOperationOutcomeIssue({
            severity: 'error',
            code: 'exception',
            details: { text: 'boom', notAFhirField: 'x' },
            notAFhirField: 'x'
        });

        expect(result).toStrictEqual({ severity: 'error', code: 'exception', details: { text: 'boom' } });
    });
});
