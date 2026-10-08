# Patient-Scoped Binary Create and Person-Scoped Binary Access — Design

Status: **Proposed — for review and approval. No implementation is included in this change.**

Direction decided in the originating Slack thread (Imran Qureshi, Guillermo Granados), pending review
of this document: "Option 1" below.

## 1. Problem

A member (patient-scoped) token cannot create a `Binary` in fhir-server. The token is rejected with
`403 Forbidden`, so a member-facing client cannot upload a document (photo, PDF, scanned card) that a
`DocumentReference` can then point at. Today the only workaround is a backend that holds a
system/access token, which writes the `Binary` with **no person identifier stamped on it**.

The question that prompted this design: if a system token writes the `Binary` with no person id, does
retrieval using a person (patient-scoped) token later break or leak? Short answer, verified against the
code below: retrieval does not "break" for such a `Binary` because nothing person-scoped is evaluated
for `Binary` at all — it is gated only by the tenant access tag. That is the real gap: **a `Binary` is
never tied to the member who owns it**, in either direction.

### 1.1 Why the write is rejected today (verified against `main` @ `9ba2d5d`)

Three independent gates each reject a patient-scoped `Binary` create:

1. `ScopesValidator.isScopesValidAsync` (`src/operations/security/scopesValidator.js`, the `else`
   branch of the `accessViaPatientScopes` check, ~lines 143-171). `Binary` is not patient-filterable,
   so `accessViaPatientScopes` is false; the token is evaluated against `user/`+`system/` scopes only,
   and because a patient scope is present and the request is a write, it returns
   `Write not allowed using user scopes if patient scope is present`.
2. `PatientScopeManager.canWriteResourceAsync` (`src/operations/security/patientScopeManager.js`,
   ~lines 298-352) returns `false` when `isAccessAllowedByPatientScopes` is false for the resource type
   ("A patient scope must never authorize writes to shared/administrative resource types"), and
   `canWriteResourceWithAllowedPatientIdsAsync` (~lines 234-293) throws
   `Resource type Binary cannot be written via a patient scope`.
3. `ScopesManager.isAccessTagChangeAllowedByScopes` / `isAccessToResourceAllowedBySecurityTags`
   (`src/operations/security/scopesManager.js`, ~lines 189 and 254) only short-circuit for patient
   scopes when `isAccessAllowedByPatientScopes` is true, i.e. never for `Binary`.

`Binary` is absent from `patientFilterMapping` (`src/fhir/patientFilterManager.js`) because a `Binary`
has no patient reference of its own. It is reachable from a Patient only via
`DocumentReference.content.attachment.url` (Patient → DocumentReference → Binary: two hops). The
generated `src/operations/everything/generated.non_clinical_resources_fields.json` lists
`Binary: ['securityContext._uuid']` as its only outbound reference, and `DocumentReference` as a clinical
resource reaching it through the custom `content.attachment.url` handling in
`nonClinicalResourceExtractor.js` (~lines 69-91).

### 1.2 How `Binary` reads are gated today

Every read path funnels through `SearchManager.constructQueryAsync`
(`src/operations/search/searchManager.js`, ~lines 289-500). For `Binary`:

- `accessViaPatientScopes = isAccessAllowedByPatientScopes(...)` is **false**, so no patient/person
  filter is built.
- `securityTagManager.getSecurityTagsFromScope` returns the caller's `access/<code>` codes and
  `getQueryWithSecurityTags` ANDs `meta.security $elemMatch {system: access, code: <client>}` (or the
  `_access.<code>` index form when `useAccessIndex`). `access/*` removes even that.

So a `Binary` is returned to anyone whose token carries the matching tenant access code, regardless of
which member it belongs to. A pure `patient/*` token with no `user/`/`system/` + `access/` scope cannot
read `Binary` at all (scope gate, same code path as the write rejection above, read variant allowed only
when a `user/`/`system/` scope matches and an access code is present). In practice member-facing clients
(see the GraphQL test token `access/*.* patient/*.* user/*.* admin/*.read` in
`src/tests/integration/graphqlv2/documentReference/graphql.documentReference.test.js`) carry a mixed
scope, which is why mixed-scope handling is a first-class concern here (§5.4).

## 2. Goals and non-goals

Goals

- G1. A patient-scoped token may **create** a `Binary`, and the created `Binary` is cryptographically
  tied to the token's person id so only that person (and tenant-wide/system readers) can read it.
- G2. Every read path applies the person check to tagged `Binary` resources; none can be used to bypass
  it (search, search-by-id, `_history`/vread, `$everything`, `$graph`, GraphQL, export).
- G3. Zero behavior change for existing (untagged) `Binary` resources and for system/user/admin
  tokens that carry no patient scope.
- G4. Ship behind a feature flag, default off.

Non-goals (explicit)

- N1. Update / patch / delete / `$merge` of `Binary` by patient-scoped tokens: stay forbidden.
- N2. Closing the by-id read gap for **untagged** `Binary` (all existing clinical `Binary` and
  system-written ones with no tag): documented as a separate follow-up (§12.1).
