const { describe, test, expect } = require('@jest/globals');
const {
    BadRequestError,
    NotFoundError,
    NotAllowedError,
    NotValidatedError,
    UnauthorizedError,
    ForbiddenError,
    ExternalTimeoutError,
    PreconditionFailedError,
    MethodNotAllowedError,
    PayloadTooLargeError
} = require('../../../utils/httpErrors');

describe('httpErrors', () => {
    describe('BadRequestError', () => {
        test('constructs correctly with an error object', () => {
            const err = new BadRequestError(new Error('test error'));
            expect(err.message).toBe('test error');
            expect(err.statusCode).toBe(400);
            expect(err.issue).toBeDefined();
            expect(err.issue[0].details.text).toBe('test error');
        });

        test('BUG: passing a string produces undefined message and details.text', () => {
            // BadRequestError expects an object with .message property
            // If a string is passed, 'test error'.message is undefined
            const err = new BadRequestError('test error');
            expect(err.message).toBeUndefined();
            expect(err.issue[0].details.text).toBeUndefined();
        });

        test('BUG: crashes when passed null', () => {
            // null.message throws TypeError
            expect(() => {
                new BadRequestError(null);
            }).toThrow();
        });

        test('BUG: crashes when passed undefined', () => {
            // undefined.message throws TypeError
            expect(() => {
                new BadRequestError(undefined);
            }).toThrow();
        });

        test('attaches extra options', () => {
            const err = new BadRequestError(new Error('test'), { username: 'admin' });
            expect(err.username).toBe('admin');
        });
    });

    describe('PayloadTooLargeError', () => {
        test('constructs correctly with an error object', () => {
            const err = new PayloadTooLargeError(new Error('too big'));
            expect(err.message).toBe('too big');
            expect(err.statusCode).toBe(413);
            expect(err.issue[0].details.text).toBe('too big');
        });

        test('BUG: passing a string produces undefined message and details.text', () => {
            // Same bug as BadRequestError - expects object with .message
            const err = new PayloadTooLargeError('too big');
            expect(err.message).toBeUndefined();
            expect(err.issue[0].details.text).toBeUndefined();
        });

        test('BUG: crashes when passed null', () => {
            expect(() => {
                new PayloadTooLargeError(null);
            }).toThrow();
        });
    });

    describe('NotValidatedError', () => {
        test('constructs correctly with operationOutcome', () => {
            const outcome = { issue: [{ severity: 'error', code: 'invalid' }] };
            const err = new NotValidatedError(outcome);
            expect(err.message).toBe('Validation Failed');
            expect(err.statusCode).toBe(400);
            expect(err.issue).toEqual([{ severity: 'error', code: 'invalid' }]);
        });

        test('BUG: crashes when passed null operationOutcome', () => {
            // Accessing null.issue will throw TypeError
            expect(() => {
                new NotValidatedError(null);
            }).toThrow();
        });

        test('BUG: crashes when passed undefined operationOutcome', () => {
            expect(() => {
                new NotValidatedError(undefined);
            }).toThrow();
        });

        test('BUG: crashes when operationOutcome has no issue property', () => {
            // operationOutcome.issue will be undefined
            // This passes undefined to the ServerError options.issue
            const err = new NotValidatedError({});
            // The issue will be undefined - not an error but a logic bug
            expect(err.issue).toBeUndefined();
        });
    });

    describe('NotFoundError', () => {
        test('constructs correctly', () => {
            const err = new NotFoundError('resource not found');
            expect(err.message).toBe('resource not found');
            expect(err.statusCode).toBe(404);
            expect(err.name).toBe('NotFound');
            expect(err.issue[0].code).toBe('not-found');
        });

        test('handles null message without crashing', () => {
            // NotFoundError takes a string message directly, so this should work
            const err = new NotFoundError(null);
            expect(err.statusCode).toBe(404);
        });
    });

    describe('NotAllowedError', () => {
        test('constructs correctly', () => {
            const err = new NotAllowedError('not allowed');
            expect(err.message).toBe('not allowed');
            // BUG: The comment says "Set this to make the HTTP status code 409"
            // but the class is named NotAllowedError - semantically this should be 403
            // However the statusCode getter returns 409 (Conflict)
            expect(err.statusCode).toBe(409);
            expect(err.issue[0].code).toBe('forbidden');
        });

        test('BUG: statusCode 409 (Conflict) is semantically wrong for NotAllowedError', () => {
            // NotAllowedError uses code 'forbidden' in the issue but returns 409 (Conflict)
            // 409 is "Conflict", not "Forbidden" (which is 403)
            // This is a semantic mismatch between the error name/code and HTTP status
            const err = new NotAllowedError('not allowed');
            expect(err.issue[0].code).toBe('forbidden');
            // The HTTP status is 409 (Conflict) but the issue code says 'forbidden'
            expect(err.statusCode).not.toBe(403);
            expect(err.statusCode).toBe(409);
        });
    });

    describe('UnauthorizedError', () => {
        test('constructs correctly', () => {
            const err = new UnauthorizedError('unauthorized');
            expect(err.message).toBe('unauthorized');
            expect(err.statusCode).toBe(401);
            expect(err.issue[0].code).toBe('security');
        });
    });

    describe('ForbiddenError', () => {
        test('constructs correctly', () => {
            const err = new ForbiddenError('forbidden');
            expect(err.message).toBe('forbidden');
            expect(err.statusCode).toBe(403);
            expect(err.issue[0].code).toBe('forbidden');
            expect(err.issue[0].diagnostics).toBe('forbidden');
        });
    });

    describe('ExternalTimeoutError', () => {
        test('constructs correctly', () => {
            const err = new ExternalTimeoutError('timed out');
            expect(err.message).toBe('timed out');
            expect(err.statusCode).toBe(504);
            expect(err.issue[0].code).toBe('timeout');
        });
    });

    describe('PreconditionFailedError', () => {
        test('constructs correctly', () => {
            const err = new PreconditionFailedError('precondition failed');
            expect(err.message).toBe('precondition failed');
            expect(err.statusCode).toBe(412);
            expect(err.issue[0].code).toBe('precondition-failed');
        });
    });

    describe('MethodNotAllowedError', () => {
        test('constructs correctly', () => {
            const err = new MethodNotAllowedError('method not allowed');
            expect(err.message).toBe('method not allowed');
            expect(err.statusCode).toBe(405);
            expect(err.issue[0].code).toBe('not-supported');
        });
    });

    describe('options parameter edge cases', () => {
        test('BUG: options=null crashes all constructors that iterate Object.entries(options)', () => {
            // All constructors call Object.entries(options) which fails on null
            expect(() => {
                new NotFoundError('test', null);
            }).toThrow();
        });

        test('options with conflicting properties overwrite class properties', () => {
            // options can overwrite internal properties like 'issue' or 'message'
            const err = new NotFoundError('test', { issue: 'overwritten' });
            expect(err.issue).toBe('overwritten');
        });
    });
});
