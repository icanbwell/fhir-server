/**
 * FIXED (DCON-4894) -- previously a KNOWN, TRACKED, UNFIXED GAP quarantined via jest.config.js
 * testPathIgnorePatterns.
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
 * manipulation), that cross-tenant Person/Patient was previously still returned regardless of
 * scope.
 *
 * A same-owner-tenant fallback check (only follow a Person.link into a Person that shares an
 * owner tag with the caller's own top-level Person) was implemented and reverted: this data
 * model's Main-Person-to-Client-Person links are *intentionally* cross-tenant by design (a
 * Main Person owned by one tenant legitimately links to Client Person records owned by OTHER
 * tenants, each representing the same real human's account at a different source system -- see
 * review.md §1, and the still-passing regression test in
 * personToPatientIdsExpander.crossTenant.test.js modeled on
 * src/tests/patientScope/search_with_duplicate_patient_id.person_scope_uuid). An owner-tag
 * equality check cannot distinguish that legitimate, intentional cross-tenant link from a
 * malicious/corrupted one, so applying it breaks real, currently-relied-upon functionality.
 *
 * The fix: gate the decision to follow a Person.link AT ALL on its `assurance` value (FHIR's
 * match-confidence field), applied inside the traversal loop itself, independent of what scope
 * the caller holds -- see personLinkAssuranceLevel.js and
 * personToPatientIdsExpander.assuranceEnforcement.test.js. This protects a pure-patient-scope
 * caller exactly as much as a tenant/service-account caller, because the check happens before
 * any scope-derived query is even built, so it closes this gap without resurrecting the rejected
 * same-owner-tenant heuristic -- a legitimate cross-tenant Main-Person-to-Client-Person link with
 * sufficient assurance is still followed (see the third test below), while a link with
 * insufficient (or missing) assurance is not, regardless of whether it happens to be
 * cross-tenant.
 *
 * This closure relies on configManager.enforcePersonLinkAssuranceMinimum being turned on (it
 * defaults to false in code); these tests explicitly opt in to exercise the closed behavior. See
 * configManager.js for why that flag must not be enabled in a real environment without first
 * observing configManager.logPersonLinkAssuranceBelowMinimum's dry-run logging there.
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

describe('PersonToPatientIdsExpander — pure patient-scope caller cross-tenant gap (fixed via assurance enforcement)', () => {
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
            enableProxyPersonScopeCheckForEverything: true,
            // Opt in to the DCON-4894 fix under test. Both flags default to false in real
            // code/environments -- see configManager.js's doc comments for why enforcement must
            // not be turned on for real until the dry-run logging has been observed first.
            personLinkAssuranceMinimumLevel: 'level2',
            enforcePersonLinkAssuranceMinimum: true
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
                // personAlpha's own identity assertion (its own Patient record) -- a strongly
                // verified link, so it must still be followed even with enforcement on.
                { target: { _uuid: 'Patient/patient-alpha-uuid', type: 'Patient' }, assurance: 'level4' },
                // Cross-tenant link representing a malicious/corrupted link, NOT a legitimate
                // MPS-style identity match (unlike the regression test in the sibling
                // crossTenant.test.js file) -- only algorithmic (level1) confidence, below the
                // configured level2 minimum, so it must NOT be followed.
                { target: { _uuid: 'Person/person-beta-uuid', type: 'Person' }, assurance: 'level1' }
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
        // FIXED: the level1 (below the level2 minimum) cross-tenant Person.link is no longer
        // followed, so patient-beta-uuid is never reached at all.
        expect(result).not.toContain('patient-beta-uuid');
        // The below-minimum link must not even trigger a second-level lookup for personBeta.
        expect(mockDatabaseQueryManager.findAsync).toHaveBeenCalledTimes(1);
    });

    test('should NOT include patients from a different tenant reached transitively (Person -> Person -> Person), even with no access/ scope on the token', async () => {
        const personAlpha = {
            _uuid: 'person-alpha-uuid',
            meta: { security: [{ system: SecurityTagSystem.owner, code: 'alpha_health' }] },
            // Same-tenant, strongly verified link -- must still be followed with enforcement on.
            link: [{ target: { _uuid: 'Person/person-beta-uuid', type: 'Person' }, assurance: 'level4' }]
        };
        const personBeta = {
            _uuid: 'person-beta-uuid',
            meta: { security: [{ system: SecurityTagSystem.owner, code: 'alpha_health' }] },
            // Crosses into a different tenant (gamma_labs) with only algorithmic (level1)
            // confidence -- below the configured level2 minimum, so it must NOT be followed.
            link: [{ target: { _uuid: 'Person/person-gamma-uuid', type: 'Person' }, assurance: 'level1' }]
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

        // FIXED: the level1 beta -> gamma link is no longer followed.
        expect(result).not.toContain('patient-gamma-uuid');
        // alpha -> beta (level4) is still followed, but beta -> gamma (level1) must not trigger
        // a third-level lookup for personGamma.
        expect(mockDatabaseQueryManager.findAsync).toHaveBeenCalledTimes(2);
    });

    test('REGRESSION: a legitimate cross-tenant Person.link (MPS-style identity match) with sufficient assurance is still followed -- enforcement gates on assurance, not on tenant boundary', async () => {
        // Mirrors personToPatientIdsExpander.crossTenant.test.js's legitimate
        // Main-Person-to-Client-Person regression fixture, but additionally exercises it with
        // enforcePersonLinkAssuranceMinimum turned on: a cross-tenant link with assurance at/
        // above the configured minimum must still be traversed, proving the fix does not
        // resurrect the rejected same-owner-tenant heuristic.
        const mainPerson = {
            _uuid: 'main-person-uuid',
            meta: { security: [{ system: SecurityTagSystem.owner, code: 'bwell' }] },
            link: [{ target: { _uuid: 'Person/client-person-uuid', type: 'Person' }, assurance: 'level3' }]
        };
        const clientPerson = {
            _uuid: 'client-person-uuid',
            // Different owner tenant than mainPerson -- the normal, intentional shape of an
            // MPS-matched Client Person, not an attack.
            meta: { security: [{ system: SecurityTagSystem.owner, code: 'mps-api' }] },
            link: [{ target: { _uuid: 'Patient/mps-patient-uuid', type: 'Patient' }, assurance: 'level3' }]
        };

        mockFindAsyncSequence([[mainPerson], [clientPerson]]);

        const expander = createExpander();

        const result = await expander.getPatientIdsFromPersonAsync({
            databaseQueryManager: mockDatabaseQueryManager,
            personIds: ['main-person-uuid'],
            totalProcessedPersonIds: new Set(),
            level: 1,
            requestInfo,
            addTopPersonAccessCheck: true
        });

        expect(result).toContain('mps-patient-uuid');
        expect(mockDatabaseQueryManager.findAsync).toHaveBeenCalledTimes(2);
    });
});
