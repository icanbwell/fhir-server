'use strict';

const { describe, test, expect } = require('@jest/globals');
const { ServerError } = require('../../../../../middleware/fhir/utils/server.error');

describe('ServerError', () => {
    test('is an instance of Error', () => {
        const err = new ServerError('test message');
        expect(err).toBeInstanceOf(Error);
    });

    test('is an instance of ServerError', () => {
        const err = new ServerError('test message');
        expect(err).toBeInstanceOf(ServerError);
    });

    test('stores message', () => {
        const err = new ServerError('something went wrong');
        expect(err.message).toBe('something went wrong');
    });

    test('message is enumerable', () => {
        const err = new ServerError('visible');
        const keys = Object.keys(err);
        expect(keys).toContain('message');
    });

    test('mixes in additional options', () => {
        const err = new ServerError('error', { statusCode: 404, resourceType: 'Patient' });
        expect(err.statusCode).toBe(404);
        expect(err.resourceType).toBe('Patient');
    });

    test('has a stack trace', () => {
        const err = new ServerError('with stack');
        expect(err.stack).toBeDefined();
        expect(typeof err.stack).toBe('string');
    });

    test('works without options', () => {
        const err = new ServerError('no options');
        expect(err.message).toBe('no options');
    });

    test('options can include issue for FHIR OperationOutcome compatibility', () => {
        const err = new ServerError('forbidden', {
            statusCode: 403,
            issue: { code: 'forbidden', severity: 'error' }
        });
        expect(err.issue.code).toBe('forbidden');
        expect(err.statusCode).toBe(403);
    });
});
