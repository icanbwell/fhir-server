'use strict';

const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

// Mock dependencies
jestObj.mock('../../../utils/mongoQueryStringify', () => ({
    mongoQueryAndOptionsStringify: jestObj.fn(() => 'stringified-query')
}));

jestObj.mock('../../../operations/graph/queryItem', () => ({
    QueryItem: jestObj.fn().mockImplementation((params) => ({
        query: params.query,
        collectionName: params.collectionName,
        resourceType: params.resourceType
    }))
}));

const { MongoError, MongoMergeError } = require('../../../utils/mongoErrors');
const { mongoQueryAndOptionsStringify } = require('../../../utils/mongoQueryStringify');
const { QueryItem } = require('../../../operations/graph/queryItem');

describe('MongoError', () => {
    const defaultParams = {
        requestId: 'req-123',
        message: 'Test error',
        error: new Error('inner error'),
        collection: 'Patient_4_0_0',
        query: { id: '123' },
        elapsedTime: 5000,
        options: {}
    };

    function createMongoError(overrides = {}) {
        const params = { ...defaultParams, ...overrides };
        return new MongoError(
            params.requestId,
            params.message,
            params.error,
            params.collection,
            params.query,
            params.elapsedTime,
            params.options
        );
    }

    test('stores elapsedTimeInSecs correctly (ms to seconds)', () => {
        const err = createMongoError({ elapsedTime: 5000 });
        expect(err.elapsedTimeInSecs).toBe(5);
    });

    test('stores elapsedTimeInSecs for fractional seconds', () => {
        const err = createMongoError({ elapsedTime: 1500 });
        expect(err.elapsedTimeInSecs).toBe(1.5);
    });

    test('stores elapsedTimeInSecs as 0 for 0ms', () => {
        const err = createMongoError({ elapsedTime: 0 });
        expect(err.elapsedTimeInSecs).toBe(0);
    });

    test('stores collection property', () => {
        const err = createMongoError({ collection: 'Observation_4_0_0' });
        expect(err.collection).toBe('Observation_4_0_0');
    });

    test('stores requestId property', () => {
        const err = createMongoError({ requestId: 'req-abc-456' });
        expect(err.requestId).toBe('req-abc-456');
    });

    test('stores query property', () => {
        const query = { resourceType: 'Patient', id: '789' };
        const err = createMongoError({ query });
        expect(err.query).toBe(query);
    });

    test('stores options property', () => {
        const options = { limit: 10, sort: { _id: 1 } };
        const err = createMongoError({ options });
        expect(err.options).toBe(options);
    });

    test('preserves original_error reference', () => {
        const innerError = new Error('database connection failed');
        const err = createMongoError({ error: innerError });
        expect(err.original_error).toBe(innerError);
    });

    test('propagates statusCode from inner error', () => {
        const innerError = new Error('not found');
        innerError.statusCode = 404;
        const err = createMongoError({ error: innerError });
        expect(err.statusCode).toBe(404);
    });

    test('statusCode is undefined when inner error has no statusCode', () => {
        const innerError = new Error('generic error');
        const err = createMongoError({ error: innerError });
        expect(err.statusCode).toBeUndefined();
    });

    test('spreads options keys onto the instance', () => {
        const options = { projection: { name: 1 }, maxTimeMS: 30000 };
        const err = createMongoError({ options });
        expect(err.projection).toEqual({ name: 1 });
        expect(err.maxTimeMS).toBe(30000);
    });

    test('spreads multiple option keys', () => {
        const options = { foo: 'bar', baz: 42, nested: { a: 1 } };
        const err = createMongoError({ options });
        expect(err.foo).toBe('bar');
        expect(err.baz).toBe(42);
        expect(err.nested).toEqual({ a: 1 });
    });

    test('combines stack traces from parent and inner error', () => {
        const innerError = new Error('inner stack');
        const err = createMongoError({ error: innerError });
        expect(err.stack).toContain('inner stack');
    });

    test('preserves stack_before_rethrow', () => {
        const err = createMongoError();
        expect(err.stack_before_rethrow).toBeDefined();
        expect(typeof err.stack_before_rethrow).toBe('string');
    });

    test('uses message parameter as the message', () => {
        const err = createMongoError({ message: 'Custom message' });
        expect(err.message).toBe('Custom message');
    });

    test('falls back to inner error message when message is empty', () => {
        const innerError = new Error('fallback message');
        const err = createMongoError({ message: '', error: innerError });
        expect(err.message).toBe('fallback message');
    });

    test('is an instance of AggregateError', () => {
        const err = createMongoError();
        expect(err).toBeInstanceOf(AggregateError);
    });

    test('calls QueryItem with correct parameters', () => {
        createMongoError({ collection: 'TestCol', query: { x: 1 } });
        expect(QueryItem).toHaveBeenCalledWith({
            query: { x: 1 },
            collectionName: 'TestCol',
            resourceType: null
        });
    });

    test('calls mongoQueryAndOptionsStringify', () => {
        createMongoError();
        expect(mongoQueryAndOptionsStringify).toHaveBeenCalled();
    });

    test('uses default empty options when options argument is omitted', () => {
        const innerError = new Error('connection timeout');
        // Call constructor without options (7th argument)
        const err = new MongoError(
            'req-no-opts',
            'Timeout error',
            innerError,
            'Patient_4_0_0',
            { id: '1' },
            2000
        );
        expect(err.options).toEqual({});
    });

    test('handles inner error with empty message string', () => {
        const innerError = new Error('');
        const err = createMongoError({ error: innerError });
        // When error.message is empty, the || '' in super() yields ''
        expect(err.original_error).toBe(innerError);
    });

    test('handles multiline message for stack manipulation', () => {
        const innerError = new Error('inner');
        const err = createMongoError({ message: 'line1\nline2\nline3' });
        // Multiline message changes how many lines are kept from stack
        expect(err.stack).toBeDefined();
        expect(err.stack_before_rethrow).toBeDefined();
    });

    test('does not add extra properties when options is empty', () => {
        const err = createMongoError({ options: {} });
        // The for...of loop should not add any extra keys
        const ownKeys = Object.keys(err);
        expect(ownKeys).not.toContain('undefined');
    });

    test('passes options to mongoQueryAndOptionsStringify', () => {
        const options = { sort: { _id: 1 }, limit: 50 };
        createMongoError({ options });
        expect(mongoQueryAndOptionsStringify).toHaveBeenCalledWith(
            expect.objectContaining({ options })
        );
    });
});

