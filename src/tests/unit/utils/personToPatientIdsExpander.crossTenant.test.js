/**
 * Tests for PersonToPatientIdsExpander cross-tenant boundary
 * Verifies that person expansion does NOT cross tenant boundaries when the caller has
 * requested the top-person access-tag check (addTopPersonAccessCheck), including at
 * recursion depths beyond the top-level Person.
 *
 * IDG-5 changed the mechanism entirely for a patient-scoped caller: instead of applying the
 * caller's access-tag filter at every recursion level, getPatientIdsFromPersonAsync now
 * requires every level's Person._uuid to equal requestInfo.personIdFromJwtToken. Since that
 * value never changes across recursion, a patient-scoped caller's self-lookup can only ever
 * match the top-level Person and never any Person reached via Person.link -- not just
 * cross-tenant ones. This closes the cross-tenant leak covered below as a side effect, but it
 * also means the (intentionally cross-tenant) Main-Person-to-Client-Person traversal used by
 * MPS-style identity matching no longer works for a patient-scoped caller either -- see the
 * former "REGRESSION" test below, now inverted to assert the new (more restrictive) behavior.
 *
 * A pure patient-scope caller (e.g. "patient/Person.read" with no access/ scope at all -- the
 * normal shape for a plain patient-facing app token) never carries an access/ scope by design
 * (see ScopesManager.isAccessToResourceAllowedBySecurityTags); that mechanism is unrelated to
 * this file, since hasPatientScope callers no longer use the access-tag filter at all.
 */
const { describe, test, expect, beforeEach } = require('@jest/globals');
const { jest: jestGlobal } = require('@jest/globals');
const { SecurityTagSystem } = require('../../../utils/securityTagSystem');
const { DatabaseQueryFactory } = require('../../../dataLayer/databaseQueryFactory');
const { ScopesManager } = require('../../../operations/security/scopesManager');
const { SecurityTagManager } = require('../../../operations/common/securityTagManager');
const { ConfigManager } = require('../../../utils/configManager');
const { PersonToPatientIdsExpander } = require('../../../utils/personToPatientIdsExpander');

/**
 * Creates an object that satisfies `instanceof RealClass` (used by this module's
 * assertTypeEquals() constructor checks) without running the real constructor or wiring up
 * its real dependency graph. Overrides are defined as own data properties via
 * defineProperty (rather than plain assignment) because some real classes (e.g.
 * ConfigManager) expose getter-only accessors on the prototype for the same names, and a
 * plain `obj.key = value` assignment onto an object whose prototype has a getter-only
 * accessor throws instead of shadowing it.
 * @param {Function} RealClass
 * @param {Object} overrides
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

/**
 * Builds a mongo-cursor-like object (hasNext/nextObject) over a fixed array of docs, matching
 * the subset of the DatabaseQueryManager cursor interface this module relies on.
 * @param {Object[]} docs
 */
function createCursor (docs) {
    let index = 0;
    return {
        hasNext: jestGlobal.fn(async () => index < docs.length),
        nextObject: jestGlobal.fn(async () => docs[index++])
    };
}

/**
 * Walks a (possibly $and/$or nested) mongo query looking for a
 * `meta.security: { $elemMatch: { system: access, code: ... } }` clause and returns the set of
 * access codes it requires. Returns [] if the query has no access-tag restriction at all.
 * @param {Object} query
 * @return {string[]}
 */
function extractRequiredAccessCodes (query) {
    if (!query || typeof query !== 'object') {
        return [];
    }
    let codes = [];
    for (const key of ['$and', '$or']) {
        if (Array.isArray(query[key])) {
            for (const subQuery of query[key]) {
                codes = codes.concat(extractRequiredAccessCodes(subQuery));
            }
        }
    }
    const securityClause = query['meta.security'];
    if (securityClause && securityClause.$elemMatch && securityClause.$elemMatch.system === SecurityTagSystem.access) {
        const { code } = securityClause.$elemMatch;
        if (code && code.$in) {
            codes = codes.concat(code.$in);
        } else if (code) {
            codes = codes.concat([code]);
        }
    }
    return codes;
}

/**
 * Walks a (possibly $and-nested) mongo query looking for a direct `{_uuid: 'xyz'}` equality
 * clause -- the shape getPatientIdsFromPersonAsync's hasPatientScope branch adds. Returns
 * undefined if the query has no such clause.
 * @param {Object} query
 * @return {string|undefined}
 */
function extractRequiredUuidEquality (query) {
    if (!query || typeof query !== 'object') {
        return undefined;
    }
    if (typeof query._uuid === 'string') {
        return query._uuid;
    }
    if (Array.isArray(query.$and)) {
        for (const subQuery of query.$and) {
            const found = extractRequiredUuidEquality(subQuery);
            if (found !== undefined) {
                return found;
            }
        }
    }
    return undefined;
}

/**
 * Returns whether `doc` carries the given access tag on meta.security.
 */
function docHasAccessCode (doc, code) {
    const securityTags = (doc.meta && doc.meta.security) || [];
    return securityTags.some((s) => s.system === SecurityTagSystem.access && s.code === code);
}

