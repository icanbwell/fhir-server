# Patient-scoped `Binary` create and person-scoped `Binary` read: implementation plan

**Ticket:** [DCON-5986](https://icanbwell.atlassian.net/browse/DCON-5986)
**Design:** [`docs/superpowers/specs/2026-10-08-binary-patient-scoped-write-design.md`](../specs/2026-10-08-binary-patient-scoped-write-design.md)

This is the implementation plan for the design above. It is shared for review before any code is
written; nothing in `src/` changes in this PR. Section references (§) point at the design doc. The
design's open questions were resolved in review; the outcomes are in the Decisions table below and in
design §0, and the plan reflects them.

## Scope

Build exactly what the design's "Option 1" describes, behind `ENABLE_PATIENT_SCOPED_BINARY_CREATE`
(default off):

- patient-scoped tokens can **create** (only) a `Binary`; the server stamps a
  `https://www.icanbwell.com/clientPersonId` tag from the token's person id and rejects a mismatched
  supplied tag with a reason;
- every `Binary` read path filters tagged `Binary` to the caller's person id for patient-scoped
  callers: mixed tokens (with access codes) also keep reading untagged `Binary` exactly as today, and
  pure patient tokens holding `patient/Binary.read` read **only** their own tagged `Binary`;
- system/user/admin tokens without a patient scope are unchanged and not auto-stamped.

Out of scope (unchanged from the design): update/patch/delete/`$merge` of `Binary` by patient tokens,
the by-id read gap for untagged `Binary` (§12.1), backfilling tags, and other 2+ hop resource types.

## Decisions (resolved in review, 2026-10-08)

| Topic | Decision | Effect on this plan |
|---|---|---|
| OQ-1 tag hardening | Parity with other patient-scoped creates; no `access`/`owner` restriction (verified none exists for any type today). Tracked as follow-up F-1 for all types | The tag-restriction step is removed from PR 3 |
| OQ-3 limits | Whatever fhir-server does today; no Binary-specific size or content-type limits. Findings: only the global `PAYLOAD_LIMIT` (50 MB) exists, and the body is parsed before the token is verified (existing, follow-up F-2) | The limits work is removed from PR 4 |
| OQ-4 logging | Log the person id as-is, like existing code | Logging step uses the plain id |
| OQ-6 tag URI | Approved: `https://www.icanbwell.com/clientPersonId`, valued with `personIdFromJwtToken` (the id the person read path uses) | PR 1 constant |
| OQ-5 member read | Yes: `patient/Binary.read` alone lets a member read their own tagged `Binary` | New read-gate change and strict read mode added to PR 2 |
| Mismatched tag | Reject (403) with a reason | PR 3 error message and test T42 |
| Rollout order | Read filter first, then create | PRs are ordered that way (already) |
| OQ-2 | Not a decision: verify cache and `text/plain` read paths during implementation | PR 2 verification (moved up from PR 4, because the read filter now ships first) |

Follow-ups outside this change (they apply beyond `Binary`): **F-1** constrain `access`/`owner` tags on
all patient-scoped creates; **F-2** authenticate before parsing the request body (or a lower pre-auth
limit); **F-3** optional per-member upload cap and content-type allowlist.

## Delivery: four small PRs, each flag-off and independently revertable

The flag keeps behavior identical until it is turned on, so each PR can merge without changing
production behavior. The order is chosen so that the **read filter ships before the write carve-out**
(the filter is a no-op for untagged data, so it is safe first, and no tagged `Binary` can exist until
the create path lands).

### PR 1: flag, constants, predicates (no behavior change)

| File | Change |
|---|---|
| `src/utils/securityTagSystem.js` | add `clientPersonId: 'https://www.icanbwell.com/clientPersonId'` |
| `src/utils/configManager.js` | `get enablePatientScopedBinaryCreate()` reading `ENABLE_PATIENT_SCOPED_BINARY_CREATE` via `isTrue(...)`, next to `enableDelegatedAccessDetection` (~line 1429). The flag name is kept; it gates both the create carve-out and the read changes |
| `src/fhir/patientFilterManager.js` | `personSecurityTagResources = ['Binary']` and `isPersonSecurityTagResource({ resourceType })`; **do not** touch `patientFilterMapping` (design §4.3: adding `Binary` there would make it patient-filterable for every caller) |
| `src/operations/security/scopesManager.js` | `isPatientScopedPersonTagAccess({ scope, resourceType, action })`: true iff flag on, `isPersonSecurityTagResource`, `action` is `create` or a read action, and `hasPatientScope({ scope })` (the existing case-insensitive predicate that `isUser` must agree with); plus `isPatientScopedPersonTagCreate` as the `create`-only variant used in PR 3. Also a small helper `hasUserOrSystemScope({ scope })` for the read-gate decision below |
| `src/operations/common/securityTagManager.js` | pure builder `getQueryWithPersonSecurityTag({ query, personId, hasAccessTags, useHistoryTable })` implementing design §4.4: `{ _uuid: '__invalid__' }` when `personId` is empty (fail closed); mixed mode (`hasAccessTags`): ANDs `untagged OR own tag`; strict mode (pure patient token): ANDs `own tag` only |
| `src/tests/unit/operations/security/` | unit tests: the predicates' truth table (flag x action x scope shape, including upper-case `PATIENT/` and mixed tokens); the query builder (mixed vs strict shape, history-table field names, empty person id) |

Exit criteria: unit tests green; `git diff` shows no call sites using the new functions.

### PR 2: read filter and member read scope

| File | Change |
|---|---|
| `src/operations/security/scopesValidator.js` | in `isScopesValidAsync` (the `accessViaPatientScopes` / `else` branch, ~lines 144-171): for a **read** of `Binary` when the token has a patient scope and **no** `user/`/`system/` scope, evaluate the patient scopes (`getPatientScopes`) for `Binary` instead of falling to the `user/`+`system/` branch that requires an `access/` code. Tokens that also carry `user/`/`system/` scopes keep today's evaluation unchanged |
| `src/operations/search/searchManager.js` | after the access-tag / patient-filter block (the `else if (securityTags ...)` branch ends ~line 440) and **before** `queryRewriterManager.rewriteQueryAsync` (~line 471): if flag on and `isPersonSecurityTagResource({ resourceType })` and `hasPatientScope({ scope })`, call the builder from PR 1 with `hasAccessTags = securityTags && securityTags.length > 0`. The predicate is ANDed on top of the access-tag filter, never an `else` branch of it (design §9). A pure patient token has no access tags, so it gets the strict "own tagged only" mode; without it every untagged `Binary` of every tenant would be readable (design §4.4.1) |
| `src/tests/integration/patientScope/binary_with_patient_scope/binary_with_patient_scope.test.js` | replace the matching `test.todo` entries with real tests (list below) |
| OQ-2 verification | read `fhirResponseWriter.getReassembledTextForBinaryAsync` (`src/middleware/fhir/fhirResponseWriter.js`) and any Redis/request-cache short-circuit in `$everything`/`$graph`. If either can return a `Binary` without passing through `constructQueryAsync`, apply the same predicate there. T25/T26 either prove they are covered or drive the fix |
| `docs/resource-authorization.md` | document the read rule, the two modes and the `patient/Binary.read` gate |

Because every read operation funnels through `constructQueryAsync` (design §4.4 table), this covers
search, search-by-id, `$everything` non-clinical expansion, `$graph` and GraphQL (DocumentReference to
Binary). Until PR 3 lands, the integration tests seed tagged `Binary` directly with a system token
(T19), which is also a supported production path (§6).

Tests in this PR: T9, T10, T11, T13, T14, T15, T16, T17, T19, T20, T21, T25, T26, T32, T33, T34,
T37, T38, T39, T40, T41 (use `toHaveMongoQuery` before `toHaveResponse`, per `CLAUDE.md`).

Exit criteria: with the flag **off**, the pre-existing `graphql.documentReference.test.js` and
patient-scope suites pass unchanged (regression gate for T17/T32).

### PR 3: create carve-out and stamping

| File | Change |
|---|---|
| `src/operations/security/scopesValidator.js` | in `isScopesValidAsync`, the `else` branch of `accessViaPatientScopes` (~lines 144-171) returns `Write not allowed using user scopes if patient scope is present`; when `isPatientScopedPersonTagCreate`, evaluate the **patient** scopes (`getPatientScopes`) with `evaluateResourceTypeScopeMatch` for `Binary` / `create` instead, with no `access/` code required (patient tokens carry none). A `user/`/`system/`/`access/` scope alone is not sufficient in this branch |
| `src/operations/security/patientScopeManager.js` | `canWriteResourceAsync` (~line 298): for `isPatientScopedPersonTagCreate`, return true iff `personIdFromJwtToken` is a non-empty string and the resource's single `clientPersonId` tag equals it. This skips `getPatientIdsFromScopeAsync` for this path. Leave `canWriteResourceWithAllowedPatientIdsAsync` (line 234, throws `cannot be written via a patient scope`) untouched: it is not reached on this path |
| `src/operations/security/scopesManager.js` | `isAccessTagChangeAllowedByScopes` (~line 189) and `isAccessToResourceAllowedBySecurityTags` (~line 254): same patient-scope short-circuit, **only when `isCreate`** |
| `src/operations/create/create.js` | new step between `removeUnderscoreFieldsRecursive` (~line 167) and `validateResourceMetaSync`, run only when `isPatientScopedPersonTagCreate`: apply the stamping table from design §4.3 (append tag; accept one matching tag; 403 with a reason on mismatch, not echoing the other person id; 400 on more than one; 403 on missing person id). Pure in-memory array work on the request body, no I/O. The stamping function lives in its own small module so it is unit-testable (`src/operations/create/personTagStamper.js`). `access`/`owner` tags are **not** constrained (parity with other patient-scoped creates; follow-up F-1) |
| `src/tests/...` | integration tests below; unit tests for the stamper (the §4.3 table) |

Tests in this PR: T1, T2, T3, T3b, T4 (unit-level op-layer 403; 401 at auth is covered by existing
auth tests), T5, T6, T7, T8, T12, T18, T22, T23, T24, T30, T31, T36, T42.

PUT/PATCH/DELETE/`$merge` need no code change: T5-T8 are regression tests proving they keep
returning today's 403.

Exit criteria: all of the above green with the flag on; T31 (flag off) green with the flag off.

### PR 4: observability, docs, measurement

| Area | Change |
|---|---|
| Logging and metrics | `binary_person_tag_stamped`, `binary_person_tag_mismatch_rejected` (warn), `documentreference_references_binary` via `logInfo`/`logWarn`, with the person id logged as-is (same as existing code); OpenTelemetry counters per ADR 0002 (`fhir.binary.patient_create.total{outcome=created|forbidden|mismatch}`, `fhir.binary.person_filter.applied.total{mode=mixed|strict}`), registered through `createContainer.js` |
| Docs | `docs/resource-authorization.md` create-side notes; document the backend-writer contract (system writers set the `clientPersonId` tag themselves) |
| Measurement | `explain('executionStats')` for the three query shapes, in mixed and strict modes, on a seeded `Binary_4_0_0` (design §13); record the result in the PR. Nothing about performance is claimed until it runs |
| Follow-ups filed | F-1, F-2, F-3 as separate tickets (they apply beyond `Binary`) |

Tests in this PR: metric/log assertions where the repo's test container allows overriding the meter.
There are no size or content-type limit tests (limits were descoped, design §4.6).

## Test strategy

- All cases in design §14 (T1-T26, T30-T34, T36-T42; T27-T29 and T35 were removed with the descoped limits and tag hardening) map to a PR above; the existing `test.todo` skeleton in
  `src/tests/integration/patientScope/binary_with_patient_scope/binary_with_patient_scope.test.js`
  is filled in as each PR lands, so the file always shows what is implemented and what is pending.
- Style follows `create_with_patient_scope.test.js`: merge a Person first and use its uuid as
  `clientFhirPersonId`; header helpers from `getHeadersWithCustomPayload`.
- Every PR runs `make tests` (lint + jest) before push. Single files with
  `node node_modules/.bin/jest <path>`.
- Mandatory regression gate on every PR: run with the flag off and confirm the existing
  `patientScope`, `graphqlv2/documentReference` and `everything` suites are unchanged.
- Adversarial review against `review.md` (CLAUDE.md requires it for read/write/scope changes): in
  particular the "filter ANDed, never `else`", "empty id fails closed", and "same person id shared
  across tenants" checks (design §9 T7, T8), and the pure-patient-token strict mode (T39), which is the
  one place a missing tenant filter could otherwise expose untagged `Binary`.

## Rollout (after all four PRs)

1. Deploy flag-off everywhere (code dormant).
2. Enable in a lower environment; run the integration matrix and a manual
   DocumentReference to Binary GraphQL walkthrough.
3. Run the `explain` measurements from PR 4 against that environment's data (they are a gate for enabling in production).
4. Enable per environment. Rollback is flag-off; already-tagged `Binary` fall back to today's
   baseline (readable by any in-tenant caller), not below it (design §7).
5. Backend clients that want per-member isolation start stamping tags on their writes.

## Risks and how the plan handles them

| Risk | Handling |
|---|---|
| Read predicate accidentally hides existing untagged `Binary` | filter is `untagged OR tag == person`; T17/T32 and the flag-off regression gate in every PR |
| A read path bypasses `constructQueryAsync` | OQ-2 verification in PR 4; T25/T26 |
| Mixed-scope token bypasses the person check | branch keyed on `hasPatientScope`, the same predicate as `isUser`; T22 |
| Widening patient-scope helpers affects other resource types | the new concept is deliberately separate (`personSecurityTagResources`); `patientFilterMapping` and `canAccessResourceWithPatientScope` are not changed |
| Large uploads / unauthenticated body parsing | no new limits (decision: parity); only the global 50 MB `PAYLOAD_LIMIT` applies and the body is parsed before the token is verified today (existing behavior, follow-up F-2); gateway rate limiting and malware scanning are dependencies outside this repo |
| Pure patient token reading untagged `Binary` across tenants | strict read mode plus T39; the review step above calls it out |
| Cross-tenant `access`/`owner` tags on member-created `Binary` | unchanged from every other patient-scoped create today (follow-up F-1) |

## Open items I could not settle from the code alone

- Production data: whether any existing `Binary` already carries a `clientPersonId`-system tag
  (expected none; to be checked with a count query before enabling).
