const { describe, test, expect } = require('@jest/globals');
const { createTooCostlyError, GUIDANCE } = require('../../../utils/fhirErrorFactory');
const OperationOutcomeIssue = require('../../../fhir/classes/4_0_0/backbone_elements/operationOutcomeIssue');

describe('fhirErrorFactory', () => {
    describe('createTooCostlyError', () => {
        test('creates error for PUT operation', () => {
            const { message, options } = createTooCostlyError({
                actual: 50001,
                limit: 50000,
                operation: 'PUT'
            });

            expect(message).toContain('50001');
            expect(message).toContain('50000');
            expect(message).toContain('members');

            expect(options.issue).toBeDefined();
            expect(Array.isArray(options.issue)).toBe(true);
            expect(options.issue.length).toBe(1);

            const issue = options.issue[0];
            expect(issue).toBeInstanceOf(OperationOutcomeIssue);
            expect(issue.severity).toBe('error');
            expect(issue.code).toBe('too-costly');
            expect(issue.diagnostics).toContain('50001');
            expect(issue.diagnostics).toContain('50000');
            expect(issue.diagnostics).toContain('Alternative approaches');
        });

        test('creates error for PATCH operation with custom guidance', () => {
            const { message, options } = createTooCostlyError({
                actual: 11000,
                limit: 10000,
                operation: 'PATCH',
                customGuidance: 'Split into 2 batches of 10000 operations each'
            });

            expect(message).toContain('11000');
            expect(message).toContain('10000');
            expect(message).toContain('operations');

            const issue = options.issue[0];
            expect(issue.diagnostics).toContain('Split into 2 batches');
        });

        test('uses default PATCH guidance when not provided', () => {
            const { options } = createTooCostlyError({
                actual: 100,
                limit: 50,
                operation: 'PUT'
            });

            expect(options.issue[0].diagnostics).toContain(GUIDANCE.PATCH);
            expect(options.issue[0].diagnostics).toContain(GUIDANCE.PAGINATION);
            expect(options.issue[0].diagnostics).toContain(GUIDANCE.STREAMING);
        });
    });

    describe('GUIDANCE constants', () => {
        test('exports expected guidance strings', () => {
            expect(GUIDANCE.PATCH).toBeDefined();
            expect(GUIDANCE.PATCH_EXAMPLE).toBeDefined();
            expect(GUIDANCE.PAGINATION).toBeDefined();
            expect(GUIDANCE.STREAMING).toBeDefined();
            expect(GUIDANCE.FHIR_PATCH_URL).toBeDefined();
        });
    });
});
