'use strict';

/**
 * Regression test tracking a KNOWN, DOCUMENTED gap from docs/resource-authorization.md §12
 * "Known gaps in the current implementation" — the "High — `$access-history` link traversal drops
 * the access-tag check past the first hop" finding.
 *
 * This is intentionally a `test.failing` (Jest 30): the assertion below encodes CORRECT behavior
 * that `PersonToPatientIdsExpander.getPatientIdsFromPersonAsync` does not currently implement. The
 * test SUCCEEDS (green) as long as the assertion keeps failing internally, i.e. as long as the bug
 * is still present. If someone fixes the bug and forgets to flip this back to `test(...)`, this
 * file turns red in CI, which is the whole point. Not new/undiscovered — see §12 for the write-up.
 *
 * Background:
 *   `getPatientIdsFromPersonAsync` (src/utils/personToPatientIdsExpander.js:200) only applies the
 *   caller's access-tag filter to the Mongo query when `addTopPersonAccessCheck` is true (or the
 *   `$everything` GET special-case matches) — see lines ~224-264. Its own recursive calls, made
 *   when a Person links to another Person (lines ~350 and ~372), pass `requestInfo` through but
 *   never forward `addTopPersonAccessCheck`, so it silently defaults back to `false` at every
 *   deeper recursion level (the parameter default on line ~209). That means: a caller who is only
 *   entitled to see the *top-level* Person (because it passed the access-tag filter there) will
 *   still have every Person/Patient reachable by following `Person.link` at depth >= 2 returned to
 *   them, with no re-check that they hold an access tag for that deeper resource's tenant.
 *
 * This test constructs a 2-level Person.link chain:
 *   - level 0: Person tagged for `clientA` (the caller's tenant) — reachable via the top-level
 *     access-tag-filtered query.
 *   - level 1: Person tagged for `clientB` only, linked from level 0, itself linking to a Patient.
 *
 * The mocked `databaseQueryManager.findAsync` simulates "this document only comes back if the
 * query actually carries a security-tag filter that matches it" — i.e. when the real code applies
 * `securityTagManager.getQueryWithSecurityTags`, only documents whose tag is in that filter are
 * returned by the (fake) database; when the code does NOT apply any tag filter (the bug, at
 * recursion depth >= 2), the fake database returns anything matching by id regardless of tag,
 * exactly mirroring what an unfiltered Mongo query would do against real data.
 */
const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

jestGlobal.mock('../../../utils/assertType', () => ({
    assertIsValid: (obj, message) => {
        if (!obj) {
            throw new Error(message || 'obj is null or undefined');
        }
    },
    assertTypeEquals: () => {}
}));

const { PersonToPatientIdsExpander } = require('../../../utils/personToPatientIdsExpander');
const { SecurityTagSystem } = require('../../../utils/securityTagSystem');

/**
 * Recursively walks a Mongo-style query object and collects every string found inside a `$in`
 * array. `FilterById.getListFilter` (the real, un-mocked code used by the class under test)
 * always expresses "which ids am I looking for" this way, regardless of which field name it
 * attaches the `$in` to, so this is a faithful, shape-agnostic way for the fake DB to know which
 * ids were requested.
 * @param {*} node
 * @param {Set<string>} into
 */
function collectRequestedIds (node, into) {
    if (!node || typeof node !== 'object') {
        return;
    }
    if (Array.isArray(node)) {
        node.forEach((child) => collectRequestedIds(child, into));
        return;
    }
    for (const [key, value] of Object.entries(node)) {
        if (key === '$in' && Array.isArray(value)) {
            value.forEach((v) => {
                if (typeof v === 'string') {
                    into.add(v);
                }
            });
        } else {
            collectRequestedIds(value, into);
        }
    }
}

/**
 * Builds a fake async cursor over a plain array, matching the subset of the real cursor's shape
 * (`hasNext`/`nextObject`) that `getPatientIdsFromPersonAsync` actually uses.
 * @param {object[]} docs
 */
function makeFakeCursor (docs) {
    let index = 0;
    return {
        hasNext: async () => index < docs.length,
        nextObject: async () => docs[index++]
    };
}

