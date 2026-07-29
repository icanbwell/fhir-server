'use strict';

const { describe, test, expect, jest: jestObj } = require('@jest/globals');

jestObj.mock('../../../../../constants', () => ({
    LENIENT_SEARCH_HANDLING: 'lenient',
    STRICT_SEARCH_HANDLING: 'strict'
}));

const { getValidateMissingVariableValuesPlugin } = require('../../../../../middleware/graphql/plugins/graphqlValidateMissingVariableValuesPlugin');

describe('ValidateMissingVariableValuesPlugin', () => {
    const createDocument = (variableNames, defaults = {}) => ({
        definitions: [{
            variableDefinitions: variableNames.map(name => ({
                variable: { name: { value: name } },
                defaultValue: defaults[name] || null
            }))
        }]
    });

    test('getValidateMissingVariableValuesPlugin returns plugin', () => {
        const plugin = getValidateMissingVariableValuesPlugin();
        expect(plugin).toBeDefined();
        expect(plugin.requestDidStart).toBeDefined();
    });

    test('lenient handling does not throw for missing variables', async () => {
        const plugin = getValidateMissingVariableValuesPlugin();
        const handlers = await plugin.requestDidStart({});
        const request = {
            variables: {},
            http: { headers: new Map([['handling', 'lenient']]) }
        };
        const document = createDocument(['id', 'name']);

        expect(() => handlers.didResolveOperation({ request, document })).not.toThrow();
    });

    test('strict handling throws for missing variables', async () => {
        const plugin = getValidateMissingVariableValuesPlugin();
        const handlers = await plugin.requestDidStart({});
        const request = {
            variables: {},
            http: { headers: new Map([['handling', 'strict']]) }
        };
        const document = createDocument(['id', 'name']);

        expect(() => handlers.didResolveOperation({ request, document })).toThrow(
            'Missing variable values: id,name'
        );
    });

    test('strict handling does not throw when all variables provided', async () => {
        const plugin = getValidateMissingVariableValuesPlugin();
        const handlers = await plugin.requestDidStart({});
        const request = {
            variables: { id: '123', name: 'test' },
            http: { headers: new Map([['handling', 'strict']]) }
        };
        const document = createDocument(['id', 'name']);

        expect(() => handlers.didResolveOperation({ request, document })).not.toThrow();
    });

    test('strict handling ignores variables with default values', async () => {
        const plugin = getValidateMissingVariableValuesPlugin();
        const handlers = await plugin.requestDidStart({});
        const request = {
            variables: {},
            http: { headers: new Map([['handling', 'strict']]) }
        };
        const document = createDocument(['id'], { id: { kind: 'StringValue', value: 'default' } });

        expect(() => handlers.didResolveOperation({ request, document })).not.toThrow();
    });

    test('defaults to lenient when no handling header', async () => {
        const plugin = getValidateMissingVariableValuesPlugin();
        const handlers = await plugin.requestDidStart({});
        const request = {
            variables: {},
            http: { headers: new Map() }
        };
        const document = createDocument(['id']);

        expect(() => handlers.didResolveOperation({ request, document })).not.toThrow();
    });

    test('willSendResponse sets status 200 for validation errors', async () => {
        const plugin = getValidateMissingVariableValuesPlugin();
        const handlers = await plugin.requestDidStart({});
        const response = {
            body: {
                kind: 'single',
                singleResult: {
                    errors: [{ extensions: { code: 'GRAPHQL_VALIDATION_FAILED' } }]
                }
            },
            http: { status: 400 }
        };

        await handlers.willSendResponse({ response });

        expect(response.http.status).toBe(200);
    });

    test('willSendResponse does not modify status for non-validation errors', async () => {
        const plugin = getValidateMissingVariableValuesPlugin();
        const handlers = await plugin.requestDidStart({});
        const response = {
            body: {
                kind: 'single',
                singleResult: {
                    errors: [{ extensions: { code: 'INTERNAL_SERVER_ERROR' } }]
                }
            },
            http: { status: 500 }
        };

        await handlers.willSendResponse({ response });

        expect(response.http.status).toBe(500);
    });
});
