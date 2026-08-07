/**
 * KNOWN, TRACKED, UNFIXED GAP -- see jest.config.js testPathIgnorePatterns.
 *
 * A pure patient-scope caller (e.g. scope = "patient/Person.read" with no combined access/
 * scope at all -- the normal shape for a plain patient-facing app token) is not protected by
 * PersonToPatientIdsExpander.getPatientIdsFromPersonAsync's scope-derived security-tag filter
 * (getSecurityTagsFromScope / getQueryWithSecurityTags), even when the caller supplies
 * addTopPersonAccessCheck: true. That filter requires scope-derived access/ codes to do
 * anything; a pure patient-scope token never carries one by design (see
 * ScopesManager.isAccessToResourceAllowedBySecurityTags), so getSecurityTagsFromScope()
 * legitimately returns [] for it, and getQueryWithSecurityTags() is then a complete no-op (no
 * filter is added at all -- see review.md §D, "no restriction" must not be indistinguishable
 * from "no matches"). Concretely: if this caller's own top-level Person has a Person.link into
 * another tenant's Person/Patient (via data corruption, a matching error, or intentional
 * manipulation), that cross-tenant Person/Patient is currently still returned.
 *
 * A same-owner-tenant fallback check (only follow a Person.link into a Person that shares an
 * owner tag with the caller's own top-level Person) was implemented and reverted: this data
 * model's Main-Person-to-Client-Person links are *intentionally* cross-tenant by design (a
 * Main Person owned by one tenant legitimately links to Client Person records owned by OTHER
 * tenants, each representing the same real human's account at a different source system -- see
 * review.md §1, and the now-passing regression test in
 * personToPatientIdsExpander.crossTenant.test.js modeled on
 * src/tests/patientScope/search_with_duplicate_patient_id.person_scope_uuid). An owner-tag
 * equality check cannot distinguish that legitimate, intentional cross-tenant link from a
 * malicious/corrupted one, so applying it breaks real, currently-relied-upon functionality.
 *
 * These tests encode the DESIRED (not current) behavior and are expected to FAIL until a real
 * fix is found -- e.g. a signal in the data model that can reliably distinguish a
 * verified/consented identity-match link from an unverified or malicious one, which
 * Person.link's existing `assurance` (match-confidence) field does not reliably provide today
 * (it's optional and not used as a trust boundary anywhere else in this codebase). This is
 * intentionally left as a tracked, unfixed gap rather than a false-confidence patch; see
 * jest.config.js's testPathIgnorePatterns comment for the convention this repo uses for that.
 */
const { describe, test, expect, beforeEach } = require('@jest/globals');
const { jest: jestGlobal } = require('@jest/globals');
const { SecurityTagSystem } = require('../../../utils/securityTagSystem');
const { DatabaseQueryFactory } = require('../../../dataLayer/databaseQueryFactory');
const { ScopesManager } = require('../../../operations/security/scopesManager');
const { SecurityTagManager } = require('../../../operations/common/securityTagManager');
const { ConfigManager } = require('../../../utils/configManager');
const { PersonToPatientIdsExpander } = require('../../../utils/personToPatientIdsExpander');

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

function createCursor (docs) {
    let index = 0;
    return {
        hasNext: jestGlobal.fn(async () => index < docs.length),
        nextObject: jestGlobal.fn(async () => docs[index++])
    };
}

