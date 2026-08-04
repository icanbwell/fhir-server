'use strict';

const { describe, test, expect, jest: jestObj } = require('@jest/globals');

jestObj.mock('../../../../../operations/common/logging', () => ({
    logInfo: jestObj.fn(),
    logError: jestObj.fn()
}));

const { getApolloServerLoggingPlugin } = require('../../../../../middleware/graphql/plugins/graphqlLoggingPlugin');
const { logInfo, logError } = require('../../../../../operations/common/logging');

describe('graphqlLoggingPlugin', () => {
    test('getApolloServerLoggingPlugin returns plugin with endpoint', () => {
        const plugin = getApolloServerLoggingPlugin('/graphql');
        expect(plugin).toBeDefined();
        expect(plugin.endpoint).toBe('/graphql');
    });

    test('requestDidStart logs GraphQL Request Received', async () => {
        const plugin = getApolloServerLoggingPlugin('/4_0_0/graphql');
        const requestContext = {
            contextValue: { user: 'test-user' },
            request: { operationName: 'GetPatient', query: '{ patient { id } }' }
        };

        await plugin.requestDidStart(requestContext);

        expect(logInfo).toHaveBeenCalledWith('GraphQL Request Received', expect.objectContaining({
            user: 'test-user',
            args: expect.objectContaining({
                endpoint: '/4_0_0/graphql',
                operationName: 'GetPatient'
            })
        }));
    });

    test('parsingDidStart returns error handler that logs on error', async () => {
        const plugin = getApolloServerLoggingPlugin('/graphql');
        const requestContext = {
            contextValue: { user: null },
            request: { operationName: 'Q', query: 'bad' }
        };

        const handlers = await plugin.requestDidStart(requestContext);
        const parsingDone = await handlers.parsingDidStart();
        await parsingDone(new Error('Parse error'));

        expect(logInfo).toHaveBeenCalledWith('GraphQL Request Parsing Error', expect.anything());
    });

    test('parsingDidStart error handler does nothing without error', async () => {
        const plugin = getApolloServerLoggingPlugin('/graphql');
        const requestContext = {
            contextValue: {},
            request: { operationName: 'Q', query: '{}' }
        };

        logInfo.mockClear();
        const handlers = await plugin.requestDidStart(requestContext);
        logInfo.mockClear();
        const parsingDone = await handlers.parsingDidStart();
        await parsingDone(null);

        expect(logInfo).not.toHaveBeenCalledWith('GraphQL Request Parsing Error', expect.anything());
    });

    test('validationDidStart returns error handler that logs multiple errors', async () => {
        const plugin = getApolloServerLoggingPlugin('/graphql');
        const requestContext = {
            contextValue: { user: 'u' },
            request: { operationName: 'Q', query: '{}' }
        };

        const handlers = await plugin.requestDidStart(requestContext);
        const validationDone = await handlers.validationDidStart();
        await validationDone([new Error('err1'), new Error('err2')]);

        expect(logInfo).toHaveBeenCalledWith(expect.stringContaining('Validation Error: err1'), expect.anything());
        expect(logInfo).toHaveBeenCalledWith(expect.stringContaining('Validation Error: err2'), expect.anything());
    });

    test('executionDidStart returns executionDidEnd that logs on error', async () => {
        const plugin = getApolloServerLoggingPlugin('/graphql');
        const requestContext = {
            contextValue: { user: null },
            request: { operationName: 'Q', query: '{}' }
        };

        const handlers = await plugin.requestDidStart(requestContext);
        const execHandlers = await handlers.executionDidStart();
        await execHandlers.executionDidEnd(new Error('exec error'));

        expect(logError).toHaveBeenCalledWith(expect.stringContaining('Execution Error: exec error'), expect.anything());
    });

    test('executionDidEnd does nothing without error', async () => {
        const plugin = getApolloServerLoggingPlugin('/graphql');
        const requestContext = {
            contextValue: {},
            request: { operationName: 'Q', query: '{}' }
        };

        logError.mockClear();
        const handlers = await plugin.requestDidStart(requestContext);
        const execHandlers = await handlers.executionDidStart();
        await execHandlers.executionDidEnd(null);

        expect(logError).not.toHaveBeenCalled();
    });
});