describe('MongoMergeError', () => {
    const defaultParams = {
        requestId: 'req-merge-123',
        message: 'Merge error',
        error: new Error('merge inner error'),
        resourceType: 'Patient',
        query: { id: '123' },
        elapsedTime: 3000,
        options: {}
    };

    function createMongoMergeError(overrides = {}) {
        const params = { ...defaultParams, ...overrides };
        return new MongoMergeError(
            params.requestId,
            params.message,
            params.error,
            params.resourceType,
            params.query,
            params.elapsedTime,
            params.options
        );
    }

    test('stores elapsedTimeInSecs correctly (ms to seconds)', () => {
        const err = createMongoMergeError({ elapsedTime: 3000 });
        expect(err.elapsedTimeInSecs).toBe(3);
    });

    test('stores resourceType property (not collection)', () => {
        const err = createMongoMergeError({ resourceType: 'Observation' });
        expect(err.resourceType).toBe('Observation');
    });

    test('stores requestId property', () => {
        const err = createMongoMergeError({ requestId: 'req-merge-789' });
        expect(err.requestId).toBe('req-merge-789');
    });

    test('stores query property', () => {
        const query = { 'meta.source': 'http://example.com' };
        const err = createMongoMergeError({ query });
        expect(err.query).toBe(query);
    });

    test('preserves original_error reference', () => {
        const innerError = new Error('merge conflict');
        const err = createMongoMergeError({ error: innerError });
        expect(err.original_error).toBe(innerError);
    });

    test('propagates statusCode from inner error', () => {
        const innerError = new Error('conflict');
        innerError.statusCode = 409;
        const err = createMongoMergeError({ error: innerError });
        expect(err.statusCode).toBe(409);
    });

    test('spreads options keys onto the instance', () => {
        const options = { upsert: true, writeConcern: { w: 1 } };
        const err = createMongoMergeError({ options });
        expect(err.upsert).toBe(true);
        expect(err.writeConcern).toEqual({ w: 1 });
    });

    test('combines stack traces', () => {
        const innerError = new Error('merge inner stack');
        const err = createMongoMergeError({ error: innerError });
        expect(err.stack).toContain('merge inner stack');
    });

    test('preserves stack_before_rethrow', () => {
        const err = createMongoMergeError();
        expect(err.stack_before_rethrow).toBeDefined();
    });

    test('is an instance of AggregateError', () => {
        const err = createMongoMergeError();
        expect(err).toBeInstanceOf(AggregateError);
    });

    test('calls QueryItem with resourceType instead of collectionName', () => {
        createMongoMergeError({ resourceType: 'Encounter', query: { y: 2 } });
        expect(QueryItem).toHaveBeenCalledWith({
            query: { y: 2 },
            collectionName: null,
            resourceType: 'Encounter'
        });
    });

    test('uses message parameter as the message', () => {
        const err = createMongoMergeError({ message: 'Merge failed' });
        expect(err.message).toBe('Merge failed');
    });

    test('falls back to inner error message when message is empty', () => {
        const innerError = new Error('fallback merge msg');
        const err = createMongoMergeError({ message: '', error: innerError });
        expect(err.message).toBe('fallback merge msg');
    });

    test('uses default empty options when options argument is omitted', () => {
        const innerError = new Error('merge timeout');
        const err = new MongoMergeError(
            'req-merge-no-opts',
            'Merge timeout',
            innerError,
            'Patient',
            { id: '1' },
            4000
        );
        expect(err.options).toEqual({});
    });

    test('handles inner error with empty message string', () => {
        const innerError = new Error('');
        const err = createMongoMergeError({ error: innerError });
        expect(err.original_error).toBe(innerError);
    });

    test('handles multiline message for stack manipulation', () => {
        const err = createMongoMergeError({ message: 'line1\nline2\nline3' });
        expect(err.stack).toBeDefined();
        expect(err.stack_before_rethrow).toBeDefined();
    });

    test('does not add extra properties when options is empty', () => {
        const err = createMongoMergeError({ options: {} });
        const ownKeys = Object.keys(err);
        expect(ownKeys).not.toContain('undefined');
    });

    test('passes options to mongoQueryAndOptionsStringify', () => {
        const options = { sort: { _id: 1 }, limit: 25 };
        createMongoMergeError({ options });
        expect(mongoQueryAndOptionsStringify).toHaveBeenCalledWith(
            expect.objectContaining({ options })
        );
    });

    test('statusCode is undefined when inner error has no statusCode', () => {
        const innerError = new Error('generic merge error');
        const err = createMongoMergeError({ error: innerError });
        expect(err.statusCode).toBeUndefined();
    });
});
