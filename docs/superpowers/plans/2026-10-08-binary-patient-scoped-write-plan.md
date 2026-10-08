# Patient-scoped `Binary` create and person-scoped `Binary` read: implementation plan

**Ticket:** [DCON-5986](https://icanbwell.atlassian.net/browse/DCON-5986)
**Design:** [`docs/superpowers/specs/2026-10-08-binary-patient-scoped-write-design.md`](../specs/2026-10-08-binary-patient-scoped-write-design.md)

This is the implementation plan for the design above. It is shared for review before any code is
written; nothing in `src/` changes in this PR. Section references (§) point at the design doc. The
design's open questions (OQ-1 to OQ-6) are decisions this plan depends on and are called out where
they change the work.

## Scope

Build exactly what the design's "Option 1" describes, behind `ENABLE_PATIENT_SCOPED_BINARY_CREATE`
(default off):

- patient-scoped tokens can **create** (only) a `Binary`; the server stamps a
  `https://www.icanbwell.com/clientPersonId` tag from the token's person id;
- every `Binary` read path filters tagged `Binary` to the caller's person id for patient-scoped
  callers, and leaves untagged `Binary` exactly as today;
- system/user/admin tokens without a patient scope are unchanged and not auto-stamped.

Out of scope (unchanged from the design): update/patch/delete/`$merge` of `Binary` by patient tokens,
the by-id read gap for untagged `Binary` (§12.1), backfilling tags, and other 2+ hop resource types.

## Decisions needed before coding starts

| OQ | Decision | If not decided | Affects |
|---|---|---|---|
| OQ-1 | Restrict `access`/`owner` tags on patient-scoped `Binary` create to the caller's own Person tags | PR 2 ships without it (parity with other patient-scoped creates); cross-tenant injection (T3) stays open | PR 2, test T35 |
| OQ-3 | Size and content-type defaults (10 MB, allowlist) | PR 3 is held; PRs 1-2 can ship and stay flag-off | PR 3, tests T27-T29 |
| OQ-4 | PHI policy for logging the person id (full / hashed / truncated) | Default to the existing audit-log convention for person ids; revisit in review | PR 2 logging |
| OQ-6 | Tag system URI `https://www.icanbwell.com/clientPersonId` | Proceed with the proposed name | PR 1 constant |
| OQ-2 | Not a decision: verified during PR 4 (cache and `text/plain` read paths) | n/a | PR 4, tests T25-T26 |
| OQ-5 | `patient/Binary.read` read-only access for members | Stays out of scope (follow-on) | none |

## Delivery: four small PRs, each flag-off and independently revertable

The flag keeps behavior identical until it is turned on, so each PR can merge without changing
production behavior. The order is chosen so that the **read filter ships before the write carve-out**
(the filter is a no-op for untagged data, so it is safe first, and no tagged `Binary` can exist until
the create path lands).

### PR 1: flag, constants, predicates (no behavior change)

| File | Change |
|---|---|
| `src/utils/securityTagSystem.js` | add `clientPersonId: 'https://www.icanbwell.com/clientPersonId'` |
| `src/utils/configManager.js` | `get enablePatientScopedBinaryCreate()` reading `ENABLE_PATIENT_SCOPED_BINARY_CREATE` via `isTrue(...)`, next to `enableDelegatedAccessDetection` (~line 1429) |
| `src/fhir/patientFilterManager.js` | `personSecurityTagResources = ['Binary']` and `isPersonSecurityTagResource({ resourceType })`; **do not** touch `patientFilterMapping` (design §4.3: adding `Binary` there would make it patient-filterable for every caller) |
| `src/operations/security/scopesManager.js` | `isPatientScopedPersonTagCreate({ scope, resourceType, action })`: true iff flag on, `isPersonSecurityTagResource`, `action === 'create'`, and `hasPatientScope({ scope })` (the existing case-insensitive predicate that `isUser` must agree with) |
| `src/operations/common/securityTagManager.js` | pure builder `getQueryWithPersonSecurityTag({ query, personId, useHistoryTable })` that returns the `$or` clause from design §4.4 ANDed onto `query`, and `{ _uuid: '__invalid__' }` when `personId` is empty (fail closed) |
| `src/tests/unit/operations/security/` | unit tests: `isPatientScopedPersonTagCreate` truth table (flag x action x scope shape, including upper-case `PATIENT/` and mixed tokens); the query builder (shape, history-table field names, empty person id) |

Exit criteria: unit tests green; `git diff` shows no call sites using the new functions.

### PR 2: read filter (`SearchManager.constructQueryAsync`)

| File | Change |
|---|---|
| `src/operations/search/searchManager.js` | after the access-tag / patient-filter block (the `else if (securityTags ...)` branch ends ~line 440) and **before** `queryRewriterManager.rewriteQueryAsync` (~line 471): if flag on and `isPersonSecurityTagResource({ resourceType })` and `hasPatientScope({ scope })`, call the builder from PR 1. The predicate is ANDed on top of the access-tag filter, never an `else` branch of it (design §9) |
| `src/tests/integration/patientScope/binary_with_patient_scope/binary_with_patient_scope.test.js` | replace the matching `test.todo` entries with real tests (list below) |

Because every read operation funnels through `constructQueryAsync` (design §4.4 table), this single
change covers search, search-by-id, `$everything` non-clinical expansion, `$graph` and GraphQL
(DocumentReference to Binary). Until PR 3 lands, the integration tests seed tagged `Binary`
directly with a system token (T19), which is also a supported production path (§6).

Tests in this PR: T9, T10, T11, T13, T14, T15, T16, T17, T19, T20, T21, T32, T33, T34 (use
`toHaveMongoQuery` before `toHaveResponse`, per `CLAUDE.md`), plus `docs/resource-authorization.md`
update for the read rule.

Exit criteria: with the flag **off**, the pre-existing `graphql.documentReference.test.js` and
patient-scope suites pass unchanged (regression gate for T17/T32).

### PR 3: create carve-out and stamping

| File | Change |
|---|---|
| `src/operations/security/scopesValidator.js` | in `isScopesValidAsync`, the `else` branch of `accessViaPatientScopes` (~lines 144-171) returns `Write not allowed using user scopes if patient scope is present`; when `isPatientScopedPersonTagCreate`, evaluate the **patient** scopes (`getPatientScopes`) with `evaluateResourceTypeScopeMatch` for `Binary` / `create` instead, with no `access/` code required (patient tokens carry none). A `user/`/`system/`/`access/` scope alone is not sufficient in this branch |
| `src/operations/security/patientScopeManager.js` | `canWriteResourceAsync` (~line 298): for `isPatientScopedPersonTagCreate`, return true iff `personIdFromJwtToken` is a non-empty string and the resource's single `clientPersonId` tag equals it. This skips `getPatientIdsFromScopeAsync` for this path. Leave `canWriteResourceWithAllowedPatientIdsAsync` (line 234, throws `cannot be written via a patient scope`) untouched: it is not reached on this path |
| `src/operations/security/scopesManager.js` | `isAccessTagChangeAllowedByScopes` (~line 189) and `isAccessToResourceAllowedBySecurityTags` (~line 254): same patient-scope short-circuit, **only when `isCreate`** |
| `src/operations/create/create.js` | new step between `removeUnderscoreFieldsRecursive` (~line 167) and `validateResourceMetaSync`, run only when `isPatientScopedPersonTagCreate`: apply the stamping table from design §4.3 (append tag; accept one matching tag; 403 on mismatch; 400 on more than one; 403 on missing person id). Pure in-memory array work on the request body, no I/O. The stamping function lives in its own small module so it is unit-testable (`src/operations/create/personTagStamper.js`) |
| `src/operations/create/create.js` (OQ-1, if approved) | require supplied `access` and `owner` tags to be among the caller's Person tags; reuse the Person already loaded for the self-lookup where possible, otherwise one indexed `_uuid` read |
| `src/tests/...` | integration tests below; unit tests for the stamper (the §4.3 table) |

Tests in this PR: T1, T2, T3, T3b, T4 (unit-level op-layer 403; 401 at auth is covered by existing
auth tests), T5, T6, T7, T8, T12, T18, T22, T23, T24, T30, T31, T35 (if OQ-1), T36.

PUT/PATCH/DELETE/`$merge` need no code change: T5-T8 are regression tests proving they keep
returning today's 403.

Exit criteria: all of the above green with the flag on; T31 (flag off) green with the flag off.

### PR 4: limits, observability, remaining read paths, docs

| Area | Change |
|---|---|
| Limits (OQ-3) | `PATIENT_BINARY_MAX_BYTES` and `PATIENT_BINARY_ALLOWED_CONTENT_TYPES` in `ConfigManager`; synchronous check in `create.js` for patient-scoped `Binary` create only, before any write or cloud-storage call. Oversize throws the existing `PayloadTooLargeError` (413); disallowed type returns a 4xx OperationOutcome. System tokens unchanged (T29) |
| OQ-2 | Read `fhirResponseWriter.getReassembledTextForBinaryAsync` (`src/middleware/fhir/fhirResponseWriter.js`) and any Redis/request-cache short-circuit in `$everything`/`$graph`. If either can return a `Binary` without passing through `constructQueryAsync`, apply the same predicate there. Tests T25, T26 either prove they are covered or drive the fix |
| Logging and metrics | `binary_person_tag_stamped`, `binary_person_tag_mismatch_rejected` (warn), `binary_create_rejected_size|content_type`, `documentreference_references_binary` via `logInfo`/`logWarn`; OpenTelemetry counters per ADR 0002 (`fhir.binary.patient_create.total{outcome}`, `fhir.binary.person_filter.applied.total`, size histogram), registered through `createContainer.js` |
| Docs | `docs/resource-authorization.md` (design §5 and §12.1), document the backend-writer contract (system writers set the `clientPersonId` tag themselves) |
| Measurement | `explain('executionStats')` for the three query shapes on a seeded `Binary_4_0_0` (design §13) and record the result in the PR; this is the "plan to measure" item, nothing about performance is claimed until it runs |

Tests in this PR: T25, T26, T27, T28, T29, plus metric/log assertions where the repo's test container
allows overriding the meter.

## Test strategy

- All 37 cases in design §14 map to a PR above; the existing `test.todo` skeleton in
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
  across tenants" checks (design §9 T7, T8).

## Rollout (after all four PRs)

1. Deploy flag-off everywhere (code dormant).
2. Enable in a lower environment; run the integration matrix and a manual
   DocumentReference to Binary GraphQL walkthrough.
3. Run the `explain` measurements from PR 4 against that environment's data.
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
| Large uploads | PR 4 limits (needs OQ-3); gateway rate limiting and malware scanning are out of scope and recorded as dependencies |

## Open items I could not settle from the code alone

- Whether the Person already loaded for the patient-scope self-lookup is reachable from `create.js`
  without a second read (affects OQ-1 cost; to be confirmed when PR 3 is written).
- Production data: whether any existing `Binary` already carries a `clientPersonId`-system tag
  (expected none; to be checked with a count query before enabling).
