# Close docs/resource-authorization.md §12 Open Findings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the four findings currently marked `Open` in `docs/resource-authorization.md`
§12 ("Known gaps in the current implementation"), each a confirmed gap between the authorization
model that doc describes and what the code actually enforces.

**Architecture:** Two of the four findings are independent, low-risk, mechanical fixes (the
Composition section filter's missing `unclassified` fold-in; `BwellPersonFinder`'s missing
intermediate-Person enumeration). The other two — `Person.link.assurance` never being checked,
and pure-`patient/`-scope callers getting no re-check on cross-tenant `Person.link` traversal —
turn out to be **the same underlying gap surfacing at two different layers**, not two separate
bugs: today, nothing in `PersonToPatientIdsExpander.getPatientIdsFromPersonAsync`
(`src/utils/personToPatientIdsExpander.js`) ever inspects the `assurance` field on a `Person.link`
entry before deciding to follow it into a recursion step, and the *existing* re-check that does
exist (the scope-derived `meta.security` filter added by the two FIXED findings already in §12)
is applied to the *query for the linked Person*, not to the *decision to follow the link at all*
— so it has nothing to bind to for a caller whose scope carries no access code at all
(`getSecurityTagsFromScope` legitimately returns `[]` for a pure `patient/` scope, which is a
no-op filter, not a deny). Gating the link-following decision itself on `assurance` — a check that
runs regardless of what scope the caller holds — closes both findings with one mechanism instead
of two. Because production `Person.link` data has never been inspected for how well
`assurance` is actually populated (§12's own text flags this as "not verifiable from this
codebase alone"), the enforcement is config-flagged, defaults to **off** in the same "log what
would have happened first" pattern already used elsewhere in this file
(`configManager.enableProxyPersonScopeCheckForEverything`), and the plan front-loads the logging
task before the enforcing task, so there's real signal to flip the flag on by, not a guess.

**Tech Stack:** Jest + MongoDB Memory Server, existing `src/tests/common.js` harness, the
`personToPatientIdsExpander.crossTenant.test.js` / `.pureScopeCrossTenant.bugs.test.js` fixture
style (inline person/patient objects, no `$merge` fixtures needed for these unit-level tests),
`configManager` getter pattern (`isTrue(env.X)` for booleans).

## Global Constraints

- **This data model's cross-tenant `Person.link`-ing is intentional, not a bug** — a bwell master
  Person owned by one tenant legitimately links to Client Person records owned by *other* tenants
  (confirmed against the real, currently-passing
  `src/tests/patientScope/search_with_duplicate_patient_id.person_scope_uuid` fixture). Two prior
  attempts to close a related gap by adding a same-tenant/tag-match requirement were built, merged
  as a first cut, and then reverted for exactly this reason: `8542592a5` (DCON-4806, write-path tag
  match) reverted in `a5ded4a4a`, and an owner-tag fallback for the pure-patient-scope case
  reverted in `e5b649607`. Any new gate in this area — including this plan's assurance check —
  must default to **off**, ship with a **dry-run/log-only** mode first, and get a real signal from
  that logging before anyone flips it to enforce. Do not skip the dry-run task to save time; that
  is exactly the shortcut that produced the two reverts above.
- FHIR R4's `Person.link.assurance` is a `code` bound to the `identity-assuranceLevel` ValueSet:
  `level1` (algorithmic match only) < `level2` (validated) < `level3` (validated with
  verification) < `level4` (level 3 + additional consent). Treat these as an ordered rank
  1–4 for the "minimum required level" comparison; an absent/unrecognized value must be treated as
  **rank 0** (fails any configured minimum) once enforcement is on — never treat "missing" as
  "trusted."
- Every new/modified config flag follows this file's existing pattern exactly: a boolean
  `enableX`/`enforceX` getter using `isTrue(env.X)`, defaulting to `false`
  (`src/utils/configManager.js`, see `enableConsentedProaDataAccess` at line 418 and
  `enableDelegatedAccessDetection` at line 1264 for the shape to copy).
- Do not touch the two already-`FIXED` findings' code (`ScopesManager.isAccessTagChangeAllowedByScopes`,
  the `addTopPersonAccessCheck` threading) — this plan only adds a new, independent check
  alongside them.
- Do not remove any test from `jest.config.js`'s `testPathIgnorePatterns` until you've run it
  directly and confirmed it passes against your branch — this repo's own convention (see the
  comment block above that array).

---

### Task 1: Composition section filter — fold in the hardcoded `unclassified` code

