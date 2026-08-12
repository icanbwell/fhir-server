'use strict';

/**
 * Regression test for a FIXED gap that was tracked in docs/resource-authorization.md §12
 * "Known gaps in the current implementation" — the "High — `$access-history` link traversal drops
 * the access-tag check past the first hop" finding.
 *
 * Originally written as `test.failing` (Jest 30) to document a real, then-unfixed bug. The fix
 * forwards `addTopPersonAccessCheck` through both recursive calls in
 * `getPatientIdsFromPersonAsync`, so the access-tag filter now applies at every recursion level,
 * not just the initial lookup. This is now a plain `test(...)` asserting the fixed behavior.
 *
 * Background (kept for context; see docs/resource-authorization.md §12 for the historical write-up):
 *   Before the fix, `getPatientIdsFromPersonAsync` (src/utils/personToPatientIdsExpander.js) only
 *   applied the caller's access-tag filter to the Mongo query when `addTopPersonAccessCheck` was
 *   true (or the `$everything` GET special-case matched). Its own recursive calls, made when a
 *   Person links to another Person, passed `requestInfo` through but never forwarded
 *   `addTopPersonAccessCheck`, so it silently defaulted back to `false` at every deeper recursion
 *   level. A caller entitled to see only the *top-level* Person (having passed the access-tag
 *   filter there) would still have every Person/Patient reachable by following `Person.link` at
 *   depth >= 2 returned to them, with no re-check that they held an access tag for that deeper
 *   resource's tenant.
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
            isAccessAllowedByPatientScopes: jestGlobal.fn().mockReturnValue(false),
            hasPatientScope: jestGlobal.fn().mockReturnValue(false)
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

    test('a Patient reachable only through a second-hop Person link tagged for a different ' +
        "tenant than the caller's must not be included in the result", async () => {
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

        // The caller only holds an access tag for clientA. The level-1 Person (and the Patient
        // linked from it) is tagged for clientB only, so it must never be resolved into the
        // result, no matter how many link hops away it is.
        expect(patientIds).not.toContain('patient-1-uuid');
    });

    test('a Patient reachable through a second-hop Person link tagged for the SAME tenant as the ' +
        'caller is still included', async () => {
        // Regression guard for the fix itself: propagating addTopPersonAccessCheck through
        // recursion must not turn into an unconditional deny — a legitimately-reachable,
        // correctly-tagged deeper resource should still come back.
        fakeDatabase[1] = {
            ...levelOnePerson,
            meta: {
                security: [{ system: SecurityTagSystem.access, code: 'clientA' }]
            }
        };

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

        expect(patientIds).toContain('patient-1-uuid');
    });
});
