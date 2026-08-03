const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

jestObj.mock('../../../../utils/assertType', () => ({
    assertTypeEquals: jestObj.fn(),
    assertIsValid: jestObj.fn()
}));

const { AccessIndexManager } = require('../../../../operations/common/accessIndexManager');

describe('AccessIndexManager', () => {
    let manager;
    let mockIndexProvider;
    let mockConfigManager;

    beforeEach(() => {
        jestObj.clearAllMocks();

        mockIndexProvider = {
            hasIndexForAccessCodes: jestObj.fn()
        };
        mockConfigManager = {};

        manager = new AccessIndexManager({
            configManager: mockConfigManager,
            indexProvider: mockIndexProvider
        });
    });

    describe('constructor', () => {
        test('stores configManager and indexProvider', () => {
            expect(manager.configManager).toBe(mockConfigManager);
            expect(manager.indexProvider).toBe(mockIndexProvider);
        });

        test('calls assertTypeEquals for configManager and indexProvider', () => {
            const { assertTypeEquals } = require('../../../../utils/assertType');
            // Constructor was already called in beforeEach, verify assertions happened
            expect(assertTypeEquals).toHaveBeenCalledTimes(2);
        });
    });

    describe('resourceHasAccessIndexForAccessCodes', () => {
        test('returns true when indexProvider confirms index exists', () => {
            mockIndexProvider.hasIndexForAccessCodes.mockReturnValue(true);

            const result = manager.resourceHasAccessIndexForAccessCodes({
                resourceType: 'Patient',
                accessCodes: ['bwell']
            });

            expect(result).toBe(true);
        });

        test('returns false when indexProvider says no index exists', () => {
            mockIndexProvider.hasIndexForAccessCodes.mockReturnValue(false);

            const result = manager.resourceHasAccessIndexForAccessCodes({
                resourceType: 'CustomResource',
                accessCodes: ['bwell']
            });

            expect(result).toBe(false);
        });

        test('passes accessCodes and resourceType to indexProvider in correct format', () => {
            mockIndexProvider.hasIndexForAccessCodes.mockReturnValue(true);

            manager.resourceHasAccessIndexForAccessCodes({
                resourceType: 'Observation',
                accessCodes: ['access-code-1', 'access-code-2']
            });

            expect(mockIndexProvider.hasIndexForAccessCodes).toHaveBeenCalledWith({
                accessCodes: ['access-code-1', 'access-code-2'],
                resourceType: 'Observation'
            });
        });

        test('swaps parameter names: receives resourceType+accessCodes, passes accessCodes+resourceType', () => {
            // The method receives { resourceType, accessCodes } but passes
            // { accessCodes, resourceType } to indexProvider - verifying correct mapping
            mockIndexProvider.hasIndexForAccessCodes.mockReturnValue(true);

            manager.resourceHasAccessIndexForAccessCodes({
                resourceType: 'Patient',
                accessCodes: ['code1', 'code2', 'code3']
            });

            const call = mockIndexProvider.hasIndexForAccessCodes.mock.calls[0][0];
            expect(call).toHaveProperty('accessCodes', ['code1', 'code2', 'code3']);
            expect(call).toHaveProperty('resourceType', 'Patient');
        });

        test('handles multiple access codes', () => {
            mockIndexProvider.hasIndexForAccessCodes.mockReturnValue(true);

            const result = manager.resourceHasAccessIndexForAccessCodes({
                resourceType: 'Patient',
                accessCodes: ['bwell', 'client-abc', 'client-xyz']
            });

            expect(result).toBe(true);
            expect(mockIndexProvider.hasIndexForAccessCodes).toHaveBeenCalledWith({
                accessCodes: ['bwell', 'client-abc', 'client-xyz'],
                resourceType: 'Patient'
            });
        });

        test('handles single access code', () => {
            mockIndexProvider.hasIndexForAccessCodes.mockReturnValue(true);

            const result = manager.resourceHasAccessIndexForAccessCodes({
                resourceType: 'Condition',
                accessCodes: ['single-code']
            });

            expect(result).toBe(true);
        });

        test('handles empty accessCodes array', () => {
            mockIndexProvider.hasIndexForAccessCodes.mockReturnValue(true);

            const result = manager.resourceHasAccessIndexForAccessCodes({
                resourceType: 'Patient',
                accessCodes: []
            });

            // Delegates to indexProvider which determines behavior for empty array
            expect(mockIndexProvider.hasIndexForAccessCodes).toHaveBeenCalledWith({
                accessCodes: [],
                resourceType: 'Patient'
            });
            expect(result).toBe(true);
        });

        test('delegates entirely to indexProvider for return value', () => {
            // The method is a pure delegate - it does not add its own logic
            mockIndexProvider.hasIndexForAccessCodes.mockReturnValue(false);

            const result1 = manager.resourceHasAccessIndexForAccessCodes({
                resourceType: 'Patient',
                accessCodes: ['bwell']
            });
            expect(result1).toBe(false);

            mockIndexProvider.hasIndexForAccessCodes.mockReturnValue(true);

            const result2 = manager.resourceHasAccessIndexForAccessCodes({
                resourceType: 'Patient',
                accessCodes: ['bwell']
            });
            expect(result2).toBe(true);
        });

        test('returns the exact boolean value from indexProvider without coercion', () => {
            // Verifying no truthiness coercion - exact value passthrough
            mockIndexProvider.hasIndexForAccessCodes.mockReturnValue(false);

            const result = manager.resourceHasAccessIndexForAccessCodes({
                resourceType: 'Patient',
                accessCodes: ['x']
            });

            expect(result).toStrictEqual(false);
        });
    });
});
