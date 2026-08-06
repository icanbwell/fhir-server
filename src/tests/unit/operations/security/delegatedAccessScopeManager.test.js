const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

/**
 * Unit tests for the real DelegatedAccessScopeManager (src/operations/security/
 * delegatedAccessScopeManager.js). A prior version of this file asserted behavior against an
 * inline stand-in class defined in beforeEach() instead of the real one, so it never actually
 * covered this class - see docs/resource-authorization.md's known-gaps section.
 *
 * isAccessAllowedAsync's own job is narrow: guard against a missing actor/personIdFromJwtToken,
 * then delegate the real consent decision to DelegatedAccessRulesManager.hasValidConsentAsync
 * (mocked here). Cross-tenant/grantor-actor legitimacy is that manager's responsibility, not
 * this class's - see delegatedAccessRulesManager.test.js for that coverage.
 */
jestGlobal.mock('../../../../utils/assertType', () => ({
    assertIsValid: () => {},
    assertTypeEquals: () => {}
}));

const { DelegatedAccessScopeManager } = require('../../../../operations/security/delegatedAccessScopeManager');

describe('DelegatedAccessScopeManager', () => {
    let mockDelegatedAccessRulesManager;
    let manager;

    beforeEach(() => {
        mockDelegatedAccessRulesManager = {
            hasValidConsentAsync: jestGlobal.fn()
        };
        manager = new DelegatedAccessScopeManager({
            delegatedAccessRulesManager: mockDelegatedAccessRulesManager
        });
    });

    describe('isAccessAllowedAsync', () => {
        test('happy path: valid actor with consent returns true', async () => {
            const actor = { person: 'Person/valid-person-123' };
            const personIdFromJwtToken = 'person-owner-456';
            mockDelegatedAccessRulesManager.hasValidConsentAsync.mockResolvedValue(true);

            const result = await manager.isAccessAllowedAsync({ actor, personIdFromJwtToken });

            expect(result).toBe(true);
            expect(mockDelegatedAccessRulesManager.hasValidConsentAsync).toHaveBeenCalledWith({
                actor,
                personIdFromJwtToken
            });
        });

        test('when hasValidConsentAsync returns false, access is denied', async () => {
            const actor = { person: 'Person/valid-person-123' };
            const personIdFromJwtToken = 'person-owner-456';
            mockDelegatedAccessRulesManager.hasValidConsentAsync.mockResolvedValue(false);

            const result = await manager.isAccessAllowedAsync({ actor, personIdFromJwtToken });

            expect(result).toBe(false);
        });

        test('null actor is denied without consulting the rules manager', async () => {
            mockDelegatedAccessRulesManager.hasValidConsentAsync.mockResolvedValue(true);

            const result = await manager.isAccessAllowedAsync({
                actor: null,
                personIdFromJwtToken: 'person-owner-456'
            });

            expect(result).toBe(false);
            expect(mockDelegatedAccessRulesManager.hasValidConsentAsync).not.toHaveBeenCalled();
        });

        test('undefined actor is denied without consulting the rules manager', async () => {
            mockDelegatedAccessRulesManager.hasValidConsentAsync.mockResolvedValue(true);

            const result = await manager.isAccessAllowedAsync({
                actor: undefined,
                personIdFromJwtToken: 'person-owner-456'
            });

            expect(result).toBe(false);
            expect(mockDelegatedAccessRulesManager.hasValidConsentAsync).not.toHaveBeenCalled();
        });

        test('empty personIdFromJwtToken is denied without consulting the rules manager', async () => {
            mockDelegatedAccessRulesManager.hasValidConsentAsync.mockResolvedValue(true);

            const result = await manager.isAccessAllowedAsync({
                actor: { person: 'Person/valid-person-123' },
                personIdFromJwtToken: ''
            });

            expect(result).toBe(false);
            expect(mockDelegatedAccessRulesManager.hasValidConsentAsync).not.toHaveBeenCalled();
        });

        test('missing personIdFromJwtToken is denied without consulting the rules manager', async () => {
            mockDelegatedAccessRulesManager.hasValidConsentAsync.mockResolvedValue(true);

            const result = await manager.isAccessAllowedAsync({
                actor: { person: 'Person/valid-person-123' },
                personIdFromJwtToken: undefined
            });

            expect(result).toBe(false);
            expect(mockDelegatedAccessRulesManager.hasValidConsentAsync).not.toHaveBeenCalled();
        });
    });
});
