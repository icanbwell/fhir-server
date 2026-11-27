# Delegated v2-scopes-only Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A RelatedPerson delegated token reaches the request path carrying only SMART v2 letter scopes, behind a default-off flag; a delegate left with no v2 `patient/` scope is refused with a 401 at login.

**Architecture:** One pure filter function in `smartScopeParser.js`, called once from `AuthService.processUserInfo` right after the delegated user type is set. Every downstream consumer reads the filtered `scope`, so nothing else changes.

**Tech Stack:** Node.js (CommonJS), Jest. Unit tests run with `--config jest.unit.config.js`.

**Spec:** `docs/specs/delegated-v2-scopes-only.md`

## Global Constraints

- Work on a new branch cut from the Consent-permissions branch; the PR is based on that branch.
- Flag: env `ENABLE_DELEGATED_V2_SCOPES_ONLY`, getter `enableDelegatedV2ScopesOnly`, default `false`.
- Only tokens with `context.actor.isOrganizationActor === false` (RelatedPerson) are filtered. Organization actors and non-delegated tokens are unchanged.
- Refusal reason string: `delegated_actor_no_v2_scope`, via `done(null, false, { reason })` after `logWarn('Auth rejected', ...)`.
- Prefixes filtered: `patient`, `user`, `access`, `system`, `admin` (five; matched case-insensitively); other tokens (`openid`, `profile`) are kept.
- No ticket IDs in code, comments, tests, test names or docs. No code comments beyond JSDoc. Tests are parameterized with `test.each`.
- Stage your own files with explicit paths. No commit or push until asked; a commit message starts with the ticket key, with no Co-Authored-By.
- Run jest as `yarn jest --runInBand --forceExit --config jest.unit.config.js <path>`. Do not run the full suite.
- Security-sensitive path (OAuth scope parsing): check the diff against `review.md` before finishing.

## Review Focus

- A delegate with only v1 scopes: refused with a 401, never reaching the request path with an empty scope.
- A delegate with v1 and v2 tokens mixed: v1 dropped, v2 kept, `openid` kept.
- Extra or repeated spaces in the scope string: no empty tokens, no crash.
- Wrong-case prefix (`Patient/Observation.rs`): `isUser` counts it, so the filter must treat it like `patient/`.
- A `patient/` scope that survives only as an invalid suffix (`patient/Observation.sr`, out of order): dropped, so the delegate is refused.

---

### Task 1: The flag

**Files:**
- Modify: `src/utils/configManager.js` (next to `enableDelegatedConsentResourcePermissions`, around line 1650)
- Test: `src/tests/unit/utils/configManager.envMatrix.test.js` (next to the `enableDelegatedConsentResourcePermissions` test, around line 155)

**Interfaces:**
- Produces: `configManager.enableDelegatedV2ScopesOnly: boolean`

- [ ] **Step 1: Create the branch** `git checkout -b <branch>` from the Consent-permissions branch, and confirm `git status` is clean apart from the two staged docs files.
- [ ] **Step 2: Write the failing test** `enableDelegatedV2ScopesOnly defaults to FALSE when unset and for "false"`: unset and `'false'` give `false`, `'true'` gives `true`, in the same shape as the neighbouring test.
- [ ] **Step 3: Run it to see it fail** with `yarn jest --runInBand --forceExit --config jest.unit.config.js src/tests/unit/utils/configManager.envMatrix.test.js -t enableDelegatedV2ScopesOnly`. Expected: FAIL (`undefined` is not `false`).
- [ ] **Step 4: Add the getter** `get enableDelegatedV2ScopesOnly()` returning `isTrue(env.ENABLE_DELEGATED_V2_SCOPES_ONLY)`, with a JSDoc saying a RelatedPerson delegated token is evaluated on v2 letter scopes only, that it needs `ENABLE_SMART_V2_CRUDS_SCOPES` on too, and that with that flag off the letters do not parse so the delegate is denied.
- [ ] **Step 5: Run the test** as in Step 3. Expected: PASS.
- [ ] **Step 6: Stage** `src/utils/configManager.js` and the test file.

### Task 2: The scope filter

**Files:**
- Modify: `src/operations/security/smartScopeParser.js` (add the function and export it)
- Test: `src/tests/unit/operations/security/smartScopeParser.test.js`

**Interfaces:**
- Produces: `filterToV2LetterScopes(scope: string): string` — splits on runs of whitespace, drops a token whose prefix (before the first `/`, lowercased) is one of the five filtered prefixes (`SCOPE_PREFIXES` plus `admin`) and whose suffix (after the first `.`) is not `isV2Suffix`, keeps every other token, returns the kept tokens joined by one space (`''` when none, `''` for an empty input).

- [ ] **Step 1: Write the failing test** `filterToV2LetterScopes` with one `test.each` of `[input, expected]`:
  - `'patient/Observation.rs'` → `'patient/Observation.rs'`
  - `'patient/Observation.read patient/Patient.rs'` → `'patient/Patient.rs'`
  - `'openid patient/Patient.write access/client.*'` → `'openid'`
  - `'openid user/*.rs access/client.cruds'` → `'openid user/*.rs access/client.cruds'`
  - `'patient/Observation.sr'` → `''` (out of order)
  - `'Patient/Observation.rs Patient/Observation.read'` → `'Patient/Observation.rs'`
  - `'  patient/Patient.rs   openid '` → `'patient/Patient.rs openid'`
  - `'patient/Patient'` → `''` (no suffix)
  - `''` → `''`
  - `'admin/*.write'` → `''`, `'admin/*.cruds'` → `'admin/*.cruds'`, `'openid admin/*.* patient/Patient.rs'` → `'openid patient/Patient.rs'`
