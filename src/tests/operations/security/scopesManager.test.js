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
const { ScopesManager } = require('../../../operations/security/scopesManager');
const { ConfigManager } = require('../../../utils/configManager');
const { PatientFilterManager } = require('../../../fhir/patientFilterManager');
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

describe('ScopesManager - access tag change Tests (SEC-1580 F2)', () => {
    const scopesManager = new ScopesManager({
        configManager: new ConfigManager(),
        patientFilterManager: new PatientFilterManager()
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
        test('should return only the codes of access tags', () => {
            expect(scopesManager.getAccessTagCodes(resourceWithAccessCodes(['clientA', 'clientB'])))
                .toEqual(['clientA', 'clientB']);
        });

        test('should return an empty array when the resource has no access tags or no meta', () => {
            expect(scopesManager.getAccessTagCodes(resourceWithAccessCodes([]))).toEqual([]);
            expect(scopesManager.getAccessTagCodes({ resourceType: 'Patient', id: '1' })).toEqual([]);
            expect(scopesManager.getAccessTagCodes(null)).toEqual([]);
        });
    });

    describe('isAccessTagChangeAllowedByScopes', () => {
        const user = 'test-user';

        /**
         * @param {string[]} oldAccessCodes
         * @param {string[]} newAccessCodes
         * @param {string} scope
         * @param {boolean} ignoreRemovals
         */
        function isChangeAllowed (oldAccessCodes, newAccessCodes, scope, ignoreRemovals = false) {
            return scopesManager.isAccessTagChangeAllowedByScopes({
                oldAccessCodes, newAccessCodes, resourceType: 'Patient', user, scope, ignoreRemovals
            });
        }

        test('should allow adding an access tag the caller has access to', () => {
            expect(isChangeAllowed(['clientA'], ['clientA', 'clientB'], 'access/clientA.* access/clientB.*'))
                .toBeTrue();
        });

        test('should not allow adding an access tag the caller has no access to', () => {
            expect(isChangeAllowed(['clientA'], ['clientA', 'clientB'], 'access/clientA.*')).toBeFalse();
        });

        test('should allow removing an access tag the caller has access to', () => {
            expect(isChangeAllowed(['clientA', 'clientB'], ['clientA'], 'access/clientA.* access/clientB.*'))
                .toBeTrue();
        });

        test('should not allow removing an access tag the caller has no access to', () => {
            expect(isChangeAllowed(['clientA', 'clientB'], ['clientA'], 'access/clientA.*')).toBeFalse();
        });

        test('should allow leaving an access tag the caller has no access to untouched', () => {
            expect(isChangeAllowed(['clientA', 'clientB'], ['clientA', 'clientB'], 'access/clientA.*'))
                .toBeTrue();
        });

        test('should allow any change when the caller has the * access code', () => {
            expect(isChangeAllowed(['clientA'], ['clientB', 'clientC'], 'access/*.*')).toBeTrue();
        });

        test('should not allow a change when the caller has no write access scopes', () => {
            expect(isChangeAllowed(['clientA'], ['clientA', 'clientB'], 'access/clientB.read')).toBeFalse();
        });

        test('should require write access, not read access, on the added code', () => {
            expect(isChangeAllowed(['clientA'], ['clientA', 'clientB'], 'access/clientA.* access/clientB.read'))
                .toBeFalse();
        });

        test('should ignore removals when the write path cannot remove access tags', () => {
            expect(isChangeAllowed(['clientA', 'clientB'], ['clientA'], 'access/clientA.*', true)).toBeTrue();
        });

        test('should still check additions when removals are ignored', () => {
            expect(isChangeAllowed(['clientA'], ['clientA', 'clientB'], 'access/clientA.*', true)).toBeFalse();
        });

        test('should allow a create whose access tags the caller has access to', () => {
            expect(isChangeAllowed([], ['clientA'], 'access/clientA.*')).toBeTrue();
        });

        test('should not allow a create with an access tag the caller has no access to', () => {
            expect(isChangeAllowed([], ['clientA', 'clientB'], 'access/clientA.*')).toBeFalse();
        });

        test('should leave a patient scoped caller to the patient scope checks', () => {
            // a patient scoped caller holds no access scopes to compare against
            expect(isChangeAllowed(['clientA'], ['clientA', 'clientB'], 'patient/Patient.write')).toBeTrue();
        });

        test('should still check a caller that has both patient and access scopes on a resource type not accessible by patient scope', () => {
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
