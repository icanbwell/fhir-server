const {
    describe,
    beforeEach,
    afterEach,
    test,
    expect
} = require('@jest/globals');
const {
    commonBeforeEach,
    commonAfterEach,
    getTestContainer,
    createTestRequest
} = require('../../common');
const { SecurityTagSystem } = require('../../../utils/securityTagSystem');

describe('ScopesManager - getAccessCodesFromScopes Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('only matches scopes with the access/ prefix, not any scope merely starting with "access" (SEC-1580 F11)', async () => {
        await createTestRequest();
        const container = getTestContainer();
        const scopesManager = container.scopesManager;

        // a scope that starts with the literal characters "access" but is not
        // an access/<tenant>.<action> scope must not be treated as one
        const accessCodes = scopesManager.getAccessCodesFromScopes(
            'write', 'testUser', 'accessory/clientA.write user/*.write'
        );
        expect(accessCodes).toStrictEqual([]);
    });

    test('still matches a real access/ scope', async () => {
        await createTestRequest();
        const container = getTestContainer();
        const scopesManager = container.scopesManager;

        const accessCodes = scopesManager.getAccessCodesFromScopes(
            'write', 'testUser', 'access/clientA.write user/*.write'
        );
        expect(accessCodes).toStrictEqual(['clientA']);
    });
});