- N3. Backfilling tags onto existing `Binary` resources.
- N4. Changing authorization for other non-clinical resource types (surveyed in §10).

## 3. Decision: Option 1 — person-id security tag, create-only

1. Allow `Binary` **create only** (REST `POST /4_0_0/Binary`) for a token that has a patient scope
   granting create on `Binary` (`patient/Binary.write`, `patient/Binary.c`, `patient/*.write`, ...).
2. On such a create the server **stamps** a security tag onto `meta.security` from the person id in the
   token (§4). The client does not control it.
3. On read, when the caller is patient-scoped and a `Binary` carries the person tag, the tag must equal
   the caller's person id. A `Binary` with no person tag is treated exactly as today.
4. Everything else stays as it is (N1, N3, G3).

Why this and not the alternatives is in §11.

## 4. Detailed design

### 4.1 Where the person id comes from (cited)

- `AuthService.processUserInfo` (`src/strategies/authService.js`, ~lines 287-396) is the single place
  the JWT claim is read: `context.personIdFromJwtToken = jwt_payload[this.requiredJWTFields.clientFhirPersonId]`
  (claim name `clientFhirPersonId`, `requiredJWTFields` at ~line 79). `masterPersonIdFromJwtToken` is
  `bwellFhirPersonId`.
- `isUser` is derived in `getFieldsFromToken` (~line 498) as `scopes.some(s => s.toLowerCase().startsWith('patient/'))`
  — i.e. **any** patient scope makes the token a "user" token. For `isUser` tokens, **all four** claims
  (`clientFhirPersonId`, `clientFhirPatientId`, `bwellFhirPersonId`, `bwellFhirPatientId`) are required;
  a token missing any is rejected at authentication with 401 (`missing_required_jwt_field`,
  ~lines 308-321). So "patient scope but no person id" cannot reach the operation layer today; the
  design still re-checks defensively (§4.3, test T4) because the invariant lives in a different layer.
- It flows to operations as `requestInfo.personIdFromJwtToken` (`FhirRequestInfoBuilder.personId`,
  `src/utils/fhirRequestInfoBuilder.js` ~line 42, 129; `FhirRequestInfo`, `src/utils/fhirRequestInfo.js`
  ~line 128).
- Its value is the member's **Person `_uuid`**: the patient-scope code compares it to `Person._uuid`
  (`personFilterMapping: { Person: 'id' }`, `getValueOfPropertyFromResource` returns `[resource._uuid]`
  for `id`), and the existing patient-scope integration tests build headers from the merged Person's uuid.

