const { describe, test, expect, jest: jestObj, beforeEach } = require('@jest/globals');

// Mock assertType
jestObj.mock('../../../../utils/assertType', () => ({
    assertIsValid: jestObj.fn()
}));

// Mock moment-timezone
jestObj.mock('moment-timezone', () => {
    const mockMoment = {
        format: jestObj.fn().mockReturnValue('2024-01-15T10:30:00.000')
    };
    const momentFn = () => mockMoment;
    momentFn.utc = () => mockMoment;
    return momentFn;
});

const { BaseResponseHandler } = require('../../../../utils/responseHandler/baseResponseHandler');

describe('BaseResponseHandler', () => {
    let mockResponse;
    let handler;

    beforeEach(() => {
        mockResponse = {
            status: jestObj.fn().mockReturnThis(),
            json: jestObj.fn().mockReturnThis()
        };
        handler = new BaseResponseHandler({ response: mockResponse, requestId: 'req-123' });
    });

    test('constructor stores response', () => {
        expect(handler.response).toBe(mockResponse);
    });

    test('constructor stores requestId', () => {
        expect(handler.requestId).toBe('req-123');
    });

    describe('setStatusCodeAsync', () => {
        test('calls response.status with the given status code', async () => {
            await handler.setStatusCodeAsync({ statusCode: 200 });
            expect(mockResponse.status).toHaveBeenCalledWith(200);
        });

        test('calls response.status with 404', async () => {
            await handler.setStatusCodeAsync({ statusCode: 404 });
            expect(mockResponse.status).toHaveBeenCalledWith(404);
        });
    });

    describe('sendResponseAsync', () => {
        test('throws Method not implemented error', async () => {
            await expect(handler.sendResponseAsync({}, null)).rejects.toThrow('Method not implemented.');
        });
    });

    describe('writeOperationOutcomeAsync', () => {
        test('builds bundle with correct structure and calls sendResponseAsync', async () => {
            const operationOutcome = { resourceType: 'OperationOutcome', issue: [] };

            // Override sendResponseAsync to capture what it receives
            let capturedBundle;
            handler.sendResponseAsync = jestObj.fn().mockImplementation(async (bundle) => {
                capturedBundle = bundle;
            });

            await handler.writeOperationOutcomeAsync(operationOutcome);

            expect(handler.sendResponseAsync).toHaveBeenCalledTimes(1);
            expect(capturedBundle).toBeDefined();
            expect(capturedBundle.id).toBe('req-123');
            expect(capturedBundle.type).toBe('searchset');
            expect(capturedBundle.resourceType).toBe('Bundle');
            expect(capturedBundle.entry).toEqual([{ resource: operationOutcome }]);
            expect(capturedBundle.timestamp).toMatch(/Z$/);
        });
    });
});
