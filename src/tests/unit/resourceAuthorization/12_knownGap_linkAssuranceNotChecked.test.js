'use strict';

/**
 * Regression test tracking docs/resource-authorization.md §12 "Known gaps in the current
 * implementation" — the "Open — link traversal never checks `assurance`" finding.
 *
 * DCON-4894 added assurance-awareness to personToPatientIdsExpander.js in two sequential,
 * separately-committed changes:
 *   - Commit A: dry-run logging (configManager.logPersonLinkAssuranceBelowMinimum, default
 *     false) that logs a warning whenever a followed Person.link's `assurance` value doesn't
 *     meet the configured configManager.personLinkAssuranceMinimumLevel (default 'level2'),
 *     without changing which links are followed.
 *   - Commit B: an enforcement gate (configManager.enforcePersonLinkAssuranceMinimum, default
 *     false in code regardless of environment configuration) that, only once explicitly turned
 *     on, excludes a below-minimum link from being followed at all.
 *
 * Both flags default to false, and Commit B's flag is intentionally meant to stay off until
 * Commit A's logging has been observed in a real environment (see
 * personToPatientIdsExpander.assuranceLogging.test.js and
 * personToPatientIdsExpander.assuranceEnforcement.test.js for coverage of both). So under the
 * code-level defaults exercised below, traversal behavior is unchanged from before DCON-4894:
 * every link is still followed regardless of its assurance level. What IS no longer true is the
 * original narrower claim this file made -- that no code path reads `link.assurance` at all --
 * so that assertion has been removed rather than kept passing artificially. The still-accurate
 * behavioral claim (every link followed identically under default configuration) is kept below.
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

function makeFakeCursor (docs) {
    let index = 0;
    return {
        hasNext: async () => index < docs.length,
        nextObject: async () => docs[index++]
    };
}

describe('§12 known gap — link traversal never checks Person.link.assurance (under default config)', () => {
    describe('behavioral demonstration', () => {
        /** @type {PersonToPatientIdsExpander} */
        let expander;
        /** @type {object[]} */
        let fakeDatabase;
        /** @type {{findAsync: jest.Mock}} */
        let mockDatabaseQueryManager;

        // Top-level person links to two patients: one via a link explicitly marked with the
        // weakest possible identity-assurance level (level1 - "Local" per the FHIR
        // identity-assuranceLevel ValueSet), and one via a link with the strongest
        // (level4 - "Strong-Verified"). If assurance were honored at all, these would plausibly
        // be treated differently.
        const topPerson = {
            id: 'person-top',
            _uuid: 'person-top-uuid',
            _sourceId: 'person-top',
            meta: { security: [{ system: SecurityTagSystem.access, code: 'clientA' }] },
            link: [
                {
                    target: { _uuid: 'Patient/patient-weak-link-uuid', type: 'Patient' },
                    assurance: 'level1'
                },
                {
                    target: { _uuid: 'Patient/patient-strong-link-uuid', type: 'Patient' },
                    assurance: 'level4'
                }
            ]
        };

        beforeEach(() => {
            fakeDatabase = [topPerson];

            mockDatabaseQueryManager = {
                findAsync: jestGlobal.fn(async () => makeFakeCursor(fakeDatabase))
            };

            const mockScopesManager = {
                isAccessAllowedByPatientScopes: jestGlobal.fn().mockReturnValue(false)
            };
            const mockSecurityTagManager = {
                getSecurityTagsFromScope: jestGlobal.fn().mockReturnValue([]),
                getQueryWithSecurityTags: jestGlobal.fn(({ query }) => query)
            };
            const mockConfigManager = {
                enableProxyPersonScopeCheckForEverything: false,
                useAccessIndex: false,
                // Explicitly false, matching the code-level defaults added by DCON-4894:
                // dry-run logging and enforcement both stay off unless an operator opts in.
                logPersonLinkAssuranceBelowMinimum: false,
                enforcePersonLinkAssuranceMinimum: false
            };

            expander = new PersonToPatientIdsExpander({
                databaseQueryFactory: {},
                scopesManager: mockScopesManager,
                securityTagManager: mockSecurityTagManager,
                configManager: mockConfigManager
            });
        });

        test('a level1 (weakest) link and a level4 (strongest) link are both followed identically under default configuration', async () => {
            const patientIds = await expander.getPatientIdsFromPersonAsync({
                personIds: ['person-top'],
                totalProcessedPersonIds: new Set(),
                databaseQueryManager: mockDatabaseQueryManager,
                level: 1,
                toMap: false
            });

            // Documents the out-of-the-box behavior: with both DCON-4894 flags at their default
            // (false), both links are still followed with no distinction whatsoever based on
            // assurance. This is a plain assertion (not a test.failing) because it IS the correct
            // and intended default behavior -- enforcement is opt-in only, pending real-world
            // observation of the dry-run logging (see personToPatientIdsExpander.assuranceLogging
            // .test.js and personToPatientIdsExpander.assuranceEnforcement.test.js for the
            // opt-in-on behavior).
            expect(patientIds).toContain('patient-weak-link-uuid');
            expect(patientIds).toContain('patient-strong-link-uuid');
        });
    });
});
