const { describe, test, expect } = require('@jest/globals');
const { WriteFailure, WRITE_FAILURE_STAGE } = require('../../../../operations/writePipeline/writeFailure');

/**
 * A frozen synthetic failure subject.
 */
const subject = Object.freeze({
    id: 'patient-1',
    uuid: '11111111-1111-4111-8111-111111111111',
    sourceAssigningAuthority: 'client',
    resourceType: 'Patient'
});

/**
 * An empty OperationOutcome for check failures.
 */
const operationOutcome = Object.freeze({ resourceType: 'OperationOutcome', issue: [] });
/**
 * A synthetic error for error failures.
 */
const error = new Error('synthetic failure');

describe('WriteFailure', () => {
    test.each([
        { name: 'both operationOutcome and error', args: { operationOutcome, error }, valid: false },
        { name: 'neither operationOutcome nor error', args: {}, valid: false },
        { name: 'only an operationOutcome', args: { operationOutcome }, valid: true },
        { name: 'only an error', args: { error }, valid: true }
    ])('constructor with $name', ({ args, valid }) => {
        const create = () => new WriteFailure({ stage: WRITE_FAILURE_STAGE.SCOPE, subject, ...args });

        if (!valid) {
            expect(create).toThrow('WriteFailure needs exactly one of operationOutcome or error');
            return;
        }
        const failure = create();
        expect(failure.stage).toBe(WRITE_FAILURE_STAGE.SCOPE);
        expect(failure.operationOutcome).toBe(args.operationOutcome ?? null);
        expect(failure.error).toBe(args.error ?? null);
        expect(failure.subject).toStrictEqual(subject);
    });

    test('subjectOf maps the id, uuid, source assigning authority and resource type', () => {
        const resource = {
            resourceType: 'Patient',
            id: 'patient-1',
            _uuid: '11111111-1111-4111-8111-111111111111',
            _sourceAssigningAuthority: 'client',
            name: [{ family: 'Synthetic' }]
        };

        expect(WriteFailure.subjectOf(resource)).toStrictEqual(subject);
    });

    test('the failure and a copy of its subject are frozen', () => {
        const mutableSubject = { ...subject };

        const failure = new WriteFailure({ stage: WRITE_FAILURE_STAGE.WRITE, subject: mutableSubject, error });
        mutableSubject.id = 'changed';

        expect(Object.isFrozen(failure)).toBe(true);
        expect(Object.isFrozen(failure.subject)).toBe(true);
        expect(failure.subject).not.toBe(mutableSubject);
        expect(failure.subject.id).toBe('patient-1');
    });
});