- [ ] **Step 2: Run it to see it fail** with `-t filterToV2LetterScopes`. Expected: FAIL (not a function).
- [ ] **Step 3: Implement `filterToV2LetterScopes`** in `smartScopeParser.js` with a JSDoc, reusing `isV2Suffix` and `SCOPE_PREFIXES` (with a local constant adding `admin`); add it to `module.exports`.
- [ ] **Step 4: Run the test** as in Step 2. Expected: PASS.
- [ ] **Step 5: Stage** both files.

### Task 3: Apply it in `processUserInfo`

**Files:**
- Modify: `src/strategies/authService.js` (the delegated block in `processUserInfo`, after `context.userType = AUTH_USER_TYPES.delegatedUser`, before the Consent lookup; import `filterToV2LetterScopes`)
- Test: `src/tests/unit/strategies/authService.test.js` (new `describe('processUserInfo with enableDelegatedV2ScopesOnly')` inside `processUserInfo`, built like the existing `processes delegated actor` test: `enableDelegatedAccessDetection` true, `enableDelegatedV2ScopesOnly` set per case via `Object.defineProperty`)

**Interfaces:**
- Consumes: `filterToV2LetterScopes` (Task 2); `configManager.enableDelegatedV2ScopesOnly` (Task 1)
- Produces: for a flagged RelatedPerson delegate, the `scope` passed to `done` is the filtered string; with no `patient/` token left, `done(null, false, { reason: 'delegated_actor_no_v2_scope' })`.

- [ ] **Step 1: Write the failing tests**, all with a RelatedPerson `act` claim and `isUser: true`; await `processUserInfo` and assert on `done`:
  - flag on, scope `'openid patient/Patient.read patient/Observation.rs'` → `done` called with scope `'openid patient/Observation.rs'`
  - flag on, scope `'patient/Patient.read access/client.read'` → `done(null, false, { reason: 'delegated_actor_no_v2_scope' })`
  - flag on, scope `'patient/Patient.sr'` → same refusal
  - flag off, scope `'patient/Patient.read'` → scope unchanged
  - flag on, Organization `act` claim (`isOrganizationActor` true), scope `'patient/Patient.read'` → scope unchanged
  - flag on, no `act` claim, `isUser: true`, scope `'patient/Patient.read'` → scope unchanged
  - flag on, RelatedPerson `act` claim but `isUser: false` → the `act` claim is ignored and `done` is called with the scope unchanged
- [ ] **Step 2: Run them to see them fail** with `-t "enableDelegatedV2ScopesOnly"`. Expected: the filter and refusal cases FAIL; the unchanged cases may already pass.
- [ ] **Step 3: Implement** in the delegated block: when `this.configManager.enableDelegatedV2ScopesOnly` and `!context.actor.isOrganizationActor`, set `scope = filterToV2LetterScopes(scope)`; if no token of the result starts with `patient/` (case-insensitive, the same rule `getFieldsFromToken` uses for `isUser`), call `logWarn('Auth rejected', { reason: 'delegated_actor_no_v2_scope', username, subject })`, `done(null, false, { reason: 'delegated_actor_no_v2_scope' })`, and return.
- [ ] **Step 4: Run the tests** as in Step 2, then the whole `authService.test.js`. Expected: PASS.
- [ ] **Step 5: Stage** both files.

### Task 4: Integration test and readme

**Files:**
- Test: `src/tests/integration/strategies/jwt.bearer.strategy.test.js` (a new test beside the existing delegated-actor tests, around line 350; the same nock-backed setup with a `MockConfigManager` that overrides the two flags)
- Modify: `readme/delegatedActorAccess.md` (a bullet in the Config list, around line 391)

**Interfaces:**
- Consumes: the whole flow from Tasks 1 to 3.

- [ ] **Step 1: Write the failing test** `rejects a RelatedPerson delegated token carrying only v1 scopes when enableDelegatedV2ScopesOnly is on`: sign a token with scope `'patient/*.read access/*.read'` and a RelatedPerson `act`, with `enableDelegatedAccessDetection`, `enableSmartV2CrudsScopes` and `enableDelegatedV2ScopesOnly` all true, and assert the strategy refuses it (the same assertion the neighbouring tests use for an invalid `act`). Add a second test with scope `'patient/*.rs access/*.rs'` that passes and exposes `'patient/*.rs access/*.rs'` as the scope.
- [ ] **Step 2: Run it** with `yarn jest --runInBand --forceExit src/tests/integration/strategies/jwt.bearer.strategy.test.js -t enableDelegatedV2ScopesOnly` (Docker is not needed if the file only mocks the IdP; if it does need it, say so and leave this run to CI). Expected: the refusal test FAILs before Task 3 and PASSes after.
- [ ] **Step 3: Add the readme bullet** `ENABLE_DELEGATED_V2_SCOPES_ONLY`: true/false, default `false`; for a RelatedPerson delegated token only v2 letter scopes (`patient/Observation.rs`) are kept and v1 `.read`, `.write` and `.*` are dropped; a token left with no `patient/` scope gets 401; Organization actors and other tokens are unchanged; turn it on together with `ENABLE_SMART_V2_CRUDS_SCOPES`.
- [ ] **Step 4: Run `make lint`** (or `yarn eslint` on the changed files) and fix findings.
- [ ] **Step 5: Review the diff against `review.md`** (scope parsing) and note anything that cannot be confirmed.
- [ ] **Step 6: Stage** the test and the readme; tell the user what is staged.