describe('§12 known gap — $access-history link traversal drops the access-tag check past the first hop', () => {
    /** @type {PersonToPatientIdsExpander} */
    let expander;
    /** @type {object[]} */
    let fakeDatabase;
    /** @type {{findAsync: jest.Mock}} */
    let mockDatabaseQueryManager;

    const levelZeroPerson = {
        id: 'person-0',
        _uuid: 'person-0-uuid',
        _sourceId: 'person-0',
        meta: {
            security: [
                { system: SecurityTagSystem.access, code: 'clientA' }
            ]
        },
        link: [
            { target: { _uuid: 'Person/person-1-uuid', type: 'Person' } }
        ]
    };

    const levelOnePerson = {
        id: 'person-1-uuid',
        _uuid: 'person-1-uuid',
        _sourceId: 'person-1-uuid',
        meta: {
            // Tagged for a DIFFERENT tenant than the caller's clientA access tag.
            security: [
                { system: SecurityTagSystem.access, code: 'clientB' }
            ]
        },
        link: [
            { target: { _uuid: 'Patient/patient-1-uuid', type: 'Patient' } }
        ]
    };

    beforeEach(() => {
        fakeDatabase = [levelZeroPerson, levelOnePerson];

        mockDatabaseQueryManager = {
            findAsync: jestGlobal.fn(async ({ query }) => {
                const requestedIds = new Set();
                collectRequestedIds(query, requestedIds);
                const securityTags = query && query.__securityTagsAppliedForTest;

                const matches = fakeDatabase.filter((doc) => {
                    const idMatches = requestedIds.has(doc.id) ||
                        requestedIds.has(doc._uuid) ||
                        requestedIds.has(doc._sourceId);
                    if (!idMatches) {
                        return false;
                    }
                    if (!securityTags) {
                        // No tag filter was applied to this query at all -- an unfiltered Mongo
                        // query returns the document regardless of its tag. This is what happens
                        // today at recursion depth >= 2 (the bug).
                        return true;
                    }
                    const docAccessCodes = (doc.meta.security || [])
                        .filter((s) => s.system === SecurityTagSystem.access)
                        .map((s) => s.code);
                    return docAccessCodes.some((code) => securityTags.includes(code));
                });

                return makeFakeCursor(matches);
            })
        };

        const mockScopesManager = {
            isAccessAllowedByPatientScopes: jestGlobal.fn().mockReturnValue(false)
        };

        const mockSecurityTagManager = {
            getSecurityTagsFromScope: jestGlobal.fn().mockReturnValue(['clientA']),
            // Mirrors the real SecurityTagManager.getQueryWithSecurityTags contract: given a base
            // query and a list of security tags, returns a query that also carries a security tag
            // requirement. We tag the returned query with a test-only marker so the fake DB above
            // can tell "a tag filter was applied" apart from "no tag filter was applied" without
            // needing to reimplement Mongo's query semantics.
            getQueryWithSecurityTags: jestGlobal.fn(({ query, securityTags }) => ({
                ...query,
                __securityTagsAppliedForTest: securityTags
            }))
        };

        const mockConfigManager = {
            enableProxyPersonScopeCheckForEverything: false,
            useAccessIndex: false
        };

        expander = new PersonToPatientIdsExpander({
            databaseQueryFactory: {},
            scopesManager: mockScopesManager,
            securityTagManager: mockSecurityTagManager,
            configManager: mockConfigManager
        });
    });

    test.failing(
        'a Patient reachable only through a second-hop Person link tagged for a different ' +
        "tenant than the caller's must not be included in the result",
        async () => {
            const requestInfo = {
                user: 'service-account@clientA',
                scope: 'access/clientA.read',
                originalUrl: '/4_0_0/Person/person-0/$access-history',
                method: 'GET'
            };

            const patientIds = await expander.getPatientIdsFromPersonAsync({
                personIds: ['person-0'],
                totalProcessedPersonIds: new Set(),
                databaseQueryManager: mockDatabaseQueryManager,
                level: 1,
                toMap: false,
                requestInfo,
                addTopPersonAccessCheck: true
            });

            // CORRECT behavior: the caller only holds an access tag for clientA. The level-1
            // Person (and the Patient linked from it) is tagged for clientB only, so it must never
            // be resolved into the result, no matter how many link hops away it is.
            //
            // ACTUAL current behavior: the recursive call omits addTopPersonAccessCheck, so no
            // security-tag filter is applied to the level-1 query. The fake DB above then returns
            // the clientB-tagged Person purely by id match, and its linked Patient
            // ("patient-1-uuid") leaks into the result.
            expect(patientIds).not.toContain('patient-1-uuid');
        }
    );
});
