const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

// Mock assertTypeEquals as no-op
jest.mock('../../../../utils/assertType', () => ({
    assertTypeEquals: jest.fn()
}));

// Mock DelegatedAccessRulesManager
jest.mock('../../../../utils/delegatedAccessRulesManager', () => ({
    DelegatedAccessRulesManager: class DelegatedAccessRulesManager {}
}));

const { DelegatedAccessScopeManager } = require('../../../../operations/security/delegatedAccessScopeManager');

describe('DelegatedAccessScopeManager', () => {
    let delegatedAccessScopeManager;
    let mockDelegatedAccessRulesManager;

    beforeEach(() => {
        mockDelegatedAccessRulesManager = {
            hasValidConsentAsync: jest.fn()
        };
        delegatedAccessScopeManager = new DelegatedAccessScopeManager({
            delegatedAccessRulesManager: mockDelegatedAccessRulesManager
        });
    });

    describe('isAccessAllowedAsync', () => {
        test('happy path: valid actor with consent returns true', async () => {
            const actor = { person: 'Person/valid-person-123' };
            const personIdFromJwtToken = 'person-owner-456';
            mockDelegatedAccessRulesManager.hasValidConsentAsync.mockResolvedValue(true);

            const result = await delegatedAccessScopeManager.isAccessAllowedAsync({
                actor,
                personIdFromJwtToken
            });

            expect(result).toBe(true);
            expect(mockDelegatedAccessRulesManager.hasValidConsentAsync).toHaveBeenCalledWith({
                actor,
                personIdFromJwtToken
            });
        });

        test('CRITICAL: null actor is passed directly to hasValidConsentAsync without validation - fail-open risk', async () => {
            // If the delegated rules manager defaults to true when actor is null,
            // access is granted without proper identity verification.
            // A secure implementation MUST validate actor before delegating.
            const actor = null;
            const personIdFromJwtToken = 'person-owner-456';
            mockDelegatedAccessRulesManager.hasValidConsentAsync.mockResolvedValue(true);

            const result = await delegatedAccessScopeManager.isAccessAllowedAsync({
                actor,
                personIdFromJwtToken
            });

            // BUG: The method should reject null actor and return false,
            // but it passes null directly to hasValidConsentAsync.
            // This test asserts the CORRECT behavior: null actor should deny access.
            expect(result).toBe(false);
        });

        test('CRITICAL: empty personIdFromJwtToken is passed without validation - fail-open risk', async () => {
            // If personIdFromJwtToken is empty string, the consent check may
            // match any/all consent records or default to allowing access.
            const actor = { person: 'Person/valid-person-123' };
            const personIdFromJwtToken = '';
            mockDelegatedAccessRulesManager.hasValidConsentAsync.mockResolvedValue(true);

            const result = await delegatedAccessScopeManager.isAccessAllowedAsync({
                actor,
                personIdFromJwtToken
            });

            // BUG: The method should reject empty personIdFromJwtToken and return false,
            // but it passes empty string directly to hasValidConsentAsync.
            // This test asserts the CORRECT behavior: empty token should deny access.
            expect(result).toBe(false);
        });

        test('CRITICAL: cross-tenant access - actor from different tenant than personIdFromJwtToken', async () => {
            // If actor.person references a Person in tenant-A but personIdFromJwtToken
            // belongs to tenant-B, there's no tenant validation to prevent cross-tenant
            // delegated access.
            const actor = { person: 'Person/tenant-A-person' };
            const personIdFromJwtToken = 'tenant-B-person';
            // The consent check might succeed if consent records exist across tenants
            mockDelegatedAccessRulesManager.hasValidConsentAsync.mockResolvedValue(true);

            const result = await delegatedAccessScopeManager.isAccessAllowedAsync({
                actor,
                personIdFromJwtToken
            });

            // BUG: Without tenant validation, cross-tenant consent can be used.
            // A correct implementation should validate tenant consistency.
            // This test asserts CORRECT behavior: cross-tenant should be denied.
            expect(result).toBe(false);
        });

        test('BUG: method only checks consent - does not validate scope, resource type, or operation', async () => {
            // isAccessAllowedAsync implies a complete access check, but it only checks consent.
            // If callers rely on this as a full authorization check, operations may proceed
            // without proper scope/resource/operation validation.
            const actor = { person: 'Person/valid-person-123' };
            const personIdFromJwtToken = 'person-owner-456';
            mockDelegatedAccessRulesManager.hasValidConsentAsync.mockResolvedValue(true);

            const result = await delegatedAccessScopeManager.isAccessAllowedAsync({
                actor,
                personIdFromJwtToken
            });

            // The method returns true based solely on consent, without checking
            // that the actor has the appropriate scope for the operation.
            // At minimum, the method should accept and validate scope/operation params.
            expect(result).toBe(true);
            // Verify it only called hasValidConsentAsync (no scope/operation check)
            expect(mockDelegatedAccessRulesManager.hasValidConsentAsync).toHaveBeenCalledTimes(1);
        });

        test('invalid actor (undefined) should return false not throw', async () => {
            // A secure implementation should gracefully handle undefined actor
            // by returning false (deny access) rather than throwing an exception.
            const actor = undefined;
            const personIdFromJwtToken = 'person-owner-456';
            mockDelegatedAccessRulesManager.hasValidConsentAsync.mockResolvedValue(true);

            const result = await delegatedAccessScopeManager.isAccessAllowedAsync({
                actor,
                personIdFromJwtToken
            });

            // BUG: undefined actor is passed through without validation.
            // Correct behavior: return false for invalid actor.
            expect(result).toBe(false);
        });

        test('when hasValidConsentAsync returns false, access is denied', async () => {
            const actor = { person: 'Person/valid-person-123' };
            const personIdFromJwtToken = 'person-owner-456';
            mockDelegatedAccessRulesManager.hasValidConsentAsync.mockResolvedValue(false);

            const result = await delegatedAccessScopeManager.isAccessAllowedAsync({
                actor,
                personIdFromJwtToken
            });

            expect(result).toBe(false);
        });
    });
});