/**
 * A minimal but faithful stand-in for SecurityTagManager.getQueryWithSecurityTags(): it
 * produces the same `meta.security` $elemMatch shape the real implementation does, which is
 * exactly what extractRequiredAccessCodes() (mimicking what MongoDB itself would evaluate)
 * looks for.
 */
function getQueryWithSecurityTagsStub ({ query, securityTags }) {
    if (!securityTags || securityTags.length === 0) {
        return query;
    }
    const securityTagQuery = {
        'meta.security': {
            $elemMatch: {
                system: SecurityTagSystem.access,
                code: { $in: securityTags }
            }
        }
    };
    return { $and: [query, securityTagQuery] };
}

describe('PersonToPatientIdsExpander — Cross-Tenant Boundary', () => {
    let mockDatabaseQueryManager;

    /**
     * @param {Object[]} docsInCallOrder One doc (or empty array to simulate "not found") per
     *   expected findAsync() call, in the order the recursion is expected to issue them.
     */
    function mockFindAsyncSequence (docsInCallOrder) {
        let callIndex = 0;
        mockDatabaseQueryManager.findAsync = jestGlobal.fn(async ({ query }) => {
            const docsForThisCall = docsInCallOrder[callIndex] || [];
            callIndex += 1;

            let matchingDocs = docsForThisCall;

            // Simulate the hasPatientScope branch's {_uuid: personIdFromJwtToken} clause: a real
            // Mongo query would only ever return the doc(s) whose own _uuid matches exactly.
            const requiredUuid = extractRequiredUuidEquality(query);
            if (requiredUuid !== undefined) {
                matchingDocs = matchingDocs.filter((doc) => doc._uuid === requiredUuid);
            }

            // Simulate what a real MongoDB query with an access-tag filter would return: only
            // docs carrying at least one of the required access codes.
            const requiredAccessCodes = extractRequiredAccessCodes(query);
            if (requiredAccessCodes.length > 0) {
                matchingDocs = matchingDocs.filter(
                    (doc) => requiredAccessCodes.some((code) => docHasAccessCode(doc, code))
                );
            }

            return createCursor(matchingDocs);
        });
    }

    beforeEach(() => {
        mockDatabaseQueryManager = {
            findAsync: jestGlobal.fn()
        };
    });

    /**
     * @param {string[]} callerAccessCodes Access codes getSecurityTagsFromScope() should return for
     *   this caller. Pass [] to simulate a pure patient-scope caller with no access/ scope at all.
     */
    function createExpander (callerAccessCodes) {
        const scopesManager = createStubInstance(ScopesManager, {
            isAccessAllowedByPatientScopes: () => true
        });
        const securityTagManager = createStubInstance(SecurityTagManager, {
            getSecurityTagsFromScope: () => callerAccessCodes,
            getQueryWithSecurityTags: getQueryWithSecurityTagsStub
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

    describe('a patient-scoped caller never follows Person.link, cross-tenant or not', () => {
        const requestInfo = {
            user: 'alpha-test-user',
            scope: 'patient/Person.read access/alpha_health.read',
            personIdFromJwtToken: 'person-alpha-uuid'
        };

        test('should NOT include patients from a different tenant reached via a direct Person.link', async () => {
            // PersonAlpha (tenant alpha) has a link to PersonBeta (tenant beta). Even though
            // PersonAlpha's own _uuid correctly matches the caller's JWT identity at level 1,
            // the SAME identity is required at level 2 too -- so PersonBeta (a different
            // Person, with a different _uuid) can never match, regardless of tenant.
            const personAlpha = {
                _uuid: 'person-alpha-uuid',
                _sourceId: 'alpha-bob',
                meta: {
                    security: [
                        { system: SecurityTagSystem.owner, code: 'alpha_health' },
                        { system: SecurityTagSystem.access, code: 'alpha_health' }
                    ]
                },
                link: [
                    { target: { _uuid: 'Patient/patient-alpha-uuid', type: 'Patient' } },
                    // Cross-tenant link (should not be followed into the result set)
                    { target: { _uuid: 'Person/person-beta-uuid', type: 'Person' } }
                ]
            };

            const personBeta = {
                _uuid: 'person-beta-uuid',
                _sourceId: 'beta-bob',
                meta: {
                    security: [
                        { system: SecurityTagSystem.owner, code: 'beta_insurance' },
                        { system: SecurityTagSystem.access, code: 'beta_insurance' }
                    ]
                },
                link: [
                    { target: { _uuid: 'Patient/patient-beta-uuid', type: 'Patient' } }
                ]
            };

            mockFindAsyncSequence([[personAlpha], [personBeta]]);

            const expander = createExpander(['alpha_health']);

            const result = await expander.getPatientIdsFromPersonAsync({
                databaseQueryManager: mockDatabaseQueryManager,
                personIds: ['person-alpha-uuid'],
                totalProcessedPersonIds: new Set(),
                level: 1,
                requestInfo
            });

            expect(result).toContain('patient-alpha-uuid');
            expect(result).not.toContain('patient-beta-uuid');
            // The recursive lookup for personBeta is still issued (the link is followed to
            // *attempt* a lookup), but it must be gated by the caller's own uuid, not by an
            // access-tag filter.
            expect(mockDatabaseQueryManager.findAsync).toHaveBeenCalledTimes(2);
            const secondCallQuery = mockDatabaseQueryManager.findAsync.mock.calls[1][0].query;
            expect(extractRequiredUuidEquality(secondCallQuery)).toEqual('person-alpha-uuid');
        });

        test('should NOT include patients reached transitively (Person -> Person -> Person), i.e. the check must propagate through every recursion level', async () => {
            // alpha -> beta -> gamma; gamma is two hops away from the top-level person.
            const personAlpha = {
                _uuid: 'person-alpha-uuid',
                meta: { security: [{ system: SecurityTagSystem.access, code: 'alpha_health' }] },
                link: [{ target: { _uuid: 'Person/person-beta-uuid', type: 'Person' } }]
            };
            const personBeta = {
                _uuid: 'person-beta-uuid',
                meta: { security: [{ system: SecurityTagSystem.access, code: 'alpha_health' }] },
                link: [{ target: { _uuid: 'Person/person-gamma-uuid', type: 'Person' } }]
            };
            const personGamma = {
                _uuid: 'person-gamma-uuid',
                meta: { security: [{ system: SecurityTagSystem.access, code: 'gamma_labs' }] },
                link: [{ target: { _uuid: 'Patient/patient-gamma-uuid', type: 'Patient' } }]
            };

            mockFindAsyncSequence([[personAlpha], [personBeta], [personGamma]]);

            const expander = createExpander(['alpha_health']);

            const result = await expander.getPatientIdsFromPersonAsync({
                databaseQueryManager: mockDatabaseQueryManager,
                personIds: ['person-alpha-uuid'],
                totalProcessedPersonIds: new Set(),
                level: 1,
                requestInfo
            });

            expect(result).not.toContain('patient-gamma-uuid');
            // personBeta's _uuid never matches the caller's own uuid, so its lookup returns
            // nothing and recursion stops there -- personGamma's lookup is never even issued.
            expect(mockDatabaseQueryManager.findAsync).toHaveBeenCalledTimes(2);
            const secondCallQuery = mockDatabaseQueryManager.findAsync.mock.calls[1][0].query;
            expect(extractRequiredUuidEquality(secondCallQuery)).toEqual('person-alpha-uuid');
        });
    });

    describe('formerly-legitimate cross-tenant multi-Person-link traversal (MPS-style identity matching) is now also denied', () => {
        // This data model's Main-Person-to-Client-Person linking is *intentionally*
        // cross-tenant: a Main Person (e.g. owned by "bwell") legitimately links to Client
        // Person records owned by OTHER tenants (e.g. "mps-api"), each representing the same
        // real human's account at a different source system. Before IDG-5, this traversal
        // worked for a patient-scoped caller anchored at the Main Person (see
        // src/tests/patientScope/search_with_duplicate_patient_id.person_scope_uuid). IDG-5's
        // per-level _uuid check means it no longer does: only the Main Person's own direct
        // Patient.link remains reachable, and this Person.link hop is never followed. This is
        // the same restriction as above (see the describe block's title) -- it isn't specific
        // to same-tenant vs. cross-tenant, so this test only guards against silently
        // re-introducing hop-following in a way that's scoped to be tenant-aware instead of an
        // unconditional block.
        const requestInfo = {
            user: 'bwell-patient-user',
            scope: 'patient/Task.read admin/*.read',
            personIdFromJwtToken: 'main-person-uuid'
        };

        test('should NOT include a Patient reached via a Person.link to a Person owned by a different tenant', async () => {
            const mainPerson = {
                _uuid: 'main-person-uuid',
                meta: { security: [{ system: SecurityTagSystem.owner, code: 'bwell' }] },
                link: [{ target: { _uuid: 'Person/client-person-uuid', type: 'Person' } }]
            };
            const clientPerson = {
                _uuid: 'client-person-uuid',
                // Different owner tenant than the Main Person above -- this is the normal,
                // intentional shape of an MPS-matched Client Person, not an attack.
                meta: { security: [{ system: SecurityTagSystem.owner, code: 'mps-api' }] },
                link: [{ target: { _uuid: 'Patient/mps-patient-uuid', type: 'Patient' } }]
            };

            // No access/ scope on this token, so getSecurityTagsFromScope() legitimately
            // returns [] -- irrelevant here since hasPatientScope's _uuid check is what gates
            // this now, not the access-tag filter.
            mockFindAsyncSequence([[mainPerson], [clientPerson]]);

            const expander = createExpander([]);

            const result = await expander.getPatientIdsFromPersonAsync({
                databaseQueryManager: mockDatabaseQueryManager,
                personIds: ['main-person-uuid'],
                totalProcessedPersonIds: new Set(),
                level: 1,
                requestInfo
            });

            expect(result).not.toContain('mps-patient-uuid');
        });
    });
});
