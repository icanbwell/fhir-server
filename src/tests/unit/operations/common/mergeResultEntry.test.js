'use strict';

const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

const { MergeResultEntry } = require('../../../../operations/common/mergeResultEntry');

describe('MergeResultEntry', () => {
    describe('constructor', () => {
        test('assigns all properties correctly', () => {
            const entry = new MergeResultEntry({
                operationOutcome: { resourceType: 'OperationOutcome' },
                issue: { severity: 'error' },
                created: true,
                id: 'patient-1',
                uuid: 'uuid-123',
                resourceType: 'Patient',
                updated: false,
                sourceAssigningAuthority: 'client-a'
            });

            expect(entry.operationOutcome).toEqual({ resourceType: 'OperationOutcome' });
            expect(entry.issue).toEqual({ severity: 'error' });
            expect(entry.created).toBe(true);
            expect(entry.id).toBe('patient-1');
            expect(entry._uuid).toBe('uuid-123');
            expect(entry.resourceType).toBe('Patient');
            expect(entry.updated).toBe(false);
            expect(entry._sourceAssigningAuthority).toBe('client-a');
        });

        test('handles null/undefined optional fields', () => {
            const entry = new MergeResultEntry({
                operationOutcome: null,
                issue: undefined,
                created: false,
                id: 'test-1',
                uuid: 'uuid-1',
                resourceType: 'Observation',
                updated: true,
                sourceAssigningAuthority: undefined
            });

            expect(entry.operationOutcome).toBeNull();
            expect(entry.issue).toBeUndefined();
            expect(entry._sourceAssigningAuthority).toBeUndefined();
        });
    });

    describe('toJSON', () => {
        test('returns object with all non-null fields', () => {
            const entry = new MergeResultEntry({
                operationOutcome: null,
                issue: null,
                created: true,
                id: 'patient-1',
                uuid: 'uuid-123',
                resourceType: 'Patient',
                updated: false,
                sourceAssigningAuthority: 'client-a'
            });

            const json = entry.toJSON();
            expect(json.id).toBe('patient-1');
            expect(json.uuid).toBe('uuid-123');
            expect(json.resourceType).toBe('Patient');
            expect(json.created).toBe(true);
            expect(json.updated).toBe(false);
            expect(json.sourceAssigningAuthority).toBe('client-a');
        });

        test('excludes null fields from output', () => {
            const entry = new MergeResultEntry({
                operationOutcome: null,
                issue: null,
                created: true,
                id: 'patient-1',
                uuid: 'uuid-123',
                resourceType: 'Patient',
                updated: false,
                sourceAssigningAuthority: 'client-a'
            });

            const json = entry.toJSON();
            expect(json).not.toHaveProperty('operationOutcome');
            expect(json).not.toHaveProperty('issue');
        });

        test('excludes undefined fields from output', () => {
            const entry = new MergeResultEntry({
                operationOutcome: undefined,
                issue: undefined,
                created: false,
                id: 'test-1',
                uuid: 'uuid-1',
                resourceType: 'Observation',
                updated: false,
                sourceAssigningAuthority: undefined
            });

            const json = entry.toJSON();
            expect(json).not.toHaveProperty('operationOutcome');
            expect(json).not.toHaveProperty('issue');
            expect(json).not.toHaveProperty('sourceAssigningAuthority');
        });

        test('maps _uuid to uuid in JSON output', () => {
            const entry = new MergeResultEntry({
                created: false,
                id: 'test-1',
                uuid: 'my-uuid',
                resourceType: 'Patient',
                updated: false,
                sourceAssigningAuthority: 'auth'
            });

            const json = entry.toJSON();
            expect(json.uuid).toBe('my-uuid');
            expect(json).not.toHaveProperty('_uuid');
        });

        test('maps _sourceAssigningAuthority to sourceAssigningAuthority in JSON output', () => {
            const entry = new MergeResultEntry({
                created: false,
                id: 'test-1',
                uuid: 'my-uuid',
                resourceType: 'Patient',
                updated: false,
                sourceAssigningAuthority: 'my-authority'
            });

            const json = entry.toJSON();
            expect(json.sourceAssigningAuthority).toBe('my-authority');
            expect(json).not.toHaveProperty('_sourceAssigningAuthority');
        });

        test('includes boolean false values (not stripped as falsy)', () => {
            const entry = new MergeResultEntry({
                created: false,
                id: 'test-1',
                uuid: 'uuid-1',
                resourceType: 'Patient',
                updated: false,
                sourceAssigningAuthority: 'auth'
            });

            const json = entry.toJSON();
            expect(json.created).toBe(false);
            expect(json.updated).toBe(false);
        });
    });

    describe('createFromError', () => {
        test('creates MergeResultEntry with OperationOutcome from error', () => {
            const error = new Error('Something went wrong');
            const resource = {
                resourceType: 'Patient',
                id: 'patient-1',
                _uuid: 'uuid-123',
                _sourceAssigningAuthority: 'client-a'
            };

            const result = MergeResultEntry.createFromError({ error, resource });

            expect(result).toBeInstanceOf(MergeResultEntry);
            expect(result.id).toBe('patient-1');
            expect(result._uuid).toBe('uuid-123');
            expect(result._sourceAssigningAuthority).toBe('client-a');
            expect(result.resourceType).toBe('Patient');
            expect(result.created).toBe(false);
            expect(result.updated).toBe(false);
        });

        test('creates valid OperationOutcome structure', () => {
            const error = new Error('Validation failed');
            const resource = {
                resourceType: 'Observation',
                id: 'obs-1',
                _uuid: 'uuid-obs',
                _sourceAssigningAuthority: 'source-1'
            };

            const result = MergeResultEntry.createFromError({ error, resource });
            const outcome = result.operationOutcome;

            expect(outcome.resourceType).toBe('OperationOutcome');
            expect(outcome.issue).toHaveLength(1);
            expect(outcome.issue[0].severity).toBe('error');
            expect(outcome.issue[0].code).toBe('exception');
            expect(outcome.issue[0].diagnostics).toBe('Validation failed');
        });

        test('sets issue from the first OperationOutcome issue', () => {
            const error = new Error('Test error');
            const resource = {
                resourceType: 'Patient',
                id: 'p1',
                _uuid: 'u1',
                _sourceAssigningAuthority: 'a1'
            };

            const result = MergeResultEntry.createFromError({ error, resource });
            expect(result.issue).toBeTruthy();
            expect(result.issue.severity).toBe('error');
            expect(result.issue.code).toBe('exception');
        });

        test('includes resource type in expression field of the issue', () => {
            const error = new Error('Error occurred');
            const resource = {
                resourceType: 'Condition',
                id: 'cond-1',
                _uuid: 'uuid-cond',
                _sourceAssigningAuthority: 'src'
            };

            const result = MergeResultEntry.createFromError({ error, resource });
            expect(result.operationOutcome.issue[0].expression).toEqual(['Condition']);
        });

        test('handles error with empty message', () => {
            const error = new Error('');
            const resource = {
                resourceType: 'Patient',
                id: 'p1',
                _uuid: 'u1',
                _sourceAssigningAuthority: 'a1'
            };

            const result = MergeResultEntry.createFromError({ error, resource });
            expect(result.operationOutcome.issue[0].diagnostics).toBe('');
        });

        test('handles error with undefined message', () => {
            const error = new Error();
            const resource = {
                resourceType: 'Patient',
                id: 'p1',
                _uuid: 'u1',
                _sourceAssigningAuthority: 'a1'
            };

            const result = MergeResultEntry.createFromError({ error, resource });
            // Error() without message gives empty string
            expect(result.operationOutcome.issue[0].diagnostics).toBe('');
        });

        test('sets created and updated to false', () => {
            const error = new Error('fail');
            const resource = {
                resourceType: 'Patient',
                id: 'p1',
                _uuid: 'u1',
                _sourceAssigningAuthority: 'a1'
            };

            const result = MergeResultEntry.createFromError({ error, resource });
            expect(result.created).toBe(false);
            expect(result.updated).toBe(false);
        });

        test('adds a source-line extension with the line number when provided', () => {
            const error = new Error('Bad NDJSON line');
            const resource = {
                resourceType: 'Patient',
                id: 'p1',
                _uuid: 'u1',
                _sourceAssigningAuthority: 'a1'
            };

            const result = MergeResultEntry.createFromError({ error, resource, lineNumber: 42 });
            const extension = result.operationOutcome.issue[0].extension;

            expect(extension).toHaveLength(1);
            expect(extension[0].url).toBe('https://www.icanbwell.com/source-line');
            expect(extension[0].valueInteger).toBe(42);
        });

        test('omits the extension when lineNumber is not provided', () => {
            const error = new Error('fail');
            const resource = {
                resourceType: 'Patient',
                id: 'p1',
                _uuid: 'u1',
                _sourceAssigningAuthority: 'a1'
            };

            const result = MergeResultEntry.createFromError({ error, resource });
            expect(result.operationOutcome.issue[0].extension).toBeUndefined();
        });
    });
});
