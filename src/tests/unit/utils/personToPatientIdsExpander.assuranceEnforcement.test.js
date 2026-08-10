/**
 * DCON-4894 Commit B: enforcement of a configured Person.link.assurance minimum during
 * traversal.
 *
 * When configManager.enforcePersonLinkAssuranceMinimum is true, a Person.link whose `assurance`
 * does not meet configManager.personLinkAssuranceMinimumLevel (including a missing/absent
 * assurance, which ranks 0 -- see personLinkAssuranceLevel.js) is excluded from being followed
 * at all: it must not contribute to the returned patientIds, and if it points at a Person it
 * must not be recursed into (no second-level database lookup for it). When the flag is false
 * (its code-level default), behavior must be identical to before DCON-4894 -- every link is
 * still followed regardless of assurance.
 */
const { describe, test, expect, jest: jestGlobal } = require('@jest/globals');

const { PersonToPatientIdsExpander } = require('../../../utils/personToPatientIdsExpander');
const { SecurityTagSystem } = require('../../../utils/securityTagSystem');
const { DatabaseQueryFactory } = require('../../../dataLayer/databaseQueryFactory');
const { ScopesManager } = require('../../../operations/security/scopesManager');
const { SecurityTagManager } = require('../../../operations/common/securityTagManager');
const { ConfigManager } = require('../../../utils/configManager');

/**
 * Creates an object that satisfies `instanceof RealClass` (used by this module's
 * assertTypeEquals() constructor checks) without running the real constructor.
 */
function createStubInstance (RealClass, overrides = {}) {
    const instance = Object.create(RealClass.prototype);
    for (const [key, value] of Object.entries(overrides)) {
        Object.defineProperty(instance, key, {
            value,
            writable: true,
            enumerable: true,
            configurable: true
        });
    }
    return instance;
}

function makeFakeCursor (docs) {
    let index = 0;
    return {
        hasNext: jestGlobal.fn(async () => index < docs.length),
        nextObject: jestGlobal.fn(async () => docs[index++])
    };
}

describe('PersonToPatientIdsExpander — DCON-4894 assurance enforcement (Commit B)', () => {
    // One Patient-target link with no assurance at all (ranks 0), and one Person-target
    // (cross-tenant) link explicitly marked 'level1' -- both below the 'level2' minimum used in
    // these tests.
    const topPerson = {
        id: 'person-top',
        _uuid: 'person-top-uuid',
        _sourceId: 'person-top',
        meta: { security: [{ system: SecurityTagSystem.access, code: 'clientA' }] },
        link: [
            { target: { _uuid: 'Patient/patient-no-assurance-uuid', type: 'Patient' } },
            { target: { _uuid: 'Person/person-other-uuid', type: 'Person' }, assurance: 'level1' }
        ]
    };

    const otherPerson = {
        id: 'person-other',
        _uuid: 'person-other-uuid',
        _sourceId: 'person-other',
        meta: { security: [{ system: SecurityTagSystem.access, code: 'clientB' }] },
        link: [
            { target: { _uuid: 'Patient/patient-other-uuid', type: 'Patient' } }
        ]
    };

    function createExpander (configOverrides) {
        const scopesManager = createStubInstance(ScopesManager, {});
        const securityTagManager = createStubInstance(SecurityTagManager, {});
        const configManager = createStubInstance(ConfigManager, {
            useAccessIndex: false,
            enableProxyPersonScopeCheckForEverything: false,
            personLinkAssuranceMinimumLevel: 'level2',
            logPersonLinkAssuranceBelowMinimum: false,
            enforcePersonLinkAssuranceMinimum: false,
            ...configOverrides
        });
        const databaseQueryFactory = createStubInstance(DatabaseQueryFactory);

        return new PersonToPatientIdsExpander({
            databaseQueryFactory,
            scopesManager,
            securityTagManager,
            configManager
        });
    }

    function createMockDatabaseQueryManager (docsInCallOrder) {
        let callIndex = 0;
        return {
            findAsync: jestGlobal.fn(async () => {
                const docsForThisCall = docsInCallOrder[callIndex] || [];
                callIndex += 1;
                return makeFakeCursor(docsForThisCall);
            })
        };
    }

    test('excludes the below-minimum Patient link and does not recurse into the below-minimum Person link, when enforcement is on', async () => {
        const expander = createExpander({ enforcePersonLinkAssuranceMinimum: true });
        const mockDatabaseQueryManager = createMockDatabaseQueryManager([[topPerson], [otherPerson]]);

        const patientIds = await expander.getPatientIdsFromPersonAsync({
            personIds: ['person-top'],
            totalProcessedPersonIds: new Set(),
            databaseQueryManager: mockDatabaseQueryManager,
            level: 1,
            toMap: false
        });

        expect(patientIds).not.toContain('patient-no-assurance-uuid');
        expect(patientIds).not.toContain('patient-other-uuid');
        // Only the top-level lookup should have been issued -- the below-minimum Person link
        // must never trigger a second-level findAsync call.
        expect(mockDatabaseQueryManager.findAsync).toHaveBeenCalledTimes(1);
    });

    test('follows both links, identical to pre-existing behavior, when enforcement is off (default)', async () => {
        const expander = createExpander({ enforcePersonLinkAssuranceMinimum: false });
        const mockDatabaseQueryManager = createMockDatabaseQueryManager([[topPerson], [otherPerson]]);

        const patientIds = await expander.getPatientIdsFromPersonAsync({
            personIds: ['person-top'],
            totalProcessedPersonIds: new Set(),
            databaseQueryManager: mockDatabaseQueryManager,
            level: 1,
            toMap: false
        });

        expect(patientIds).toContain('patient-no-assurance-uuid');
        expect(patientIds).toContain('patient-other-uuid');
        expect(mockDatabaseQueryManager.findAsync).toHaveBeenCalledTimes(2);
    });
});
