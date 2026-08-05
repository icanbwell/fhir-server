/**
 * Tests for PersonToPatientIdsExpander cross-tenant boundary
 * Verifies that person expansion does NOT cross tenant boundaries when the caller has
 * requested the top-person access-tag check (addTopPersonAccessCheck), including at
 * recursion depths beyond the top-level Person.
 *
 * Two distinct caller shapes are covered, because they are protected by two different
 * mechanisms in getPatientIdsFromPersonAsync():
 *  - A caller whose scope legitimately carries its own access/ code (e.g. a combined
 *    "patient/... access/tenant.read" scope) is protected by the existing scope-derived
 *    security-tag query filter (getSecurityTagsFromScope / getQueryWithSecurityTags).
 *  - A pure patient-scope caller (e.g. "patient/Person.read" with no access/ scope at all --
 *    the normal shape for a plain patient-facing app token) never carries an access/ scope by
 *    design (see ScopesManager.isAccessToResourceAllowedBySecurityTags), so that mechanism is a
 *    guaranteed no-op for them. They are protected instead by an owner-tag same-tenant check
 *    against the caller's own top-level Person.
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
            const requiredAccessCodes = extractRequiredAccessCodes(query);
            if (requiredAccessCodes.length === 0) {
                return createCursor(docsForThisCall);
            }
            // Simulate what a real MongoDB query with this filter would return: only docs
            // carrying at least one of the required access codes.
            const matchingDocs = docsForThisCall.filter(
                (doc) => requiredAccessCodes.some((code) => docHasAccessCode(doc, code))
            );
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

    describe('BUG: Person expansion follows links across tenant boundaries', () => {
        const callerAccessCodes = ['alpha_health'];
        const requestInfo = { user: 'alpha-test-user', scope: 'patient/Person.read access/alpha_health.read' };

        test('should NOT include patients from a different tenant reached via a direct Person.link, when addTopPersonAccessCheck is requested', async () => {
            // PersonAlpha (tenant alpha) has a link to PersonBeta (tenant beta).
            // This should NOT happen in clean data, but if it does (data corruption,
            // migration error, or intentional manipulation), a caller that asked for the
            // top-person access check must not have the cross-tenant Person/Patient silently
            // included.
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

            const expander = createExpander(callerAccessCodes);

            const result = await expander.getPatientIdsFromPersonAsync({
                databaseQueryManager: mockDatabaseQueryManager,
                personIds: ['person-alpha-uuid'],
                totalProcessedPersonIds: new Set(),
                level: 1,
                requestInfo,
                addTopPersonAccessCheck: true
            });

            expect(result).toContain('patient-alpha-uuid');
            expect(result).not.toContain('patient-beta-uuid');
            // The recursive lookup for personBeta must have been issued with the caller's
            // access-tag filter applied -- not just the top-level lookup.
            expect(mockDatabaseQueryManager.findAsync).toHaveBeenCalledTimes(2);
            const secondCallQuery = mockDatabaseQueryManager.findAsync.mock.calls[1][0].query;
            expect(extractRequiredAccessCodes(secondCallQuery)).toEqual(callerAccessCodes);
        });

        test('should NOT include patients from a different tenant reached transitively (Person -> Person -> Person), i.e. the check must propagate through every recursion level', async () => {
            // alpha -> beta -> gamma; gamma is two hops away from the top-level person and
            // belongs to a third, unrelated tenant.
            const personAlpha = {
                _uuid: 'person-alpha-uuid',
                meta: { security: [{ system: SecurityTagSystem.access, code: 'alpha_health' }] },
                link: [{ target: { _uuid: 'Person/person-beta-uuid', type: 'Person' } }]
            };
            const personBeta = {
                _uuid: 'person-beta-uuid',
                // Beta is (implausibly, but per the attack scenario) still readable by alpha,
                // e.g. a shared plan -- this is what lets the traversal reach it at all.
                meta: { security: [{ system: SecurityTagSystem.access, code: 'alpha_health' }] },
                link: [{ target: { _uuid: 'Person/person-gamma-uuid', type: 'Person' } }]
            };
            const personGamma = {
                _uuid: 'person-gamma-uuid',
                meta: { security: [{ system: SecurityTagSystem.access, code: 'gamma_labs' }] },
                link: [{ target: { _uuid: 'Patient/patient-gamma-uuid', type: 'Patient' } }]
            };

            mockFindAsyncSequence([[personAlpha], [personBeta], [personGamma]]);

            const expander = createExpander(callerAccessCodes);

            const result = await expander.getPatientIdsFromPersonAsync({
                databaseQueryManager: mockDatabaseQueryManager,
                personIds: ['person-alpha-uuid'],
                totalProcessedPersonIds: new Set(),
                level: 1,
                requestInfo,
                addTopPersonAccessCheck: true
            });

            expect(result).not.toContain('patient-gamma-uuid');
            expect(mockDatabaseQueryManager.findAsync).toHaveBeenCalledTimes(3);
            const thirdCallQuery = mockDatabaseQueryManager.findAsync.mock.calls[2][0].query;
            expect(extractRequiredAccessCodes(thirdCallQuery)).toEqual(callerAccessCodes);
        });
    });

    describe('BUG: pure patient-scope caller (no access/ scope) gets no protection from the scope-derived filter', () => {
        // Realistic shape for a plain patient-facing app token: a bare patient/ scope with no
        // combined access/ scope at all. getSecurityTagsFromScope() legitimately returns []
        // for this caller (see ScopesManager.isAccessToResourceAllowedBySecurityTags), which
        // makes getQueryWithSecurityTags() a no-op query filter. The owner-tag same-tenant
        // check is the only thing protecting this caller.
        const requestInfo = { user: 'alpha-patient-user', scope: 'patient/Person.read' };

        test('should NOT include patients from a different tenant reached via a direct Person.link, even with no access/ scope on the token', async () => {
            const personAlpha = {
                _uuid: 'person-alpha-uuid',
                _sourceId: 'alpha-bob',
                meta: {
                    security: [
                        { system: SecurityTagSystem.owner, code: 'alpha_health' }
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
                        { system: SecurityTagSystem.owner, code: 'beta_insurance' }
                    ]
                },
                link: [
                    { target: { _uuid: 'Patient/patient-beta-uuid', type: 'Patient' } }
                ]
            };

            // The query filter is a no-op for this caller (no access codes at all), so the mock's
            // findAsync returns whatever it was seeded with regardless of query content -- exactly
            // what getQueryWithSecurityTags() would do against a real MongoDB with securityTags=[].
            mockFindAsyncSequence([[personAlpha], [personBeta]]);

            const expander = createExpander([]);

            const result = await expander.getPatientIdsFromPersonAsync({
                databaseQueryManager: mockDatabaseQueryManager,
                personIds: ['person-alpha-uuid'],
                totalProcessedPersonIds: new Set(),
                level: 1,
                requestInfo,
                addTopPersonAccessCheck: true
            });

            expect(result).toContain('patient-alpha-uuid');
            expect(result).not.toContain('patient-beta-uuid');
            // Confirms the scope-derived filter really was a no-op (no access codes were required)
            // and that the owner-tag check is what did the rejecting, not the mongo query.
            expect(mockDatabaseQueryManager.findAsync).toHaveBeenCalledTimes(2);
            const secondCallQuery = mockDatabaseQueryManager.findAsync.mock.calls[1][0].query;
            expect(extractRequiredAccessCodes(secondCallQuery)).toEqual([]);
        });

        test('should NOT include patients from a different tenant reached transitively (Person -> Person -> Person), even with no access/ scope on the token', async () => {
            const personAlpha = {
                _uuid: 'person-alpha-uuid',
                meta: { security: [{ system: SecurityTagSystem.owner, code: 'alpha_health' }] },
                link: [{ target: { _uuid: 'Person/person-beta-uuid', type: 'Person' } }]
            };
            const personBeta = {
                _uuid: 'person-beta-uuid',
                // Still owned by alpha -- represents a legitimate same-tenant Client Person hop
                // in the middle of the chain.
                meta: { security: [{ system: SecurityTagSystem.owner, code: 'alpha_health' }] },
                link: [{ target: { _uuid: 'Person/person-gamma-uuid', type: 'Person' } }]
            };
            const personGamma = {
                _uuid: 'person-gamma-uuid',
                meta: { security: [{ system: SecurityTagSystem.owner, code: 'gamma_labs' }] },
                link: [{ target: { _uuid: 'Patient/patient-gamma-uuid', type: 'Patient' } }]
            };

            mockFindAsyncSequence([[personAlpha], [personBeta], [personGamma]]);

            const expander = createExpander([]);

            const result = await expander.getPatientIdsFromPersonAsync({
                databaseQueryManager: mockDatabaseQueryManager,
                personIds: ['person-alpha-uuid'],
                totalProcessedPersonIds: new Set(),
                level: 1,
                requestInfo,
                addTopPersonAccessCheck: true
            });

            expect(result).not.toContain('patient-gamma-uuid');
            expect(mockDatabaseQueryManager.findAsync).toHaveBeenCalledTimes(3);
        });
    });

    describe('REGRESSION: legitimate same-tenant multi-Person-link traversal must not be denied', () => {
        // Normal data-model shape per review.md §1: a Main Person linked to multiple Client
        // Persons, all owned by the same tenant as the Main Person itself. The owner-tag
        // check must not false-positive-deny this, even for a pure patient-scope caller.
        const requestInfo = { user: 'alpha-patient-user', scope: 'patient/Person.read' };

        test('should include patients from multiple same-tenant Client Persons linked from the top-level Person', async () => {
            const mainPerson = {
                _uuid: 'main-person-uuid',
                meta: { security: [{ system: SecurityTagSystem.owner, code: 'alpha_health' }] },
                link: [
                    { target: { _uuid: 'Person/client-person-1-uuid', type: 'Person' } },
                    { target: { _uuid: 'Person/client-person-2-uuid', type: 'Person' } }
                ]
            };
            const clientPerson1 = {
                _uuid: 'client-person-1-uuid',
                meta: { security: [{ system: SecurityTagSystem.owner, code: 'alpha_health' }] },
                link: [{ target: { _uuid: 'Patient/patient-1-uuid', type: 'Patient' } }]
            };
            const clientPerson2 = {
                _uuid: 'client-person-2-uuid',
                meta: { security: [{ system: SecurityTagSystem.owner, code: 'alpha_health' }] },
                link: [{ target: { _uuid: 'Patient/patient-2-uuid', type: 'Patient' } }]
            };

            mockFindAsyncSequence([[mainPerson], [clientPerson1, clientPerson2]]);

            const expander = createExpander([]);

            const result = await expander.getPatientIdsFromPersonAsync({
                databaseQueryManager: mockDatabaseQueryManager,
                personIds: ['main-person-uuid'],
                totalProcessedPersonIds: new Set(),
                level: 1,
                requestInfo,
                addTopPersonAccessCheck: true
            });

            expect(result).toContain('patient-1-uuid');
            expect(result).toContain('patient-2-uuid');
        });
    });
});
