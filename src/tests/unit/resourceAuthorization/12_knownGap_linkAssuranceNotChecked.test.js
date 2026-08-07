'use strict';

/**
 * Regression test tracking a KNOWN, DOCUMENTED gap from docs/resource-authorization.md §12
 * "Known gaps in the current implementation" — the "Medium — link traversal never checks
 * `assurance`" finding.
 *
 * Unlike the other §12 findings covered in this directory (see
 * 12_knownGap_patientScopedWriteTagBypass.test.js and
 * 12_knownGap_accessHistoryLinkTraversalLeak.test.js), this one is NOT expressed as a
 * `test.failing`. Those two findings have a clearly documented CORRECT behavior elsewhere in the
 * codebase (a doc comment on the very function that skips the check, or the caller's own access
 * grant) that the code fails to implement, so "assert the correct behavior, watch it fail" is an
 * honest test. This finding is different: nothing in this codebase specifies what threshold of
 * `Person.link.assurance` (FHIR's match-confidence code: level1/level2/level3/level4) should or
 * should not be traversed. Inventing a specific policy (e.g. "level1 links must be excluded") and
 * asserting it as `test.failing` would fabricate a requirement this repo has never stated, which is
 * exactly the mistake this task was set up to avoid repeating (see the removed
 * delegatedAccessScopeManager.test.js precedent).
 *
 * So instead this file documents the verified, narrower fact from §12: no code path in
 * personToPatientIdsExpander.js reads `link.assurance` at all, so every link is followed
 * identically regardless of its assurance level. Both assertions below are plain `test(...)` and
 * currently PASS — they document the current (gap-having) behavior, not a fix. If someone adds
 * assurance-aware filtering, the second test's expectation (that assurance has zero effect) will
 * correctly break, which is the intended signal to come update/remove this file.
 */
const fs = require('fs');
const path = require('path');
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

describe('§12 known gap — link traversal never checks Person.link.assurance', () => {
    test('source file does not reference `assurance` anywhere', () => {
        const sourcePath = path.join(__dirname, '../../../utils/personToPatientIdsExpander.js');
        const source = fs.readFileSync(sourcePath, 'utf8');

        // This is the actual verified claim from §12: the field is never read. If this ever
        // fails, someone added assurance-handling code and this whole file (including the
        // behavioral test below) should be revisited/removed rather than "fixed" to keep passing.
        expect(source).not.toMatch(/assurance/i);
    });

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
                useAccessIndex: false
            };

            expander = new PersonToPatientIdsExpander({
                databaseQueryFactory: {},
                scopesManager: mockScopesManager,
                securityTagManager: mockSecurityTagManager,
                configManager: mockConfigManager
            });
        });

        test('a level1 (weakest) link and a level4 (strongest) link are both followed identically', async () => {
            const patientIds = await expander.getPatientIdsFromPersonAsync({
                personIds: ['person-top'],
                totalProcessedPersonIds: new Set(),
                databaseQueryManager: mockDatabaseQueryManager,
                level: 1,
                toMap: false
            });

            // Documents the gap: both links are followed with no distinction whatsoever based on
            // assurance. This is the CURRENT (gap-having) behavior, so it is a plain assertion,
            // not a test.failing.
            expect(patientIds).toContain('patient-weak-link-uuid');
            expect(patientIds).toContain('patient-strong-link-uuid');
        });
    });
});
