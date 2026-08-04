'use strict';

const { describe, test, expect, jest: jestObj } = require('@jest/globals');
const { AddRequestIdToResponseHeadersPlugin, getAddRequestIdToResponseHeadersPlugin } = require('../../../../../middleware/graphql/plugins/graphqlAddRequestIdToResponseHeadersPlugin');

describe('AddRequestIdToResponseHeadersPlugin', () => {
    test('getAddRequestIdToResponseHeadersPlugin returns plugin instance', () => {
        const plugin = getAddRequestIdToResponseHeadersPlugin();
        expect(plugin).toBeInstanceOf(AddRequestIdToResponseHeadersPlugin);
    });

    test('sets X-Request-ID from fhirRequestInfo.userRequestId', async () => {
        const plugin = new AddRequestIdToResponseHeadersPlugin();
        const handlers = await plugin.requestDidStart({});
        const headers = new Map();
        const requestContext = {
            contextValue: {
                fhirRequestInfo: { userRequestId: 'req-123' },
                req: { id: 'fallback-id' }
            },
            response: {
                headersSent: false,
                http: { headers }
            }
        };

        handlers.willSendResponse(requestContext);

        expect(headers.get('X-Request-ID')).toBe('req-123');
    });

    test('falls back to req.id when userRequestId is missing', async () => {
        const plugin = new AddRequestIdToResponseHeadersPlugin();
        const handlers = await plugin.requestDidStart({});
        const headers = new Map();
        const requestContext = {
            contextValue: {
                fhirRequestInfo: {},
                req: { id: 'fallback-456' }
            },
            response: {
                headersSent: false,
                http: { headers }
            }
        };

        handlers.willSendResponse(requestContext);

        expect(headers.get('X-Request-ID')).toBe('fallback-456');
    });

    test('does not set header when response is null', async () => {
        const plugin = new AddRequestIdToResponseHeadersPlugin();
        const handlers = await plugin.requestDidStart({});
        const requestContext = {
            contextValue: {
                fhirRequestInfo: { userRequestId: 'req-123' }
            },
            response: null
        };

        expect(() => handlers.willSendResponse(requestContext)).not.toThrow();
    });

    test('does not set header when headersSent is true', async () => {
        const plugin = new AddRequestIdToResponseHeadersPlugin();
        const handlers = await plugin.requestDidStart({});
        const headers = new Map();
        const requestContext = {
            contextValue: {
                fhirRequestInfo: { userRequestId: 'req-789' },
                req: { id: 'req-789' }
            },
            response: {
                headersSent: true,
                http: { headers }
            }
        };

        handlers.willSendResponse(requestContext);

        expect(headers.has('X-Request-ID')).toBe(false);
    });
});