**Files:**
- Modify: `src/utils/compositionSectionFilter.js`
- Test: `src/tests/unit/utils/compositionSectionFilter.test.js` (new file — no existing unit test
  for this module today; current coverage is integration-level via
  `src/enrich/providers/compositionSectionFilterEnrichmentProvider.js`'s own tests)

**Interfaces:**
- Consumes: `SENSITIVE_CATEGORY` from `src/constants.js` (`SENSITIVE_CATEGORY.SYSTEM =
  'https://www.icanbwell.com/sensitivity-category'`, `SENSITIVE_CATEGORY.UNCLASSIFIED_CODE =
  'unclassified'`) — already imported in this file.
- Produces: no signature change to `filterCompositionSensitiveSections(resource,
  deniedSensitiveCategorySet)` — same call site in
  `compositionSectionFilterEnrichmentProvider.js:57` keeps working unchanged.

**Context:** `shouldRemoveSection` (`src/utils/compositionSectionFilter.js:4-11`) only strips a
section whose `code.coding` matches a code in the caller-supplied `deniedSensitiveCategorySet`
(the grantor's Consent `deny` provisions). The query-level exclusion this is meant to mirror,
`DataSharingManager.updateQueryForDelegatedAccessSensitiveData`
(`src/operations/search/dataSharingManager.js`), ANDs the hardcoded `unclassified` code onto the
denylist *in addition to* the Consent-derived ones (§9 of the doc). This function never does
that, so an `unclassified`-tagged section inside an otherwise-visible Composition survives.

- [ ] **Step 1: Write the failing test**

```javascript
// src/tests/unit/utils/compositionSectionFilter.test.js
const { describe, test, expect } = require('@jest/globals');
const { filterCompositionSensitiveSections } = require('../../../utils/compositionSectionFilter');
const { SENSITIVE_CATEGORY } = require('../../../constants');

describe('filterCompositionSensitiveSections', () => {
    test('strips a section tagged with the hardcoded unclassified code even when it is not in the denied set', () => {
        const resource = {
            _uuid: 'composition-1',
            section: [
                {
                    id: 'sec-unclassified',
                    code: {
                        coding: [
                            { system: SENSITIVE_CATEGORY.SYSTEM, code: SENSITIVE_CATEGORY.UNCLASSIFIED_CODE }
                        ]
                    }
                },
                {
                    id: 'sec-visible',
                    code: { coding: [{ system: SENSITIVE_CATEGORY.SYSTEM, code: 'behavioral-health' }] }
                }
            ]
        };

        // denylist does NOT contain 'unclassified' -- only a Consent-derived category
        filterCompositionSensitiveSections(resource, new Set(['substance-abuse']));

        const remainingIds = resource.section.map((s) => s.id);
        expect(remainingIds).toEqual(['sec-visible']);
    });

    test('still strips a Consent-denied category alongside the hardcoded unclassified code', () => {
        const resource = {
            _uuid: 'composition-2',
            section: [
                { id: 'sec-denied', code: { coding: [{ system: SENSITIVE_CATEGORY.SYSTEM, code: 'substance-abuse' }] } },
                { id: 'sec-unclassified', code: { coding: [{ system: SENSITIVE_CATEGORY.SYSTEM, code: SENSITIVE_CATEGORY.UNCLASSIFIED_CODE }] } },
                { id: 'sec-visible', code: { coding: [{ system: SENSITIVE_CATEGORY.SYSTEM, code: 'behavioral-health' }] } }
            ]
        };

        filterCompositionSensitiveSections(resource, new Set(['substance-abuse']));

        expect(resource.section.map((s) => s.id)).toEqual(['sec-visible']);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nvm use && node node_modules/.bin/jest src/tests/unit/utils/compositionSectionFilter.test.js -t "unclassified"`
Expected: FAIL — `sec-unclassified` is still present in `remainingIds` for the first test.

- [ ] **Step 3: Write the minimal implementation**

```javascript
// src/utils/compositionSectionFilter.js
function shouldRemoveSection({ section, deniedSensitiveCategorySet }) {
    if (!Array.isArray(section?.code?.coding)) {
        return false;
    }
    return section.code.coding.some(
        (c) =>
            c?.system === SENSITIVE_CATEGORY.SYSTEM &&
            (deniedSensitiveCategorySet.has(c?.code) || c?.code === SENSITIVE_CATEGORY.UNCLASSIFIED_CODE)
    );
}
```

(Only the `some()` predicate changes — add the `|| c?.code === SENSITIVE_CATEGORY.UNCLASSIFIED_CODE`
clause. `SENSITIVE_CATEGORY` is already imported at the top of the file.)

- [ ] **Step 4: Run test to verify it passes**

Run: `nvm use && node node_modules/.bin/jest src/tests/unit/utils/compositionSectionFilter.test.js`
Expected: PASS (both tests).

- [ ] **Step 5: Run the existing enrichment-provider tests to confirm no regression**

Run: `nvm use && node node_modules/.bin/jest src/tests/unit/enrich/providers/compositionSectionFilterEnrichmentProvider.test.js` (adjust path if the file lives elsewhere — `grep -rl compositionSectionFilterEnrichmentProvider src/tests` to confirm)
Expected: PASS, unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/utils/compositionSectionFilter.js src/tests/unit/utils/compositionSectionFilter.test.js
git commit -m "Fold hardcoded unclassified code into Composition section filter's denylist"
```

---

### Task 2: `BwellPersonFinder` — enumerate every intermediate Person on the walk to the master Person

**Files:**
- Modify: `src/utils/bwellPersonFinder.js`
- Modify: `src/dataLayer/postSaveHandlers/handlers/consentCacheInvalidationHandler.js`
- Test: `src/tests/unit/utils/bwellPersonFinder.test.js` (currently excluded in `jest.config.js`'s
  `testPathIgnorePatterns` — see Step 6 below for what to do about that)
- Test: `src/dataLayer/postSaveHandlers/handlers/consentCacheInvalidationHandler.test.js` (existing
  file, add cases)

**Interfaces:**
- Consumes: nothing new.
- Produces: new method `BwellPersonFinder.getPersonIdsInLinkPathToBwellPersonAsync({ patientId })
  -> Promise<string[]>` (returns every intermediate Person `_uuid` visited during the BFS walk,
  **including** the final bwell master Person id, in visit order; empty array if no path is
  found). `ConsentCacheInvalidationHandler` calls this instead of `getBwellPersonIdAsync` and
  bumps the cache generation for every id it returns, not just the last one.

**Context:** `BwellPersonFinder.searchForBwellPersonAsync`
(`src/utils/bwellPersonFinder.js:235-` — the recursive BFS-style walk) tracks `visitedSubjects` (a
`Set` of *subject reference strings*, used only to avoid infinite loops) but returns only the
final matched bwell-master-Person id — every Person it passed through on the way is discarded.
`ConsentCacheInvalidationHandler.afterSaveAsync`
(`src/dataLayer/postSaveHandlers/handlers/consentCacheInvalidationHandler.js`) therefore can only
bump the immediate client Person(s) (one hop, via `getImmediatePersonIdsOfPatientsAsync`) and the
master Person (via `getBwellPersonIdAsync`) — any Person strictly between those two hops in a
deeper link graph is never bumped, and its `$everything` cache entry (if any exists) would keep
serving pre-revocation PHI for the rest of the TTL. This is self-documented as a residual gap in
the handler's own class comment.

- [ ] **Step 1: Read the current recursive walk to confirm the exact return shape to extend**

```bash
sed -n '225,270p' src/utils/bwellPersonFinder.js
```
Confirm `searchForBwellPersonAsync` recurses by calling itself with the next `currentSubject` and
returns whatever the recursive call returns (a single id or `null`) — there is no accumulator
parameter yet.

- [ ] **Step 2: Write the failing test for `BwellPersonFinder`**

```javascript
// src/tests/unit/utils/bwellPersonFinder.test.js (add this describe block; keep existing ones)
describe('getPersonIdsInLinkPathToBwellPersonAsync', () => {
    test('returns every intermediate Person id plus the bwell master Person id, in visit order', async () => {
        // Patient -> ClientPerson (owner: acme) -> MasterPerson (owner: bwell, sourceAssigningAuthority: bwell)
        const patientId = 'patient-uuid-1';
        const clientPersonId = 'client-person-uuid-1';
        const masterPersonId = 'master-person-uuid-1';

        // isBwellPerson() unconditionally dereferences person.meta.security, so every doc
        // walked needs a meta.security array (empty is fine for non-master Persons) — see
        // src/tests/unit/utils/bwellPersonFinder.test.js's existing fixtures for this pattern.
        // The master Person is recognized by meta.security access+owner tags coded
        // BwellMasterPersonCode ('bwell'), not by an `identifier` entry.
        const clientPersonDoc = {
            _uuid: clientPersonId,
            meta: { security: [] },
            link: [{ target: { _uuid: `Patient/${patientId}`, type: 'Patient' } }]
        };
        const masterPersonDoc = {
            _uuid: masterPersonId,
            meta: {
                security: [
                    { system: SecurityTagSystem.access, code: 'bwell' },
                    { system: SecurityTagSystem.owner, code: 'bwell' }
                ]
            },
            link: [{ target: { _uuid: `Person/${clientPersonId}`, type: 'Person' } }]
        };

        // First query (by Patient/<id>) returns the client Person; second query
        // (by Person/<clientPersonId>) returns the master Person.
        let call = 0;
        const mockDatabaseQueryManager = {
            findAsync: jest.fn().mockImplementation(() => {
                call += 1;
                const doc = call === 1 ? clientPersonDoc : masterPersonDoc;
                let served = false;
                return Promise.resolve({
                    hasNext: async () => !served,
                    nextObject: async () => { served = true; return doc; }
                });
            })
        };
        // BwellPersonFinder's constructor asserts databaseQueryFactory instanceof
        // DatabaseQueryFactory (assertTypeEquals) — a plain object literal fails that check.
        // Build the mock off the real prototype, matching the sibling test file's existing helper.
        const mockDatabaseQueryFactory = Object.create(DatabaseQueryFactory.prototype);
        mockDatabaseQueryFactory.createQuery = jest.fn().mockReturnValue(mockDatabaseQueryManager);

        const finder = new BwellPersonFinder({ databaseQueryFactory: mockDatabaseQueryFactory });

        const path = await finder.getPersonIdsInLinkPathToBwellPersonAsync({ patientId });

        expect(path).toEqual([clientPersonId, masterPersonId]);
    });

    test('returns an empty array when no Person links to the patient at all', async () => {
        const mockDatabaseQueryManager = {
            findAsync: jest.fn().mockResolvedValue({ hasNext: async () => false, nextObject: async () => null })
        };
        const mockDatabaseQueryFactory = Object.create(DatabaseQueryFactory.prototype);
        mockDatabaseQueryFactory.createQuery = jest.fn().mockReturnValue(mockDatabaseQueryManager);
        const finder = new BwellPersonFinder({ databaseQueryFactory: mockDatabaseQueryFactory });

        const path = await finder.getPersonIdsInLinkPathToBwellPersonAsync({ patientId: 'patient-with-no-person' });

        expect(path).toEqual([]);
    });
});
```

(Add the necessary `require`/`jest.mock` boilerplate matching the rest of the existing file —
`DatabaseQueryFactory` and `SecurityTagSystem` in particular, needed by the mock construction and
`meta.security` tags above; this file is currently in `jest.config.js`'s ignore list for an
unrelated reason; see Step 6.)

- [ ] **Step 3: Run test to verify it fails**

Run: `nvm use && node node_modules/.bin/jest --testPathIgnorePatterns='/never-never-match/' src/tests/unit/utils/bwellPersonFinder.test.js -t "getPersonIdsInLinkPathToBwellPersonAsync"`

Expected: FAIL — `getPersonIdsInLinkPathToBwellPersonAsync is not a function`.

> Note: overriding `testPathIgnorePatterns` on the CLI to force a single ignored file to run also
> removes the `.claude/`/worktree exclusion, which can pull in unrelated test files from other
> worktrees under this repo and produce noisy, unrelated failures/hangs if you don't scope the
> positional pattern tightly. Prefer temporarily commenting out just this file's line in
> `jest.config.js` locally over the CLI flag if that happens; do not commit that comment-out.

- [ ] **Step 4: Implement `getPersonIdsInLinkPathToBwellPersonAsync`**

```javascript
// src/utils/bwellPersonFinder.js -- add alongside getBwellPersonIdAsync

/**
 * Like getBwellPersonIdAsync, but returns every Person _uuid visited while walking
 * Person.link from the given patient up to (and including) the bwell master Person,
 * in visit order -- not just the final master Person id. Used by cache-invalidation
 * paths that need to bump every Person the walk passed through, not only the two
 * endpoints. Returns [] if no Person links to the patient at all.
 * @param {string} patientId
 * @return {Promise<string[]>}
 */
async getPersonIdsInLinkPathToBwellPersonAsync ({ patientId }) {
    const databaseQueryManager = this.databaseQueryFactory.createQuery({
        resourceType: 'Person',
        base_version: '4_0_0'
    });

    const path = [];
    await this.searchForBwellPersonAsync({
        currentSubject: `${PATIENT_REFERENCE_PREFIX}${patientId}`,
        databaseQueryManager,
        visitedSubjects: new Set(),
        path
    });
    return path;
}
```

Then modify `searchForBwellPersonAsync` to accept an optional `path` array and push each
intermediate Person's `_uuid` onto it as it's visited (before recursing further):

```javascript
// src/utils/bwellPersonFinder.js -- modify the existing method signature and body
async searchForBwellPersonAsync ({ currentSubject, databaseQueryManager, visitedSubjects, path }) {
    if (visitedSubjects.has(currentSubject)) {
        return null;
    }

    visitedSubjects.add(currentSubject);
    // ... existing query logic unchanged ...

    while (!foundPersonId && (await linkedPersons.hasNext())) {
        const nextPerson = await linkedPersons.nextObject();
        const nextPersonId = nextPerson._uuid;
        if (path) {
            path.push(nextPersonId);
        }
        if (this.isBwellPerson(nextPerson)) {
            foundPersonId = nextPersonId;
        } else {
            foundPersonId = await this.searchForBwellPersonAsync({
                currentSubject: `${PERSON_REFERENCE_PREFIX}${nextPersonId}`,
                databaseQueryManager,
                visitedSubjects,
                path
            });
        }
    }
    return foundPersonId;
}
```

(Read the full existing method body first — `sed -n '235,275p' src/utils/bwellPersonFinder.js` —
and adapt this sketch to match the real control flow exactly; the surrounding lines this task
doesn't show are unchanged. `getBwellPersonIdAsync`'s own call site must keep passing `path:
undefined` implicitly, i.e. its call is unchanged, so existing callers are unaffected.)

- [ ] **Step 5: Run test to verify it passes**

Run: `nvm use && node node_modules/.bin/jest src/tests/unit/utils/bwellPersonFinder.test.js -t "getPersonIdsInLinkPathToBwellPersonAsync"`
Expected: PASS (both new tests).

- [ ] **Step 6: Confirm whether `bwellPersonFinder.test.js` can be de-quarantined**

Run the *whole* file (not just the new tests) directly, bypassing the ignore list per this repo's
own convention (comment out its line in `jest.config.js` locally, do not commit that): `nvm use &&
node node_modules/.bin/jest src/tests/unit/utils/bwellPersonFinder.test.js`. If it now passes in
full, remove its entry from `jest.config.js`'s `testPathIgnorePatterns` as a separate commit with a
one-line message noting which unrelated bug it was quarantined for and that this task's changes
didn't touch that. If it still fails for an unrelated pre-existing reason, leave the entry in
place — do not scope-creep this task into fixing an unrelated bug.

- [ ] **Step 7: Update `ConsentCacheInvalidationHandler` to bump every Person in the path**

```javascript
// src/dataLayer/postSaveHandlers/handlers/consentCacheInvalidationHandler.js
// Replace the existing "Walk up the link graph to the bwell master Person" block:

// Walk the link graph from the patient up to (and including) the bwell master Person,
// bumping every intermediate Person's Everything-cache generation along the way -- not
// just the immediate client Person(s) and the final master Person. Closes the residual
// gap noted above: an $everything cache primed under an intermediate Person's key (a
// link graph deeper than master -> client -> Patient) is now invalidated too.
const pathPersonUuids = await this.bwellPersonFinder.getPersonIdsInLinkPathToBwellPersonAsync({
    patientId: patientUuid
});
for (const personUuid of pathPersonUuids) {
    if (personUuid) {
        personUuidsToBump.add(personUuid);
    }
}
```

(This replaces the single `getBwellPersonIdAsync` call and its `if (bwellPersonUuid) {
personUuidsToBump.add(bwellPersonUuid); }` — the immediate-Person lookup via
`getImmediatePersonIdsOfPatientsAsync` just above it is unchanged, since the new path array
already includes that same immediate Person as its first element; the `Set` dedupes if there's
any overlap.)

Update the class comment's "Residual gap" paragraph to remove the now-fixed claim.

- [ ] **Step 8: Add a `ConsentCacheInvalidationHandler` test for a 3+ hop link graph**

```javascript
// src/dataLayer/postSaveHandlers/handlers/consentCacheInvalidationHandler.test.js
// add this test alongside the existing describe block's cases
it('bumps every intermediate Person in a link graph deeper than master -> client -> Patient', async () => {
    const redisManager = createFakeRedisManager(); // reuse existing helper in this file
    const intermediatePersonUuid = 'intermediate-person-uuid-1';
    const masterPersonUuid = 'master-person-uuid-1';
    const bwellPersonFinder = createFakeBwellPersonFinder(); // reuse existing helper
    bwellPersonFinder.getPersonIdsInLinkPathToBwellPersonAsync = jest.fn().mockResolvedValue([
        intermediatePersonUuid,
        masterPersonUuid
    ]);

    const handler = new ConsentCacheInvalidationHandler({ redisManager, bwellPersonFinder });

    await handler.afterSaveAsync({
        requestId: 'req-3',
        eventType: 'U',
        resourceType: 'Consent',
        doc: {
            resourceType: 'Consent',
            id: 'consent-uuid-3',
            status: 'rejected',
            patient: {
                reference: 'Patient/3fa85f64-5717-4562-b3fc-2c963f66afa6',
                _uuid: 'Patient/3fa85f64-5717-4562-b3fc-2c963f66afa6'
            }
        }
    });

    expect(Number(await redisManager.getCacheAsync(`ClientPerson:${intermediatePersonUuid}:Everything:Generation`))).toBe(1);
    expect(Number(await redisManager.getCacheAsync(`ClientPerson:${masterPersonUuid}:Everything:Generation`))).toBe(1);
});
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `nvm use && node node_modules/.bin/jest src/dataLayer/postSaveHandlers/handlers/consentCacheInvalidationHandler.test.js`
Expected: PASS, including the new test.

- [ ] **Step 10: Commit**

```bash
git add src/utils/bwellPersonFinder.js src/tests/unit/utils/bwellPersonFinder.test.js \
        src/dataLayer/postSaveHandlers/handlers/consentCacheInvalidationHandler.js \
        src/dataLayer/postSaveHandlers/handlers/consentCacheInvalidationHandler.test.js \
        jest.config.js
git commit -m "Bump Everything-cache generation for every intermediate Person on Consent write, not just the endpoints"
```

---

### Task 3: Dry-run logging for `Person.link.assurance` during traversal (no behavior change)

**Files:**
- Create: `src/utils/personLinkAssuranceLevel.js`
- Modify: `src/utils/personToPatientIdsExpander.js`
- Modify: `src/utils/configManager.js`
- Test: `src/tests/unit/utils/personLinkAssuranceLevel.test.js` (new)
- Test: `src/tests/unit/utils/personToPatientIdsExpander.assuranceLogging.test.js` (new)

**Interfaces:**
- Produces: `rankPersonLinkAssurance(assurance: string|undefined) -> number` (0 for
  missing/unrecognized, 1–4 for `level1`–`level4`) and `meetsMinimumAssurance({assurance,
  minimumLevel}) -> boolean`, both exported from `src/utils/personLinkAssuranceLevel.js`.
  `configManager.personLinkAssuranceMinimumLevel -> string` (default `'level2'`) and
  `configManager.enforcePersonLinkAssuranceMinimum -> boolean` (default `false`) — the latter is
  read by Task 4, not this task; this task only adds the getters and the logging, gated on a
  third, log-only flag.
- Consumes: nothing new from earlier tasks.

**Context:** Nobody in this codebase reads `Person.link.assurance` today (confirmed by `grep -rn
assurance src/utils/personToPatientIdsExpander.js src/operations/` returning nothing outside
generated FHIR class files). Before gating any real access decision on it (Task 4), get a
production read on how well it's actually populated — the §12 finding itself says this is "not
verifiable from this codebase alone." This task adds structured logging every time a `Person.link`
is followed during traversal, recording its `assurance` value (or its absence) — deployable
immediately, zero behavior change, and gives whoever operates this service a real distribution to
look at (via whatever log aggregation this deployment uses) before Task 4's flag is ever
considered for `true`.

- [ ] **Step 1: Write the failing test for the ranking helper**

```javascript
// src/tests/unit/utils/personLinkAssuranceLevel.test.js
const { describe, test, expect } = require('@jest/globals');
const { rankPersonLinkAssurance, meetsMinimumAssurance } = require('../../../utils/personLinkAssuranceLevel');

describe('rankPersonLinkAssurance', () => {
    test.each([
        [undefined, 0],
        [null, 0],
        ['', 0],
        ['not-a-real-code', 0],
        ['level1', 1],
        ['level2', 2],
        ['level3', 3],
        ['level4', 4]
    ])('ranks %p as %p', (input, expected) => {
        expect(rankPersonLinkAssurance(input)).toBe(expected);
    });
});

describe('meetsMinimumAssurance', () => {
    test('missing assurance never meets any configured minimum', () => {
        expect(meetsMinimumAssurance({ assurance: undefined, minimumLevel: 'level1' })).toBe(false);
    });
    test('a level at or above the minimum passes', () => {
        expect(meetsMinimumAssurance({ assurance: 'level3', minimumLevel: 'level2' })).toBe(true);
        expect(meetsMinimumAssurance({ assurance: 'level2', minimumLevel: 'level2' })).toBe(true);
    });
    test('a level below the minimum fails', () => {
        expect(meetsMinimumAssurance({ assurance: 'level1', minimumLevel: 'level2' })).toBe(false);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nvm use && node node_modules/.bin/jest src/tests/unit/utils/personLinkAssuranceLevel.test.js`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the ranking helper**

```javascript
// src/utils/personLinkAssuranceLevel.js
'use strict';

/**
 * FHIR R4 Person.link.assurance is bound to the identity-assuranceLevel ValueSet:
 * level1 (algorithmic match only) < level2 (validated) < level3 (validated with
 * verification) < level4 (level 3 + additional consent). An absent or unrecognized
 * value ranks 0 -- lower than every real level -- so it never satisfies a configured
 * minimum. Never treat "missing" as "trusted."
 * @type {{[code: string]: number}}
 */
const ASSURANCE_RANK = {
    level1: 1,
    level2: 2,
    level3: 3,
    level4: 4
};

/**
 * @param {string|undefined|null} assurance
 * @return {number}
 */
function rankPersonLinkAssurance (assurance) {
    return ASSURANCE_RANK[assurance] || 0;
}

/**
 * @param {{assurance: string|undefined|null, minimumLevel: string}} params
 * @return {boolean}
 */
function meetsMinimumAssurance ({ assurance, minimumLevel }) {
    return rankPersonLinkAssurance(assurance) >= rankPersonLinkAssurance(minimumLevel);
}

module.exports = { rankPersonLinkAssurance, meetsMinimumAssurance, ASSURANCE_RANK };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `nvm use && node node_modules/.bin/jest src/tests/unit/utils/personLinkAssuranceLevel.test.js`
Expected: PASS.

- [ ] **Step 5: Add the two config getters**

```javascript
// src/utils/configManager.js -- add near enableDelegatedAccessDetection (line ~1264)

/**
 * Minimum Person.link.assurance level ('level1'-'level4') traversal will require once
 * enforcePersonLinkAssuranceMinimum is enabled. Also used as the threshold for the
 * dry-run logging below, so logging reflects the level that would actually be enforced.
 * @return {string}
 */
get personLinkAssuranceMinimumLevel () {
    return env.PERSON_LINK_ASSURANCE_MINIMUM_LEVEL || 'level2';
}

/**
 * When true, emits a log entry (no behavior change) every time Person.link traversal
 * follows a link whose assurance does not meet personLinkAssuranceMinimumLevel. Ship
 * and observe this before ever enabling enforcePersonLinkAssuranceMinimum (Task 4).
 * @return {boolean}
 */
get logPersonLinkAssuranceBelowMinimum () {
    return isTrue(env.LOG_PERSON_LINK_ASSURANCE_BELOW_MINIMUM);
}
```

- [ ] **Step 6: Write the failing test for the traversal logging**

```javascript
// src/tests/unit/utils/personToPatientIdsExpander.assuranceLogging.test.js
// Model this file's setup (constructor args, mock databaseQueryManager returning a
// person with a `link` array) on the existing personToPatientIdsExpander.crossTenant.test.js
// in this same directory -- copy its beforeEach/mock-cursor helpers rather than
// reinventing them. Key addition: give a linked Person.link entry an explicit
// `assurance: 'level1'` (below the level2 default minimum) and assert logWarn (mocked
// via jest.mock('../../../../operations/common/logging', ...) exactly as the existing
// sibling test files in this directory already do) is called with the link's target id
// and its assurance value when configManager.logPersonLinkAssuranceBelowMinimum is true,
// and is NOT called when that flag is false (default). Assert patientIds returned are
// UNCHANGED in both cases -- this task must not alter traversal results.
```

(Write out the actual test body following that model — do not leave it as a description; the
comment above is guidance for which existing file to copy the harness from, not a substitute for
real test code. Two cases minimum: flag on -> `logWarn` called once per below-minimum link with
`{ personId, targetId, assurance, minimumLevel }`-shaped context; flag off -> `logWarn` not called
for assurance at all, and `patientIds`/`personIdsToRecurse` identical to before this task in both
cases.)

- [ ] **Step 7: Run test to verify it fails**

Run: `nvm use && node node_modules/.bin/jest src/tests/unit/utils/personToPatientIdsExpander.assuranceLogging.test.js`
Expected: FAIL — no logging call happens yet.

- [ ] **Step 8: Add the logging (no behavior change) to the traversal loop**

```javascript
// src/utils/personToPatientIdsExpander.js -- inside the `while (await personResourceCursor.hasNext())`
// loop, right after `person.link.length > 0 && !totalProcessedPersonIds.has(personId)` is confirmed
// true (i.e. alongside the existing patientIdsToAdd / personResourceWithPersonReferenceLink
// construction at lines ~339-361) -- add, do not replace, that logic:
if (this.configManager.logPersonLinkAssuranceBelowMinimum) {
    const minimumLevel = this.configManager.personLinkAssuranceMinimumLevel;
    for (const l of person.link) {
        if (l.target && l.target[uuidKey] && !meetsMinimumAssurance({ assurance: l.assurance, minimumLevel })) {
            logWarn('Person.link followed below configured assurance minimum (dry-run, no enforcement)', {
                personId,
                targetId: l.target[uuidKey],
                assurance: l.assurance,
                minimumLevel
            });
        }
    }
}
```

Add `const { meetsMinimumAssurance } = require('./personLinkAssuranceLevel');` to this file's
existing `require` block, and confirm `logWarn` is already imported (it is, for the
`maximumRecursionDepth` warning further down).

- [ ] **Step 9: Run test to verify it passes**

Run: `nvm use && node node_modules/.bin/jest src/tests/unit/utils/personToPatientIdsExpander.assuranceLogging.test.js`
Expected: PASS.

- [ ] **Step 10: Run the full existing expander test suite to confirm zero behavior change**

Run: `nvm use && node node_modules/.bin/jest src/tests/unit/utils/personToPatientIdsExpander.crossTenant.test.js`
Expected: PASS, identical to before this task (this task adds logging only, gated behind a flag
that defaults off).

- [ ] **Step 11: Commit**

```bash
git add src/utils/personLinkAssuranceLevel.js src/utils/personToPatientIdsExpander.js \
        src/utils/configManager.js \
        src/tests/unit/utils/personLinkAssuranceLevel.test.js \
        src/tests/unit/utils/personToPatientIdsExpander.assuranceLogging.test.js
git commit -m "Add dry-run logging for Person.link traversal below a configured assurance minimum"
```

- [ ] **Step 12: Deploy and observe before proceeding to Task 4**

This is a deliberate pause point, not a code step. `LOG_PERSON_LINK_ASSURANCE_BELOW_MINIMUM=true`
needs to run in a real environment (staging at minimum, ideally production read traffic) long
enough to answer: is `assurance` populated at all on real `Person.link` entries, and if so, what
fraction sit below `level2`? If the answer is "almost never populated," Task 4's default minimum
of `level2` would fail closed for nearly all cross-tenant links — including the legitimate
master/client ones review.md and this file's Global Constraints section already warn about — and
either the default minimum needs lowering, the identity-matching pipeline needs to start
populating it, or enforcement needs a different design entirely. Do not start Task 4 until this
has a real answer; this is exactly the step the two prior reverts skipped.

---

### Task 4: Enforce the assurance minimum on `Person.link` traversal (closes both remaining Open findings)

**Depends on:** Task 3's logging having run long enough to set an informed default for
`enforcePersonLinkAssuranceMinimum` and `personLinkAssuranceMinimumLevel` — do not merge this task
with enforcement defaulted to `true` without that signal; the flag must still default to `false`
in the code itself regardless of what any particular environment's `.env` sets it to.

**Files:**
- Modify: `src/utils/personToPatientIdsExpander.js`
- Modify: `src/utils/configManager.js`
- Test: `src/tests/unit/utils/personToPatientIdsExpander.assuranceEnforcement.test.js` (new)
- Test: `src/tests/unit/utils/personToPatientIdsExpander.pureScopeCrossTenant.bugs.test.js`
  (de-quarantine once green)

**Interfaces:**
- Consumes: `meetsMinimumAssurance`, `configManager.personLinkAssuranceMinimumLevel` (Task 3).
- Produces: no new exports; changes `getPatientIdsFromPersonAsync`'s internal filtering so that,
  when `configManager.enforcePersonLinkAssuranceMinimum` is `true`, a `Person.link` entry whose
  `assurance` doesn't meet the configured minimum is excluded from both `patientIdsToAdd` (so its
  target Patient is never returned) and `personResourceWithPersonReferenceLink` (so traversal
  doesn't recurse into it) — **regardless of `addTopPersonAccessCheck`/scope type**. This is what
  makes the fix apply to a pure-`patient/`-scope caller too: the gate is on the link itself, not
  on the scope-derived query filter.

**Context:** This is the enforcing half of Task 3. Add the second config getter, then change the
`patientIdsToAdd`/`personResourceWithPersonReferenceLink` construction
(`src/utils/personToPatientIdsExpander.js:339-361`) to skip any link that fails the assurance
check when enforcement is on. Because this check happens before any scope-derived query is even
built, it protects a pure-`patient/`-scope caller (§12's third Open finding) exactly as much as it
protects a tenant/service-account caller (§12's first Open finding) — one code change, both
findings closed.

- [ ] **Step 1: Add the enforcement config getter**

```javascript
// src/utils/configManager.js -- add directly below logPersonLinkAssuranceBelowMinimum (Task 3)

/**
 * When true, Person.link traversal (PersonToPatientIdsExpander) excludes any link whose
 * assurance does not meet personLinkAssuranceMinimumLevel from both the returned patient
 * ids and further recursion -- for every caller type, including a pure patient/-scope
 * caller with no access/ scope to otherwise gate on. Defaults to false: do not enable in
 * an environment that hasn't first run logPersonLinkAssuranceBelowMinimum long enough to
 * confirm real Person.link data clears the configured minimum (see the plan this shipped
 * with, docs/superpowers/plans/2026-08-09-close-resource-authorization-known-gaps.md).
 * @return {boolean}
 */
get enforcePersonLinkAssuranceMinimum () {
    return isTrue(env.ENFORCE_PERSON_LINK_ASSURANCE_MINIMUM);
}
```

- [ ] **Step 2: Write the failing enforcement test**

```javascript
// src/tests/unit/utils/personToPatientIdsExpander.assuranceEnforcement.test.js
// Copy the harness from personToPatientIdsExpander.crossTenant.test.js in this same
// directory (constructor args, mock databaseQueryManager/cursor). Two cases:
//
// 1. configManager.enforcePersonLinkAssuranceMinimum = true, minimum = 'level2'. A Person
//    resolves with person.link containing one Patient-target link (assurance: undefined)
//    and one Person-target link into a different-tenant Person (assurance: 'level1').
//    Call getPatientIdsFromPersonAsync. Assert the Patient-target link's patient id is
//    EXCLUDED from the returned patientIds (undefined assurance ranks 0, fails the
//    level2 minimum) and the Person-target link is NOT included in personIdsToRecurse
//    (i.e. the mock's second-level findAsync is never called -- assert
//    mockDatabaseQueryManager.findAsync was called exactly once).
//
// 2. Same fixture, configManager.enforcePersonLinkAssuranceMinimum = false (default).
//    Assert both links ARE followed (patientIds includes the Patient-target id;
//    findAsync is called a second time for the recursion step) -- i.e. default
//    behavior is completely unchanged from before this task.
//
// 3. POSITIVE case, enforcement on -- this is the one prior reverts got bitten by, so it
//    is not optional. configManager.enforcePersonLinkAssuranceMinimum = true, minimum =
//    'level2'. A Person resolves with a legitimate cross-tenant Person-target link (the
//    Main-Person -> Client-Person shape this plan's Global Constraints call out as
//    intentional) whose assurance is 'level2' (at the minimum, not above it -- proves the
//    comparison is inclusive). Assert this link IS included in personIdsToRecurse (the
//    mock's second-level findAsync IS called) and any Patient-target link reachable
//    through it is NOT silently dropped. This guards against an enforcement
//    implementation that (buggily) excludes every link whenever the flag is on --
//    exactly the over-blocking failure mode of the two prior reverts, just reached via
//    missing/insufficient assurance data instead of an owner-tag mismatch.
//
// Write the real test bodies, not this description -- follow the exact mock shape
// (hasNext/nextObject cursor, FilterById query capture) already used in
// personToPatientIdsExpander.crossTenant.test.js so assertions land on real captured
// state, not a re-implemented stand-in.
```

- [ ] **Step 3: Run test to verify it fails**

Run: `nvm use && node node_modules/.bin/jest src/tests/unit/utils/personToPatientIdsExpander.assuranceEnforcement.test.js`
Expected: FAIL — case 1's exclusion doesn't happen yet (current code always follows every link);
case 3 passes vacuously today (nothing is excluded pre-fix) but must still pass post-fix.

- [ ] **Step 4: Implement the enforcement**

```javascript
// src/utils/personToPatientIdsExpander.js
// Modify the patientIdsToAdd / personResourceWithPersonReferenceLink construction
// (lines ~339-361) to filter out any link failing the assurance check when enforcement
// is on. Structure (adapt to the real surrounding code, which this sketch elides):

const minimumLevel = this.configManager.personLinkAssuranceMinimumLevel;
const enforceAssurance = this.configManager.enforcePersonLinkAssuranceMinimum;

const linksPassingAssurance = enforceAssurance
    ? person.link.filter((l) => meetsMinimumAssurance({ assurance: l.assurance, minimumLevel }))
    : person.link;

const patientIdsToAdd = linksPassingAssurance
    .filter(l => l.target && l.target[`${uuidKey}`] &&
        (l.target[`${uuidKey}`].startsWith(patientReferencePrefix) || l.target.type === 'Patient'))
    .map(l => {
        const patientId = l.target[`${uuidKey}`].replace(patientReferencePrefix, '');
        if (toMap === true) {
            linkedPatients.add(patientId);
        }
        return patientId;
    });

patientIds = patientIds.concat(patientIdsToAdd);

const personResourceWithPersonReferenceLink = linksPassingAssurance
    .filter(l => l.target && l.target[`${uuidKey}`] &&
        (l.target[`${uuidKey}`].startsWith(personReferencePrefix) || l.target.type === 'Person'))
    .map(l => l.target[`${uuidKey}`].replace(personReferencePrefix, ''));
```

(The only change from the current code is computing `linksPassingAssurance` first and filtering
from that instead of `person.link` directly in both places. Keep the dry-run logging from Task 3
as-is, unconditional on `enforceAssurance` — logging should keep firing even after enforcement is
on, so operators can see what's actively being excluded, not just what would have been.)

Add `meetsMinimumAssurance` to this file's existing import from Task 3 (already imported; no new
import needed).

- [ ] **Step 5: Run test to verify it passes**

Run: `nvm use && node node_modules/.bin/jest src/tests/unit/utils/personToPatientIdsExpander.assuranceEnforcement.test.js`
Expected: PASS (all three cases, including case 3's positive check that a legitimate
at-minimum-assurance cross-tenant link is still followed under enforcement).

- [ ] **Step 6: Run the quarantined pure-scope test with enforcement enabled**

The existing quarantined test
(`src/tests/unit/utils/personToPatientIdsExpander.pureScopeCrossTenant.bugs.test.js`) encodes the
*desired* behavior for a pure-`patient/`-scope caller and is expected to fail today. It doesn't yet
set `configManager.enforcePersonLinkAssuranceMinimum = true` in its fixture (it predates this
flag) — update its `beforeEach`/mock `configManager` to set that flag `true` and
`personLinkAssuranceMinimumLevel` to a level its cross-tenant fixture's link assurance won't meet
(or leave the fixture's link with no `assurance` field at all, which ranks 0 and fails any real
minimum). Run: `nvm use && node node_modules/.bin/jest
src/tests/unit/utils/personToPatientIdsExpander.pureScopeCrossTenant.bugs.test.js` (bypass the
ignore list the same way as Task 2 Step 3 — comment out its `jest.config.js` line locally, don't
commit that). If it now passes, this confirms the enforcement genuinely closes the pure-scope
gap. If any of its cases still fail, read the failure closely — the fixture may also model a
*legitimate* cross-tenant master/client link, which per this plan's Global Constraints must still
pass through when its `assurance` clears the minimum; do not weaken the test to force a pass, fix
the fixture's assurance value or the implementation.

- [ ] **Step 7: De-quarantine the pure-scope test**

Once Step 6 passes for real (not by weakening assertions), remove
`personToPatientIdsExpander.pureScopeCrossTenant.bugs.test.js`'s entry from `jest.config.js`'s
`testPathIgnorePatterns`, and update the test file's top-of-file "KNOWN, TRACKED, UNFIXED GAP"
comment to describe the fix instead (mirroring how `12_knownGap_accessHistoryLinkTraversalLeak.test.js`
was un-quarantined for the earlier §12 fixes) — do not just delete the historical context, record
what changed and why, matching this repo's established documentation style for this exact
situation.

- [ ] **Step 8: Run the full expander + patientScope + everything test suites**

Run: `nvm use && node node_modules/.bin/jest src/tests/unit/utils/personToPatientIdsExpander.crossTenant.test.js src/tests/unit/operations/security/patientScopeManager.test.js src/tests/unit/graphqlv2/dataSource.test.js`
Expected: PASS, no regressions — with `enforcePersonLinkAssuranceMinimum` still defaulted to
`false` in these suites' config, so none of this should change any existing assertion; only the
new/updated tests above exercise the flag turned on.

`crossTenant.test.js` is the regression fixture that exists specifically because two prior fixes
in this exact area were reverted for breaking the legitimate Main-Person -> Client-Person
cross-tenant link (see this plan's Global Constraints) — its `Person.link` entries have no
`assurance` field today, which ranks `0` and would fail any real minimum once enforcement is on.
Running it only at the `false` default (as above) never actually exercises that regression guard
under enforcement. Before considering `enforcePersonLinkAssuranceMinimum` for enablement in any
real environment, additionally: temporarily set `personLinkAssuranceMinimumLevel` to `level2` and
`enforcePersonLinkAssuranceMinimum` to `true` in a throwaway local run of this same suite (or add
an equivalent case within it) with its legitimate cross-tenant link's `assurance` populated at or
above the minimum, and confirm it still passes. Do not commit `enforcePersonLinkAssuranceMinimum:
true` as this suite's default — it must keep testing the flag-off default behavior on every CI
run.

- [ ] **Step 9: Commit**

```bash
git add src/utils/personToPatientIdsExpander.js src/utils/configManager.js \
        src/tests/unit/utils/personToPatientIdsExpander.assuranceEnforcement.test.js \
        src/tests/unit/utils/personToPatientIdsExpander.pureScopeCrossTenant.bugs.test.js \
        jest.config.js
git commit -m "Enforce Person.link assurance minimum during traversal when configured, closing the pure-patient-scope cross-tenant gap"
```

---

### Task 5: Update `docs/resource-authorization.md` to reflect all four closed findings

**Files:**
- Modify: `docs/resource-authorization.md`

**Interfaces:** None — documentation only.

- [ ] **Step 1: Move the four §12 entries from Open to Fixed**

For each of the four findings this plan closes, move its bullet from the `### Open` subsection to
the `### Fixed` subsection (in commit order: Composition/`unclassified`, then the
Consent-cache/intermediate-Person one, then the two assurance-related ones combined into a single
`FIXED` bullet — since Task 4's design note above explains they're one mechanism, write them up as
one finding, not two, in the Fixed list), each rewritten in the same past-tense/file:line-cited
style as every other `FIXED` bullet already in this section. For the assurance-related bullet
specifically, describe: what changed (§ references §1/§5), the exact mechanism (assurance-ranked
gate on link-following itself, independent of scope type), the config flag names and their default
(`false` — note explicitly that enforcement is opt-in pending the Task 3 observation period,
matching how the doc already describes `configManager.clientsWithDataConnectionViewControl` as
gated), and the covering tests (`personToPatientIdsExpander.assuranceEnforcement.test.js`, the
de-quarantined `pureScopeCrossTenant` test, `personLinkAssuranceLevel.test.js`).

- [ ] **Step 2: Update the intro paragraph's tally**

Change "ten have since been fixed, four remain open, and three suspected findings were
investigated and do not reproduce" to reflect the new counts (fourteen fixed, zero open, three
investigated) once all four bullets have moved.

- [ ] **Step 3: Remove the now-empty `### Open` heading, or note explicitly that none remain**

If no `Open` bullets remain after Step 1, either remove the `### Open` subheading entirely or
replace its contents with a one-line note ("None open as of `<date>` — see Fixed above for what
closed the prior four.") so a future reader doesn't wonder whether the heading was accidentally
left behind mid-edit.

- [ ] **Step 4: Update §5 and §9's prose if they describe the now-stale "never checks assurance" /
  "no re-check for pure-patient-scope" behavior as current**

Re-read §5 ("Patient-scoped tokens, proxy-patient, and Person/Patient link expansion") and §9
("Sensitivity classification") for any sentence describing the old (pre-fix) behavior as current
fact rather than as a historical note in §12 — update those sentences to describe the new
assurance-gated behavior, citing `personLinkAssuranceLevel.js` and the two new config flags, the
same way §5 already cites `PersonToPatientIdsExpander`'s other mechanics.

- [ ] **Step 5: Commit**

```bash
git add docs/resource-authorization.md
git commit -m "Update docs/resource-authorization.md: close the four Open findings from §12"
```

---

## Self-Review

**1. Coverage of all four findings:**
- `Person.link.assurance` never checked → Task 3 (logging) + Task 4 (enforcement). ✓
- Composition section filter missing `unclassified` → Task 1. ✓
- Pure-patient-scope caller no re-check → Task 4 (same mechanism as the assurance finding,
  by design — explained in Architecture). ✓
- Consent-cache invalidation not walking intermediate Persons → Task 2. ✓

**2. Placeholder scan:** Tasks 3 and 4 contain two `// Copy the harness from ... follow the exact
mock shape` guidance comments instead of fully inlined test bodies (in the "Write the failing
test" steps for the logging and enforcement tests). This is a deliberate exception, not an
oversight: the exact mock cursor/`FilterById` shape lives in
`personToPatientIdsExpander.crossTenant.test.js`, a file already in this repo that changes
independently of this plan — inlining a guessed copy risks drifting from the real harness by the
time this task is executed. Each such comment specifies the exact assertions required (what's
called, with what shape, how many times) so there's no ambiguity about *what* the test must prove,
only *how* to wire the existing mock harness to prove it. All other steps have complete, runnable
code.

**3. Type/interface consistency:** `meetsMinimumAssurance({assurance, minimumLevel})` (Task 3) is
used identically in Task 4's enforcement code and Task 4 Step 2's test description; `rankPersonLinkAssurance`
is only used internally by `meetsMinimumAssurance` and directly in Task 3's own test — no other
task calls it directly, so no drift risk there. `getPersonIdsInLinkPathToBwellPersonAsync` (Task 2)
return shape (`string[]`, master Person last) is consistent between its own test, its
implementation, and `ConsentCacheInvalidationHandler`'s consumption of it. Config getter names
(`personLinkAssuranceMinimumLevel`, `logPersonLinkAssuranceBelowMinimum`,
`enforcePersonLinkAssuranceMinimum`) are spelled identically everywhere they're referenced across
Tasks 3–5.
