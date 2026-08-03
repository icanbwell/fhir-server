const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

jestObj.mock('../../../utils/assertType', () => ({
    assertTypeEquals: jestObj.fn(),
    assertIsValid: jestObj.fn()
}));

const { BaseResponseStreamer } = require('../../../utils/baseResponseStreamer');

describe('BaseResponseStreamer', () => {
    let mockResponse;

    beforeEach(() => {
        mockResponse = {
            status: jestObj.fn().mockReturnThis(),
            write: jestObj.fn(),
            end: jestObj.fn()
        };
    });

    describe('constructor', () => {
        test('stores response and requestId', () => {
            const streamer = new BaseResponseStreamer({
                response: mockResponse,
                requestId: 'req-123'
            });

            expect(streamer.response).toBe(mockResponse);
            expect(streamer.requestId).toBe('req-123');
        });

        test('calls assertIsValid with the response', () => {
            const { assertIsValid } = require('../../../utils/assertType');
            new BaseResponseStreamer({
                response: mockResponse,
                requestId: 'req-456'
            });

            expect(assertIsValid).toHaveBeenCalledWith(mockResponse);
        });
    });

    describe('startAsync', () => {
        test('throws Method not implemented error', async () => {
            const streamer = new BaseResponseStreamer({
                response: mockResponse,
                requestId: 'req-123'
            });

            await expect(streamer.startAsync()).rejects.toThrow('Method not implemented.');
        });
    });

    describe('writeBundleEntryAsync', () => {
        test('throws Method not implemented error', async () => {
            const streamer = new BaseResponseStreamer({
                response: mockResponse,
                requestId: 'req-123'
            });

            await expect(streamer.writeBundleEntryAsync({ bundleEntry: {} })).rejects.toThrow('Method not implemented.');
        });
    });

    describe('writeAsync', () => {
        test('does not throw when called (optional override)', async () => {
            const streamer = new BaseResponseStreamer({
                response: mockResponse,
                requestId: 'req-123'
            });

            await expect(streamer.writeAsync({ content: 'some content' })).resolves.toBeUndefined();
        });
    });

    describe('setBundle', () => {
        test('does not throw when called (optional override)', () => {
            const streamer = new BaseResponseStreamer({
                response: mockResponse,
                requestId: 'req-123'
            });

            expect(() => streamer.setBundle({ bundle: {} })).not.toThrow();
        });
    });

    describe('setStatusCodeAsync', () => {
        test('calls response.status with the given status code', async () => {
            const streamer = new BaseResponseStreamer({
                response: mockResponse,
                requestId: 'req-123'
            });

            await streamer.setStatusCodeAsync({ statusCode: 200 });
            expect(mockResponse.status).toHaveBeenCalledWith(200);
        });

        test('sets 404 status code', async () => {
            const streamer = new BaseResponseStreamer({
                response: mockResponse,
                requestId: 'req-123'
            });

            await streamer.setStatusCodeAsync({ statusCode: 404 });
            expect(mockResponse.status).toHaveBeenCalledWith(404);
        });

        test('sets 500 status code', async () => {
            const streamer = new BaseResponseStreamer({
                response: mockResponse,
                requestId: 'req-123'
            });

            await streamer.setStatusCodeAsync({ statusCode: 500 });
            expect(mockResponse.status).toHaveBeenCalledWith(500);
        });
    });

    describe('endAsync', () => {
        test('throws Method not implemented error', async () => {
            const streamer = new BaseResponseStreamer({
                response: mockResponse,
                requestId: 'req-123'
            });

            await expect(streamer.endAsync()).rejects.toThrow('Method not implemented.');
        });
    });
});