describe('PersonToPatientIdsExpander — pure patient-scope caller cross-tenant gap (unfixed)', () => {
    let mockDatabaseQueryManager;

    function mockFindAsyncSequence (docsInCallOrder) {
        let callIndex = 0;
        mockDatabaseQueryManager.findAsync = jestGlobal.fn(async () => {
            const docsForThisCall = docsInCallOrder[callIndex] || [];
            callIndex += 1;
            // A pure patient-scope caller's query is never filtered (getQueryWithSecurityTags
            // is a no-op for it), so -- exactly like a real MongoDB query with no filter --
            // every doc seeded for this call is "found", regardless of tenant.
            return createCursor(docsForThisCall);
        });
    }

    beforeEach(() => {
        mockDatabaseQueryManager = {
            findAsync: jestGlobal.fn()
        };
    });

    function createExpander () {
        const scopesManager = createStubInstance(ScopesManager, {
            isAccessAllowedByPatientScopes: () => true
        });
        const securityTagManager = createStubInstance(SecurityTagManager, {
            // A pure patient-scope token never carries an access/ scope, so this legitimately
            // returns [] -- see ScopesManager.isAccessToResourceAllowedBySecurityTags.
            getSecurityTagsFromScope: () => [],
            getQueryWithSecurityTags: ({ query }) => query
        });
        const configManager = createStubInstance(ConfigManager, {
            useAccessIndex: false,
            enableProxyPersonScopeCheckForEverything: true
        });
        const databaseQueryFactory = createStubInstance(DatabaseQueryFactory);

        return new PersonToPatientIdsExpander({
            databaseQueryFactory,
            scopesManager,
            securityTagManager,
            configManager
        });
    }

    const requestInfo = { user: 'alpha-patient-user', scope: 'patient/Person.read' };

    test('should NOT include patients from a different tenant reached via a direct Person.link, even with no access/ scope on the token', async () => {
        const personAlpha = {
            _uuid: 'person-alpha-uuid',
            _sourceId: 'alpha-bob',
            meta: { security: [{ system: SecurityTagSystem.owner, code: 'alpha_health' }] },
            link: [
                { target: { _uuid: 'Patient/patient-alpha-uuid', type: 'Patient' } },
                // Cross-tenant link representing a malicious/corrupted link, NOT a legitimate
                // MPS-style identity match (unlike the regression test in the sibling
                // crossTenant.test.js file).
                { target: { _uuid: 'Person/person-beta-uuid', type: 'Person' } }
            ]
        };

        const personBeta = {
            _uuid: 'person-beta-uuid',
            _sourceId: 'beta-bob',
            meta: { security: [{ system: SecurityTagSystem.owner, code: 'beta_insurance' }] },
            link: [
                { target: { _uuid: 'Patient/patient-beta-uuid', type: 'Patient' } }
            ]
        };

        mockFindAsyncSequence([[personAlpha], [personBeta]]);

        const expander = createExpander();

        const result = await expander.getPatientIdsFromPersonAsync({
            databaseQueryManager: mockDatabaseQueryManager,
            personIds: ['person-alpha-uuid'],
            totalProcessedPersonIds: new Set(),
            level: 1,
            requestInfo,
            addTopPersonAccessCheck: true
        });

        expect(result).toContain('patient-alpha-uuid');
        // DESIRED: not currently true. Today patient-beta-uuid IS included -- this assertion
        // documents the gap and is expected to fail until a real fix lands.
        expect(result).not.toContain('patient-beta-uuid');
    });

    test('should NOT include patients from a different tenant reached transitively (Person -> Person -> Person), even with no access/ scope on the token', async () => {
        const personAlpha = {
            _uuid: 'person-alpha-uuid',
            meta: { security: [{ system: SecurityTagSystem.owner, code: 'alpha_health' }] },
            link: [{ target: { _uuid: 'Person/person-beta-uuid', type: 'Person' } }]
        };
        const personBeta = {
            _uuid: 'person-beta-uuid',
            meta: { security: [{ system: SecurityTagSystem.owner, code: 'alpha_health' }] },
            link: [{ target: { _uuid: 'Person/person-gamma-uuid', type: 'Person' } }]
        };
        const personGamma = {
            _uuid: 'person-gamma-uuid',
            meta: { security: [{ system: SecurityTagSystem.owner, code: 'gamma_labs' }] },
            link: [{ target: { _uuid: 'Patient/patient-gamma-uuid', type: 'Patient' } }]
        };

        mockFindAsyncSequence([[personAlpha], [personBeta], [personGamma]]);

        const expander = createExpander();

        const result = await expander.getPatientIdsFromPersonAsync({
            databaseQueryManager: mockDatabaseQueryManager,
            personIds: ['person-alpha-uuid'],
            totalProcessedPersonIds: new Set(),
            level: 1,
            requestInfo,
            addTopPersonAccessCheck: true
        });

        // DESIRED: not currently true -- documents the still-open gap.
        expect(result).not.toContain('patient-gamma-uuid');
    });
});
