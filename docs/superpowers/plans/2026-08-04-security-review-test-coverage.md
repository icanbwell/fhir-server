# FHIR Security Data Model Verification — Test Coverage Gap Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the gap between the 20 access-control rules enumerated in the "FHIR Security Data
Model Verification" review doc (follow-up to INC-331) and what our test suite actually,
currently, enforces in CI — not what a doc or a quarantined file merely *claims* to cover.

**Architecture:** This is a test-coverage remediation plan, not a feature build. Every task
either (a) restores dead/skipped coverage that already exists, (b) writes a net-new adversarial
test against a documented gap, or (c) reconciles a quarantined test with a bug fix that has
already landed. Where the underlying product bug is still open, the new test is expected to fail
initially and must be added to `jest.config.js`'s `testPathIgnorePatterns` with a one-line reason
— this mirrors the pattern the repo already uses for ~58 existing quarantined security tests, so
we are extending an established convention, not inventing one.

**Tech Stack:** Jest + MongoDB Memory Server, existing `src/tests/common.js` harness
(`getHeaders(scopes)`, `createTestRequest`), the `data_sharing/scenario_*` fixture-and-`$merge`
pattern.

## Global Constraints

- `docs/security-model-spec.md`, which the review doc calls the "authoritative reference" for all
  20 rules, **does not exist in this repo**. The only rule definitions available are the review
  doc's own Part Z matrix. Flag this to JTG/Kristen before sign-off — the checklist is currently
  ungrounded against any versioned spec file in-repo.
- Every new adversarial test must have a **positive and a negative case** (E.6 in the review doc)
  — a lone "should see" test cannot catch a missing filter.
- Use deterministic fixture ids consistent with existing `scenario_*` JSON fixtures; do not invent
  a second fixture-generation convention.
- Do not remove a file from `testPathIgnorePatterns` unless you have run it locally and confirmed
  it passes against current `main`. Several bugs the review doc describes as open have already
  been fixed by the in-flight `SEC-1580` initiative (F2, F3, F4, F5, F7, F11 are on `main`; F10 is
  not yet merged) — check current status before assuming the doc's "not enforced" framing still
  holds for the specific line it cites.
- This plan only adds/restores **tests**. Where a task uncovers a code fix that hasn't landed
  (W-chain, W1, W3, X-summary CACHE-1, X-export VULN-3), file that as a separate ticket referencing
  the relevant `SEC-1580` sub-finding — do not fix product code as a side effect of a test task.

---

## Why the plan is organized this way

The review doc's own Part F audit is **not fully reliable** — verified against the live repo:

- Several rows it cites as "✓ Covered" point at test files that are `describe.skip` end-to-end
  (`scenario_3`, `scenario_8`, `scenario_9`, `consent_based_data_access.test.js`,
  `disabled_consent_based_data_access.test.js`, `shared_patient.test.js`). A skipped file proves
  nothing; those rows have less real coverage than claimed.
- Parts W and X (write-path escalation, non-`$everything` egress) were **never audited against
  the test suite at all** — the doc only says the underlying behavior is unenforced. In fact a
  large body of adversarial tests for exactly these scenarios already exists under
  `src/tests/unit/**`, written specifically to "assert correct behavior for known, tracked bugs
  ... and fail by design until each is fixed" (`jest.config.js` comment) — but all ~58 of them are
  excluded from every CI run via `testPathIgnorePatterns`. Some of the bugs they target have since
  been fixed on `main` (via the `SEC-1580` commits) without their quarantine entry being removed,
  so their coverage is silently still off even though it would now pass.
- **W-chain** (Consent self-grant + Person.link graft → `$everything` leak) has **zero test
  coverage of any kind**, quarantined or otherwise. The review doc calls this "the confirmed
  exploit" and its own exit criterion says W-chain "must be explicitly cleared — not assumed." It
  is the single highest-priority gap in this plan, ahead of the doc's own headline picks
  (D-CL1, D-IDG5).

