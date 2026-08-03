'use strict';

const { describe, test, expect, jest: jestObj, beforeEach } = require('@jest/globals');

// Mock the winston logger
jestObj.mock('../../../../../winstonInit', () => ({
    getLogger: () => ({
        info: jestObj.fn(),
        error: jestObj.fn(),
        warn: jestObj.fn(),
        debug: jestObj.fn()
    })
}));

// Mock superagent
const mockSuperagentRequest = {
    send: jestObj.fn().mockReturnThis(),
    set: jestObj.fn().mockReturnThis()
};

jestObj.mock('superagent', () => ({
    get: jestObj.fn().mockReturnValue(mockSuperagentRequest),
    post: jestObj.fn().mockReturnValue(mockSuperagentRequest),
    put: jestObj.fn().mockReturnValue(mockSuperagentRequest),
    delete: jestObj.fn().mockReturnValue(mockSuperagentRequest)
}));

// Mock the FHIR resource schemas
jestObj.mock('../../../../../middleware/fhir/resources/4_0_0/schemas/bundle', () => {
    return function Bundle(props) {
        Object.assign(this, props);
    };
}, { virtual: true });

jestObj.mock('../../../../../middleware/fhir/resources/4_0_0/schemas/bundlelink', () => {
    return function BundleLink(props) {
        Object.assign(this, props);
    };
}, { virtual: true });

jestObj.mock('../../../../../middleware/fhir/resources/4_0_0/schemas/bundleentry', () => {
    return function BundleEntry(props) {
        Object.assign(this, props);
    };
}, { virtual: true });

// Mock error utils
jestObj.mock('../../../../../middleware/fhir/utils/error.utils', () => ({
    internal: jestObj.fn((message, version) => {
        const err = new Error(message);
        err.statusCode = 500;
        return err;
    })
}));

const { batch, transaction, question } = require('../../../../../middleware/fhir/base/base.service');
const errors = require('../../../../../middleware/fhir/utils/error.utils');

describe('base.service', () => {
    let mockReq;
    let mockRes;

    beforeEach(() => {
        jestObj.clearAllMocks();

        mockReq = {
            protocol: 'https',
            baseUrl: '/fhir',
            headers: {
                host: 'localhost:3000'
            },
            params: {
                base_version: '4_0_0'
            },
            body: {
                resourceType: 'Bundle',
                type: 'batch',
                entry: []
            },
            get: jestObj.fn().mockReturnValue('localhost:3000')
        };

        mockRes = {
            req: {
                protocol: 'https',
                baseUrl: '/fhir',
                get: jestObj.fn().mockReturnValue('localhost:3000')
            }
        };
    });

    describe('batch', () => {
        test('rejects when resourceType is not Bundle', async () => {
            mockReq.body.resourceType = 'Patient';

            await expect(batch(mockReq, mockRes)).rejects.toThrow(
                "Expected 'resourceType: Bundle'. Received 'resourceType: Patient'."
            );

            expect(errors.internal).toHaveBeenCalledWith(
                expect.stringContaining('Patient'),
                '4_0_0'
            );
        });

        test('rejects when type is not batch', async () => {
            mockReq.body.type = 'transaction';

            await expect(batch(mockReq, mockRes)).rejects.toThrow(
                "Expected 'type: batch'. Received 'type: transaction'."
            );
        });

        test('resolves with a bundle when entries are empty', async () => {
            mockReq.body.entry = [];

            const result = await batch(mockReq, mockRes);

            expect(result).toBeDefined();
            expect(result.type).toBe('batch');
            expect(result.total).toBe(0);
        });

        test('processes entries and creates request promises', async () => {
            const superagent = require('superagent');
            // Make the mocked send/set chain resolve to a response
            mockSuperagentRequest.set.mockReturnValue(
                Promise.resolve({ status: 200 })
            );

            mockReq.body.entry = [
                {
                    request: { url: 'Patient/1', method: 'GET' },
                    resource: null
                }
            ];

            const result = await batch(mockReq, mockRes);

            expect(superagent.get).toHaveBeenCalled();
            expect(result.total).toBe(1);
        });

        test('handles request errors gracefully', async () => {
            const superagent = require('superagent');
            superagent.get.mockReturnValue({
                send: jestObj.fn().mockReturnValue({
                    set: jestObj.fn().mockReturnValue(
                        Promise.reject({ status: 404, message: 'Not Found' })
                    )
                })
            });

            mockReq.body.entry = [
                {
                    request: { url: 'Patient/999', method: 'GET' },
                    resource: null
                }
            ];

            // The service catches errors in the promise chain, so it should still resolve
            const result = await batch(mockReq, mockRes);

            expect(result).toBeDefined();
            expect(result.total).toBe(1);
        });
    });

    describe('transaction', () => {
        test('rejects when resourceType is not Bundle', async () => {
            mockReq.body.resourceType = 'Patient';
            mockReq.body.type = 'transaction';

            await expect(transaction(mockReq, mockRes)).rejects.toThrow(
                "Expected 'resourceType: Bundle'. Received 'resourceType: Patient'."
            );
        });

        test('rejects when type is not transaction', async () => {
            mockReq.body.type = 'batch';

            await expect(transaction(mockReq, mockRes)).rejects.toThrow(
                "Expected 'type: transaction'. Received 'type: batch'."
            );
        });

        test('resolves with bundle when entries are empty', async () => {
            mockReq.body.type = 'transaction';
            mockReq.body.entry = [];

            const result = await transaction(mockReq, mockRes);

            expect(result).toBeDefined();
            expect(result.type).toBe('transaction');
            expect(result.total).toBe(0);
        });

        test('processes POST entries correctly', async () => {
            const superagent = require('superagent');
            superagent.post.mockReturnValue({
                send: jestObj.fn().mockReturnValue({
                    set: jestObj.fn().mockReturnValue(
                        Promise.resolve({ status: 201 })
                    )
                })
            });

            mockReq.body.type = 'transaction';
            mockReq.body.entry = [
                {
                    request: { url: 'Patient', method: 'POST' },
                    resource: { resourceType: 'Patient', name: [{ family: 'Smith' }] }
                }
            ];

            const result = await transaction(mockReq, mockRes);

            expect(superagent.post).toHaveBeenCalled();
            expect(result.total).toBe(1);
        });
    });

    describe('question', () => {
        test('resolves with empty object', async () => {
            const result = await question(mockReq, mockRes);

            expect(result).toEqual({});
        });

        test('does not throw errors', async () => {
            await expect(question(mockReq, mockRes)).resolves.not.toThrow();
        });
    });
});
