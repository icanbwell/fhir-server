const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

const { OperationAccessManager } = require('../../../utils/operationAccessManager');

describe('OperationAccessManager', () => {
    let manager;
    let mockProvider1;
    let mockProvider2;
    let mockProvider3;

    beforeEach(() => {
        jestObj.clearAllMocks();

        mockProvider1 = { verifyAccess: jestObj.fn() };
        mockProvider2 = { verifyAccess: jestObj.fn() };
        mockProvider3 = { verifyAccess: jestObj.fn() };
    });

    describe('constructor', () => {
        test('stores accessProviders array', () => {
            manager = new OperationAccessManager({
                accessProviders: [mockProvider1, mockProvider2]
            });

            expect(manager.accessProviders).toHaveLength(2);
            expect(manager.accessProviders[0]).toBe(mockProvider1);
            expect(manager.accessProviders[1]).toBe(mockProvider2);
        });

        test('stores empty accessProviders array', () => {
            manager = new OperationAccessManager({
                accessProviders: []
            });

            expect(manager.accessProviders).toHaveLength(0);
        });

        test('stores single provider', () => {
            manager = new OperationAccessManager({
                accessProviders: [mockProvider1]
            });

            expect(manager.accessProviders).toHaveLength(1);
        });
    });

    describe('verifyAccess', () => {
        test('calls all providers with correct arguments', () => {
            manager = new OperationAccessManager({
                accessProviders: [mockProvider1, mockProvider2, mockProvider3]
            });

            const requestInfo = { scope: 'patient/*.read', user: 'test-user' };
            const resourceType = 'Patient';
            const operation = 'read';

            manager.verifyAccess({ requestInfo, resourceType, operation });

            expect(mockProvider1.verifyAccess).toHaveBeenCalledWith({
                requestInfo,
                resourceType,
                operation
            });
            expect(mockProvider2.verifyAccess).toHaveBeenCalledWith({
                requestInfo,
                resourceType,
                operation
            });
            expect(mockProvider3.verifyAccess).toHaveBeenCalledWith({
                requestInfo,
                resourceType,
                operation
            });
        });

        test('calls providers in order', () => {
            const callOrder = [];
            mockProvider1.verifyAccess.mockImplementation(() => callOrder.push(1));
            mockProvider2.verifyAccess.mockImplementation(() => callOrder.push(2));
            mockProvider3.verifyAccess.mockImplementation(() => callOrder.push(3));

            manager = new OperationAccessManager({
                accessProviders: [mockProvider1, mockProvider2, mockProvider3]
            });

            manager.verifyAccess({
                requestInfo: {},
                resourceType: 'Patient',
                operation: 'read'
            });

            expect(callOrder).toEqual([1, 2, 3]);
        });

        test('throws when first provider denies access', () => {
            const forbiddenError = new Error('Access denied by provider 1');
            forbiddenError.statusCode = 403;
            mockProvider1.verifyAccess.mockImplementation(() => { throw forbiddenError; });

            manager = new OperationAccessManager({
                accessProviders: [mockProvider1, mockProvider2]
            });

            expect(() => {
                manager.verifyAccess({
                    requestInfo: { scope: 'user/*.write' },
                    resourceType: 'Patient',
                    operation: 'create'
                });
            }).toThrow('Access denied by provider 1');

            // Second provider should NOT be called since first threw
            expect(mockProvider2.verifyAccess).not.toHaveBeenCalled();
        });

        test('throws when second provider denies access after first allows', () => {
            const forbiddenError = new Error('Access denied by provider 2');
            mockProvider2.verifyAccess.mockImplementation(() => { throw forbiddenError; });

            manager = new OperationAccessManager({
                accessProviders: [mockProvider1, mockProvider2, mockProvider3]
            });

            expect(() => {
                manager.verifyAccess({
                    requestInfo: {},
                    resourceType: 'Observation',
                    operation: 'search'
                });
            }).toThrow('Access denied by provider 2');

            // First was called, second threw, third should NOT be called
            expect(mockProvider1.verifyAccess).toHaveBeenCalledTimes(1);
            expect(mockProvider2.verifyAccess).toHaveBeenCalledTimes(1);
            expect(mockProvider3.verifyAccess).not.toHaveBeenCalled();
        });

        test('does not throw when all providers allow access', () => {
            manager = new OperationAccessManager({
                accessProviders: [mockProvider1, mockProvider2, mockProvider3]
            });

            expect(() => {
                manager.verifyAccess({
                    requestInfo: { scope: 'patient/*.read' },
                    resourceType: 'Patient',
                    operation: 'read'
                });
            }).not.toThrow();
        });

        test('succeeds with empty providers array (no checks performed)', () => {
            manager = new OperationAccessManager({
                accessProviders: []
            });

            expect(() => {
                manager.verifyAccess({
                    requestInfo: {},
                    resourceType: 'Patient',
                    operation: 'read'
                });
            }).not.toThrow();
        });

        test('passes different operation types correctly', () => {
            manager = new OperationAccessManager({
                accessProviders: [mockProvider1]
            });

            const operations = ['read', 'create', 'update', 'delete', 'search', 'vread'];

            for (const operation of operations) {
                mockProvider1.verifyAccess.mockClear();
                manager.verifyAccess({
                    requestInfo: { scope: 'system/*.*' },
                    resourceType: 'Patient',
                    operation
                });
                expect(mockProvider1.verifyAccess).toHaveBeenCalledWith(
                    expect.objectContaining({ operation })
                );
            }
        });

        test('passes different resource types correctly', () => {
            manager = new OperationAccessManager({
                accessProviders: [mockProvider1]
            });

            const resourceTypes = ['Patient', 'Observation', 'Condition', 'MedicationRequest'];

            for (const resourceType of resourceTypes) {
                mockProvider1.verifyAccess.mockClear();
                manager.verifyAccess({
                    requestInfo: {},
                    resourceType,
                    operation: 'read'
                });
                expect(mockProvider1.verifyAccess).toHaveBeenCalledWith(
                    expect.objectContaining({ resourceType })
                );
            }
        });

        test('propagates the exact error thrown by the provider', () => {
            class ForbiddenError extends Error {
                constructor(message) {
                    super(message);
                    this.statusCode = 403;
                    this.name = 'ForbiddenError';
                }
            }

            const error = new ForbiddenError('Insufficient scope for Patient/read');
            mockProvider1.verifyAccess.mockImplementation(() => { throw error; });

            manager = new OperationAccessManager({
                accessProviders: [mockProvider1]
            });

            try {
                manager.verifyAccess({
                    requestInfo: {},
                    resourceType: 'Patient',
                    operation: 'read'
                });
                // Should not reach here
                expect(true).toBe(false);
            } catch (e) {
                expect(e).toBe(error);
                expect(e.statusCode).toBe(403);
                expect(e.name).toBe('ForbiddenError');
            }
        });

        test('each provider receives the same requestInfo object reference', () => {
            manager = new OperationAccessManager({
                accessProviders: [mockProvider1, mockProvider2]
            });

            const requestInfo = { scope: 'user/*.read', user: 'admin' };

            manager.verifyAccess({
                requestInfo,
                resourceType: 'Patient',
                operation: 'read'
            });

            const call1Args = mockProvider1.verifyAccess.mock.calls[0][0];
            const call2Args = mockProvider2.verifyAccess.mock.calls[0][0];
            expect(call1Args.requestInfo).toBe(requestInfo);
            expect(call2Args.requestInfo).toBe(requestInfo);
        });
    });
});