We stamp **`clientFhirPersonId` (`personIdFromJwtToken`)**, not the b.well master id: it is the id that the
rest of the patient-scope machinery (and the Subscription family's `client_person_id`) already uses and it
is per-client, which keeps tags tenant-local.

### 4.2 Tag format

Follow the existing `meta.security` conventions (`SecurityTagSystem`, `src/utils/securityTagSystem.js`:
`access`, `owner`, `vendor`, `sourceAssigningAuthority`, `connectionType`, all
`https://www.icanbwell.com/<camelCaseName>`). Proposed addition:

```js
SecurityTagSystem.clientPersonId = 'https://www.icanbwell.com/clientPersonId';
```

Tag: `{ system: 'https://www.icanbwell.com/clientPersonId', code: '<Person _uuid>' }`.

Notes: (a) this deliberately differs from the Subscription family's *extension* system
`https://icanbwell.com/codes/client_person_id`, because that is an `extension`/`identifier` namespace, not
a `meta.security` namespace; (b) a single tag only — resources with more than one `clientPersonId` tag
are rejected on write; (c) the existing multi-index `meta_security_code.uuid`
(`{meta.security.code: 1, _uuid: 1}`, `src/indexes/customIndexes.js` ~line 806, defined without an
include/exclude list so applied to all collections) already supports an equality probe by code.

### 4.3 Write path (create only)

Introduce one narrow concept instead of widening `canAccessResourceWithPatientScope` (used by many
callers: delegated access, query rewriting, `$everything`; widening it would silently make `Binary`
"patient-filterable" everywhere):

- `PatientFilterManager.personSecurityTagResources = ['Binary']` and
  `isPersonSecurityTagResource({resourceType})`.
- `ScopesManager.isPatientScopedPersonTagCreate({scope, resourceType, action})`: true when feature flag on,
  `resourceType` is in that set, `action === 'create'`, and `hasPatientScope({scope})` (the same
  case-insensitive predicate `isUser` uses — they must agree; see the comment on `hasPatientScope`).

Required changes at the three gates in §1.1:

1. `ScopesValidator.isScopesValidAsync`: when `isPatientScopedPersonTagCreate`, evaluate the **patient**
   scopes (`getPatientScopes`) via `evaluateResourceTypeScopeMatch` for `resourceType: 'Binary'`,
   `accessRequested` = `c`/`write` (existing CRUDS mapping, `create → 'c'`). A `user/`/`system/`/`access/`
   scope alone is not sufficient in this branch, and no `access/` code is required (patient tokens carry
   none, as for every other patient-scoped write).
2. `PatientScopeManager.canWriteResourceAsync`: for `isPatientScopedPersonTagCreate` return true **iff**
   `personIdFromJwtToken` is a non-empty string and the resource's single `clientPersonId` tag equals it
   (after stamping this is always so). No Person/Patient link expansion is needed; this removes the
   `getPatientIdsFromScopeAsync` cost for this path.
3. `ScopesManager.isAccessTagChangeAllowedByScopes` / `isAccessToResourceAllowedBySecurityTags`: same
   patient-scope short-circuit, but only when `isCreate`.

Stamping (a new step in `Create.createAsync` (`src/operations/create/create.js`, between
`removeUnderscoreFieldsRecursive` and `validateResourceMetaSync`, ~lines 160-180), executed only when
`isPatientScopedPersonTagCreate`):

| Incoming `meta.security` | Result |
|---|---|
| no `clientPersonId` tag | server appends `{system: clientPersonId, code: personIdFromJwtToken}` |
| one tag equal to token person id | accepted unchanged (idempotent) |
| one tag with a different code | `403 Forbidden` — no silent overwrite (a mismatch signals a bug or an attack and should be visible in logs) |
| more than one `clientPersonId` tag | `400` |
| token has patient scope, `personIdFromJwtToken` empty/missing | `403` (defence in depth, §4.1) |

Decision on "overwrite vs reject": reject on mismatch (as the coordinator decision allows). Overwriting
silently would mask client bugs and make audit trails misleading.

Stamping is **synchronous and in-process**: a pure array manipulation on the request body that is already
in memory, using a claim already resolved at authentication. No I/O, no await on the hot path, so there is
no reason to defer it; deferring (e.g. post-response) would be incorrect because the tag must be durable
with the first write. The audit entry is the part that is correctly asynchronous (§8).

Owner/access tags on the new `Binary` (cross-tenant write risk, see §9 T3): `validateResourceMetaSync`
requires exactly one `owner` tag and the client supplies owner/access tags today for every
patient-scoped create (e.g. `Condition`; tests post fixtures with tags). For `Binary` this lets a member
choose an `access` tag naming another tenant, injecting content into that tenant's view. **Recommendation
(requires approval, OQ-1):** for patient-scoped `Binary` create, require each supplied `access` and the
`owner` tag to be one of the tags on the caller's own `Person` resource. The Person is already loaded for
the self-lookup in `personToPatientIdsExpander.js`, so this should add no extra query when the lookup is
shared; otherwise it is one indexed `_uuid` read (estimate: a single-document read by `_uuid` index; not
measured).

Mixed-scope tokens are patient-scoped (§5.4). `$merge`, `PUT`, `PATCH`, `DELETE` of `Binary` are untouched
and keep returning the existing `Write not allowed using user scopes if patient scope is present`.

### 4.4 Read path

Single choke point: add one predicate in `SearchManager.constructQueryAsync`
(`src/operations/search/searchManager.js`, after the access-tag/patient-filter block and before
`queryRewriterManager.rewriteQueryAsync`, ~line 458). Condition: flag on **and** `resourceType` is in
`personSecurityTagResources` **and** `hasPatientScope({scope})` (equivalently `isUser`).

```js
// pseudo-code
if (personId) {
  query = AND(query, { $or: [
     { [f('meta.security')]: { $not: { $elemMatch: { system: clientPersonId } } } },   // untagged: unchanged
     { [f('meta.security')]: { $elemMatch: { system: clientPersonId, code: personId } } }
  ]});
} else {
  query = { _uuid: '__invalid__' }; // fail closed: never "no filter" (review.md §3.D)
}
```

`f()` is `FieldMapper({useHistoryTable}).getFieldName`, so the same predicate is correct against
`resource.meta.security` in `*_History` collections.

Because every read operation calls `constructQueryAsync` (verified list, `grep constructQueryAsync(`):

| Read path | Call site | Covered by the single predicate? |
|---|---|---|
| search (bundle) | `search/searchBundle.js:195` | yes |
| search (streaming) | `search/searchStreaming.js:186` | yes |
| search by id (incl. `GET /Binary/{id}`) | `searchById/searchById.js:193` | yes |
| vread `_history/{vid}` | `searchByVersionId/searchByVersionId.js:207` | yes (and patient tokens are rejected earlier, line ~147) |
| `_history` | `history/history.js:251` | yes (history also requires `access/*`; patient tokens rejected, kept as is) |
| `$everything` non-clinical expansion | `everything/everythingHelper.js:312, 1302, 1577` via `fetchResourceByArgsAsync`; depth `EVERYTHING_OP_NON_CLINICAL_RESOURCE_DEPTH = 3` (`src/constants.js:168`) | yes — each depth level issues a normal id-filtered query |
| `$graph` | `graph/graphHelpers.js:362, 709, 1508` | yes |
| GraphQL v1/v2 `DocumentReference → Binary` | `graphqlv2/resolvers/custom/documentReference.js` → `dataSource.findLinkedNonClinicalResource` → DataLoader → `getResourcesInBatch` → `searchBundleAsync` | yes (resolver returns `null` when filtered) |
| bulk export | `export/script/bulkDataExportRunner.js:404` | yes (patient tokens do not run export; predicate is inert for system tokens) |
| `update/patch/remove/validate` target lookup | `update.js:261`, `patch.js:311`, `remove.js:158`, `validate.js:136` | applies if reached, but all are rejected earlier for patient tokens |

Two reads do **not** go through `constructQueryAsync` and must be verified at implementation time
(OQ-2, marked unverified): any Redis/request-cache short-circuit of resources by id inside
`$everything`/`$graph`, and `fhirResponseWriter`'s plain-text `Binary` retrieval
(`getReassembledTextForBinaryAsync`, `src/middleware/fhir/fhirResponseWriter.js:230`), which fetches by
reference for the `text/plain` format. Both must be proven to run after, not instead of, the filter; if
not, they get the same predicate. A test for each is in the matrix (T25, T26).

Query rewriters: `src/queryRewriters/rewriters/*` (chained search, proxy patient, reference) do not
reference `meta.security` (verified by grep), so the extra `$or` should pass through
`MongoQuerySimplifier` unchanged. Verify with `toHaveMongoQuery` in tests.

### 4.5 Interaction with `DocumentReference` ownership

Position: **do not validate `DocumentReference.content.attachment.url` ownership at create time.**
Reasons: (a) the member can already create a `DocumentReference` (it is patient-filterable) and nothing
checks its attachment target today; (b) validating needs a lookup of the referenced `Binary` per create
and races with out-of-order uploads (Binary created after the DocumentReference, which is legal); (c) the
read-side filter already makes a foreign tagged `Binary` invisible, whichever `DocumentReference` points
at it, so a member who points their `DocumentReference` at another member's `Binary` id gets `null`
from the GraphQL resolver and nothing in `$everything`. We do log (§8) a structured warning when a
patient-scoped `DocumentReference` create/update references a `Binary` id, for later abuse analysis, but
do not block. Revisit if untagged `Binary` by-id access (§12.1) is closed, since that would remove the
remaining way to read a foreign untagged `Binary`.

### 4.6 Size, content type, cloud storage

Verified facts (from config/code, not measurements):

- JSON body limit `PAYLOAD_LIMIT` default `50mb` (`configManager.js:509`). Base64 inflates 4/3, so the
  ceiling for raw bytes in a base64 `Binary.data` is about 37.5 MB (arithmetic estimate).
- MongoDB BSON document limit is 16 MB; without offload a base64 payload above ~12 MB raw (16 MB / 1.333,
  estimate) cannot be stored inline.
- When `BASE64_FIELD_CLOUD_STORAGE_ENABLED` is on, `Binary.data` over `BASE64_FIELD_DATA_THRESHOLD_KB`
  (default 64 KB, `configManager.js:~960`) is offloaded to the resource bucket by `Base64DataManager`
  (called in `create.js` before insert, ~line 223); history for `Binary` goes to cloud storage because
  `CLOUD_STORAGE_HISTORY_RESOURCES` defaults to `['Binary']` (`configManager.js:865`).
- `validateResourceSizeSync` currently enforces a size cap only for `AuditEvent`.

Because this opens an upload surface to end users, add patient-scoped-only limits (system tokens
unchanged), as a proposal for approval (OQ-3), all configurable:

| Setting (new env var) | Proposed default | Rationale |
|---|---|---|
| `PATIENT_BINARY_MAX_BYTES` (decoded size) | 10 MB | well under the 12 MB inline ceiling and the 50 MB body limit; typical phone photos/PDF scans are single-digit MB (a planning figure, not measured from our traffic) |
| `PATIENT_BINARY_ALLOWED_CONTENT_TYPES` | `application/pdf,image/jpeg,image/png,image/heic,text/plain` | allowlist, not blocklist; reject others with `415`-equivalent OperationOutcome |
| rate limiting | out of scope for this repo | enforce at the gateway; recorded as a dependency |

Oversize returns `PayloadTooLargeError` (413), the existing error type used by `create.js` for
`AuditEvent`. Content-type is checked from `Binary.contentType` (and the base64 magic bytes are **not**
inspected in v1; malware scanning is out of scope and recommended at the gateway/storage tier).

Sync vs async: the size/type check is synchronous and pre-persist (cheap, rejects before any write or S3
call). Cloud-storage offload remains whatever `Base64DataManager` already does for `Binary`; no new async
work is introduced by this design.

## 5. Behavior by token shape

| Token | Create `Binary` | Read `Binary` (REST/GraphQL/`$everything`/`$graph`) |
|---|---|---|
| `patient/Binary.write` (+ person claims) | allowed; tag stamped | scope gate unchanged (needs user/system + access today); tag filter applied |
| `patient/*.read` only | 403 (no create grant) | unchanged (403 at scope gate) |
| `system/*.*` or `user/*.*` + `access/<c>` (no patient scope) | unchanged; **no auto-stamp** | unchanged (no tag filter; sees tagged and untagged within tenant) |
| `access/*` + `admin/*`, no patient scope | unchanged | unchanged |
| any token with **any** patient scope plus `user/`/`system/`/`access/` (mixed) | treated as patient-scoped: requires patient create grant, always stamped, tag filter applied; user/system/access privileges do **not** bypass | tag filter applied (so a mixed token reads own tagged + untagged only) |
| patient scope, no person claim | 401 at auth today; defence-in-depth 403 | filter fails closed |
| flag off | exactly today's 403 | exactly today's behavior |

### 5.4 Mixed-scope tokens

`isUser`, `hasPatientScope` and `isAccessAllowedByPatientScopes` all key on a case-insensitive
`patient/` prefix; the existing `scopesValidator.js` comment (~lines 131-139) already insists
`patient/*.* system/*.*` must not be a write path that `patient/*.* user/*.*` is not. The new code uses
`hasPatientScope` for the branch decision so it cannot diverge from `isUser`. A backend that needs to
write member-owned `Binary` with a system identity must use a token **without** patient scopes and set the
tag itself (§6).

## 6. Backend (system) writers

System/admin/user tokens without a patient scope are not auto-stamped (the server cannot know whose
`Binary` it is). Backends that create member-owned `Binary` should set the
`clientPersonId` tag themselves. Untagged `Binary` written by system tokens keep today's semantics (§12.1).
We do not forbid or validate a supplied tag on system writes, other than the "single tag" rule, so a
backend can write a tag for any person — this is intentional (backends are trusted by tenant access code).

## 7. Backward compatibility and rollout

- Feature flag `ENABLE_PATIENT_SCOPED_BINARY_CREATE` (default false) in `ConfigManager`
  (e.g. `get enablePatientScopedBinaryCreate() { return isTrue(env.ENABLE_PATIENT_SCOPED_BINARY_CREATE); }`),
  matching how `ENABLE_DELEGATED_ACCESS_DETECTION` / `enableDelegatedAccessDetection` are done. The flag
  gates both the create carve-out and the read predicate.
- The read predicate is a strict no-op for untagged data, so enabling the flag changes nothing for the
  existing corpus; only new patient-scoped writes carry the tag.
- Rollout: (1) deploy flag-off (code dormant), (2) enable in a lower environment and run the integration
  matrix plus a manual DocumentReference→Binary GraphQL walkthrough, (3) enable per environment, (4)
  backend clients that want per-member isolation start stamping tags for their writes. Rollback = flag
  off; tagged `Binary` already written remain readable by tenant tokens (no patient filter) and become
  unreadable to member tokens only in the sense that the flag-off server no longer applies the filter
  (i.e. they would be readable by any in-tenant caller, as all `Binary` are today). Call this out to
  reviewers: **rollback weakens isolation for already-tagged Binary back to today's baseline, not below
  it.**
- No schema/index migration is required.

## 8. Audit logging and observability

- Audit: `Create.createAsync` already queues `auditLogger.logAuditEntryAsync` through
  `postRequestProcessor` (asynchronously, after the response; correct because the audit entry is not on
  the durability path of the write). It records resource type, operation and uuid; the design adds the
  stamped person id (hashed or truncated per PHI policy, OQ-4) to the audit/log context.
- Logs (`logInfo`/`logWarn`, `src/operations/common/logging.js`): `binary_person_tag_stamped`,
  `binary_person_tag_mismatch_rejected` (warn, include caller `user`, supplied code, token code),
  `binary_create_rejected_size|content_type`, and `documentreference_references_binary` (§4.5).
- Metrics: follow ADR 0002 (custom OpenTelemetry meters via DI). Proposed counters:
  `fhir.binary.patient_create.total{outcome=created|forbidden|mismatch|too_large|bad_type}`,
  `fhir.binary.person_filter.applied.total`, and a histogram of decoded size for patient-scoped creates.
  Alert on a non-zero `mismatch` rate (tag-forgery signal).

## 9. Security and threat considerations

Walked against `review.md` §3 A, B, C, D, E.

| # | Threat | Mitigation | Residual |
|---|---|---|---|
| T1 | Tag forgery: member supplies another person's tag | server rejects any supplied tag that is not the token's person id; never trusts body | none for create |
| T2 | Cross-member read of tagged `Binary` by id/search/history/`$everything`/`$graph`/GraphQL | single predicate in `constructQueryAsync` (§4.4) fail-closed on empty person id | by-id read of **untagged** `Binary` still allowed (§12.1); OQ-2 paths to verify |
| T3 | Cross-tenant injection via member-chosen `access`/`owner` tags | recommended: tags must be a subset of the caller's Person tags (OQ-1) | if rejected, parity with other patient-scoped creates |
| T4 | Enumeration of ids | filtered resource is indistinguishable from a missing one (empty result / 404, same as a failed access-tag filter) | timing difference negligible; not measured |
| T5 | Mixed-scope bypass (`patient/* system/*`) | branch keyed on `hasPatientScope`; user/system privileges do not bypass | none |
| T6 | Tag removal by a later update | updates by patient tokens forbidden; system tokens may edit tags by design | trusted backends |
| T7 | Empty/undefined person id making the filter match everything | filter builds `_uuid: '__invalid__'` instead (review.md §3.D) | none |
| T8 | Two tenants sharing the same real person (review.md §3.E) | tag holds the **client** person id and the existing access-tag filter is still ANDed (not replaced); mixed tokens keep both | none |
| T9 | Abuse of upload surface (size, type, volume) | §4.6 limits; gateway rate limit | malware scanning out of scope |
| T10 | Retrieval via DocumentReference of another member pointing at a foreign Binary | read filter (§4.5) | untagged case |

Important: the person predicate is **ANDed on top of** the access-tag filter, never an `else` branch of
it (the exact bug shape `docs/resource-authorization.md` / `review.md` §2 warn about).

## 10. Survey: other resource types 2+ hops from Patient/Person

Method: `patientFilterMapping`/`personFilterMapping`/`personFilterWithQueryMapping` in
`src/fhir/patientFilterManager.js` compared against
`generated.resource_types.json` (75 clinical, 65 non-clinical) and
`generated.non_clinical_resources_fields.json`. Result (computed with a script):

- 71 of the 75 "clinical" types are in `patientFilterMapping`; the other four are `Person` (own
  mapping), `Subscription`, `SubscriptionStatus`, `SubscriptionTopic` (person-extension mapping, the
  precedent for Option B), which have their own person-scoped handling. (`AuditEvent` is in
  `patientFilterMapping` but appears in neither generated list.) So the types with no patient/person
  handling at all are the **65 non-clinical types**; for all of them patient-scope read behaviour
  is the same as `Binary` today (access-tag filter only, and a patient-only token cannot read them) and
  write behaviour is "forbidden" (same three gates as §1.1).

"Read today" below means: with the mixed token needed to read at all, gated by tenant access tag only,
no person/patient check. "Write today" means: `403` for any token holding a patient scope.

| Type | How reached (hop count, via field) | Read today | Write today | Needs handling here? |
|---|---|---|---|---|
| **Binary** | Patient → DocumentReference → `content.attachment.url` (2) | access tag only | 403 | **In scope** (this doc) |
| Medication | MedicationRequest/Dispense/Statement/Administration `.medication*` (2) (FHIR R4 structure; fields file lists `manufacturer`, `ingredient.itemReference`) | access tag only | 403 | Not needed: shared formulary reference data, not member-authored |
| Location | Encounter/Appointment/Immunization `.location` etc. (2); `Location.managingOrganization/partOf/endpoint` | access tag only | 403 | Not needed (shared reference data) |
| Organization | many (`Patient.managingOrganization`, `Coverage.payor`, ...) (2) | access tag only | 403 | Not needed; follow-up only if members can self-report providers (unverified) |
| Practitioner | Encounter/Condition `.recorder|asserter|participant` (2) | access tag only | 403 | Not needed (shared) |
| PractitionerRole | `Encounter/...participant`, `PractitionerRole.practitioner/organization/location` (2-3) | access tag only | 403 | Not needed (shared) |
| HealthcareService | `PractitionerRole.healthcareService`, `Encounter.serviceProvider`/`Appointment.serviceType` (2-3) | access tag only | 403 | Not needed (shared) |
| Endpoint | `Organization/Location/PractitionerRole/HealthcareService.endpoint` (3) | access tag only | 403 | Not needed (infrastructure data); confirm no secrets in `address` (unverified) |
| Substance, Slot, InsurancePlan, Questionnaire, ValueSet/CodeSystem/other definitional types | reference/definitional | access tag only | 403 | Not needed |
| DeviceMetric, PaymentReconciliation, EnrollmentResponse, MessageHeader, OperationOutcome, Parameters, Bundle | non-clinical by generator list; **may carry person-specific data** depending on producers (unverified which are populated in prod) | access tag only | 403 | **Follow-up: triage** whether any is member-specific; same tag mechanism would apply |
| Specimen, Media | **clinical** (mapped via `subject.reference`) — 1 hop, not 2 | patient-filtered | allowed if `subject` is the member | Not needed |
| Provenance | clinical, mapped via `target.reference`, but a `Provenance` whose `target` is e.g. a `Condition` (2 hops) has no Patient in `target`: invisible to patient filter and cannot be written by a patient token (`getValueOfPropertyFromResource` only accepts `Patient` references) | under-inclusive (unverified for `$everything`) | 403 for non-Patient targets | **Follow-up**: verify behaviour; separate issue |
| Person / Subscription* | person-scoped by design (`personFilterMapping`, `personFilterWithQueryMapping`) | person filtered | person-checked | Already handled |

`non_clinical_resources_reachablity.json` (`level2`, `uscdiV3Level2`) was inspected but its exact semantics
were not independently verified, so no table cell depends on it. Everything marked "(unverified)" above
needs a code or data check before being relied on. **Net recommendation: `Binary` is the only 2-hop type
that is member-authored content and therefore in scope; others are shared reference data (not needed) or
follow-ups to triage.**

## 11. Alternatives considered

- **A. (chosen) Person-id security tag on `Binary`, stamped on create, filtered on read.** Smallest
  surface, backward compatible, no backfill, matches existing `meta.security` conventions.
- **B. Subscription-style `personFilterWithQueryMapping`** (add `Binary` with a filter on
  extension/identifier). Rejected: `personFilterWithQueryMapping` is consulted by
  `canAccessResourceWithPatientScope`/`isPatientRelatedResource`, which would make `Binary` fully
  "patient-filterable" for every caller and turn the person filter into the *only* gate for all `Binary`
  reads, including every existing untagged one — an immediate regression for GraphQL
  `DocumentReference → Binary` for existing data unless a full backfill precedes enablement. It also uses
  an extension, which `Binary` does not support in a queryable form without adding a field to a
  pass-through payload resource.
- **C. Reverse lookup through `DocumentReference`** (`Binary` readable iff some patient-visible
  `DocumentReference` references it). Rejected: an extra query per `Binary` read (N+1 on `$everything`),
  breaks for uploads that precede their `DocumentReference`, and cannot gate the create itself.
- **D. `Binary.securityContext` = Patient reference + `patientFilterMapping: Binary: 'securityContext.reference'`**
  (the FHIR-native approach). Attractive and reuses the existing patient machinery for read and write, but
  existing `Binary` have no `securityContext`, so enabling it hides them from patient scopes until a
  backfill; it also needs the client to know the Patient id at upload time. Recorded as the preferred
  **long-term** direction if the by-id gap (§12.1) is closed by backfill.
- **E. Backend service-client workaround** (member calls a backend that writes with a system token).
  Rejected as the end state: it is today's behavior and is precisely what leaves `Binary` untied to a
  person; but it remains available and compatible (§6).

## 12. Open questions and follow-ups

12.1 (follow-up, out of scope) By-id read of **untagged** `Binary` by a patient-scoped caller remains
possible within the tenant. Close by backfilling tags or moving to alternative D, then flipping the filter
to "tag required for patient-scoped callers".

Open questions for reviewers:

- OQ-1. Approve restricting `access`/`owner` tags on patient-scoped `Binary` create to the caller's Person
  tags (§4.3)?
- OQ-2. Confirm during implementation that cache/text-format paths (§4.4) run after the filter.
- OQ-3. Approve default size/content-type limits (§4.6) or supply product numbers.
- OQ-4. PHI policy for logging the person id (full, hashed, truncated).
- OQ-5. Should members also be able to **read** their tagged `Binary` with only `patient/Binary.read`
  (today the scope gate still requires a user/system scope + access code)? This design leaves it
  unchanged; enabling it is a small follow-on once the tag filter exists (tagged-only, never untagged).
- OQ-6. Confirm the tag system URI name `https://www.icanbwell.com/clientPersonId`.

## 13. Quantitative notes (estimates vs measured)

Nothing below was measured; no benchmark was run for this document.

- Extra read cost: one additional `$or` clause evaluated per **already-selected** document (id lookup
  by `_uuid`, or access-tag match, selects first). Estimate: O(documents returned), a few BSON field
  reads each; negligible next to `Binary` payload transfer. The `$not/$elemMatch` branch cannot use an
  index but is never the driving predicate for by-id/`$everything`/GraphQL reads. A free-text
  `GET /Binary` search with no id would scan under the access-tag filter today as well; the new clause
  does not change the access path.
- Index: no new index required. The existing `{meta.security.code: 1, _uuid: 1}` index
  (`meta_security_code.uuid`) supports an equality probe on the person code if a "list my Binaries" query
  is ever needed. **Plan to measure:** run `explain('executionStats')` for the three query shapes
  (by id, by `DocumentReference` batch of `graphQLFetchResourceBatchSize` ids, unconstrained search) on a
  seeded `Binary_4_0_0` with tagged and untagged documents before enabling in production.
- Write cost: stamping is an in-memory array push (sub-millisecond, estimate); size/type check is a
  length comparison on the decoded size; no added I/O. If OQ-1 is approved: +0 or +1 indexed read.
- Payload sizes: see §4.6 (arithmetic from configuration defaults).

## 14. Test plan

Tests are specified here as a matrix, and a skeleton using `test.todo` is added at
`src/tests/integration/patientScope/binary_with_patient_scope/binary_with_patient_scope.test.js` so the
cases are visible and tracked without asserting not-yet-existing behavior. They are implemented after
this design is approved. Style follows
`src/tests/integration/patientScope/create_with_patient_scope/create_with_patient_scope.test.js`
(`getHeadersWithCustomPayload`, merge a Person first and use its `uuid` as `clientFhirPersonId`).

Notation: **P** = `patient/Binary.write` with person claims for person A; **P-B** = same for person B;
**Pr** = patient read-capable mixed token `access/*.* patient/*.* user/*.* admin/*.read` (as in the GraphQL
test); **S** = `system/*.*` + `access/<client>` no patient scope; **S-other** = different tenant access
code; **M** = `patient/*.* system/*.*` (mixed); **flag** = `ENABLE_PATIENT_SCOPED_BINARY_CREATE`.

| ID | Use case | Token | Expected |
|---|---|---|---|
| T1 | Member creates Binary, no tag supplied | P, flag on | 201; `meta.security` contains `clientPersonId|A` |
| T2 | Member supplies matching tag | P | 201; exactly one tag |
| T3 | Member supplies other person's tag | P | 403; nothing persisted |
| T3b | Two `clientPersonId` tags | P | 400 |
| T4 | Patient scope but no/empty person id | P w/o `clientFhirPersonId` | 401 at auth (and unit test: op-layer 403) |
| T5 | PUT/update Binary | P | 403 |
| T6 | PATCH Binary | P | 403 |
| T7 | DELETE Binary | P | 403 |
| T8 | `$merge` Binary | P | 403 |
| T9 | Member A reads own tagged Binary by id | Pr(A) | 200 |
| T10 | Member B reads A's tagged Binary by id | Pr(B) | 404 / not found (same as missing) |
| T11 | Member B searches `Binary?_id=` and `Binary` search | Pr(B) | empty bundle; A's does not leak |
| T12 | `_history` and `_history/{vid}` | P/Pr | 403 (unchanged: history rejects patient scope) |
| T13 | `Patient/$everything` / `Person/$everything` as B with A's DocumentReference pointing to A's Binary (and B's own DR pointing at A's Binary) | Pr(B) | A's Binary absent from bundle; B's own present |
| T14 | `$graph` DocumentReference → Binary | Pr(A)/Pr(B) | A sees it; B does not |
| T15 | GraphQL `DocumentReference → attachment.resource` for owner | Pr(A) | Binary returned |
| T16 | GraphQL same, other member | Pr(B) | `resource: null` |
| T17 | Untagged Binary (existing fixtures) | Pr | readable exactly as today (regression against `graphql.documentReference.test.js` expectations) |
| T18 | System token writes Binary without tag | S | 201; no tag added |
| T19 | System token writes Binary with tag A | S | 201; tag preserved; readable by Pr(A), not Pr(B) |
| T20 | System token reads tagged Binary | S | 200 (no person filter without patient scope) |
| T21 | Cross-tenant: S-other reads/creates | S-other | access-tag filter still denies |
| T22 | Mixed-scope create | M | treated as patient-scoped: requires patient create grant, stamped; `system/*` alone does not bypass; `patient/Condition.write system/*.*` → 403 |
| T23 | Patient token lacking create grant (`patient/Binary.read`) | P-read | 403 |
| T24 | Patient token with only `access/*` + `user/*` (no patient) | S-like | unchanged |
| T25 | `Binary` read with `format=text/plain` path (`fhirResponseWriter`) as B | Pr(B) | not returned (OQ-2) |
| T26 | Cache short-circuit paths in `$everything`/`$graph` | Pr(B) | not returned (OQ-2) |
| T27 | Size: decoded size > `PATIENT_BINARY_MAX_BYTES` | P | 413; at the limit 201 |
| T28 | Content type outside allowlist | P | 4xx OperationOutcome |
| T29 | System token large Binary above patient cap | S | unchanged (201) |
| T30 | Cloud-storage offload on (`BASE64_FIELD_CLOUD_STORAGE_ENABLED`) with member Binary > threshold | P | 201; tag present on stored doc and in history entry |
| T31 | Flag off | P | 403 with today's message `Write not allowed using user scopes if patient scope is present` |
| T32 | Flag off, tagged Binary exists | Pr(B) | no person filter (today's behavior), documents rollback note in §7 |
| T33 | Person id claim empty on read | Pr | filter fails closed (`_uuid: '__invalid__'`) — unit test of query construction |
| T34 | Query shape | Pr | `toHaveMongoQuery` shows `$or` clause ANDed with access-tag filter, using `resource.meta.security` for history |
| T35 | Owner/access tag hardening (if OQ-1 approved) | P | tag not in caller's Person tags → 403 |
| T36 | Audit entry written; stamping logged | P | audit logger invoked once with resource uuid |

Unit tests (new, `src/tests/unit/...`): `ScopesManager.isPatientScopedPersonTagCreate` truth table
(flag × action × scope shapes, including upper-case `PATIENT/`), stamping function table in §4.3,
`SecurityTagManager` person-filter builder.

## 15. Implementation outline (after approval; not part of this change)

1. `SecurityTagSystem.clientPersonId`; `ConfigManager` flag and limits.
2. `PatientFilterManager.personSecurityTagResources` + helpers.
3. `ScopesManager.isPatientScopedPersonTagCreate` and the three gate changes (§4.3).
4. `PatientScopeManager`/`Create`: stamping, validation, limits.
5. `SecurityTagManager.getQueryWithPersonSecurityTag` and its call in `constructQueryAsync`.
6. Tests per §14, docs: add §5/§12 notes to `docs/resource-authorization.md`.
