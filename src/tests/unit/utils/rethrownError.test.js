const { describe, test, expect, beforeEach, afterEach, jest: jestObj } = require('@jest/globals');
const { RethrownError, reThrow } = require('../../../utils/rethrownError');

describe('RethrownError', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        process.env = { ...originalEnv };
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    describe('constructor basics', () => {
        test('throws if no error parameter is passed', () => {
            expect(() => {
                new RethrownError({ message: 'Something went wrong', error: null });
            }).toThrow('RethrownError requires a message and error');
        });

        test('throws if error is undefined', () => {
            expect(() => {
                new RethrownError({ message: 'Something went wrong', error: undefined });
            }).toThrow('RethrownError requires a message and error');
        });

        test('sets name to RethrownError', () => {
            const inner = new Error('inner error');
            const rethrown = new RethrownError({ message: 'outer', error: inner });
            expect(rethrown.name).toBe('RethrownError');
        });

        test('uses error.message as message when message param is not provided', () => {
            const inner = new Error('original message');
            const rethrown = new RethrownError({ error: inner });
            expect(rethrown.message).toBe('original message');
        });

        test('uses provided message over error.message', () => {
            const inner = new Error('original message');
            const rethrown = new RethrownError({ message: 'custom message', error: inner });
            expect(rethrown.message).toBe('custom message');
        });
    });

    describe('stack trace combination', () => {
        test('stack_before_rethrow is captured and contains RethrownError reference', () => {
            const inner = new Error('inner failure');
            const rethrown = new RethrownError({ message: 'outer context', error: inner });

            expect(rethrown.stack_before_rethrow).toBeDefined();
            expect(typeof rethrown.stack_before_rethrow).toBe('string');
            expect(rethrown.stack_before_rethrow).toContain('RethrownError');
        });

        test('nested error is preserved for stack building', () => {
            const inner = new Error('inner failure');
            const rethrown = new RethrownError({ message: 'outer context', error: inner });

            expect(rethrown.nested).toBe(inner);
            expect(rethrown.nested.stack).toContain('inner failure');
        });

        test('buildCombinedStacks prepends nested stack with Causes separator', () => {
            const inner = new Error('inner failure');
            const rethrown = new RethrownError({ message: 'outer context', error: inner });

            const combined = rethrown.buildCombinedStacks('outer stack trace', inner);
            expect(combined).toContain('inner failure');
            expect(combined).toContain('Causes:');
            expect(combined).toContain('outer stack trace');
        });

        test('buildCombinedStacks returns stack as-is when nested is null', () => {
            const inner = new Error('inner');
            const rethrown = new RethrownError({ message: 'outer', error: inner });

            const result = rethrown.buildCombinedStacks('just a stack', null);
            expect(result).toBe('just a stack');
        });
    });

    describe('original_error unwrapping', () => {
        test('original_error is the inner error when not a RethrownError', () => {
            const rootCause = new Error('root cause');
            const rethrown = new RethrownError({ message: 'wrapper', error: rootCause });

            expect(rethrown.original_error).toBe(rootCause);
        });

        test('original_error unwraps nested RethrownErrors to root cause', () => {
            const rootCause = new Error('root cause');
            const firstRethrow = new RethrownError({ message: 'first wrap', error: rootCause });
            const secondRethrow = new RethrownError({ message: 'second wrap', error: firstRethrow });

            expect(secondRethrow.original_error).toBe(rootCause);
        });

        test('deeply nested RethrownErrors still unwrap to root cause', () => {
            const rootCause = new Error('deep root');
            const level1 = new RethrownError({ message: 'level1', error: rootCause });
            const level2 = new RethrownError({ message: 'level2', error: level1 });
            const level3 = new RethrownError({ message: 'level3', error: level2 });

            expect(level3.original_error).toBe(rootCause);
        });
    });

    describe('statusCode handling', () => {
        test('propagates numeric statusCode from inner error', () => {
            const inner = new Error('not found');
            inner.statusCode = 404;
            const rethrown = new RethrownError({ message: 'wrapper', error: inner });

            expect(rethrown.statusCode).toBe(404);
        });

        test('defaults to 500 when inner error has no statusCode', () => {
            const inner = new Error('generic error');
            const rethrown = new RethrownError({ message: 'wrapper', error: inner });

            expect(rethrown.statusCode).toBe(500);
        });

        test('string error.code does NOT become statusCode (only numeric statusCode)', () => {
            const inner = new Error('connection refused');
            inner.code = 'ECONNREFUSED';
            const rethrown = new RethrownError({ message: 'wrapper', error: inner });

            expect(rethrown.statusCode).toBe(500);
        });

        test('string statusCode does NOT become statusCode - must be numeric', () => {
            const inner = new Error('bad status');
            inner.statusCode = '400';
            const rethrown = new RethrownError({ message: 'wrapper', error: inner });

            expect(rethrown.statusCode).toBe(500);
        });

        test('statusCode 0 is falsy but still numeric - propagates', () => {
            const inner = new Error('zero status');
            inner.statusCode = 0;
            const rethrown = new RethrownError({ message: 'wrapper', error: inner });

            // typeof 0 === 'number' so it should propagate
            expect(rethrown.statusCode).toBe(0);
        });
    });

    describe('LOG_EXCLUDE_RESOURCES filtering', () => {
        test('removes resources from args.parentEntities based on LOG_EXCLUDE_RESOURCES env var', () => {
            process.env.LOG_EXCLUDE_RESOURCES = 'Patient,Observation';

            const args = {
                parentEntities: {
                    entity1: { resourceType: 'Patient', id: '123' },
                    entity2: { resourceType: 'Encounter', id: '456' }
                }
            };

            const inner = new Error('test');
            const rethrown = new RethrownError({ message: 'wrapper', error: inner, args });

            // Patient should be removed, Encounter should remain
            expect(rethrown.args.parentEntities.entity1).toBeUndefined();
            expect(rethrown.args.parentEntities.entity2).toEqual({ resourceType: 'Encounter', id: '456' });
        });

        test('does not filter when LOG_EXCLUDE_RESOURCES is not set', () => {
            delete process.env.LOG_EXCLUDE_RESOURCES;

            const args = {
                parentEntities: {
                    entity1: { resourceType: 'Patient', id: '123' }
                }
            };

            const inner = new Error('test');
            const rethrown = new RethrownError({ message: 'wrapper', error: inner, args });

            expect(rethrown.args.parentEntities.entity1).toEqual({ resourceType: 'Patient', id: '123' });
        });

        test('handles null parentEntities gracefully', () => {
            process.env.LOG_EXCLUDE_RESOURCES = 'Patient';

            const args = { parentEntities: null };
            const inner = new Error('test');

            expect(() => {
                new RethrownError({ message: 'wrapper', error: inner, args });
            }).not.toThrow();
        });

        test('handles missing args gracefully', () => {
            const inner = new Error('test');

            expect(() => {
                new RethrownError({ message: 'wrapper', error: inner });
            }).not.toThrow();
        });

        test('recursively removes excluded resources from nested objects', () => {
            process.env.LOG_EXCLUDE_RESOURCES = 'Observation';

            const args = {
                parentEntities: {
                    nested: {
                        deep: { resourceType: 'Observation', id: '789' }
                    }
                }
            };

            const inner = new Error('test');
            const rethrown = new RethrownError({ message: 'wrapper', error: inner, args });

            expect(rethrown.args.parentEntities.nested.deep).toBeUndefined();
        });
    });

    describe('issue propagation', () => {
        test('preserves issue array from inner error', () => {
            const inner = new Error('test');
            inner.issue = [{ severity: 'error', code: 'invalid' }];

            const rethrown = new RethrownError({ message: 'wrapper', error: inner });
            expect(rethrown.issue).toEqual([{ severity: 'error', code: 'invalid' }]);
        });
    });

    describe('source property', () => {
        test('stores source when provided', () => {
            const inner = new Error('test');
            const rethrown = new RethrownError({
                message: 'wrapper',
                error: inner,
                source: 'PatientService'
            });

            expect(rethrown.source).toBe('PatientService');
        });

        test('source is undefined when not provided', () => {
            const inner = new Error('test');
            const rethrown = new RethrownError({ message: 'wrapper', error: inner });

            expect(rethrown.source).toBeUndefined();
        });
    });

    describe('reThrow utility function', () => {
        test('throws a RethrownError with the given message and error', () => {
            const inner = new Error('original');

            expect(() => {
                reThrow({ message: 'rethrown context', error: inner });
            }).toThrow(RethrownError);
        });

        test('thrown error has correct message', () => {
            const inner = new Error('original');

            try {
                reThrow({ message: 'rethrown context', error: inner });
            } catch (e) {
                expect(e.message).toBe('rethrown context');
                expect(e.original_error).toBe(inner);
            }
        });

        test('thrown error propagates statusCode from inner error', () => {
            const inner = new Error('not found');
            inner.statusCode = 404;

            try {
                reThrow({ message: 'wrapper', error: inner });
            } catch (e) {
                expect(e.statusCode).toBe(404);
            }
        });
    });
});
