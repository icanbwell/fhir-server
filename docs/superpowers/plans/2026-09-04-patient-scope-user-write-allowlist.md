# Allowlisted User-Scope Writes Alongside a Patient Scope — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator-configured set of resource types (default: none) accept a write from a
`user/...write`-scoped caller even when that caller's token also carries a `patient/...` scope,
without weakening the existing patient-scope anti-escalation veto for any other resource type.

**Architecture:** Three write paths enforce the veto today with different structure —
`create.js`/`update.js` are two-phase (coarse scope check, then a finer per-resource check once
the resource is loaded), `mergeManager.preMergeChecksAsync` is single-phase (only the coarse
check runs, ever). This plan adds one new gate — `PatientScopeManager.canBypassPatientScopeForUserWriteAsync`
— and wires it into each path's *existing* finer-grained hook, adding a merge-specific existing-resource
lookup only where merge doesn't already have one. The gate itself never grants access on its own;
it only lifts the veto so the ordinary user-scope check gets to run, plus an ownership check
(reference-based for patient-compartment types, a new `sourcePatientId` tag for types like `Binary`
that have no patient-compartment field at all).

**Tech Stack:** Node.js/Express FHIR server, `@asymmetrik/sof-scope-checker` for scope matching,
Jest + MongoDB Memory Server for tests.

**Spec:** `docs/superpowers/specs/2026-09-04-patient-scope-user-write-allowlist-design.md` — read
it alongside this plan; task descriptions below reference its section numbers. Two places this
plan **refines** the spec's wording (both because the spec's phrasing was ambiguous about how
`canWriteResourceAsync`'s single `resource` argument already does double duty for create vs.
update, not because the underlying design is wrong):
- The spec's `canBypassPatientScopeForUserWriteAsync({requestInfo, resourceType, existingResource})`
  signature (§4.3) is written here as flat params (`{base_version, isUser, personIdFromJwtToken,
  scope, user, resourceType, existingResource}`), matching every other method on
  `PatientScopeManager` (none of which take a nested `requestInfo` object).
