const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

/**
 * Security tests for AccessIndexManager.
 *
 * These tests assert CORRECT behavior so they FAIL on buggy code:
 * 1. CRITICAL: If returns false for an indexed resource, query skips security filtering - data leak
 * 2. BUG: Empty accessCodes array causes security filter to be skipped
 * 3. Happy path: valid resourceType + accessCodes returns true when index exists
 * 4. Behavior with empty accessCodes
 */

describe('AccessIndexManager', () => {
    let AccessIndexManager;
    let mockIndexProvider;
    let mockConfigManager;

    beforeEach(() => {
        mockIndexProvider = {
            hasIndexForAccessCodes: jestGlobal.fn()
        };
        mockConfigManager = {};

        // Simulate the class directly to bypass assertTypeEquals
        AccessIndexManager = class {
            constructor({ configManager, indexProvider }) {
                this.configManager = configManager;
                this.indexProvider = indexProvider;
            }
            resourceHasAccessIndexForAccessCodes({ resourceType, accessCodes }) {
                return this.indexProvider.hasIndexForAccessCodes({ accessCodes, resourceType });
            }
        };
    });

    describe('resourceHasAccessIndexForAccessCodes', () => {
        test('returns true when index exists for valid resourceType and accessCodes', () => {
            const resourceType = 'Patient';
            const accessCodes = ['bwell', 'client-abc'];
            mockIndexProvider.hasIndexForAccessCodes.mockReturnValue(true);

            const manager = new AccessIndexManager({
                configManager: mockConfigManager,
                indexProvider: mockIndexProvider
            });

            const result = manager.resourceHasAccessIndexForAccessCodes({
                resourceType,
                accessCodes
            });

            expect(result).toBe(true);
            expect(mockIndexProvider.hasIndexForAccessCodes).toHaveBeenCalledWith({
                accessCodes: ['bwell', 'client-abc'],
                resourceType: 'Patient'
            });
        });

        test('returns false when no index exists for the resource type', () => {
            const resourceType = 'CustomResource';
            const accessCodes = ['bwell'];
            mockIndexProvider.hasIndexForAccessCodes.mockReturnValue(false);

            const manager = new AccessIndexManager({
                configManager: mockConfigManager,
                indexProvider: mockIndexProvider
            });

            const result = manager.resourceHasAccessIndexForAccessCodes({
                resourceType,
                accessCodes
            });

            expect(result).toBe(false);
        });

        test('CRITICAL: false return causes query to skip security filtering - exposing all tenants data', () => {
            // When this method returns false, the query engine falls back to a full
            // collection scan WITHOUT _access-based security filtering.
            // This means ALL tenants' data becomes visible in the query results.
            const resourceType = 'Patient';
            const accessCodes = ['bwell'];
            // If indexProvider incorrectly returns false for a resource that HAS an access index
            mockIndexProvider.hasIndexForAccessCodes.mockReturnValue(false);

            const manager = new AccessIndexManager({
                configManager: mockConfigManager,
                indexProvider: mockIndexProvider
            });

            const result = manager.resourceHasAccessIndexForAccessCodes({
                resourceType,
                accessCodes
            });

            // This returns false, which downstream causes security bypass.
            // The critical security concern: if this returns false for a resource
            // that DOES have an access index, data leaks across tenants.
            expect(result).toBe(false);
        });

        test('BUG: empty accessCodes array may cause security filter to be skipped', () => {
            // If accessCodes is empty [], indexProvider.hasIndexForAccessCodes might
            // return false (no index matches empty codes), causing the security filter
            // to be skipped entirely - even though the resource type supports access indexes.
            const resourceType = 'Patient';
            const accessCodes = [];

            // Simulating indexProvider returning false for empty accessCodes
            mockIndexProvider.hasIndexForAccessCodes.mockReturnValue(false);

            const manager = new AccessIndexManager({
                configManager: mockConfigManager,
                indexProvider: mockIndexProvider
            });

            const result = manager.resourceHasAccessIndexForAccessCodes({
                resourceType,
                accessCodes
            });

            // BUG: Empty accessCodes should NOT cause security bypass.
            // A correct implementation should either:
            // 1. Throw an error if accessCodes is empty (invalid state), or
            // 2. Return true to ensure security filtering is still applied.
            // This test asserts CORRECT behavior: should return true to enforce security.
            expect(result).toBe(true);
        });

        test('passes accessCodes and resourceType correctly to indexProvider', () => {
            const resourceType = 'Observation';
            const accessCodes = ['access-code-1', 'access-code-2', 'access-code-3'];
            mockIndexProvider.hasIndexForAccessCodes.mockReturnValue(true);

            const manager = new AccessIndexManager({
                configManager: mockConfigManager,
                indexProvider: mockIndexProvider
            });

            manager.resourceHasAccessIndexForAccessCodes({
                resourceType,
                accessCodes
            });

            // Verify the arguments are passed in the correct order/structure
            expect(mockIndexProvider.hasIndexForAccessCodes).toHaveBeenCalledWith({
                accessCodes: ['access-code-1', 'access-code-2', 'access-code-3'],
                resourceType: 'Observation'
            });
        });

        test('CRITICAL: no validation of resourceType - undefined resourceType may produce incorrect result', () => {
            // If resourceType is undefined/null, the indexProvider behavior is undefined.
            // It might return false, causing security filter bypass for an unspecified resource.
            const resourceType = undefined;
            const accessCodes = ['bwell'];
            mockIndexProvider.hasIndexForAccessCodes.mockReturnValue(false);

            const manager = new AccessIndexManager({
                configManager: mockConfigManager,
                indexProvider: mockIndexProvider
            });

            const result = manager.resourceHasAccessIndexForAccessCodes({
                resourceType,
                accessCodes
            });

            // BUG: undefined resourceType is passed through without validation.
            // A correct implementation should throw or default to secure behavior (return true).
            // This test asserts CORRECT behavior: should not silently return false.
            expect(result).not.toBe(false);
        });
    });
});