So the plan runs in four phases: **(0)** restore free/dead coverage, **(1)** close the confirmed
write-path exploit, **(2)** close the two doc-headline read-side gaps, **(3)** reconcile every
other quarantined file against current `main`, **(4)** close the remaining net-new gaps (Part X
and the smaller Part A/D rows).

---

## Phase 0 — Restore coverage that already exists but doesn't run

### Task 0.1: Un-skip the `data_sharing` scenario suites and re-triage

**Files:**
- Modify: `src/tests/data_sharing/scenario_3/data_sharing_scenario_3.test.js:38`
- Modify: `src/tests/data_sharing/scenario_8/data_sharing_scenario_8.test.js:41`
- Modify: `src/tests/data_sharing/scenario_9/data_sharing_scenario_9.test.js:33`
- Modify: `src/tests/consented_data/consented_data/consent_based_data_access.test.js:64`
- Modify: `src/tests/consented_data/consented_data/disabled_consent_based_data_access.test.js:38`
- Modify: `src/tests/consented_data/consented_data/shared_patient.test.js:49`

- [ ] Change each `describe.skip(...)` to `describe(...)` one file at a time.
- [ ] Run each file individually: `nvm use && node node_modules/.bin/jest <path> -t ""`.
- [ ] For every test that now fails: read the failure. If it fails because of an unrelated stale
  assertion (fixture drift, renamed field), fix the assertion — these suites predate several
  recent `SEC-1580` changes and may just be out of date. If it fails because it's hitting a real,
  still-open security bug, leave that single `test`/`describe` block skipped with a comment citing
  the bug (do not re-skip the whole file), and file a ticket.
- [ ] Also un-skip the individual `test.skip` in `scenario_1` at
  `src/tests/data_sharing/scenario_1/data_sharing_scenario_1.test.js:147` ("...and later consent
  revoked") for the same treatment — this is a revoke-then-requery test we otherwise have to build
  from scratch in Phase 2.
- [ ] Commit each file's restoration separately so a bad restore is easy to `git revert` in
  isolation.

**Why this is Phase 0:** this is coverage that was already written and paid for. Six files,
plus one individual test, currently contribute literally nothing to CI despite several rows in
Part F citing them as evidence.

---

## Phase 1 — Close the confirmed write-path exploit (W-chain, W1)

This is the review doc's own "confirmed exploit chain" and has **no test today, quarantined or
not**. `proaConsentManager.js` has no check that a Consent's grantor/owner actually owns the
patient it references, and no check ties `Person.link` writes back to an access-scope check on
the link target (`resourceValidator.js:123` returns early for any non-`isUser` caller). Both must
be exercised together (W-chain) and in isolation (W1) because a fix to one write path doesn't
guarantee the other is also closed.

### Task 1.1: W-chain integration test — the full exploit sequence

**Files:**
- Create: `src/tests/unit/operations/security/consentSelfGrantLinkGraft.test.js`
  (new quarantined-by-default file — add its path to `jest.config.js` `testPathIgnorePatterns`
  in the same commit, with the reason comment `// SEC-1580 W-chain: confirmed exploit, tracked
  under <ticket>`)

- [ ] Seed two tenants exactly like the `E.2` link graph in the review doc: Tenant A owns
  `patA` plus a PROA-consent-gated Observation on `patA`. Tenant B has its own client Person `PB`
  → master `M_B` → `patB`, with no relationship to Tenant A's data yet.
- [ ] As Tenant B (`getHeaders('user/*.read user/*.write access/client_b.*')`):
  1. `POST /4_0_0/Consent` — a Consent Tenant B owns (`meta.security` owner/access = clientB),
     `provision.type=permit`, matching `connectionType`, referencing `patA` as the patient.
  2. `PUT` Tenant B's own `Person` (`PB`) adding `link.target = Patient/patA`.
  3. `GET /4_0_0/Patient/patB/$everything` (or the proxy-patient form).
- [ ] **Assert (PASS condition):** either step 1 or step 2 is rejected (4xx), OR step 3's Bundle
  does not contain `patA` or any of its consented data.
- [ ] **This test is expected to fail against current `main`** — confirm it fails, and confirm
  *why* it fails matches the doc's description (Tenant A's data comes back) rather than an
  unrelated setup error, before quarantining it.
