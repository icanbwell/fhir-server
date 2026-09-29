const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

// Mock dependencies
jestObj.mock('../../../../../middleware/fhir/utils/schema.utils', () => ({
    resolveSchema: jestObj.fn((version, schema) => {
        // Return a constructor function that creates objects with properties
        return function MockOperationOutcome(props) {
            Object.assign(this, props);
        };
    })
}));

jestObj.mock('../../../../../fhir/classes/4_0_0/resources/operationOutcome', () => {
    return function MockOperationOutcome(props) {
        Object.assign(this, props);
    };
});

jestObj.mock('../../../../../fhir/classes/4_0_0/backbone_elements/operationOutcomeIssue', () => {
    return function MockOperationOutcomeIssue(props) {
        Object.assign(this, props);
    };
});

jestObj.mock('../../../../../fhir/classes/4_0_0/complex_types/narrative', () => {
    return function MockNarrative(props) {
        Object.assign(this, props);
    };
});

const {
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
} = require('../../../../../middleware/fhir/utils/error.utils');

const { resolveSchema } = require('../../../../../middleware/fhir/utils/schema.utils');

describe('error.utils', () => {
    beforeEach(() => {
        jestObj.clearAllMocks();
    });

    describe('invalidParameter', () => {
        test('returns OperationOutcome with error severity', () => {
            const result = invalidParameter('Missing required param');

            expect(result.issue).toBeDefined();
            expect(result.issue[0].severity).toBe('error');
            expect(result.issue[0].code).toBe('invalid');
        });

        test('includes the message in diagnostics', () => {
            const result = invalidParameter('field xyz is required');

            expect(result.issue[0].diagnostics).toBe('field xyz is required');
        });

        test('has generated narrative with severity and diagnostics', () => {
            const result = invalidParameter('bad param');

            expect(result.text.status).toBe('generated');
            expect(result.text.div).toContain('error');
            expect(result.text.div).toContain('bad param');
        });

        test('includes Operation Outcome header in div', () => {
            const result = invalidParameter('test');

            expect(result.text.div).toContain('Operation Outcome');
        });

        test('handles empty message', () => {
            const result = invalidParameter('');

            expect(result.issue[0].diagnostics).toBe('');
            expect(result.issue[0].code).toBe('invalid');
        });

        test('handles special characters in message', () => {
            const msg = '<script>alert("xss")</script>';
            const result = invalidParameter(msg);

            expect(result.issue[0].diagnostics).toBe(msg);
            expect(result.text.div).toContain(msg);
        });
    });

    describe('unauthorized', () => {
        test('returns error with statusCode 401', () => {
            const result = unauthorized('Not authorized', '4_0_0');

            expect(result.statusCode).toBe(401);
        });

        test('uses FORBIDDEN issue code', () => {
            const result = unauthorized('Denied', '4_0_0');

            expect(result.issue.code).toBe('forbidden');
        });

        test('uses default message when none provided', () => {
            const result = unauthorized(undefined, '4_0_0');

            expect(result.issue.diagnostics).toBe('401: Unauthorized request');
        });

        test('uses custom message when provided', () => {
            const result = unauthorized('Custom unauthorized msg', '4_0_0');

            expect(result.issue.diagnostics).toBe('Custom unauthorized msg');
        });

        test('uses default message for div when none provided', () => {
            const result = unauthorized(null, '4_0_0');

            expect(result.text.div).toContain('Unauthorized request');
        });

        test('calls resolveSchema with correct version', () => {
            unauthorized('msg', '4_0_0');

            expect(resolveSchema).toHaveBeenCalledWith('4_0_0', 'OperationOutcome');
        });

        test('falls back to 3_0_1 when base_version is invalid', () => {
            unauthorized('msg', 'invalid_version');

            expect(resolveSchema).toHaveBeenCalledWith('3_0_1', 'OperationOutcome');
        });

        test('falls back to 3_0_1 when base_version is null', () => {
            unauthorized('msg', null);

            expect(resolveSchema).toHaveBeenCalledWith('3_0_1', 'OperationOutcome');
        });
    });

    describe('insufficientScope', () => {
        test('returns error with statusCode 403', () => {
            const result = insufficientScope('Need more scopes', '4_0_0');

            expect(result.statusCode).toBe(403);
        });

        test('uses FORBIDDEN issue code', () => {
            const result = insufficientScope('Scope too narrow', '4_0_0');

            expect(result.issue.code).toBe('forbidden');
        });

        test('uses default message when none provided', () => {
            const result = insufficientScope(undefined, '4_0_0');

            expect(result.issue.diagnostics).toBe('403: Insufficient scope');
        });

        test('uses custom message when provided', () => {
            const result = insufficientScope('Need patient/*.read', '4_0_0');

            expect(result.issue.diagnostics).toBe('Need patient/*.read');
        });
    });

    describe('notFound', () => {
        test('returns error with statusCode 404', () => {
            const result = notFound('Patient/123 not found', '4_0_0');

            expect(result.statusCode).toBe(404);
        });

        test('uses NOT_FOUND issue code', () => {
            const result = notFound('Resource missing', '4_0_0');

            expect(result.issue.code).toBe('not-found');
        });

        test('uses default message when none provided', () => {
            const result = notFound(undefined, '4_0_0');

            expect(result.issue.diagnostics).toBe('404: Not found');
        });

        test('uses custom message when provided', () => {
            const result = notFound('Observation/456 missing', '4_0_0');

            expect(result.issue.diagnostics).toBe('Observation/456 missing');
        });

        test('handles fallback when getErrorConstructor returns falsy', () => {
            // When resolveSchema returns undefined for a version,
            // notFound falls back to '4_0_0'
            resolveSchema.mockImplementation((version, schema) => {
                if (version === 'bad_version') return undefined;
                return function MockOO(props) { Object.assign(this, props); };
            });

            const result = notFound('test', 'bad_version');

            expect(result.statusCode).toBe(404);
        });
    });

    describe('methodNotAllowed', () => {
        test('returns error with statusCode 405', () => {
            const result = methodNotAllowed('PATCH not supported', '4_0_0');

            expect(result.statusCode).toBe(405);
        });

        test('uses NOT_SUPPORTED issue code', () => {
            const result = methodNotAllowed('Method X', '4_0_0');

            expect(result.issue.code).toBe('not-supported');
        });

        test('uses default message when none provided', () => {
            const result = methodNotAllowed(undefined, '4_0_0');

            expect(result.issue.diagnostics).toBe('405: Method not allowed');
        });
    });

    describe('deleteConflict', () => {
        test('returns error with statusCode 409', () => {
            const result = deleteConflict('Resource has references', '4_0_0');

            expect(result.statusCode).toBe(409);
        });

        test('uses CONFLICT issue code', () => {
            const result = deleteConflict('Conflict detected', '4_0_0');

            expect(result.issue.code).toBe('conflict');
        });

        test('uses default message when none provided', () => {
            const result = deleteConflict(undefined, '4_0_0');

            expect(result.issue.diagnostics).toBe('409: Conflict');
        });
    });

    describe('deleted', () => {
        test('returns error with statusCode 410', () => {
            const result = deleted('Resource was deleted', '4_0_0');

            expect(result.statusCode).toBe(410);
        });

        test('uses NOT_FOUND issue code', () => {
            const result = deleted('Gone', '4_0_0');

            expect(result.issue.code).toBe('not-found');
        });

        test('uses default message when none provided', () => {
            const result = deleted(undefined, '4_0_0');

            expect(result.issue.diagnostics).toBe('410: Resource deleted');
        });
    });

    describe('internal', () => {
        test('returns error with statusCode 500', () => {
            const err = new Error('Something broke');
            const result = internal(err, '4_0_0');

            expect(result.statusCode).toBe(500);
        });

        test('uses EXCEPTION issue code', () => {
            const err = new Error('DB connection failed');
            const result = internal(err, '4_0_0');

            expect(result.issue.code).toBe('exception');
        });

        test('does NOT expose internal error message to client', () => {
            const err = new Error('Sensitive database connection string leaked');
            const result = internal(err, '4_0_0');

            expect(result.issue.diagnostics).toBe('Internal Server Error');
            expect(result.issue.diagnostics).not.toContain('Sensitive');
        });

        test('delegates to customError when err.isCustom is true', () => {
            const customErr = {
                isCustom: true,
                code: 'business-rule',
                severity: 'error',
                message: 'Custom business logic failure'
            };

            const result = internal(customErr, '4_0_0');

            expect(result.issue[0].code).toBe('business-rule');
            expect(result.issue[0].diagnostics).toBe('Custom business logic failure');
        });

        test('does not delegate to customError when isCustom is falsy', () => {
            const err = { isCustom: false, message: 'test', code: 'x', severity: 'y' };
            const result = internal(err, '4_0_0');

            expect(result.issue.diagnostics).toBe('Internal Server Error');
        });
    });

    describe('customError', () => {
        test('creates OperationOutcome with custom error properties', () => {
            const err = {
                code: 'too-costly',
                severity: 'warning',
                message: 'Query too expensive'
            };

            const result = customError(err, '4_0_0');

            expect(result.issue[0].code).toBe('too-costly');
            expect(result.issue[0].severity).toBe('warning');
            expect(result.issue[0].diagnostics).toBe('Query too expensive');
        });

        test('sets isCustom flag on result', () => {
            const err = { code: 'invalid', severity: 'error', message: 'bad' };

            const result = customError(err, '4_0_0');

            expect(result.isCustom).toBe(true);
        });

        test('includes narrative text', () => {
            const err = { code: 'invalid', severity: 'fatal', message: 'Critical failure' };

            const result = customError(err, '4_0_0');

            expect(result.text.status).toBe('generated');
            expect(result.text.div).toContain('fatal');
            expect(result.text.div).toContain('Critical failure');
        });
    });

    describe('isServerError', () => {
        test('returns true for instances created by the same constructor resolveSchema returns', () => {
            // Since resolveSchema is mocked to return a new function each call,
            // we need to ensure both calls in isServerError and our test use the same ref
            const SharedConstructor = function MockOO(props) { Object.assign(this, props); };
            resolveSchema.mockReturnValue(SharedConstructor);

            const err = new SharedConstructor({});
            const result = isServerError(err, '4_0_0');

            expect(result).toBe(true);
        });

        test('returns false for plain objects', () => {
            const plainError = { text: {}, issue: {} };

            const result = isServerError(plainError, '4_0_0');

            expect(result).toBe(false);
        });

        test('returns false for standard Error instances', () => {
            const err = new Error('Something went wrong');

            const result = isServerError(err, '4_0_0');

            expect(result).toBe(false);
        });

        test('returns false when instance is from a different constructor', () => {
            function OtherConstructor(props) { Object.assign(this, props); }
            const err = new OtherConstructor({});

            const result = isServerError(err, '4_0_0');

            expect(result).toBe(false);
        });
    });

    describe('version fallback behavior', () => {
        test('falls back to 3_0_1 when baseVersion is undefined', () => {
            unauthorized('msg', undefined);

            expect(resolveSchema).toHaveBeenCalledWith('3_0_1', 'OperationOutcome');
        });

        test('falls back to 3_0_1 when baseVersion is empty string', () => {
            unauthorized('msg', '');

            expect(resolveSchema).toHaveBeenCalledWith('3_0_1', 'OperationOutcome');
        });

        test('uses provided baseVersion when it exists in VERSIONS', () => {
            unauthorized('msg', '4_0_0');

            expect(resolveSchema).toHaveBeenCalledWith('4_0_0', 'OperationOutcome');
        });
    });
});
