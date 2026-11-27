const { describe, test, expect } = require('@jest/globals');
const { GraphQLError } = require('graphql');
const { getGraphQlErrorCode } = require('../../../../middleware/graphql/graphqlErrorCode');
const {
    ForbiddenError, NotFoundError, BadRequestError
} = require('../../../../utils/httpErrors');
const { ServerError } = require('../../../../middleware/fhir/utils/server.error');

const asResolverError = (originalError) => new GraphQLError(originalError.message, {
    path: ['patients'],
    originalError
});

describe('getGraphQlErrorCode', () => {
    test.each([
        ['400', new BadRequestError(new Error('bad')), 'BAD_USER_INPUT'],
        ['401', new ServerError('no auth', { statusCode: 401 }), 'UNAUTHENTICATED'],
        ['403', new ForbiddenError('nope'), 'FORBIDDEN'],
        ['404', new NotFoundError('missing'), 'NOT_FOUND'],
        ['409', new ServerError('dup', { statusCode: 409 }), 'CONFLICT'],
        ['412', new ServerError('stale', { statusCode: 412 }), 'PRECONDITION_FAILED'],
        ['504', new ServerError('slow', { statusCode: 504 }), 'DOWNSTREAM_TIMEOUT'],
        ['500', new ServerError('boom', { statusCode: 500 }), 'INTERNAL_SERVER_ERROR'],
        ['untyped Error', new Error('boom'), 'INTERNAL_SERVER_ERROR']
    ])('resolver error with %s maps to %s', (_name, originalError, expected) => {
        expect(getGraphQlErrorCode(asResolverError(originalError))).toBe(expected);
    });

    test.each(['constructor', '403', null, undefined])('ignores a non-numeric statusCode %p', (statusCode) => {
        const error = new Error('x');
        error.statusCode = statusCode;
        expect(getGraphQlErrorCode(asResolverError(error))).toBe('INTERNAL_SERVER_ERROR');
    });

    test('Mongo wait queue timeout maps to DOWNSTREAM_TIMEOUT', () => {
        const timeout = new Error('Timed out while checking out a connection from connection pool');
        timeout.name = 'MongoWaitQueueTimeoutError';
        expect(getGraphQlErrorCode(asResolverError(timeout))).toBe('DOWNSTREAM_TIMEOUT');
    });

    test('wrapped Mongo wait queue timeout maps to DOWNSTREAM_TIMEOUT', () => {
        const timeout = new Error('timeout');
        timeout.name = 'MongoWaitQueueTimeoutError';
        const wrapper = new Error('query failed');
        wrapper.cause = timeout;
        expect(getGraphQlErrorCode(asResolverError(wrapper))).toBe('DOWNSTREAM_TIMEOUT');
    });

    test('keeps the code Apollo gave to errors that did not come from a resolver', () => {
        const validation = new GraphQLError('invalid', { extensions: { code: 'GRAPHQL_VALIDATION_FAILED' } });
        expect(getGraphQlErrorCode(validation)).toBe('GRAPHQL_VALIDATION_FAILED');
    });

    test('defaults to INTERNAL_SERVER_ERROR when a non-resolver error has no code', () => {
        expect(getGraphQlErrorCode(new GraphQLError('x'))).toBe('INTERNAL_SERVER_ERROR');
    });
});