- [ ] Add a negative/control case: the identical sequence where Tenant B's Consent references a
  patient Tenant B *does* legitimately have consented access to — must still return that data (so
  the eventual fix doesn't overcorrect into "no self-created consent is ever honored").

### Task 1.2: W1 — Consent self-grant in isolation

**Files:**
- Modify: `src/tests/unit/operations/security/consentSelfGrantLinkGraft.test.js` (same file as
  1.1, second `describe` block — these two scenarios share fixtures)

- [ ] `POST`/`PUT` a Consent whose owner/grantor tag is Tenant B while its referenced patient is
  owned by Tenant A — **without** the link-graft step.
- [ ] Assert the write is rejected, or — if the write is accepted at persistence time — that a
  subsequent consent-driven read never honors it (i.e. `proaConsentManager`'s read-side query
  building excludes consents whose owner tag doesn't match the referenced resource's owner tag).
- [ ] This isolates the bug from W-chain: if 1.1 passes W1's assertion but not W-chain's, the fix
  needs to happen in the link-write path, not the consent-write path (or vice versa) — the
  eventual fix owner needs this to know where to look.

---

## Phase 2 — Close the two doc-headline read-side gaps (D-CL1, D-IDG5)

### Task 2.1: D-CL1 — revoke-then-requery against `$everything`, with cache-invalidation assertion

**Files:**
- Create: `src/tests/everything/consent_revocation/consent_revocation_everything.test.js`
- Reuse fixtures from: `src/tests/data_sharing/scenario_1/fixtures/` (master/client/proa
  person-patient-observation set) rather than inventing a new universe.

- [ ] Seed the standard PROA scenario (client person linked to a proa patient, active
  `consent_given` fixture).
- [ ] `GET /4_0_0/Patient/<clientPatientId>/$everything` with the client's scopes — assert the
  proa patient/observation **are present**.
- [ ] `PUT` the Consent to `provision.type=deny` (or delete it) — i.e. revoke.
- [ ] Re-run the identical `$everything` request — assert the proa data is **gone**.
- [ ] Add a `provision.period.end` case: seed a Consent whose `permit` provision's period already
  ended (`E.4`'s `consent_proa_expired` fixture shape) and assert `$everything` treats it as if no
  consent exists at all, without any revoke step.
- [ ] Add a cache-invalidation assertion specifically: if `$everything` responses are cached (the
  review doc flags a Redis response-cache TTL as the mechanism that could serve stale data), issue
  the revoke, then re-request `$everything` **before** any TTL could plausibly have expired
  (mock/advance the clock the same way `patient.summary.test.js:914` fakes the Redis generation
  key) and assert the response still reflects the revoke. If this requires manually bumping a
  cache-generation key the way the `$summary` test does, that itself is evidence the invalidation
  is not automatic — record that finding rather than quietly working around it in the test.
- [ ] Expect this file to need a `testPathIgnorePatterns` entry for the cache-invalidation
  sub-case specifically if the underlying generation-counter gap described in Task 4.3 (X-summary)
  turns out to be shared code — check `summaryCacheKeyGenerator.js`/`baseCacheKeyGenerator.js`
  usage from the `$everything` path before assuming it's a separate bug.

### Task 2.2: D-IDG5 — adversarial nested-tag probe on `$everything` and `$graph`

**Files:**
- Create: `src/tests/everything/nested_resource_tag_leak/nested_resource_tag_leak.test.js`

- [ ] Build the `E.3` cross-tenant nested resource exactly as specified: an Observation owned by
  tenantA that `references` a Practitioner or Organization owned by tenantB, both reachable from
  the same patient graph that `$everything` would normally expand.
- [ ] As a tenantA-only caller (`access/tenantA.*`), `GET /Patient/<id>/$everything`.
- [ ] **Assert:** the tenantB-owned nested Practitioner/Organization is **absent** from the
  returned Bundle — walk every `entry`, not just the root, and check each entry's
  `meta.security` owner/access tags against the caller's granted tags (this is the literal
  instruction in the doc's "single most important review action" callout).
- [ ] Repeat the identical seed/assert against `$graph` (`X-graph`'s scope) — D-IDG5 and X-graph
  are the same underlying leak surface through two different endpoints; one fixture, two request
  paths, per the doc's Part 2 principle ("cover every way data can leave").
- [ ] Contrast explicitly with `delete_everything_cross_tag.test.js` — that file proves the
  foreign-tagged nested resource can't be **deleted** via `$everything`; this new test proves it
  isn't **returned** by a `GET`. Do not consider this task done by pointing at that existing file.

---

## Phase 3 — Reconcile existing quarantined tests against current `main`

For each row, first check whether the underlying `SEC-1580` fix has already landed; if so this is
a "flip the flag" task, not a "write a test" task.

### Task 3.1: W2b (WPI-2, post-merge re-check) — confirm fixed, remove stale mock-only test

**Files:**
- Verify: `src/operations/update/update.js:422-428` (`isAccessTagChangeAllowedByAccessScopes`)
- Modify: `src/tests/unit/operations/security/writeAllowedByScopesValidator.test.js:491-541`

- [ ] Run `src/tests/operations/security/scopesManager.test.js` (F2/F3 cases, already live, not
  quarantined) — confirm green on current `main`.
- [ ] Read `writeAllowedByScopesValidator.test.js:491-541` — it currently mocks the SEC-1580
  post-merge check out as a no-op and asserts the *old* permissive behavior. Rewrite it to call
  through to the real check instead of stubbing it, so a future regression (someone removing the
  `update.js:422-428` call) fails this test instead of being silently masked.
- [ ] `mergeCrossTenantWrite.test.js` and `writeAuthorizationBypass.test.js` are still in
  `testPathIgnorePatterns`. Run both directly (`npx jest --testPathPatterns=<file>` bypasses the
  ignore list). For any individual test whose scenario is specifically the post-merge re-check
  (WPI-2), confirm it now passes; if so, split it out of the file or add a scoped
  `testPathIgnorePatterns` removal — do not blanket-unquarantine either file, since both also
  contain W2 (SAE-2, still open per Task 3.2) cases that will still fail.

### Task 3.2: W2 (SAE-2, access-tag forgery on write) — confirm still open, keep quarantined, narrow the citation

**Files:**
- Verify: `src/operations/security/scopesManager.js:244` (`if (accessViaPatientScopes) return
  true`)

- [ ] Confirm this line still unconditionally short-circuits the write-side "ALL access tags
  required" check for any patient-scoped caller — if so, W2 is a distinct, still-open bug from
  W2b and must stay quarantined.
- [ ] File a ticket citing `scopesManager.js:244` specifically (the doc only names the rule, not
  the line) so whoever fixes it doesn't have to re-derive what Task 2 of this audit already
  found.

### Task 3.3: W3 (IDG-4, Person.link target forgery) — confirm still open, keep quarantined

**Files:**
- Verify: `src/operations/common/resourceValidator.js:123` (`if (!isUser) return null`)
- Verify: `src/tests/unit/operations/merge/merge.crossTenant.test.js:533`

- [ ] Confirm `resourceValidator.js` still skips reference-array (hence `Person.link`) validation
  entirely for non-user (access/service-account) scopes, and only checks array length — never
  target tenant — for patient-scoped callers.
- [ ] `resourceValidator.test.js:210` ("allows array reference update for non-user scope") is
  **not** quarantined and currently asserts the permissive behavior as correct, on `Appointment`.
  Add a comment to that test noting it would need to change the day W3 is fixed for `Person`
  specifically, so nobody "fixes" `merge.crossTenant.test.js:533` by loosening
  `resourceValidator.test.js:210` instead of tightening the validator.

### Task 3.4: W4 (CACHE-2, delegated-actor cache collision) — lock in the incidental mitigation

**Files:**
- Create: `src/tests/unit/operations/security/delegatedActorCacheIsolation.test.js`
- Reference: `src/operations/everything/everythingHelper.js:318`,
  `src/operations/summary/summary.js:132`, `src/strategies/authService.js:253-254`

- [ ] `baseCacheKeyGenerator.js:84` builds cache keys without an actor/consent component — the
  literal CACHE-2 bug is real. But both consumers currently bail out of caching entirely when
  `requestInfo.userType === AUTH_USER_TYPES.delegatedUser`, so the collision is unreachable today
  as a **side effect**, not a design decision.
- [ ] Write a test that asserts this bail-out: two delegated actors with identical scopes but
  different sensitive-category denials both hit `$everything`/`$summary`, and assert **no cache
  write occurs** for either (spy on the Redis/cache-set call and assert it's never invoked for a
  `delegatedUser` request), not just that the two responses happen to differ.
- [ ] This test should be **live, not quarantined** — it documents current safe behavior. Its
  value is as a regression guard: if someone later "optimizes" the delegated-user bail-out away
  without also fixing the cache key, this test starts failing and catches the reintroduction of
  CACHE-2 before it ships.

### Task 3.5: X-export (VULN-3, `exportById` missing tenant-ownership check) — confirm still open, narrow quarantine

**Files:**
- Verify: `src/operations/export/exportById.js` (`getExportStatusResourceWithId` — fetch by id
  only, no access-tag cross-check)
- Verify: `src/tests/unit/operations/export/bulkDataExportRunner.crossTenant.test.js` (VULN-1
  through VULN-7)

- [ ] Confirm `exportById.js` still has no tenant-ownership check on the fetched `ExportStatus`.
- [ ] The rest of `bulkDataExportRunner.crossTenant.test.js` (VULN-1, 2, 4–7) may target different,
  independently-fixed or still-open issues — triage each `describe` block the same way as Task
  3.1/3.2, don't treat the file as one unit.
- [ ] File a ticket for VULN-3 specifically if still open; this is the one X-export sub-finding the
  review doc's exit criterion would block on, since Part D/W failures are blocking and this is the
  X-equivalent severity.

### Task 3.6: X-gql (v1/v2 `OperationAccessManager` wiring) — confirm scope of the gap, keep quarantined, add a targeted read-isolation test

**Files:**
- Verify: `src/graphql/dataSource.js` (v1 — `verifyAccess` only called for mutations)
- Verify: `src/graphqlv2/dataSource.js` (v2 — no `OperationAccessManager` reference at all)
- Create: `src/tests/graphqlv2/cmsDelegatedOperationAllowlist.test.js`

- [ ] This is not simply "GraphQL is unauthenticated" — reads still go through the shared
  `searchManager`/tenant-tag filtering, so basic tenant isolation holds on both versions. The gap
  is narrower: CMS-partner and delegated-user **operation/resource-type allowlisting**
  (`cmsManager.js:61-81`, `DelegatedAccessManager.verifyAccess`) is REST-only and never runs for
  any GraphQL read, v1 or v2.
- [ ] Write a new, narrowly-scoped test: a `cmsPartnerUser`-scoped GraphQL v2 query against a
  resource type that REST search would reject for that same token — assert whether GraphQL v2
  rejects it too. Expect this to fail (confirming the gap); quarantine with a comment distinguishing
  it from the existing `crossTenantPhiLeakage.test.js` (which targets DataLoader-level tenant
  bypass, a different bug).
- [ ] Do not attempt to reconcile the two existing large quarantined files
  (`graphqlResolver.crossTenant.test.js`, `crossTenantPhiLeakage.test.js`) in this task — they are
  large enough to warrant their own triage pass structured like Task 3.1; note that as a follow-up,
  don't silently skip it.

---

## Phase 4 — Remaining net-new gaps

### Task 4.1: A11 — admin scope bypass, intended-behavior characterization test

**Files:**
- Create: `src/tests/patientScope/admin_scope/admin_scope_tenant_bypass.test.js`

- [ ] Seed two tenants' data. As `admin/*.*`, search/read across both — assert data from both
  tenants is returned (this is by-design, per the doc; the test's job is to nail down that
  contract so a future accidental tightening doesn't silently break an intended admin workflow).
- [ ] As a **non-admin** token with only `access/clientA.*`, attempt the same cross-tenant
  read — assert it still returns nothing from clientB. This is the actual regression guard: admin
  bypass must not leak into the non-admin path via a shared code branch.
- [ ] This test should be live/passing, not quarantined, unless it reveals the bypass is broader
  than intended (e.g. reachable without the literal `admin/*.*` scope string).

### Task 4.2: A3 / A12 hardening — cross-tenant existence oracle and true global-resource test

**Files:**
- Create: `src/tests/patientScope/read_by_id.cross_tenant/read_by_id.cross_tenant.test.js`
- Create: `src/tests/data_sharing/global_resource_cross_tenant/global_resource_cross_tenant.test.js`

- [ ] A3 hardening: as tenantA, `GET /Patient/<tenantB_owned_id>` (direct read-by-id, not
  `$everything`) and separately `GET /Patient/<nonexistent_id>`. Assert the two responses are
  **indistinguishable** — same status code, same body shape, no field or timing difference that
  would let a caller infer "exists but forbidden" vs "doesn't exist." Compare directly against
  `errorInformationDisclosure.test.js:216` (quarantined) — if that test already asserts exactly
  this, promote/adapt it into a live integration test rather than writing a parallel one.
- [ ] A12 hardening: seed a truly shared, non-patient-linked resource (Organization or ValueSet)
  visible to tenantA. As tenantB (no relationship to tenantA at all, not even a shared-access
  case), request it — assert absence, unless the resource is intentionally globally public (in
  which case assert presence and document why that's the correct global-resource contract).

### Task 4.3: D-IDG1 hardening — promote the sibling-Person probe to an integration test

**Files:**
- Create: `src/tests/everything/sibling_person_traversal/sibling_person_traversal.test.js`
- Reference: `src/tests/unit/utils/personToPatientIdsExpander.crossTenant.test.js:23` (quarantined
  unit test — use as the model, not a substitute)

- [ ] Seed the `E.2` "trap Person S" — reachable via a shared grouping key but NOT on the queried
  Person's `link` — plus the queried Person's real link graph.
- [ ] `GET /Person/<id>/$everything` and the proxy-patient form — assert Person S's data never
  appears in either.
- [ ] This closes the gap between "we proved the *expander utility* excludes S in isolation"
  (the existing unit test) and "we proved the *actual endpoint* excludes S" (nothing currently
  does) — a unit-level pass doesn't guarantee every call site wires the exclusion in correctly.

### Task 4.4: D-SAE4 — reframe existing test around the exists-vs-not-found signal specifically

**Files:**
- Modify or extract from: `src/tests/unit/operations/update/conditionalCrossTenant.test.js:193,
  287, 374, 465`
- Create: `src/tests/patientScope/conditional_update_existence_oracle/conditional_update_existence_oracle.test.js`

- [ ] The existing quarantined tests prove a conditional update **succeeds** cross-tenant (a write
  bug). D-SAE4 as the doc frames it is about the **response signature** — does the API tell the
  caller "this exists, you can't touch it" vs "not found," regardless of whether the write is
  ultimately allowed. Add the narrower assertion: attempt a conditional/by-id write against a
  resource that exists but is foreign-tenant-owned, and against an id that plain doesn't exist —
  assert identical status/body shape for both, exactly like Task 4.2's A3 read-side version.
- [ ] Keep this as a new file rather than editing the quarantined one — the write-succeeds bug
  (VULN framing) and the existence-oracle bug (SAE-4/SAE-5 framing) are two different rules in
  Part Z and may be fixed independently.

### Task 4.5: X-graph — multi-chunk consent-state test (regression guard for the F4 fix)

**Files:**
- Create: `src/tests/practitioner/graph_consent_chunking/graph_pss_chunked_consent.test.js`

- [ ] `graphHelpers.js`'s per-chunk consent-cache keying (`everythingChunkIndex`) was fixed on
  `main` via `SEC-1580 F4` (commit `a3b99df35`). No test currently exercises the specific failure
  mode it fixed: multiple id-chunks within one `$graph` call where consent state differs between
  chunks.
- [ ] Force chunking the same way `practitioner.graph_pss_chunked.test.js` does
  (`graphBatchSize=1` or equivalent), seed two patients in the same `$graph` traversal — one with
  active PROA consent, one revoked — and assert each chunk's result reflects its own consent
  state, not a stale/leaked value from the other chunk's cache entry. This is a regression guard,
  not a bug hunt — expect it to pass; its value is catching a future reintroduction of the
  unkeyed-cache bug.

### Task 4.6: X-summary CACHE-1 — expose the dormant generation counter (code-fix ticket, test documents it)

**Files:**
- Verify: `src/operations/summary/summaryCacheKeyGenerator.js:35-52`,
  `src/dataLayer/redisManager.js:73` (`incrementGenerationAsync` — confirm still only called from
  the lazy-init branch)
- Create: `src/tests/unit/operations/summary/summaryCacheGenerationInvalidation.test.js`
  (quarantined — add to `testPathIgnorePatterns`)

- [ ] Write the real CACHE-1 scenario without faking the Redis key: apply a `meta.security` tag
  change or a Consent revoke through the actual write path, then re-request `$summary`, and
  assert the response changes. Do not call `redisData.set(...)`/`incrementGenerationAsync`
  manually anywhere in this test — if it needs that to pass, it isn't testing invalidation, it's
  testing the mock.
- [ ] Confirm this fails (it should, since nothing in production code currently bumps the
  generation on a security-relevant write). Quarantine with a comment pointing at
  `summaryCacheKeyGenerator.js` and file a ticket: the fix needs a post-save hook (likely in
  `src/preSaveHandlers/` or a Consent-write listener) that calls `incrementGenerationAsync` on
  any write that changes a resource's or its owner-Person's security posture.

---

## Self-review notes

- **Spec coverage:** every row in the review doc's Part Z (IDG-1..7, SAE-1..6, WPI-1..2,
  CACHE-1..2, CL-1..3) maps to at least one task above via its Part A–D/W/X row id. A1, A2, B4-neg,
  B5, B6, C7, C8, C9, C10 have no dedicated task because live, verified, non-quarantined coverage
  already exists (Phase-0's audit) and no gap was found — they're intentionally omitted rather than
  missed.
- **Placeholder scan:** every task names an exact file path and an exact assertion; none defer
  "add appropriate checks" to the implementer.
- **Type/name consistency:** file paths for new tests follow the existing directory convention
  (`src/tests/<area>/<scenario_name>/<scenario_name>.test.js`) used throughout `src/tests/`.

## Execution note

This plan intentionally does **not** hand off to `subagent-driven-development` /
`executing-plans` yet. Several tasks (1.1, 1.2, 2.1's cache sub-case, 4.6) will produce tests that
fail against current `main` by design and require a human call on whether to quarantine or block
on a code fix first — that judgment should happen with a reviewer in the loop (per the doc's own
L1–L4 sign-off process), not inside an unattended subagent loop. Recommend running Phase 0 and
Task 3.x (verification-only, no new red tests) via subagent-driven-development first, then
handling Phases 1, 2, and 4 task-by-task with review checkpoints.