- The spec's §4.4 says to pass "the loaded resource" as `existingResource` for create.js/update.js.
  That resource is the **existing** stored resource only on update's already-found branch — on
  every create branch (both `create.js` and update.js's create-via-PUT branch) it is a **brand-new**
  resource, so this plan threads an explicit `currentResource` (`null` on every create branch, the
  pre-merge stored resource on update's found branch) rather than reusing the ambiguous `resource`
  param — see Task 4.
- One addition beyond the spec's core design (§4.3/§4.4): the spec's §5 "Trust model" section and
  §7 open question both flag that a subsequent write must not be allowed to silently change an
  already-set `sourcePatientId` tag to a different patient, and §7 recommends enforcing this now
  rather than as a fast-follow. Task 6 implements that recommendation, mirroring the existing
  `SEC-1580 F2/F3` access-tag-change protection pattern in `scopesValidator.js`.

## Global Constraints

- Default (`PATIENT_SCOPE_USER_WRITE_ALLOWED_RESOURCES` unset) must be **zero behavior change** —
  every new code path must short-circuit to today's behavior when the allowlist is empty.
- The allowlist bypass must never substitute for a real scope check — lifting the patient-scope
  veto only unlocks the *existing* user-scope check (`scopeChecker` against
  `scopesManager.getUserScopes`), never skips it.
- Do not add `Binary` (or any other allowlisted type) to `patientFilterManager.patientFilterMapping`
  or any of its sibling mappings — that mapping is consumed far beyond this write check (search,
  `$everything`, `accessHistory`, `resourceValidator`, `bulkDataExportRunner`) and this feature's
  blast radius must stay confined to the write-authorization bypass only (design §3).
- New `meta.security` tag system constant: `sourcePatientId: 'https://www.icanbwell.com/sourcePatientId'`,
  matching `fhir-server-ui`'s existing client-side constant exactly (design §2, §4.2).
- Every new/changed method that already has an established param-naming convention in the file it
  lives in must follow that convention (`currentResource` = "resource as stored, `null`/`undefined`
  on create" is already established by `isAccessTagChangeAllowedByAccessScopes` in
  `scopesValidator.js`; this plan reuses that name rather than introducing `existingResource` at
  that layer).
- Prettier: 100 char width, semicolons, single quotes, 4-space indent, ES5 trailing commas (repo
  convention, `CLAUDE.md`).

---

### Task 1: Config flag — `patientScopeUserWriteAllowedResourceTypes`

**Files:**
- Modify: `src/utils/configManager.js` (add getter near the other `_parseCommaSeparatedList`-backed
  getters, e.g. after `clickHouseOnlyResources` at line 1226)
- Test: `src/tests/unit/utils/configManager.test.js` (create if it doesn't already cover this
  pattern — check first; if a `configManager.test.js` unit test file already exists for other
  comma-list getters, add to it instead of creating a new file)

**Interfaces:**
- Produces: `ConfigManager.prototype.patientScopeUserWriteAllowedResourceTypes` — getter, returns
  `string[]`, default `[]`. Every later task's config check calls
  `this.configManager.patientScopeUserWriteAllowedResourceTypes.includes(resourceType)`.

- [ ] **Step 1: Check for an existing config-getter unit test file**

Run: `find src/tests/unit -iname "configManager*"`

If nothing exists, this task creates `src/tests/unit/utils/configManager.test.js`. If a file
exists, add the new test into its existing `describe` structure instead (match its existing style).

- [ ] **Step 2: Write the failing test**

```javascript
const { describe, test, expect } = require('@jest/globals');
const { ConfigManager } = require('../../../utils/configManager');

describe('ConfigManager.patientScopeUserWriteAllowedResourceTypes', () => {
    const ORIGINAL_ENV = process.env.PATIENT_SCOPE_USER_WRITE_ALLOWED_RESOURCES;

    afterEach(() => {
        process.env.PATIENT_SCOPE_USER_WRITE_ALLOWED_RESOURCES = ORIGINAL_ENV;
    });

    test('defaults to an empty array when unset', () => {
        delete process.env.PATIENT_SCOPE_USER_WRITE_ALLOWED_RESOURCES;
        const configManager = new ConfigManager();
        expect(configManager.patientScopeUserWriteAllowedResourceTypes).toStrictEqual([]);
    });

    test('parses a comma-separated list and trims whitespace', () => {
        process.env.PATIENT_SCOPE_USER_WRITE_ALLOWED_RESOURCES = 'Binary, DocumentReference';
        const configManager = new ConfigManager();
        expect(configManager.patientScopeUserWriteAllowedResourceTypes).toStrictEqual([
            'Binary', 'DocumentReference'
        ]);
    });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `nvm use && node node_modules/.bin/jest src/tests/unit/utils/configManager.test.js -t "patientScopeUserWriteAllowedResourceTypes"`
Expected: FAIL — `configManager.patientScopeUserWriteAllowedResourceTypes` is `undefined`.

- [ ] **Step 4: Write minimal implementation**

In `src/utils/configManager.js`, add immediately after the `clickHouseOnlyResources` getter:

```javascript
    /**
     * Resource types where a caller's user/...write scope is honored even when the token also
     * carries a patient/... scope, bypassing the anti-escalation veto in scopesValidator.js that
     * otherwise vetoes every write once any patient scope is present. Empty by default (zero
     * behavior change) -- see
     * docs/superpowers/specs/2026-09-04-patient-scope-user-write-allowlist-design.md.
     *
     * PATIENT_SCOPE_USER_WRITE_ALLOWED_RESOURCES=Binary,DocumentReference
     *
     * @return {string[]}
     */
    get patientScopeUserWriteAllowedResourceTypes() {
        return this._parseCommaSeparatedList(env.PATIENT_SCOPE_USER_WRITE_ALLOWED_RESOURCES, []);
    }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `nvm use && node node_modules/.bin/jest src/tests/unit/utils/configManager.test.js -t "patientScopeUserWriteAllowedResourceTypes"`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/utils/configManager.js src/tests/unit/utils/configManager.test.js
git commit -m "Add PATIENT_SCOPE_USER_WRITE_ALLOWED_RESOURCES config flag"
```

---

### Task 2: New ownership signal — `sourcePatientId` tag + `ScopesManager` helper

**Files:**
- Modify: `src/utils/securityTagSystem.js`
- Modify: `src/operations/security/scopesManager.js` (add helper near `getPatientScopes`/`getUserScopes`,
  after `getUserScopes` at line 428; add new `require`s at the top alongside the existing ones)
- Test: `src/tests/unit/operations/security/scopesManager.test.js` (existing file — add a new
  `describe` block to it)

**Interfaces:**
- Produces: `SecurityTagSystem.sourcePatientId` (string constant).
- Produces: `ScopesManager.prototype.getPatientIdsFromSourcePatientIdTag({resource}) => string[]`
  — tolerant of `resource` being `null`/`undefined`/having no `meta.security`; returns `[]` in
  those cases. Task 3 calls this as one of the two OR'd ownership signals.

- [ ] **Step 1: Write the failing test**

Add to `src/tests/unit/operations/security/scopesManager.test.js` (check its existing
`require`/`describe` structure first and match it — the block below assumes the file already
`require`s `ScopesManager` and constructs an instance in a `beforeEach`; adapt the instantiation
to however the existing file already does it rather than duplicating a second one):

```javascript
describe('getPatientIdsFromSourcePatientIdTag', () => {
    test('returns empty array when resource has no meta.security', () => {
        expect(
            scopesManager.getPatientIdsFromSourcePatientIdTag({ resource: { resourceType: 'Binary' } })
        ).toStrictEqual([]);
    });

    test('returns empty array when resource is null', () => {
        expect(scopesManager.getPatientIdsFromSourcePatientIdTag({ resource: null })).toStrictEqual([]);
    });

    test('parses a bare-id tag code', () => {
        const resource = {
            resourceType: 'Binary',
            meta: { security: [{ system: SecurityTagSystem.sourcePatientId, code: 'patient-uuid-1' }] }
        };
        expect(scopesManager.getPatientIdsFromSourcePatientIdTag({ resource })).toStrictEqual(['patient-uuid-1']);
    });

    test('parses a Patient/<id>|<sourceAssigningAuthority> reference-shaped tag code', () => {
        const resource = {
            resourceType: 'Binary',
            meta: {
                security: [
                    { system: SecurityTagSystem.sourcePatientId, code: 'Patient/client-patient-1|client_a' }
                ]
            }
        };
        const result = scopesManager.getPatientIdsFromSourcePatientIdTag({ resource });
        expect(result).toHaveLength(1);
        // client_a|client-patient-1 normalizes deterministically via generateUUIDv5, matching the
        // same scheme getValueOfPropertyFromResource uses for reference fields.
        expect(result[0]).toStrictEqual(generateUUIDv5('client-patient-1|client_a'));
    });

    test('ignores meta.security tags with a different system', () => {
        const resource = {
            resourceType: 'Binary',
            meta: { security: [{ system: SecurityTagSystem.owner, code: 'some_tenant' }] }
        };
        expect(scopesManager.getPatientIdsFromSourcePatientIdTag({ resource })).toStrictEqual([]);
    });
});
```

Add the necessary imports at the top of the test file if not already present:
```javascript
const { SecurityTagSystem } = require('../../../../utils/securityTagSystem');
const { generateUUIDv5 } = require('../../../../utils/uid.util');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nvm use && node node_modules/.bin/jest src/tests/unit/operations/security/scopesManager.test.js -t "getPatientIdsFromSourcePatientIdTag"`
Expected: FAIL — `scopesManager.getPatientIdsFromSourcePatientIdTag is not a function`

- [ ] **Step 3: Write minimal implementation**

In `src/utils/securityTagSystem.js`, add the new constant:

```javascript
const SecurityTagSystem = {
    access: 'https://www.icanbwell.com/access',
    owner: 'https://www.icanbwell.com/owner',
    vendor: 'https://www.icanbwell.com/vendor',
    sourceAssigningAuthority: 'https://www.icanbwell.com/sourceAssigningAuthority',
    connectionType: 'https://www.icanbwell.com/connectionType',
    sourcePatientId: 'https://www.icanbwell.com/sourcePatientId'
};
```

In `src/operations/security/scopesManager.js`, add to the top-level `require`s (it already imports
`SecurityTagSystem`; add the two it doesn't yet have):

```javascript
const { ReferenceParser } = require('../../utils/referenceParser');
const { isUuid, generateUUIDv5 } = require('../../utils/uid.util');
```

Add the new method immediately after `getUserScopes` (line 428):

```javascript
    /**
     * Extracts and normalizes patient ids from the resource's sourcePatientId meta.security tags
     * (design: docs/superpowers/specs/2026-09-04-patient-scope-user-write-allowlist-design.md
     * §4.2). This is a caller-supplied ownership signal used only by
     * PatientScopeManager.canBypassPatientScopeForUserWriteAsync, for resource types that have no
     * patientFilterMapping reference field at all (e.g. Binary). Uses the same reference-parsing /
     * generateUUIDv5 normalization patientScopeManager.getValueOfPropertyFromResource already uses
     * for reference fields, so the two signal types produce directly comparable ids.
     * @param {Resource|Object|null|undefined} resource
     * @return {string[]}
     */
    getPatientIdsFromSourcePatientIdTag ({ resource }) {
        if (!resource || !resource.meta || !resource.meta.security) {
            return [];
        }
        return resource.meta.security
            .filter(s => s.system === SecurityTagSystem.sourcePatientId)
            .map(t => {
                const { id, sourceAssigningAuthority } = ReferenceParser.parseReference(t.code);
                return sourceAssigningAuthority && !isUuid(id)
                    ? generateUUIDv5(`${id}|${sourceAssigningAuthority}`)
                    : id;
            });
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `nvm use && node node_modules/.bin/jest src/tests/unit/operations/security/scopesManager.test.js -t "getPatientIdsFromSourcePatientIdTag"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/securityTagSystem.js src/operations/security/scopesManager.js src/tests/unit/operations/security/scopesManager.test.js
git commit -m "Add sourcePatientId security tag and ScopesManager helper to read it"
```

---

### Task 3: `PatientScopeManager.canBypassPatientScopeForUserWriteAsync`

**Files:**
- Modify: `src/operations/security/patientScopeManager.js` (constructor at lines 15-54; new method
  after `canWriteResourceAsync`, i.e. after line 352; bypass point inside `canWriteResourceAsync`
  at the `return false;` on line 323)
- Modify: `src/createContainer.js` (`patientScopeManager` registration, lines 494-501)
- Modify: `src/tests/unit/operations/security/patientScopeManager.test.js` (constructor call,
  lines 45-50)
- Modify: `src/tests/unit/resourceAuthorization/05_patientScopeAndLinkExpansion.test.js`
  (constructor call, lines 265-270 — `ConfigManager`/`createMockInstance` already imported/defined
  in this file, reuse them)
- Modify: `src/tests/unit/operations/security/patientScopeWriteBypass.test.js` (constructor call,
  lines 44-49 — this file mocks `utils/assertType` entirely, so a plain object works)
- Modify: `src/tests/unit/operations/security/writeAuthorizationBypass.test.js` (**two**
  constructor calls, lines 44-49 and 151-156 — this file also mocks `utils/assertType`)
- Test: `src/tests/unit/operations/security/patientScopeManager.canBypassPatientScopeForUserWriteAsync.test.js` (new)

**Interfaces:**
- Consumes: `configManager.patientScopeUserWriteAllowedResourceTypes` (Task 1),
  `scopesManager.getUserScopes({scope}) => string[]` (existing),
  `scopesManager.getPatientIdsFromSourcePatientIdTag({resource}) => string[]` (Task 2).
- Produces: `PatientScopeManager.prototype.canBypassPatientScopeForUserWriteAsync({base_version,
  isUser, personIdFromJwtToken, scope, user, resourceType, existingResource}) => Promise<boolean>`.
  `existingResource` is `null`/`undefined` for a create (nothing to protect yet) or the resource as
  currently stored for an update. Task 4 and Task 5 both call this.
- Produces: `PatientScopeManager.prototype.canWriteResourceAsync(...)` gains a new optional
  `currentResource` param (passed through to the new method as `existingResource`) — Task 4's
  callers rely on this exact param name.

- [ ] **Step 1: Write the failing unit tests for the new method**

Create `src/tests/unit/operations/security/patientScopeManager.canBypassPatientScopeForUserWriteAsync.test.js`:

```javascript
const { describe, test, expect, jest: jestGlobal } = require('@jest/globals');

jestGlobal.mock('../../../../utils/assertType', () => ({
    assertIsValid: (val, msg) => { if (!val) throw new Error(msg || 'assertion failed'); },
    assertTypeEquals: () => {}
}));

const { PatientScopeManager } = require('../../../../operations/security/patientScopeManager');
const { PatientFilterManager } = require('../../../../fhir/patientFilterManager');
const { SecurityTagSystem } = require('../../../../utils/securityTagSystem');

function buildManager ({ allowedResourceTypes = [], patientIdsFromScope = [] } = {}) {
    const patientFilterManager = new PatientFilterManager();
    const scopesManager = {
        getUserScopes: ({ scope }) => (scope || '').split(' ').filter(s => s.startsWith('user/'))
    };
    const configManager = { patientScopeUserWriteAllowedResourceTypes: allowedResourceTypes };
    const manager = new PatientScopeManager({
        databaseQueryFactory: { createQuery: jestGlobal.fn() },
        personToPatientIdsExpander: { getPatientIdsFromPersonAsync: jestGlobal.fn().mockResolvedValue([]) },
        scopesManager,
        patientFilterManager,
        configManager
    });
    manager.getPatientIdsFromScopeAsync = jestGlobal.fn().mockResolvedValue(patientIdsFromScope);
    return manager;
}

describe('PatientScopeManager.canBypassPatientScopeForUserWriteAsync', () => {
    test('denies when resourceType is not on the allowlist', async () => {
        const manager = buildManager({ allowedResourceTypes: [] });
        const result = await manager.canBypassPatientScopeForUserWriteAsync({
            base_version: '4_0_0', isUser: true, personIdFromJwtToken: 'person-1',
            scope: 'user/Binary.write', user: 'client', resourceType: 'Binary', existingResource: null
        });
        expect(result).toBe(false);
    });

    test('denies when allowlisted but the user scope does not cover the write', async () => {
        const manager = buildManager({ allowedResourceTypes: ['Binary'] });
        const result = await manager.canBypassPatientScopeForUserWriteAsync({
            base_version: '4_0_0', isUser: true, personIdFromJwtToken: 'person-1',
            scope: 'user/Observation.write', user: 'client', resourceType: 'Binary', existingResource: null
        });
        expect(result).toBe(false);
    });

    test('allows a create (no existing resource) when allowlisted and user scope sufficient', async () => {
        const manager = buildManager({ allowedResourceTypes: ['Binary'] });
        const result = await manager.canBypassPatientScopeForUserWriteAsync({
            base_version: '4_0_0', isUser: true, personIdFromJwtToken: 'person-1',
            scope: 'user/Binary.write', user: 'client', resourceType: 'Binary', existingResource: null
        });
        expect(result).toBe(true);
    });

    test('allows an existing resource when ownership matches via the sourcePatientId tag', async () => {
        const manager = buildManager({ allowedResourceTypes: ['Binary'], patientIdsFromScope: ['patient-uuid-1'] });
        const existingResource = {
            resourceType: 'Binary',
            meta: { security: [{ system: SecurityTagSystem.sourcePatientId, code: 'patient-uuid-1' }] }
        };
        const result = await manager.canBypassPatientScopeForUserWriteAsync({
            base_version: '4_0_0', isUser: true, personIdFromJwtToken: 'person-1',
            scope: 'user/Binary.write', user: 'client', resourceType: 'Binary', existingResource
        });
        expect(result).toBe(true);
    });

    test('allows an existing resource when ownership matches via the compartment reference field', async () => {
        const manager = buildManager({ allowedResourceTypes: ['DocumentReference'], patientIdsFromScope: ['patient-uuid-1'] });
        const existingResource = {
            resourceType: 'DocumentReference',
            _uuid: 'docref-uuid-1',
            subject: { reference: 'Patient/patient-uuid-1', _uuid: 'patient-uuid-1' }
        };
        const result = await manager.canBypassPatientScopeForUserWriteAsync({
            base_version: '4_0_0', isUser: true, personIdFromJwtToken: 'person-1',
            scope: 'user/DocumentReference.write', user: 'client', resourceType: 'DocumentReference', existingResource
        });
        expect(result).toBe(true);
    });

    test('denies an existing resource with neither ownership signal present (fail closed)', async () => {
        const manager = buildManager({ allowedResourceTypes: ['Binary'], patientIdsFromScope: ['patient-uuid-1'] });
        const existingResource = { resourceType: 'Binary', meta: { security: [] } };
        const result = await manager.canBypassPatientScopeForUserWriteAsync({
            base_version: '4_0_0', isUser: true, personIdFromJwtToken: 'person-1',
            scope: 'user/Binary.write', user: 'client', resourceType: 'Binary', existingResource
        });
        expect(result).toBe(false);
    });

    test('denies an existing resource owned by a different patient', async () => {
        const manager = buildManager({ allowedResourceTypes: ['Binary'], patientIdsFromScope: ['patient-uuid-1'] });
        const existingResource = {
            resourceType: 'Binary',
            meta: { security: [{ system: SecurityTagSystem.sourcePatientId, code: 'some-other-patient' }] }
        };
        const result = await manager.canBypassPatientScopeForUserWriteAsync({
            base_version: '4_0_0', isUser: true, personIdFromJwtToken: 'person-1',
            scope: 'user/Binary.write', user: 'client', resourceType: 'Binary', existingResource
        });
        expect(result).toBe(false);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `nvm use && node node_modules/.bin/jest src/tests/unit/operations/security/patientScopeManager.canBypassPatientScopeForUserWriteAsync.test.js`
Expected: FAIL — `manager.canBypassPatientScopeForUserWriteAsync is not a function`, and the
`PatientScopeManager` constructor throws because `configManager` isn't a recognized param yet
(harmless at this stage — it'll be accepted once Step 3 lands).

- [ ] **Step 3: Add the `configManager` constructor dependency**

In `src/operations/security/patientScopeManager.js`, add to the top-level `require`s:

```javascript
const { ConfigManager } = require('../../utils/configManager');
```

Update the constructor (lines 23-54):

```javascript
    constructor (
        {
            databaseQueryFactory,
            personToPatientIdsExpander,
            scopesManager,
            patientFilterManager,
            configManager
        }
    ) {
        /**
         * @type {DatabaseQueryFactory}
         */
        this.databaseQueryFactory = databaseQueryFactory;
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);

        /**
         * @type {PersonToPatientIdsExpander}
         */
        this.personToPatientIdsExpander = personToPatientIdsExpander;
        assertTypeEquals(personToPatientIdsExpander, PersonToPatientIdsExpander);

        /**
         * @type {ScopesManager}
         */
        this.scopesManager = scopesManager;
        assertTypeEquals(scopesManager, ScopesManager);

        /**
         * @type {PatientFilterManager}
         */
        this.patientFilterManager = patientFilterManager;
        assertTypeEquals(patientFilterManager, PatientFilterManager);

        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);
    }
```

Also update the class-level constructor JSDoc (lines 16-22) to add `@param {ConfigManager} configManager`.

- [ ] **Step 4: Add the new method and wire it into `canWriteResourceAsync`**

Add `currentResource` to `canWriteResourceAsync`'s param list and JSDoc (lines 287-305):

```javascript
    /**
     * returns whether this resource can be written based on permissions in the patient scope
     * @param {string} base_version
     * @param {boolean | null} isUser
     * @param {string|null} personIdFromJwtToken
     * @param {Resource} resource
     * @param {string | null} scope
     * @param {string} [user] Present when called via isAccessToResourceAllowedByPatientScopes(), which
     *   spreads the full FhirRequestInfo (including `user`) into this call.
     * @param {Resource|null} [currentResource] resource as currently stored, null/undefined when
     *   this call represents a create (mirrors isAccessTagChangeAllowedByAccessScopes's
     *   currentResource convention in scopesValidator.js). Only consulted for the allowlisted-type
     *   bypass below -- the ordinary compartment-resource path never needed it.
     * @returns {Promise<boolean>}
     */
    async canWriteResourceAsync ({
        base_version,
        isUser,
        personIdFromJwtToken,
        resource,
        scope,
        user,
        currentResource
    }) {
```

Change the bypass point (was `return false;` on line 323) to:

```javascript
        if (!this.scopesManager.isAccessAllowedByPatientScopes({
            scope,
            resourceType: resource.resourceType
        })) {
            // The caller does hold a patient scope, but this resource type is not
            // patient-filterable. A patient scope must never authorize writes to
            // shared/administrative resource types on its own -- but an operator-configured
            // allowlist may still let the token's *user* scope authorize the write instead. See
            // docs/superpowers/specs/2026-09-04-patient-scope-user-write-allowlist-design.md.
            return await this.canBypassPatientScopeForUserWriteAsync({
                base_version,
                isUser,
                personIdFromJwtToken,
                scope,
                user,
                resourceType: resource.resourceType,
                existingResource: currentResource
            });
        }
```

Add the new method after `canWriteResourceAsync` (after line 352, before the closing class brace):

```javascript
    /**
     * Whether a patient-scoped caller's write to a non-patient-filterable, allowlisted resource
     * type may proceed using the token's user scope instead of being vetoed outright. Never
     * substitutes for a real scope check -- it only lifts the veto so the ordinary user-scope
     * check gets to run, plus (for a write against an existing resource) an ownership check. See
     * docs/superpowers/specs/2026-09-04-patient-scope-user-write-allowlist-design.md §4.3.
     * @param {string} base_version
     * @param {boolean|null} isUser
     * @param {string|null} personIdFromJwtToken
     * @param {string} scope
     * @param {string} [user]
     * @param {string} resourceType
     * @param {Resource|null|undefined} existingResource null/undefined for a create (nothing to
     *   protect yet); the resource as currently stored for a write against an existing resource.
     * @returns {Promise<boolean>}
     */
    async canBypassPatientScopeForUserWriteAsync ({
        base_version,
        isUser,
        personIdFromJwtToken,
        scope,
        user,
        resourceType,
        existingResource
    }) {
        if (!this.configManager.patientScopeUserWriteAllowedResourceTypes.includes(resourceType)) {
            return false;
        }

        const userScopes = this.scopesManager.getUserScopes({ scope });
        const { success } = scopeChecker(resourceType, 'write', userScopes);
        if (!success) {
            return false;
        }

        if (!existingResource) {
            // Brand-new resource -- nothing to protect yet.
            return true;
        }

        const referenceIds = this.getValueOfPropertyFromResource({
            resource: existingResource,
            property: this.patientFilterManager.getPatientPropertyForResource({ resourceType })
        }) || [];
        const tagIds = this.scopesManager.getPatientIdsFromSourcePatientIdTag({ resource: existingResource });
        // Either signal being a match is sufficient proof of ownership -- an existence-of-a-match
        // check, not a require-all check (design §4.3, §5 -- do not "fix" this into an AND).
        const existingResourcePatientIds = [...referenceIds, ...tagIds];

        if (existingResourcePatientIds.length === 0) {
            // Neither ownership signal present on the existing resource -- we can't verify
            // ownership, so fail closed rather than assume it's fine.
            return false;
        }

        const callerPatientIds = await this.getPatientIdsFromScopeAsync({
            base_version,
            isUser,
            personIdFromJwtToken,
            requestInfo: typeof user === 'string' && scope ? { user, scope } : undefined
        });

        return existingResourcePatientIds.some(id => callerPatientIds.includes(id));
    }
```

Add the `scopeChecker` require at the top of the file (it's not yet imported here):

```javascript
const scopeChecker = require('@asymmetrik/sof-scope-checker');
```

- [ ] **Step 5: Update every other `PatientScopeManager` construction site**

`src/createContainer.js` (lines 494-501) — add `configManager: c.configManager`:

```javascript
    container.register('patientScopeManager', (c) => new PatientScopeManager(
        {
            databaseQueryFactory: c.databaseQueryFactory,
            personToPatientIdsExpander: c.personToPatientIdsExpander,
            scopesManager: c.scopesManager,
            patientFilterManager: c.patientFilterManager,
            configManager: c.configManager
        }
    ));
```

`src/tests/unit/operations/security/patientScopeManager.test.js` (lines 45-50) — this file already
defines `createMockInstance(ClassType)` (`Object.create(ClassType.prototype)`) and imports
`ConfigManager`'s sibling classes the same way; add the import and pass a mock instance (the real
getter runs on the bare prototype and returns `[]` by default, which is exactly what every existing
test in this file needs):

```javascript
const { ConfigManager } = require('../../../../utils/configManager');
// ...
        patientScopeManager = new PatientScopeManager({
            databaseQueryFactory: mockDatabaseQueryFactory,
            personToPatientIdsExpander: mockPersonToPatientIdsExpander,
            scopesManager: mockScopesManager,
            patientFilterManager: mockPatientFilterManager,
            configManager: createMockInstance(ConfigManager)
        });
```

`src/tests/unit/resourceAuthorization/05_patientScopeAndLinkExpansion.test.js` (lines 265-270) —
`ConfigManager` and `createMockInstance` are already used elsewhere in this same file (lines 89,
136-139), so just add the param:

```javascript
            patientScopeManager = new PatientScopeManager({
                databaseQueryFactory: mockDatabaseQueryFactory,
                personToPatientIdsExpander: realExpander,
                scopesManager: createMockInstance(ScopesManager),
                patientFilterManager: new PatientFilterManager(),
                configManager: createMockInstance(ConfigManager)
            });
```

`src/tests/unit/operations/security/patientScopeWriteBypass.test.js` (lines 44-49) — this file
mocks `utils/assertType` to a no-op, so a plain object is sufficient:

```javascript
        patientScopeManager = new PatientScopeManager({
            databaseQueryFactory: { createQuery: jestGlobal.fn() },
            personToPatientIdsExpander: { getPatientIdsFromPersonAsync: jestGlobal.fn().mockResolvedValue([]) },
            scopesManager: mockScopesManager,
            patientFilterManager,
            configManager: { patientScopeUserWriteAllowedResourceTypes: [] }
        });
```

`src/tests/unit/operations/security/writeAuthorizationBypass.test.js` — **two** constructions, both
in files that mock `utils/assertType`; add the same plain-object `configManager` to **both** (lines
44-49 and 151-156):

```javascript
            patientScopeManager = new PatientScopeManager({
                databaseQueryFactory: { createQuery: jestGlobal.fn() },
                personToPatientIdsExpander: { getPatientIdsFromPersonAsync: jestGlobal.fn().mockResolvedValue([]) },
                scopesManager: mockScopesManager,
                patientFilterManager: new PatientFilterManager(),
                configManager: { patientScopeUserWriteAllowedResourceTypes: [] }
            });
```

(second site — same file, second `beforeEach` block, `patientFilterManager: mockPatientFilterManager`)

```javascript
            patientScopeManager = new PatientScopeManager({
                databaseQueryFactory: { createQuery: jestGlobal.fn() },
                personToPatientIdsExpander: { getPatientIdsFromPersonAsync: jestGlobal.fn() },
                scopesManager: mockScopesManager,
                patientFilterManager: mockPatientFilterManager,
                configManager: { patientScopeUserWriteAllowedResourceTypes: [] }
            });
```

- [ ] **Step 6: Run the new test file, then every test file touched in Step 5**

Run:
```bash
nvm use && node node_modules/.bin/jest src/tests/unit/operations/security/patientScopeManager.canBypassPatientScopeForUserWriteAsync.test.js
node node_modules/.bin/jest src/tests/unit/operations/security/patientScopeManager.test.js
node node_modules/.bin/jest src/tests/unit/resourceAuthorization/05_patientScopeAndLinkExpansion.test.js
node node_modules/.bin/jest src/tests/unit/operations/security/patientScopeWriteBypass.test.js
node node_modules/.bin/jest src/tests/unit/operations/security/writeAuthorizationBypass.test.js
```
Expected: PASS for all five files (the four pre-existing files must show **no regressions** — same
pass count as before this task, since default allowlist is empty).

- [ ] **Step 7: Commit**

```bash
git add src/operations/security/patientScopeManager.js src/createContainer.js \
    src/tests/unit/operations/security/patientScopeManager.test.js \
    src/tests/unit/resourceAuthorization/05_patientScopeAndLinkExpansion.test.js \
    src/tests/unit/operations/security/patientScopeWriteBypass.test.js \
    src/tests/unit/operations/security/writeAuthorizationBypass.test.js \
    src/tests/unit/operations/security/patientScopeManager.canBypassPatientScopeForUserWriteAsync.test.js
git commit -m "Add PatientScopeManager.canBypassPatientScopeForUserWriteAsync"
```

---

### Task 4: Wire `create.js` / `update.js`

**Files:**
- Modify: `src/operations/security/scopesValidator.js` (`isAccessToResourceAllowedByPatientScopes`,
  lines 285-302; `isAccessToResourceAllowedByAccessAndPatientScopes`, lines 340-360)
- Modify: `src/operations/create/create.js` (line 232-234)
- Modify: `src/operations/update/update.js` (lines 341-343, 447-449)

**Interfaces:**
- Consumes: `PatientScopeManager.canWriteResourceAsync(..., currentResource)` (Task 3).
- Produces: `ScopesValidator.isAccessToResourceAllowedByPatientScopes({requestInfo, resource,
  base_version, currentResource})` and `ScopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes({requestInfo,
  resource, base_version, accessRequested, currentResource})` — both gain the new optional
  `currentResource` param. `currentResource` is `null` on every create branch, the pre-merge
  stored resource on update's found-existing-resource branch (see plan header "refines").

- [ ] **Step 1: Write the failing integration-style unit test**

Since `isAccessToResourceAllowedByAccessAndPatientScopes` is exercised end-to-end by the
integration suite already (Tasks 7/8 add the allowlist-specific cases), this task's own
verification is the existing `patientScopeWriteBypass.test.js` / `writeAuthorizationBypass.test.js`
suites plus a new direct unit test of the threading itself. Add to
`src/tests/unit/operations/security/patientScopeManager.canBypassPatientScopeForUserWriteAsync.test.js`
(same file as Task 3, new `describe` block — this exercises `canWriteResourceAsync`'s
`currentResource` passthrough directly, which is what `create.js`/`update.js` will now rely on):

```javascript
describe('PatientScopeManager.canWriteResourceAsync currentResource passthrough', () => {
    test('a create (currentResource null) is allowed for an allowlisted, non-compartment type', async () => {
        const manager = buildManager({ allowedResourceTypes: ['Binary'] });
        const resource = { resourceType: 'Binary', _uuid: 'binary-uuid-1' };
        const result = await manager.canWriteResourceAsync({
            base_version: '4_0_0', isUser: true, personIdFromJwtToken: 'person-1',
            resource, scope: 'user/Binary.write patient/*.*', user: 'client', currentResource: null
        });
        expect(result).toBe(true);
    });

    test('an update against an owned existing resource is allowed', async () => {
        const manager = buildManager({ allowedResourceTypes: ['Binary'], patientIdsFromScope: ['patient-uuid-1'] });
        const resource = { resourceType: 'Binary', _uuid: 'binary-uuid-1' };
        const currentResource = {
            resourceType: 'Binary',
            meta: { security: [{ system: SecurityTagSystem.sourcePatientId, code: 'patient-uuid-1' }] }
        };
        const result = await manager.canWriteResourceAsync({
            base_version: '4_0_0', isUser: true, personIdFromJwtToken: 'person-1',
            resource, scope: 'user/Binary.write patient/*.*', user: 'client', currentResource
        });
        expect(result).toBe(true);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nvm use && node node_modules/.bin/jest src/tests/unit/operations/security/patientScopeManager.canBypassPatientScopeForUserWriteAsync.test.js -t "currentResource passthrough"`
Expected: FAIL — both cases return `false` today, since `canWriteResourceAsync` doesn't yet accept/forward `currentResource`.

(This will actually already PASS once Task 3 lands, since Task 3 added `currentResource` to
`canWriteResourceAsync` directly. This task's real remaining gap is `create.js`/`update.js` not
yet passing `currentResource` through `scopesValidator.js` -- confirm Step 1's test passes now,
then proceed to wire the two higher layers, which have no isolated unit test today and are
verified by Tasks 7/8's integration tests instead.)

- [ ] **Step 3: Thread `currentResource` through `scopesValidator.js`**

`isAccessToResourceAllowedByPatientScopes` (lines 277-302):

```javascript
    /**
     * Throws forbidden error when access through patient scope is not allowed
     * @typedef {Object} IsAccessToResourceAllowedByPatientScopesParams
     * @property {import('../../utils/fhirRequestInfo').FhirRequestInfo} requestInfo
     * @property {Resource} resource
     * @property {string} base_version
     * @property {Resource|null} [currentResource] resource as currently stored, null/undefined on
     *   create -- see isAccessTagChangeAllowedByAccessScopes's currentResource for the established
     *   convention this reuses.
     *
     * @param {IsAccessToResourceAllowedByPatientScopesParams}
     */
    async isAccessToResourceAllowedByPatientScopes({requestInfo, resource, base_version, currentResource}) {
        // eslint-disable-next-line no-useless-catch
        try {
            if (
                !(await this.patientScopeManager.canWriteResourceAsync({
                    resource,
                    ...requestInfo,
                    base_version,
                    currentResource
                }))
            ) {
                throw new ForbiddenError(
                    `The current patient scope and person id in the JWT token do not allow writing the ${resource.resourceType} resource.`
                );
            }
        } catch (e) {
            throw e;
        }
    }
```

`isAccessToResourceAllowedByAccessAndPatientScopes` (lines 330-360) — also preSave `currentResource`
alongside `resource` whenever both are present, since this method is the only place that runs
`preSaveManager.preSaveAsync` before the ownership check, and `currentResource` needs the same
`_uuid` population `getValueOfPropertyFromResource` relies on:

```javascript
    /**
     * Throws forbidden error when access through patient scope or access scope is not allowed
     * @typedef {Object} IsAccessToResourceAllowedByAccessAndPatientScopesParams
     * @property {import('../../utils/fhirRequestInfo').FhirRequestInfo} requestInfo
     * @property {Resource} resource
     * @property {string} base_version
     * @property {string} accessRequested
     * @property {Resource|null} [currentResource] resource as currently stored, null/undefined on
     *   create.
     *
     * @param {IsAccessToResourceAllowedByAccessAndPatientScopesParams}
     */
    async isAccessToResourceAllowedByAccessAndPatientScopes({
                                                                requestInfo,
                                                                resource,
                                                                base_version,
                                                                accessRequested = 'write',
                                                                currentResource
                                                            }) {
        // eslint-disable-next-line no-useless-catch
        try {
            // Run preSave to generate _uuid values for references and resource
            const preSaveOptions = PreSaveOptions.fromRequestInfo(requestInfo);
            resource = await this.preSaveManager.preSaveAsync({resource, options: preSaveOptions});
            if (currentResource) {
                currentResource = await this.preSaveManager.preSaveAsync({resource: currentResource, options: preSaveOptions});
            }
            // validate access scopes for resource
            this.isAccessToResourceAllowedByAccessScopes({requestInfo, resource, accessRequested});
            // validate if resource being accessed is restricted for patient
            this.isAccessToResourceRestrictedForPatientScope({requestInfo, resource, accessRequested});
            // validate patient scopes for resource
            await this.isAccessToResourceAllowedByPatientScopes({requestInfo, resource, base_version, currentResource});
        } catch (e) {
            throw e;
        }
    }
```

- [ ] **Step 4: Update the three call sites**

`src/operations/create/create.js` (lines 232-234) — always a create, so `currentResource: null`:

```javascript
            await this.scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes({
                requestInfo, resource, base_version, currentResource: null
            });
```

`src/operations/update/update.js` line 341-343 (existing-resource branch — `resource` **is**
`foundResource` here, so `currentResource` is the same object):

```javascript
                await this.scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes({
                    requestInfo, resource: foundResource, base_version, currentResource: foundResource
                });
```

`src/operations/update/update.js` line 447-449 (create-via-PUT branch — no existing resource):

```javascript
                    await this.scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes({
                        resource: doc, requestInfo, base_version, currentResource: null
                    });
```

- [ ] **Step 5: Run the full patient-scope regression suite**

Run: `nvm use && node node_modules/.bin/jest src/tests/integration/patientScope -t ""`
Expected: PASS — every existing test unchanged (allowlist is still empty by default; `currentResource`
being `null` on every existing create call site and `foundResource` on the existing update call
site changes nothing observable since the allowlist gate in Task 3 returns `false` immediately for
every non-allowlisted type, same as the old unconditional `return false;`).

- [ ] **Step 6: Commit**

```bash
git add src/operations/security/scopesValidator.js src/operations/create/create.js src/operations/update/update.js \
    src/tests/unit/operations/security/patientScopeManager.canBypassPatientScopeForUserWriteAsync.test.js
git commit -m "Thread currentResource through create/update scope checks for the allowlist bypass"
```

---

### Task 5: Wire `$merge` (`mergeManager.preMergeChecksAsync`)

**Files:**
- Modify: `src/operations/merge/mergeManager.js` (constructor lines 37-143; `preMergeChecksAsync`
  lines 779-845; new private method)
- Modify: `src/createContainer.js` (`mergeManager` registration, lines 534-551)

**Interfaces:**
- Consumes: `PatientScopeManager.canBypassPatientScopeForUserWriteAsync(...)` (Task 3).
- Produces: `MergeManager` gains a required `patientScopeManager` constructor dependency and a new
  private method `canBypassPatientScopeVetoForMergeAsync({requestInfo, resourceToMerge,
  base_version}) => Promise<boolean>`.

- [ ] **Step 1: Write the failing integration test**

Add to a new file `src/tests/integration/patientScope/merge_with_patient_scope/merge_with_patient_scope_allowlist.test.js`
(kept separate from the existing `merge_with_patient_scope.test.js` so this task's test doesn't
collide with Task 7/8's own new integration tests, which will also live under
`merge_with_patient_scope/`):

```javascript
const binary1Resource = require('./fixtures/Binary/binary1.json');
const {
    commonBeforeEach, commonAfterEach, createTestRequest, getHeadersWithCustomPayload, mockHttpContext
} = require('../../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { ConfigManager } = require('../../../../../utils/configManager');

class AllowlistConfigManager extends ConfigManager {
    get patientScopeUserWriteAllowedResourceTypes () {
        return ['Binary'];
    }
}

describe('merge $merge with allowlisted user-scope bypass', () => {
    let requestId;
    beforeEach(async () => {
        await commonBeforeEach();
        requestId = mockHttpContext();
    });
    afterEach(async () => {
        await commonAfterEach();
    });

    test('an allowlisted type merges via user scope even with an unrelated patient scope present', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new AllowlistConfigManager());
            return c;
        });
        const headers = getHeadersWithCustomPayload({
            scope: 'user/*.* patient/Encounter.* access/*.*',
            username: 'admin-with-stray-patient-scope@example.com',
            clientFhirPersonId: 'clientFhirPerson',
            clientFhirPatientId: 'clientFhirPatient',
            bwellFhirPersonId: 'person1',
            bwellFhirPatientId: 'bwellFhirPatient',
            token_use: 'access'
        });

        const resp = await request
            .post('/4_0_0/Binary/$merge?validate=true')
            .send(binary1Resource)
            .set(headers);
        expect(resp).toHaveMergeResponse({ created: true });
    });
});
```

Create the fixture `src/tests/integration/patientScope/merge_with_patient_scope/fixtures/Binary/binary1.json`:

```json
{
  "resourceType": "Binary",
  "id": "binary1",
  "meta": {
    "source": "https://fhir-server-ui/upload",
    "security": [
      { "system": "https://www.icanbwell.com/owner", "code": "client_a" },
      { "system": "https://www.icanbwell.com/access", "code": "client_a" }
    ]
  },
  "contentType": "text/plain",
  "data": "dGVzdCBkYXRh"
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nvm use && node node_modules/.bin/jest src/tests/integration/patientScope/merge_with_patient_scope/merge_with_patient_scope_allowlist.test.js`
Expected: FAIL — merge returns `Write not allowed using user scopes if patient scope is present`
(the coarse-only check in `preMergeChecksAsync` still vetoes unconditionally).

- [ ] **Step 3: Add the `patientScopeManager` constructor dependency**

In `src/operations/merge/mergeManager.js`, add to the top-level `require`s:

```javascript
const { PatientScopeManager } = require('../security/patientScopeManager');
```

Update the constructor (lines 54-69, 143):

```javascript
    constructor (
        {
            databaseQueryFactory,
            auditLogger,
            databaseBulkInserter,
            databaseBulkLoader,
            scopesManager,
            scopesValidator,
            resourceMerger,
            resourceValidator,
            preSaveManager,
            configManager,
            databaseAttachmentManager,
            base64DataManager,
            postRequestProcessor,
            patientScopeManager
        }
    ) {
```

and, right after the existing `postRequestProcessor` assignment (before the closing `}` of the
constructor, line 143):

```javascript
        /**
         * @type {PatientScopeManager}
         */
        this.patientScopeManager = patientScopeManager;
        assertTypeEquals(patientScopeManager, PatientScopeManager);
```

Add `@param {PatientScopeManager} patientScopeManager` to the constructor's JSDoc block (after
`@param {PostRequestProcessor} postRequestProcessor` at line 52).

- [ ] **Step 4: Add the merge-specific existing-resource lookup + bypass call**

Add a new private method after `preMergeChecksAsync` (after line 845, before `preMergeChecksMultipleAsync`):

```javascript
    /**
     * Whether a patient-scoped caller's $merge write, vetoed by the coarse isScopesValidAsync
     * check in preMergeChecksAsync, may still proceed because the resource type is allowlisted and
     * the caller's user scope + resource ownership independently justify it. $merge runs only the
     * coarse scope check (design §2) -- create.js/update.js get this for free from their existing
     * finer-grained check, but merge has no equivalent hook, so this mirrors mergeResourceAsync's
     * own existing-resource lookup (lines ~324-354) to give
     * PatientScopeManager.canBypassPatientScopeForUserWriteAsync the pre-merge resource state its
     * ownership check needs. See docs/superpowers/specs/2026-09-04-patient-scope-user-write-allowlist-design.md §4.4.
     * @param {FhirRequestInfo} requestInfo
     * @param {Object} resourceToMerge
     * @param {string} base_version
     * @returns {Promise<boolean>}
     */
    async canBypassPatientScopeVetoForMergeAsync ({ requestInfo, resourceToMerge, base_version }) {
        if (!this.configManager.patientScopeUserWriteAllowedResourceTypes.includes(resourceToMerge.resourceType)) {
            return false;
        }

        const preSaveOptions = PreSaveOptions.fromRequestInfo(requestInfo);
        // resourceToMerge has not been through enrichment yet at this point in the merge pipeline
        // (see the comment on validateResourceSizeSync's call site below in
        // preMergeChecksMultipleAsync), so _uuid isn't populated -- preSave a deep copy purely to
        // compute the deterministic lookup uuid, without touching the object the rest of the merge
        // pipeline still expects in its pre-enrichment state.
        const resourceForUuidLookup = await this.preSaveManager.preSaveAsync({
            resource: deepcopy(resourceToMerge), options: preSaveOptions
        });
        const uuid = resourceForUuidLookup._uuid;
        assertIsValid(uuid, `No uuid for resource ${resourceToMerge.resourceType}/${resourceToMerge.id}`);

        /**
         * @type {Object|null}
         */
        let currentResource;
        let resourceTypeWasLoaded = false;
        if (this.databaseBulkLoader) {
            currentResource = this.databaseBulkLoader.getResourceFromExistingList({
                requestId: requestInfo.requestId,
                resourceType: resourceToMerge.resourceType,
                uuid
            });
            resourceTypeWasLoaded = this.databaseBulkLoader.isResourceTypeLoaded(
                { requestId: requestInfo.requestId, resourceType: resourceToMerge.resourceType }
            );
        }
        if (!currentResource && !resourceTypeWasLoaded) {
            const databaseQueryManager = this.databaseQueryFactory.createQuery(
                { resourceType: resourceToMerge.resourceType, base_version }
            );
            currentResource = await databaseQueryManager.fastFindOneAsync({
                query: { _uuid: uuid.toString() }
            });
        }
        if (currentResource) {
            currentResource = await this.preSaveManager.preSaveAsync({
                resource: currentResource, options: preSaveOptions
            });
        }

        return await this.patientScopeManager.canBypassPatientScopeForUserWriteAsync({
            base_version,
            isUser: requestInfo.isUser,
            personIdFromJwtToken: requestInfo.personIdFromJwtToken,
            scope: requestInfo.scope,
            user: requestInfo.user,
            resourceType: resourceToMerge.resourceType,
            existingResource: currentResource || null
        });
    }
```

Update `preMergeChecksAsync`'s forbidden-error handling (lines 814-836):

```javascript
            const forbiddenError = await this.scopesValidator.isScopesValidAsync({
                requestInfo,
                resourceType: resourceToMerge.resourceType,
                accessRequested: 'write',
                base_version
            });

            if (forbiddenError) {
                if (await this.canBypassPatientScopeVetoForMergeAsync({ requestInfo, resourceToMerge, base_version })) {
                    return null;
                }

                const operationOutcome = new OperationOutcome({
                    issue: forbiddenError.issue
                });

                return new MergeResultEntry({
                    id,
                    uuid: resourceToMerge._uuid,
                    sourceAssigningAuthority: resourceToMerge._sourceAssigningAuthority,
                    created: false,
                    updated: false,
                    issue: operationOutcome.issue?.[0] || null,
                    operationOutcome,
                    resourceType: resourceToMerge.resourceType
                });
            }
```

- [ ] **Step 5: Update the container registration**

`src/createContainer.js` (lines 534-551) — add `patientScopeManager: c.patientScopeManager`:

```javascript
    container.register('mergeManager', (c) => new MergeManager(
            {
                databaseQueryFactory: c.databaseQueryFactory,
                auditLogger: c.auditLogger,
                databaseBulkInserter: c.fastDatabaseBulkInserter,
                databaseBulkLoader: c.databaseBulkLoader,
                scopesManager: c.scopesManager,
                scopesValidator: c.scopesValidator,
                resourceMerger: c.resourceMerger,
                resourceValidator: c.resourceValidator,
                preSaveManager: c.preSaveManager,
                configManager: c.configManager,
                databaseAttachmentManager: c.databaseAttachmentManager,
                base64DataManager: c.base64DataManager,
                postRequestProcessor: c.postRequestProcessor,
                patientScopeManager: c.patientScopeManager
            }
        )
    );
```

- [ ] **Step 6: Run the new test, then the full merge + patient-scope regression suite**

Run:
```bash
nvm use && node node_modules/.bin/jest src/tests/integration/patientScope/merge_with_patient_scope/merge_with_patient_scope_allowlist.test.js
node node_modules/.bin/jest src/tests/integration/patientScope -t ""
node node_modules/.bin/jest src/tests/unit/operations/merge -t ""
```
Expected: PASS for the new test; no regressions in the existing suites (default allowlist empty →
`canBypassPatientScopeVetoForMergeAsync` returns `false` immediately for every resource type not
explicitly configured, identical to today's unconditional veto).

- [ ] **Step 7: Commit**

```bash
git add src/operations/merge/mergeManager.js src/createContainer.js \
    src/tests/integration/patientScope/merge_with_patient_scope/merge_with_patient_scope_allowlist.test.js \
    src/tests/integration/patientScope/merge_with_patient_scope/fixtures/Binary/binary1.json
git commit -m "Wire allowlisted user-scope bypass into mergeManager.preMergeChecksAsync"
```

---

### Task 6: Protect `sourcePatientId` once set

**Files:**
- Modify: `src/operations/security/scopesValidator.js` (new method after
  `isAccessTagChangeAllowedByAccessScopes`, i.e. after line 274)
- Modify: `src/operations/create/create.js` (line 237-239, alongside the existing
  `isAccessTagChangeAllowedByAccessScopes` call)
- Modify: `src/operations/update/update.js` (lines 426-428 and 452-454, alongside the existing
  `isAccessTagChangeAllowedByAccessScopes` calls)
- Test: `src/tests/unit/operations/security/scopesValidator.sourcePatientIdTagChange.test.js` (new)

**Interfaces:**
- Consumes: `configManager.patientScopeUserWriteAllowedResourceTypes` (Task 1),
  `scopesManager.getPatientIdsFromSourcePatientIdTag` (Task 2).
- Produces: `ScopesValidator.prototype.isSourcePatientIdTagChangeAllowed({requestInfo,
  currentResource, updatedResource})` — throws `ForbiddenError` if the write would change an
  already-set `sourcePatientId` tag on an allowlisted resource type; no-op otherwise (including
  when the type isn't allowlisted, or nothing was set before).

- [ ] **Step 1: Write the failing unit tests**

Create `src/tests/unit/operations/security/scopesValidator.sourcePatientIdTagChange.test.js`:

```javascript
const { describe, test, expect, jest: jestGlobal } = require('@jest/globals');

jestGlobal.mock('../../../../utils/assertType', () => ({
    assertIsValid: (val, msg) => { if (!val) throw new Error(msg || 'assertion failed'); },
    assertTypeEquals: () => {}
}));

const { ScopesValidator } = require('../../../../operations/security/scopesValidator');
const { ScopesManager } = require('../../../../operations/security/scopesManager');
const { SecurityTagSystem } = require('../../../../utils/securityTagSystem');
const { ForbiddenError } = require('../../../../utils/httpErrors');

function buildValidator ({ allowedResourceTypes = [] } = {}) {
    return new ScopesValidator({
        scopesManager: new ScopesManager({ configManager: {}, patientFilterManager: {} }),
        fhirLoggingManager: {},
        configManager: { patientScopeUserWriteAllowedResourceTypes: allowedResourceTypes },
        patientScopeManager: {},
        preSaveManager: {},
        delegatedAccessScopeManager: {}
    });
}

const requestInfo = { user: 'client', scope: 'user/Binary.write' };

describe('ScopesValidator.isSourcePatientIdTagChangeAllowed', () => {
    test('no-op when resource type is not allowlisted', () => {
        const validator = buildValidator({ allowedResourceTypes: [] });
        const currentResource = {
            resourceType: 'Binary',
            meta: { security: [{ system: SecurityTagSystem.sourcePatientId, code: 'patient-1' }] }
        };
        const updatedResource = {
            resourceType: 'Binary',
            meta: { security: [{ system: SecurityTagSystem.sourcePatientId, code: 'patient-2' }] }
        };
        expect(() => validator.isSourcePatientIdTagChangeAllowed({ requestInfo, currentResource, updatedResource })).not.toThrow();
    });

    test('no-op when nothing was set before (first write is free to set it)', () => {
        const validator = buildValidator({ allowedResourceTypes: ['Binary'] });
        const updatedResource = {
            resourceType: 'Binary',
            meta: { security: [{ system: SecurityTagSystem.sourcePatientId, code: 'patient-1' }] }
        };
        expect(() => validator.isSourcePatientIdTagChangeAllowed({ requestInfo, currentResource: null, updatedResource })).not.toThrow();
    });

    test('no-op when the tag is unchanged', () => {
        const validator = buildValidator({ allowedResourceTypes: ['Binary'] });
        const resource = {
            resourceType: 'Binary',
            meta: { security: [{ system: SecurityTagSystem.sourcePatientId, code: 'patient-1' }] }
        };
        expect(() => validator.isSourcePatientIdTagChangeAllowed({
            requestInfo, currentResource: resource, updatedResource: resource
        })).not.toThrow();
    });

    test('throws when an update tries to change an already-set tag to a different patient', () => {
        const validator = buildValidator({ allowedResourceTypes: ['Binary'] });
        const currentResource = {
            resourceType: 'Binary',
            id: 'binary-1',
            meta: { security: [{ system: SecurityTagSystem.sourcePatientId, code: 'patient-1' }] }
        };
        const updatedResource = {
            resourceType: 'Binary',
            id: 'binary-1',
            meta: { security: [{ system: SecurityTagSystem.sourcePatientId, code: 'patient-2' }] }
        };
        expect(() => validator.isSourcePatientIdTagChangeAllowed({ requestInfo, currentResource, updatedResource }))
            .toThrow(ForbiddenError);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nvm use && node node_modules/.bin/jest src/tests/unit/operations/security/scopesValidator.sourcePatientIdTagChange.test.js`
Expected: FAIL — `validator.isSourcePatientIdTagChangeAllowed is not a function`

- [ ] **Step 3: Write minimal implementation**

Add to `src/operations/security/scopesValidator.js`, immediately after
`isAccessTagChangeAllowedByAccessScopes` (after line 274):

```javascript
    /**
     * Throws forbidden error when a write to an allowlisted resource type (see
     * configManager.patientScopeUserWriteAllowedResourceTypes) tries to change an already-set
     * sourcePatientId ownership tag to a different patient. Once set, this tag is treated as
     * protected -- same posture SEC-1580 F2/F3 established for access/owner tags above -- so a
     * caller can't use one write to both pass canBypassPatientScopeForUserWriteAsync's ownership
     * check (evaluated against the pre-update value) and silently re-point a resource's recorded
     * ownership to a different patient in that same request. No-op for a non-allowlisted resource
     * type, or when no sourcePatientId tag was set before this write. See
     * docs/superpowers/specs/2026-09-04-patient-scope-user-write-allowlist-design.md §5, §7.
     * @typedef {Object} IsSourcePatientIdTagChangeAllowedParams
     * @property {import('../../utils/fhirRequestInfo').FhirRequestInfo} requestInfo
     * @property {Resource|null} currentResource resource as currently stored, null when being created
     * @property {Resource} updatedResource resource as it will be stored
     *
     * @param {IsSourcePatientIdTagChangeAllowedParams}
     */
    isSourcePatientIdTagChangeAllowed ({ requestInfo, currentResource, updatedResource }) {
        if (!this.configManager.patientScopeUserWriteAllowedResourceTypes.includes(updatedResource.resourceType)) {
            return;
        }
        const oldIds = this.scopesManager.getPatientIdsFromSourcePatientIdTag({ resource: currentResource });
        if (oldIds.length === 0) {
            return;
        }
        const newIds = this.scopesManager.getPatientIdsFromSourcePatientIdTag({ resource: updatedResource });
        const unchanged = oldIds.length === newIds.length && oldIds.every(id => newIds.includes(id));
        if (!unchanged) {
            const { user, scope } = requestInfo;
            throw new ForbiddenError(
                `user ${user} with scopes [${scope}] cannot change the sourcePatientId tag on an existing ` +
                `${updatedResource.resourceType} resource with id ${updatedResource.id}`
            );
        }
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `nvm use && node node_modules/.bin/jest src/tests/unit/operations/security/scopesValidator.sourcePatientIdTagChange.test.js`
Expected: PASS

- [ ] **Step 5: Wire it into `create.js`/`update.js` alongside the existing access-tag-change checks**

`src/operations/create/create.js` (immediately after line 239's existing call):

```javascript
            this.scopesValidator.isAccessTagChangeAllowedByAccessScopes({
                requestInfo, currentResource: null, updatedResource: resource
            });
            this.scopesValidator.isSourcePatientIdTagChangeAllowed({
                requestInfo, currentResource: null, updatedResource: resource
            });
```

`src/operations/update/update.js` (immediately after line 428's existing call, existing-resource branch):

```javascript
                    this.scopesValidator.isAccessTagChangeAllowedByAccessScopes({
                        requestInfo, currentResource: foundResource, updatedResource: doc
                    });
                    this.scopesValidator.isSourcePatientIdTagChangeAllowed({
                        requestInfo, currentResource: foundResource, updatedResource: doc
                    });
```

`src/operations/update/update.js` (immediately after line 454's existing call, create-via-PUT branch):

```javascript
                    this.scopesValidator.isAccessTagChangeAllowedByAccessScopes({
                        requestInfo, currentResource: null, updatedResource: doc
                    });
                    this.scopesValidator.isSourcePatientIdTagChangeAllowed({
                        requestInfo, currentResource: null, updatedResource: doc
                    });
```

Note: `$merge` does not get an equivalent wiring here — it does not enforce the analogous, older
`isAccessTagChangeAllowedByAccessScopes` protection for access/owner tags either (confirmed: no
call to that method anywhere in `src/operations/merge/`), so adding new protection infrastructure
to merge alone for `sourcePatientId` only would be scope creep beyond this plan's core ask. This is
a pre-existing gap for merge, not one this plan introduces.

- [ ] **Step 6: Run the full patient-scope regression suite**

Run: `nvm use && node node_modules/.bin/jest src/tests/integration/patientScope -t ""`
Expected: PASS — no regressions (every existing test's resource type is never on the allowlist, so
`isSourcePatientIdTagChangeAllowed` is a no-op for all of them).

- [ ] **Step 7: Commit**

```bash
git add src/operations/security/scopesValidator.js src/operations/create/create.js src/operations/update/update.js \
    src/tests/unit/operations/security/scopesValidator.sourcePatientIdTagChange.test.js
git commit -m "Protect sourcePatientId tag from being silently changed once set"
```

---

### Task 7: Integration tests — `Binary` (non-compartment allowlisted type)

**Files:**
- Test: `src/tests/integration/patientScope/create_with_patient_scope/binary_allowlist.test.js` (new)
- Test: `src/tests/integration/patientScope/update_with_patient_scope/binary_allowlist.test.js` (new)
- Fixtures: `src/tests/integration/patientScope/create_with_patient_scope/fixtures/Binary/binary1.json`,
  same under `update_with_patient_scope/fixtures/Binary/` (new)

**Interfaces:** None — this task only adds tests exercising Tasks 3, 4, 5, 6 together through the
real HTTP surface for `create`/`update` on `Binary` (a type absent from `patientFilterMapping`,
i.e. the pure `sourcePatientId`-tag ownership path).

- [ ] **Step 1: Write the create test**

Create `src/tests/integration/patientScope/create_with_patient_scope/fixtures/Binary/binary1.json`:

```json
{
  "resourceType": "Binary",
  "id": "binary1",
  "meta": {
    "source": "https://fhir-server-ui/upload",
    "security": [
      { "system": "https://www.icanbwell.com/owner", "code": "client_a" },
      { "system": "https://www.icanbwell.com/access", "code": "client_a" },
      { "system": "https://www.icanbwell.com/sourcePatientId", "code": "patient-uuid-1" }
    ]
  },
  "contentType": "text/plain",
  "data": "dGVzdCBkYXRh"
}
```

Create `src/tests/integration/patientScope/create_with_patient_scope/binary_allowlist.test.js`:

```javascript
const binary1Resource = require('./fixtures/Binary/binary1.json');
const {
    commonBeforeEach, commonAfterEach, createTestRequest, getHeadersWithCustomPayload
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { ConfigManager } = require('../../../../utils/configManager');

class AllowlistConfigManager extends ConfigManager {
    get patientScopeUserWriteAllowedResourceTypes () {
        return ['Binary'];
    }
}

const headersWithStrayPatientScope = getHeadersWithCustomPayload({
    scope: 'user/*.* patient/Encounter.* access/*.*',
    username: 'admin-with-stray-patient-scope@example.com',
    clientFhirPersonId: 'clientFhirPerson',
    clientFhirPatientId: 'clientFhirPatient',
    bwellFhirPersonId: 'person1',
    bwellFhirPatientId: 'bwellFhirPatient',
    token_use: 'access'
});

describe('create Binary with allowlisted user-scope bypass', () => {
    beforeEach(async () => { await commonBeforeEach(); });
    afterEach(async () => { await commonAfterEach(); });

    test('creates when the type is allowlisted, even with an unrelated patient scope present', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new AllowlistConfigManager());
            return c;
        });
        const resp = await request
            .put('/4_0_0/Binary/binary1')
            .send(binary1Resource)
            .set(headersWithStrayPatientScope);
        expect(resp).toHaveStatusCode(201);
    });

    test('is still denied when the allowlist is empty (default, no behavior change)', async () => {
        const request = await createTestRequest();
        const resp = await request
            .put('/4_0_0/Binary/binary1')
            .send(binary1Resource)
            .set(headersWithStrayPatientScope);
        expect(resp).toHaveStatusCode(403);
    });
});
```

- [ ] **Step 2: Run test to verify the first case fails, second already passes**

Run: `nvm use && node node_modules/.bin/jest src/tests/integration/patientScope/create_with_patient_scope/binary_allowlist.test.js`
Expected at this point in the plan (after Tasks 1-6 are already implemented per the plan order):
PASS for both — this task is verification of the already-implemented behavior, not new production
code. If run standalone before Tasks 1-6, the first case FAILs with `403`.

- [ ] **Step 3: Write the update test**

Create `src/tests/integration/patientScope/update_with_patient_scope/fixtures/Binary/binary1.json`
(same content as the create fixture above), and
`src/tests/integration/patientScope/update_with_patient_scope/fixtures/Binary/binary1_updated.json`:

```json
{
  "resourceType": "Binary",
  "id": "binary1",
  "meta": {
    "source": "https://fhir-server-ui/upload",
    "security": [
      { "system": "https://www.icanbwell.com/owner", "code": "client_a" },
      { "system": "https://www.icanbwell.com/access", "code": "client_a" },
      { "system": "https://www.icanbwell.com/sourcePatientId", "code": "patient-uuid-1" }
    ]
  },
  "contentType": "text/plain",
  "data": "dXBkYXRlZCBkYXRh"
}
```

Create `src/tests/integration/patientScope/update_with_patient_scope/binary_allowlist.test.js`:

```javascript
const binary1Resource = require('./fixtures/Binary/binary1.json');
const binary1Updated = require('./fixtures/Binary/binary1_updated.json');
const {
    commonBeforeEach, commonAfterEach, createTestRequest, getHeaders, getHeadersWithCustomPayload
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { ConfigManager } = require('../../../../utils/configManager');

class AllowlistConfigManager extends ConfigManager {
    get patientScopeUserWriteAllowedResourceTypes () {
        return ['Binary'];
    }
}

const headersWithStrayPatientScope = getHeadersWithCustomPayload({
    scope: 'user/*.* patient/Encounter.* access/*.*',
    username: 'admin-with-stray-patient-scope@example.com',
    clientFhirPersonId: 'clientFhirPerson',
    clientFhirPatientId: 'clientFhirPatient',
    bwellFhirPersonId: 'person1',
    bwellFhirPatientId: 'bwellFhirPatient',
    token_use: 'access'
});

describe('update Binary with allowlisted user-scope bypass', () => {
    beforeEach(async () => { await commonBeforeEach(); });
    afterEach(async () => { await commonAfterEach(); });

    test('updates an existing, owned Binary when the type is allowlisted', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new AllowlistConfigManager());
            return c;
        });
        let resp = await request
            .put('/4_0_0/Binary/binary1')
            .send(binary1Resource)
            .set(getHeaders());
        expect(resp).toHaveStatusCode(201);

        resp = await request
            .put('/4_0_0/Binary/binary1')
            .send(binary1Updated)
            .set(headersWithStrayPatientScope);
        expect(resp).toHaveStatusCode(200);
    });

    test('cannot change the sourcePatientId tag to a different patient on update', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new AllowlistConfigManager());
            return c;
        });
        let resp = await request
            .put('/4_0_0/Binary/binary1')
            .send(binary1Resource)
            .set(getHeaders());
        expect(resp).toHaveStatusCode(201);

        const spoofed = JSON.parse(JSON.stringify(binary1Updated));
        spoofed.meta.security = spoofed.meta.security.map(tag =>
            tag.system === 'https://www.icanbwell.com/sourcePatientId'
                ? { ...tag, code: 'a-different-patient' }
                : tag
        );

        resp = await request
            .put('/4_0_0/Binary/binary1')
            .send(spoofed)
            .set(headersWithStrayPatientScope);
        expect(resp).toHaveStatusCode(403);
    });
});
```

- [ ] **Step 4: Run both new test files**

Run:
```bash
nvm use && node node_modules/.bin/jest src/tests/integration/patientScope/create_with_patient_scope/binary_allowlist.test.js
node node_modules/.bin/jest src/tests/integration/patientScope/update_with_patient_scope/binary_allowlist.test.js
```
Expected: PASS for all four `test()` blocks.

- [ ] **Step 5: Commit**

```bash
git add src/tests/integration/patientScope/create_with_patient_scope/binary_allowlist.test.js \
    src/tests/integration/patientScope/create_with_patient_scope/fixtures/Binary \
    src/tests/integration/patientScope/update_with_patient_scope/binary_allowlist.test.js \
    src/tests/integration/patientScope/update_with_patient_scope/fixtures/Binary
git commit -m "Add Binary allowlist integration tests for create/update"
```

---

### Task 8: Integration tests — `DocumentReference` (compartment allowlisted type) + full regression

**Files:**
- Test: `src/tests/integration/patientScope/create_with_patient_scope/documentReference_allowlist.test.js` (new)
- Fixtures: `src/tests/integration/patientScope/create_with_patient_scope/fixtures/DocumentReference/documentReference1.json` (new)

**Interfaces:** None — final verification task.

- [ ] **Step 1: Write the test**

Create `src/tests/integration/patientScope/create_with_patient_scope/fixtures/DocumentReference/documentReference1.json`:

```json
{
  "resourceType": "DocumentReference",
  "id": "docref1",
  "meta": {
    "source": "https://fhir-server-ui/upload",
    "security": [
      { "system": "https://www.icanbwell.com/owner", "code": "client_a" },
      { "system": "https://www.icanbwell.com/access", "code": "client_a" }
    ]
  },
  "status": "current",
  "type": {
    "coding": [{ "system": "http://loinc.org", "code": "34133-9", "display": "Summary of episode note" }]
  },
  "subject": { "reference": "Patient/patient-uuid-1" },
  "content": [
    { "attachment": { "contentType": "application/pdf", "url": "Binary/binary1" } }
  ]
}
```

Create `src/tests/integration/patientScope/create_with_patient_scope/documentReference_allowlist.test.js`:

```javascript
const documentReferenceResource = require('./fixtures/DocumentReference/documentReference1.json');
const {
    commonBeforeEach, commonAfterEach, createTestRequest, getHeadersWithCustomPayload
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { ConfigManager } = require('../../../../utils/configManager');

class AllowlistConfigManager extends ConfigManager {
    get patientScopeUserWriteAllowedResourceTypes () {
        return ['Binary', 'DocumentReference'];
    }
}

const headersWithStrayPatientScope = getHeadersWithCustomPayload({
    scope: 'user/*.* patient/Encounter.* access/*.*',
    username: 'admin-with-stray-patient-scope@example.com',
    clientFhirPersonId: 'clientFhirPerson',
    clientFhirPatientId: 'clientFhirPatient',
    bwellFhirPersonId: 'person1',
    bwellFhirPatientId: 'bwellFhirPatient',
    token_use: 'access'
});

describe('create DocumentReference with allowlisted user-scope bypass', () => {
    beforeEach(async () => { await commonBeforeEach(); });
    afterEach(async () => { await commonAfterEach(); });

    test('creates a compartment-eligible type via user scope when allowlisted', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new AllowlistConfigManager());
            return c;
        });
        const resp = await request
            .put('/4_0_0/DocumentReference/docref1')
            .send(documentReferenceResource)
            .set(headersWithStrayPatientScope);
        expect(resp).toHaveStatusCode(201);
    });

    test('a DocumentReference NOT on the allowlist still falls through to the ordinary patient-scope check', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new class extends ConfigManager {
                get patientScopeUserWriteAllowedResourceTypes () { return ['Binary']; }
            }());
            return c;
        });
        const resp = await request
            .put('/4_0_0/DocumentReference/docref1')
            .send(documentReferenceResource)
            .set(headersWithStrayPatientScope);
        // DocumentReference IS patient-compartment-eligible (patientFilterMapping has it), so
        // when not itself allowlisted the *patient* scope subset gets checked instead of the veto
        // -- and this token's patient scope (patient/Encounter.*) doesn't cover
        // DocumentReference.write, so it still fails, just via the pre-existing compartment path
        // rather than the new bypass.
        expect(resp).toHaveStatusCode(403);
    });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `nvm use && node node_modules/.bin/jest src/tests/integration/patientScope/create_with_patient_scope/documentReference_allowlist.test.js`
Expected: PASS for both cases.

- [ ] **Step 3: Run the full repo test suite + lint**

Run:
```bash
nvm use && make lint
JEST_MAX_OLD_SPACE_SIZE=6144 make tests
```
Expected: PASS. If the machine can't handle the full in-band suite, at minimum run:
```bash
node node_modules/.bin/jest src/tests/integration/patientScope -t ""
node node_modules/.bin/jest src/tests/unit/operations/security -t ""
node node_modules/.bin/jest src/tests/unit/operations/merge -t ""
node node_modules/.bin/jest src/tests/unit/resourceAuthorization -t ""
node node_modules/.bin/jest src/tests/unit/utils/configManager.test.js
```

- [ ] **Step 4: Commit**

```bash
git add src/tests/integration/patientScope/create_with_patient_scope/documentReference_allowlist.test.js \
    src/tests/integration/patientScope/create_with_patient_scope/fixtures/DocumentReference
git commit -m "Add DocumentReference allowlist integration test and complete regression pass"
```

---

## Self-Review

**Spec coverage:**
- §4.1 Config → Task 1.
- §4.2 New ownership signal (tag + helper) → Task 2.
- §4.3 Bypass-eligibility check (all three conditions: allowlist membership, independent user-scope
  check, ownership-only-if-existing with fail-closed default) → Task 3.
- §4.4 Wiring: create.js/update.js → Task 4; mergeManager → Task 5.
- §5 Security considerations: mutual exclusivity (Task 3's user-scope check is never skipped, only
  unlocked) → Task 3; OR-not-AND quantifier → Task 3; `sourcePatientId` protected-field posture →
  Task 6; blast-radius containment (no `patientFilterMapping` touch) → never done anywhere in this
  plan, correctly; default-safe → Tasks 1/3/5 all gate on the allowlist first.
- §6 Testing plan: `getPatientIdsFromSourcePatientIdTag` unit tests → Task 2; bypass-eligibility
  unit tests (all 7 named scenarios) → Task 3; integration tests for create/update/merge on
  allowlisted (`Binary`) and compartment (`DocumentReference`) types → Tasks 5, 7, 8; regression
  with default empty allowlist → Tasks 4, 6, 7 (explicit empty-allowlist assertion), 8 (full suite).
- §7 Open questions: exact env-var resource list per environment is explicitly an ops decision, not
  a code task — correctly out of scope here. The `sourcePatientId`-protection question is resolved
  by implementing it now (Task 6), per the design doc's own recommendation.

**Placeholder scan:** no `TODO`/`TBD`/"add appropriate handling" language; every step has literal
code or an literal `Run:`/`Expected:` pair.

**Type consistency:** `currentResource` (nullable) is the one name used end-to-end for "resource as
stored, `null` on create" across `scopesValidator.js`, `create.js`, `update.js` — matching the
pre-existing `isAccessTagChangeAllowedByAccessScopes` convention. `canBypassPatientScopeForUserWriteAsync`'s
`existingResource` param name is deliberately distinct (it's a new, self-contained method, not
extending an existing one) but always fed from a `currentResource` value at every call site
(Task 3 step 4, Task 4 step 3, Task 5 step 4) — no caller ever needs to reconcile the two names
itself.
