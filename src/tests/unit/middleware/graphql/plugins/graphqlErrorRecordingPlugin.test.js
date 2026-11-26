const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');
const { GraphQLError } = require('graphql');
const { trace, SpanStatusCode } = require('@opentelemetry/api');

jestObj.mock('../../../../../operations/common/logging', () => ({
    logError: jestObj.fn()
}));

const { getApolloServerErrorRecordingPlugin } = require('../../../../../middleware/graphql/plugins/graphqlErrorRecordingPlugin');
const { logError } = require('../../../../../operations/common/logging');
const metrics = require('../../../../../utils/metrics');
const { ForbiddenError } = require('../../../../../utils/httpErrors');

const resolverError = (originalError, path = ['patients', 0, 'name']) => new GraphQLError(
    originalError.message,
    { path, originalError }
);

const rootField = (name, alias) => ({
    kind: 'Field',
    name: { value: name },
    ...(alias ? { alias: { value: alias } } : {})
});

const startRequest = async (operation = 'query', selections = [rootField('patients')]) => {
    const plugin = getApolloServerErrorRecordingPlugin('graphqlv2');
    return plugin.requestDidStart({ operation: { operation, selectionSet: { selections } } });
};

describe('graphqlErrorRecordingPlugin', () => {
    let errorsAdd;
    let partialAdd;
    let setStatus;

    beforeEach(() => {
        jestObj.clearAllMocks();
        errorsAdd = jestObj.spyOn(metrics.graphqlErrorsCounter, 'add').mockImplementation(() => {});
        partialAdd = jestObj.spyOn(metrics.graphqlPartialResponsesCounter, 'add').mockImplementation(() => {});
        setStatus = jestObj.fn();
        jestObj.spyOn(trace, 'getActiveSpan').mockReturnValue({ setStatus });
    });

    test('didEncounterErrors counts, logs and marks the span for a resolver error', async () => {
        const listener = await startRequest();

        await listener.didEncounterErrors({
            request: { operationName: 'GetPatients', query: '{ patients(name: "SECRET") { id } }' },
            errors: [resolverError(new ForbiddenError('no access for SECRET'))]
        });

        expect(errorsAdd).toHaveBeenCalledWith(1, {
            endpoint: 'graphqlv2',
            operation_type: 'query',
            code: 'FORBIDDEN',
            root_field: 'patients'
        });
        expect(setStatus).toHaveBeenCalledWith(expect.objectContaining({ code: SpanStatusCode.ERROR }));
        expect(logError).toHaveBeenCalledTimes(1);
        const logged = JSON.stringify(logError.mock.calls[0]);
        expect(logged).toContain('GetPatients');
        expect(logged).toContain('FORBIDDEN');
        expect(logged).toContain('patients.0.name');
        // neither the query text/variables nor the error message may reach the log
        expect(logged).not.toContain('SECRET');
    });

    test.each([
        ['an aliased root field', [rootField('patient', 'p_12345')], 'p_12345', 'patient'],
        ['a root field not in the selection', [rootField('patient')], 'invented', 'unknown']
    ])('root_field label for %s uses the schema field name, never the client alias', async (_n, selections, key, expected) => {
        const listener = await startRequest('query', selections);
        await listener.didEncounterErrors({
            request: {},
            errors: [resolverError(new Error('x'), [key])]
        });

        expect(errorsAdd).toHaveBeenCalledWith(1, expect.objectContaining({ root_field: expected }));
    });

    test('didEncounterErrors uses unknown labels when there is no path or operation name', async () => {
        const listener = await startRequest();
        await listener.didEncounterErrors({
            request: {},
            errors: [new GraphQLError('bad query', { extensions: { code: 'GRAPHQL_VALIDATION_FAILED' } })]
        });

        expect(errorsAdd).toHaveBeenCalledWith(1, expect.objectContaining({
            code: 'GRAPHQL_VALIDATION_FAILED',
            root_field: 'unknown'
        }));
    });

    test('didEncounterErrors counts each error', async () => {
        const listener = await startRequest('mutation', [rootField('one'), rootField('two')]);
        await listener.didEncounterErrors({
            request: { operationName: 'M' },
            errors: [resolverError(new Error('a'), ['one']), resolverError(new Error('b'), ['two'])]
        });

        expect(errorsAdd).toHaveBeenCalledTimes(2);
        expect(errorsAdd).toHaveBeenCalledWith(1, expect.objectContaining({
            operation_type: 'mutation', code: 'INTERNAL_SERVER_ERROR', root_field: 'two'
        }));
    });

    test('didEncounterErrors does not fail when there is no active span', async () => {
        trace.getActiveSpan.mockReturnValue(undefined);
        const listener = await startRequest();

        await expect(listener.didEncounterErrors({
            request: {}, errors: [resolverError(new Error('x'))]
        })).resolves.toBeUndefined();
        expect(errorsAdd).toHaveBeenCalledTimes(1);
    });

    test.each([
        ['data and errors', { data: { a: null }, errors: [{ message: 'x' }] }, 1],
        ['errors only', { errors: [{ message: 'x' }] }, 0],
        ['data only', { data: { a: 1 } }, 0],
        ['data and empty errors', { data: { a: 1 }, errors: [] }, 0]
    ])('willSendResponse counts partial responses for %s', async (_name, singleResult, expected) => {
        const listener = await startRequest();
        await listener.willSendResponse({ response: { body: { kind: 'single', singleResult } } });

        expect(partialAdd).toHaveBeenCalledTimes(expected);
    });

    test('willSendResponse ignores incremental responses', async () => {
        const listener = await startRequest();
        await listener.willSendResponse({ response: { body: { kind: 'incremental' } } });

        expect(partialAdd).not.toHaveBeenCalled();
    });
});
