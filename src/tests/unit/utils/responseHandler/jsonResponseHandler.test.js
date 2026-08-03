'use strict';

const { describe, test, expect, jest: jestObj, beforeEach } = require('@jest/globals');

// Mock dependencies
jestObj.mock('../../../../fhir/fhirResourceSerializer', () => ({
    FhirResourceSerializer: {
        serialize: jestObj.fn().mockReturnValue({ serialized: true })
    }
}));

jestObj.mock('../../../../fhir/serializers/4_0_0/resources/bundle', () => ({
    serialize: jestObj.fn()
}));

jestObj.mock('../../../../utils/assertType', () => ({
    assertIsValid: jestObj.fn(),
    assertTypeEquals: jestObj.fn()
}));

jestObj.mock('../../../../utils/responseHandler/baseResponseHandler', () => ({
    BaseResponseHandler: class BaseResponseHandler {
        constructor({ response, requestId }) {
            this.response = response;
            this.requestId = requestId;
        }
    }
}));

const { JsonResponseHandler } = require('../../../../utils/responseHandler/jsonResponseHandler');
const { FhirResourceSerializer } = require('../../../../fhir/fhirResourceSerializer');
const BundleSerializer = require('../../../../fhir/serializers/4_0_0/resources/bundle');

describe('JsonResponseHandler', () => {
    let handler;
    let mockResponse;

    beforeEach(() => {
        jestObj.clearAllMocks();

        mockResponse = {
            setHeader: jestObj.fn(),
            send: jestObj.fn()
        };

        handler = new JsonResponseHandler({
            response: mockResponse,
            requestId: 'test-request-id-123'
        });
    });

    describe('sendResponseAsync', () => {
        test('sets Content-Type header to application/fhir+json', async () => {
            const bundle = { entry: [{ resource: {} }] };

            await handler.sendResponseAsync(bundle, null);

            expect(mockResponse.setHeader).toHaveBeenCalledWith('Content-Type', 'application/fhir+json');
        });

        test('sets X-Request-ID header from requestId', async () => {
            const bundle = { entry: [] };

            await handler.sendResponseAsync(bundle, null);

            expect(mockResponse.setHeader).toHaveBeenCalledWith('X-Request-ID', 'test-request-id-123');
        });

        test('sets X-Cache header when cacheStatus is provided', async () => {
            const bundle = { entry: [] };

            await handler.sendResponseAsync(bundle, 'HIT');

            expect(mockResponse.setHeader).toHaveBeenCalledWith('X-Cache', 'HIT');
        });

        test('does not set X-Cache header when cacheStatus is null', async () => {
            const bundle = { entry: [] };

            await handler.sendResponseAsync(bundle, null);

            const cacheHeaderCalls = mockResponse.setHeader.mock.calls.filter(
                call => call[0] === 'X-Cache'
            );
            expect(cacheHeaderCalls).toHaveLength(0);
        });

        test('does not set X-Cache header when cacheStatus is undefined', async () => {
            const bundle = { entry: [] };

            await handler.sendResponseAsync(bundle, undefined);

            const cacheHeaderCalls = mockResponse.setHeader.mock.calls.filter(
                call => call[0] === 'X-Cache'
            );
            expect(cacheHeaderCalls).toHaveLength(0);
        });

        test('sets bundle.entry to empty array if not present', async () => {
            const bundle = {};

            await handler.sendResponseAsync(bundle, null);

            expect(bundle.entry).toEqual([]);
        });

        test('sets bundle.total to entry length', async () => {
            const bundle = { entry: [{ resource: {} }, { resource: {} }, { resource: {} }] };

            await handler.sendResponseAsync(bundle, null);

            expect(bundle.total).toBe(3);
        });

        test('sets bundle.total to 0 for empty entry', async () => {
            const bundle = { entry: [] };

            await handler.sendResponseAsync(bundle, null);

            expect(bundle.total).toBe(0);
        });

        test('calls FhirResourceSerializer.serialize with bundle and BundleSerializer', async () => {
            const bundle = { entry: [{ resource: {} }] };

            await handler.sendResponseAsync(bundle, null);

            expect(FhirResourceSerializer.serialize).toHaveBeenCalledWith(bundle, BundleSerializer);
        });

        test('calls response.send with serialized object', async () => {
            const bundle = { entry: [] };
            FhirResourceSerializer.serialize.mockReturnValue({ resourceType: 'Bundle', total: 0, entry: [] });

            await handler.sendResponseAsync(bundle, null);

            expect(mockResponse.send).toHaveBeenCalledWith({ resourceType: 'Bundle', total: 0, entry: [] });
        });

        test('converts requestId to string for header', async () => {
            handler = new JsonResponseHandler({
                response: mockResponse,
                requestId: 12345
            });

            const bundle = { entry: [] };
            await handler.sendResponseAsync(bundle, null);

            expect(mockResponse.setHeader).toHaveBeenCalledWith('X-Request-ID', '12345');
        });
    });
});
