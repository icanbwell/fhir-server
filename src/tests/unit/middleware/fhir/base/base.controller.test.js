'use strict';

const { describe, test, expect, jest: jestObj, beforeEach } = require('@jest/globals');

jestObj.mock('../../../../../middleware/fhir/base/base.service.js', () => ({
    batch: jestObj.fn(),
    transaction: jestObj.fn(),
    question: jestObj.fn()
}));

const service = require('../../../../../middleware/fhir/base/base.service.js');
const controller = require('../../../../../middleware/fhir/base/base.controller.js');

describe('base.controller', () => {
    let mockReq;
    let mockRes;
    let mockNext;

    beforeEach(() => {
        jestObj.clearAllMocks();
        mockReq = {};
        mockRes = {
            status: jestObj.fn().mockReturnThis(),
            json: jestObj.fn().mockReturnThis()
        };
        mockNext = jestObj.fn();
    });

    describe('batch', () => {
        test('returns 200 with result when service.batch resolves', async () => {
            const result = { resourceType: 'Bundle', type: 'batch-response' };
            service.batch.mockResolvedValue(result);

            const handler = controller.batch();
            await handler(mockReq, mockRes, mockNext);

            expect(service.batch).toHaveBeenCalledWith(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith(result);
            expect(mockNext).not.toHaveBeenCalled();
        });

        test('calls next(err) when service.batch rejects', async () => {
            const error = new Error('Batch failed');
            service.batch.mockRejectedValue(error);

            const handler = controller.batch();
            await handler(mockReq, mockRes, mockNext);

            expect(service.batch).toHaveBeenCalledWith(mockReq, mockRes);
            expect(mockNext).toHaveBeenCalledWith(error);
            expect(mockRes.status).not.toHaveBeenCalled();
        });
    });

    describe('transaction', () => {
        test('returns 200 with result when service.transaction resolves', async () => {
            const result = { resourceType: 'Bundle', type: 'transaction-response' };
            service.transaction.mockResolvedValue(result);

            const handler = controller.transaction();
            await handler(mockReq, mockRes, mockNext);

            expect(service.transaction).toHaveBeenCalledWith(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith(result);
            expect(mockNext).not.toHaveBeenCalled();
        });

        test('calls next(err) when service.transaction rejects', async () => {
            const error = new Error('Transaction failed');
            service.transaction.mockRejectedValue(error);

            const handler = controller.transaction();
            await handler(mockReq, mockRes, mockNext);

            expect(service.transaction).toHaveBeenCalledWith(mockReq, mockRes);
            expect(mockNext).toHaveBeenCalledWith(error);
            expect(mockRes.status).not.toHaveBeenCalled();
        });
    });

    describe('question', () => {
        test('returns 200 with result when service.question resolves', async () => {
            const result = { resourceType: 'Parameters' };
            service.question.mockResolvedValue(result);

            const handler = controller.question();
            await handler(mockReq, mockRes, mockNext);

            expect(service.question).toHaveBeenCalledWith(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith(result);
            expect(mockNext).not.toHaveBeenCalled();
        });

        test('calls next(err) when service.question rejects', async () => {
            const error = new Error('Question failed');
            service.question.mockRejectedValue(error);

            const handler = controller.question();
            await handler(mockReq, mockRes, mockNext);

            expect(service.question).toHaveBeenCalledWith(mockReq, mockRes);
            expect(mockNext).toHaveBeenCalledWith(error);
            expect(mockRes.status).not.toHaveBeenCalled();
        });
    });
});