describe('ScopesManager - access tag change Tests (SEC-1580 F2/F3)', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    /**
     * @param {string[]} accessCodes
     */
    function resourceWithAccessCodes (accessCodes) {
        return {
            resourceType: 'Patient',
            id: '1',
            meta: {
                security: [
                    { system: SecurityTagSystem.owner, code: 'clientA' },
                    ...accessCodes.map(code => ({ system: SecurityTagSystem.access, code }))
                ]
            }
        };
    }

    describe('getAccessTagCodes', () => {
        test('returns only the codes of access tags', async () => {
            await createTestRequest();
            const scopesManager = getTestContainer().scopesManager;
            expect(scopesManager.getAccessTagCodes(resourceWithAccessCodes(['clientA', 'clientB'])))
                .toStrictEqual(['clientA', 'clientB']);
        });

        test('returns an empty array when the resource has no access tags, no meta, or is null/undefined', async () => {
            await createTestRequest();
            const scopesManager = getTestContainer().scopesManager;
            expect(scopesManager.getAccessTagCodes(resourceWithAccessCodes([]))).toStrictEqual([]);
            expect(scopesManager.getAccessTagCodes({ resourceType: 'Patient', id: '1' })).toStrictEqual([]);
            expect(scopesManager.getAccessTagCodes(null)).toStrictEqual([]);
            expect(scopesManager.getAccessTagCodes(undefined)).toStrictEqual([]);
        });
    });

    describe('isAccessTagChangeAllowedByScopes', () => {
        const user = 'test-user';

        /**
         * @param {string[]} oldAccessCodes
         * @param {string[]} newAccessCodes
         * @param {string} scope
         * @param {boolean} [ignoreRemovals]
         */
        function isChangeAllowed (scopesManager, oldAccessCodes, newAccessCodes, scope, ignoreRemovals = false) {
            return scopesManager.isAccessTagChangeAllowedByScopes({
                oldAccessCodes, newAccessCodes, resourceType: 'Patient', user, scope, ignoreRemovals
            });
        }

        test('allows adding an access tag the caller has write access to', async () => {
            await createTestRequest();
            const scopesManager = getTestContainer().scopesManager;
            expect(isChangeAllowed(scopesManager, ['clientA'], ['clientA', 'clientB'], 'access/clientA.* access/clientB.*'))
                .toBeTrue();
        });

        test('F2: does not allow adding an access tag the caller has no access to (cross-tenant re-tagging)', async () => {
            await createTestRequest();
            const scopesManager = getTestContainer().scopesManager;
            expect(isChangeAllowed(scopesManager, ['clientA'], ['clientA', 'clientB'], 'access/clientA.*'))
                .toBeFalse();
        });

        test('allows removing an access tag the caller has access to', async () => {
            await createTestRequest();
            const scopesManager = getTestContainer().scopesManager;
            expect(isChangeAllowed(scopesManager, ['clientA', 'clientB'], ['clientA'], 'access/clientA.* access/clientB.*'))
                .toBeTrue();
        });

        test('does not allow removing an access tag the caller has no access to', async () => {
            await createTestRequest();
            const scopesManager = getTestContainer().scopesManager;
            expect(isChangeAllowed(scopesManager, ['clientA', 'clientB'], ['clientA'], 'access/clientA.*'))
                .toBeFalse();
        });

        test('allows leaving an access tag the caller has no access to untouched', async () => {
            await createTestRequest();
            const scopesManager = getTestContainer().scopesManager;
            expect(isChangeAllowed(scopesManager, ['clientA', 'clientB'], ['clientA', 'clientB'], 'access/clientA.*'))
                .toBeTrue();
        });

        test('allows any change when the caller has the * access code', async () => {
            await createTestRequest();
            const scopesManager = getTestContainer().scopesManager;
            expect(isChangeAllowed(scopesManager, ['clientA'], ['clientB', 'clientC'], 'access/*.*')).toBeTrue();
        });

        test('does not allow a change when the caller has no write access scopes', async () => {
            await createTestRequest();
            const scopesManager = getTestContainer().scopesManager;
            expect(isChangeAllowed(scopesManager, ['clientA'], ['clientA', 'clientB'], 'access/clientB.read'))
                .toBeFalse();
        });

        test('requires write access, not read access, on the added code', async () => {
            await createTestRequest();
            const scopesManager = getTestContainer().scopesManager;
            expect(isChangeAllowed(
                scopesManager, ['clientA'], ['clientA', 'clientB'], 'access/clientA.* access/clientB.read'
            )).toBeFalse();
        });

        test('ignores removals when the write path can only append access tags (smart merge)', async () => {
            await createTestRequest();
            const scopesManager = getTestContainer().scopesManager;
            expect(isChangeAllowed(scopesManager, ['clientA', 'clientB'], ['clientA'], 'access/clientA.*', true))
                .toBeTrue();
        });

        test('still checks additions when removals are ignored', async () => {
            await createTestRequest();
            const scopesManager = getTestContainer().scopesManager;
            expect(isChangeAllowed(scopesManager, ['clientA'], ['clientA', 'clientB'], 'access/clientA.*', true))
                .toBeFalse();
        });

        test('F3: allows a create whose access tags the caller has access to', async () => {
            await createTestRequest();
            const scopesManager = getTestContainer().scopesManager;
            expect(isChangeAllowed(scopesManager, [], ['clientA'], 'access/clientA.*')).toBeTrue();
        });

        test('F3: does not allow a create with an access tag the caller has no access to', async () => {
            await createTestRequest();
            const scopesManager = getTestContainer().scopesManager;
            expect(isChangeAllowed(scopesManager, [], ['clientA', 'clientB'], 'access/clientA.*')).toBeFalse();
        });

        test('leaves a patient-scoped caller to the patient scope checks', async () => {
            await createTestRequest();
            const scopesManager = getTestContainer().scopesManager;
            // a patient scoped caller holds no access scopes to compare against
            expect(isChangeAllowed(scopesManager, ['clientA'], ['clientA', 'clientB'], 'patient/Patient.write'))
                .toBeTrue();
        });

        test('still checks a caller with both patient and access scopes on a resource type not accessible by patient scope', async () => {
            await createTestRequest();
            const scopesManager = getTestContainer().scopesManager;
            expect(
                scopesManager.isAccessTagChangeAllowedByScopes({
                    oldAccessCodes: ['clientA'],
                    newAccessCodes: ['clientA', 'clientB'],
                    resourceType: 'Organization',
                    user,
                    scope: 'patient/Organization.write access/clientA.*'
                })
            ).toBeFalse();
        });
    });
});
