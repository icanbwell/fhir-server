# Patient-Scoped Binary Create and Person-Scoped Binary Access — Design

Status: **Two designs are on the table. #2635 implements the transitional model (reads keep unowned Binary readable). The stacked PR on top of it implements the backfill-first model of §0.2, which supersedes §4.4, §5 (read column), §7 and §16.3 where they differ. Neither is approved yet; the direction call is Imran's and Mintu's. Implementation notes are in §16 and §17.**

Direction from the originating Slack thread in #temp-user-documents (Imran Qureshi, 2026-10-09: new member uploads
only, no backfill, `securityContext` set by the server from the JWT), pending review of this document: "Option 1" below.

## 0. Decisions recorded from review (2026-10-08)

| Topic | Decision | Where it lands |
|---|---|---|
| Tag hardening (was OQ-1) | **Superseded 2026-10-14 (review finding): on a patient-scoped `Binary` create, every `owner`/`access` tag must be one the caller's own Person carries, else 403.** The original decision was parity with other patient-scoped creates (no restriction); that left a cross-tenant injection path for `Binary`. The gap for other resource types stays a separate follow-up (§4.3.1) | §4.3.1, §9 T3 |
| Upload limits (was OQ-3) | **Whatever fhir-server does today: no Binary-specific limits.** The server-wide `PAYLOAD_LIMIT` (default 50 MB) applies. Verified findings on limits and on token-before-body ordering are in §4.6 | §4.6, §14 |
| Logging the person id (was OQ-4) | **Same as existing code: log it as-is** (existing code already logs person ids in plain text) | §8 |
| Ownership id (was OQ-6, tag URI) | Uploads use the **client person id from the token** (`clientFhirPersonId`, i.e. `personIdFromJwtToken`), as `Patient/person.{person_uuid}` in `securityContext` (§0.1) | §4.1, §4.2 |
| Member read scope (was OQ-5) | **Yes: `patient/Binary.read` alone lets a member read their own tagged `Binary`**, like other resource reads | §4.4.1 (new) |
| Mismatched tag on create | **Reject with a reason** (403 with an explanatory OperationOutcome) | §4.3 |
| Rollout order | **Read filter first, then the create carve-out** | §7 |

### 0.1 Revision (2026-10-09): ownership is `securityContext`, not a security tag

After review (Imran Qureshi, Mintu Kumar Sah), the ownership marker changed from a custom
`clientPersonId` security tag to the standard FHIR field `Binary.securityContext`, which is also where a
later move to a fully patient-scoped Binary (like `Task`) lands. Everywhere this document says "person tag",
"`clientPersonId` tag" or "stamp the tag", read the following (sections 4.2, 4.3, 4.4 and 16 are rewritten to
match; the other sections keep the original wording for history):

| Question | Answer |
|---|---|
| Who sets it? | **Only the server**, from the token. A client can never send it on a patient-scoped create (spoofing): any supplied `securityContext` other than the caller's own is rejected with 403 and a reason, and the supplied value is not echoed. |
| What value? | The caller's person as the proxy patient this server already uses: `Patient/person.{person_uuid}`, with `person_uuid` the token's `clientFhirPersonId` (`PERSON_PROXY_PREFIX` = `person.`). |
| What may it point to? | A **Patient** reference: the person proxy (`Patient/person.{person_uuid}`, what member uploads get) or a real patient (`Patient/{id}`, which a backend or migration may set with a system token). Backends and migrations are trusted and may set either. |
| Who can read an owned Binary? | A patient-scoped caller whose patient ids (from `getPatientIdsFromScopeAsync`: the person's proxy plus every linked patient) include the securityContext. So a Binary owned by `Patient/person.X` is readable by person X, and one owned by a real patient is readable by every person linked to that patient. |
| Existing Binary? | No securityContext pointing at a Patient: unowned, exactly as today (mixed tokens read them; a pure patient token never does). This is what keeps `$everything` and DocumentReference traversal working for existing Binaries. |
| Later migration | Backfill `securityContext` on existing Binary, then drop the "unowned" branch and add `Binary: 'securityContext.reference'` to `patientFilterMapping`; no further change to how members' own uploads are stored. |

Matching follows the existing patient filter: ids for which `isUuid()` is true (this includes the proxy id,
because it contains the person's uuid) match `securityContext._uuid`, others match `securityContext._sourceId`.
A literal `Person/{id}` reference is not an owner marker and is treated as "unowned".

### 0.2 Revision (2026-10-15): backfill first, then the standard patient filter (Mintu's proposal)

Mintu Kumar Sah objected to the transitional "unowned vs owned" read model: it adds a second ownership path next to
the standard one, its unowned branch (`$not: {$regex: '^Patient/'}`) cannot use an index, mixed tokens (every real
member token) would still read every unowned Binary in the tenant, and all of it is removed again in DCON-6075.
His proposal, implemented in the stacked PR:

| Topic | Transitional model (#2635 head) | Backfill-first model (this revision) |
|---|---|---|
| Read filter | Dedicated `getQueryWithPersonSecurityContext`: owned by the caller OR (mixed tokens) owned by nobody | **The ordinary patient filter**: `Binary: 'securityContext.reference'` is patient-filterable (`PatientFilterManager`), so `getQueryWithPatientFilter` matches `securityContext._uuid`/`_sourceId` against the caller's patient ids. No unowned branch, no regex, one index |
| Binary without a `securityContext` | Readable by mixed tokens, never by pure patient tokens | **Not readable by any patient-scoped token** (mixed or pure) until backfilled. System and user tokens without a patient scope are unchanged |
| `$everything` / DocumentReference traversal of existing Binary | Keeps working (unowned) | **Hidden from patient-scoped callers until the Binary is backfilled**, so the backfill must complete before the flag is turned on (§17) |
| Mixed-token read | Patient filter AND tenant access-tag filter | Patient filter only, like every other patient-filterable type (the patient scope replaces the access-tag filter) |
| Gating | Read filter always on; create and strict reads behind the flag | **Everything behind `ENABLE_PATIENT_SCOPED_BINARY_CREATE`**, including the read filter. With the flag off, Binary is not patient-filterable and reads are exactly as on `main` |
| Writes | Create only | Unchanged: create only. Binary stays out of the patient-filterable lists used to classify clinical resources, and `PatientFilterManager.isCreateOnlyWithPatientScope` keeps every non-create write forbidden for a patient scope (scope gate and `canWriteResourceAsync`) |
| `$everything` cache key | `callerPersonId` always in the key | `callerPersonId` only while the flag is on (nothing is caller-specific with it off), so existing keys are unchanged |
| Metric | `fhir_binary_person_filter_applied_total` | Removed (no dedicated filter any more) |

Consequences to accept or reject when choosing:

1. **Rollback is weaker.** The flag gates the read filter, so turning it off makes member-owned Binary readable again by
   in-tenant tokens that read Binary through the access-tag path. Likewise a fhir-server deployment (fhir-server,
   -internal, -everything, -graphql) with the flag unset serves owned Binary unfiltered. This is why the
   transitional model kept its filter un-gated (§16.3). The end state in Mintu's proposal is the **unconditional**
   mapping, with no flag, once the backfill is complete (the follow-up that removes the gate is part of §17).
2. **Turning the flag on before the backfill hides existing Binary from every patient-scoped token**, including
   clinical viewers on mixed tokens and the DocumentReference to Binary hop in `$everything` and GraphQL.
3. **Existing Binary owned by a real Patient** (securityContext `Patient/{id}`) become readable by every person linked
   to that patient as soon as the flag is on. Same as the transitional model.

Sections 4.4, 5 (read column), 7 and 16.3 describe the transitional model; where they differ, this section wins.

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
- G2. Every read path applies the person check to owned `Binary` resources; none can be used to bypass
  it (search, search-by-id, `_history`/vread, `$everything`, `$graph`, GraphQL, export).
- G3. Zero behavior change for existing (unowned) `Binary` resources and for system/user/admin
  tokens that carry no patient scope.
- G4. Ship behind a feature flag, default off.
- G5. A member holding only `patient/Binary.read` (no user/system scope, no access code) can read their own
  owned `Binary`, consistent with how other patient-scoped resource reads work (§4.4.1).

Non-goals (explicit)

- N1. Update / patch / delete / `$merge` of `Binary` by patient-scoped tokens: stay forbidden.
- N2. Closing the by-id read gap for **unowned** `Binary` (all existing clinical `Binary` and
  system-written ones with no tag): documented as a separate follow-up (§12.1).
- N3. Backfilling tags onto existing `Binary` resources.
- N4. Changing authorization for other non-clinical resource types (surveyed in §10).

## 3. Decision: Option 1 — person-owned via securityContext, create-only

1. Allow `Binary` **create only** (REST `POST /4_0_0/Binary`) for a token that has a patient scope
   granting create on `Binary` (`patient/Binary.write`, `patient/Binary.c`, `patient/*.write`, ...).
2. On such a create the server **sets `securityContext`** to the caller's person proxy patient
   (`Patient/person.{person_uuid}`) from the person id in the token (§4, §0.1). The client does not control it.
3. On read, when the caller is patient-scoped and a `Binary` is owned (its `securityContext` is a Patient
   reference), it must be one of the caller's patients (the person proxy or a linked patient). A `Binary`
   with no such `securityContext` is treated exactly as today.
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

### 4.2 Ownership value (`securityContext`)

`Binary.securityContext` (a `Reference`, FHIR R4 `Binary.securityContext`) holds the owner:

| Writer | Value |
|---|---|
| Member (patient-scoped token) | `Patient/person.{person_uuid}`, set by the server from `clientFhirPersonId` (`PERSON_PROXY_PREFIX` + person uuid; the same proxy-patient form used on Consent and by `Patient/person.{id}/$everything`) |
| Backend / migration (system token) | `Patient/person.{person_uuid}` or a real `Patient/{id}`; trusted, not validated |

On save the reference handler fills `_uuid` / `_sourceId` / `_sourceAssigningAuthority`
(`referenceGlobalIdHandler.js`): for `Patient/person.{uuid}`, `isUuid()` is true (the id contains the uuid), so
`_uuid` is stored unhashed as `Patient/person.{uuid}` and `_sourceId` the same; for a source-id patient
(`Patient/abc`) `_uuid` is `Patient/<uuidv5(abc|authority)>` and `_sourceId` is `Patient/abc`. The read filter
(§4.4) matches those fields, so nothing is added to `meta.security` and `SecurityTagSystem` is unchanged.

No new index is required for by-id reads. A "list my Binaries" search benefits from a `securityContext._uuid`
index (Task has `for._uuid`); see §13.

### 4.3 Write path (create only)

Introduce one narrow concept instead of widening `canAccessResourceWithPatientScope` (used by many
callers: delegated access, query rewriting, `$everything`; widening it would silently make `Binary`
"patient-filterable" everywhere):

- `PatientFilterManager.personSecurityContextResources = ['Binary']` and
  `isPersonSecurityContextResource({resourceType})`.
- `ScopesManager.isPatientScopedPersonContextCreate({scope, resourceType, action})`: true when feature flag on,
  `resourceType` is in that set, `action === 'create'`, and `hasPatientScope({scope})` (the same
  case-insensitive predicate `isUser` uses — they must agree; see the comment on `hasPatientScope`).

Required changes at the three gates in §1.1:

1. `ScopesValidator.isScopesValidAsync`: when `isPatientScopedPersonContextCreate`, evaluate the **patient**
   scopes (`getPatientScopes`) via `evaluateResourceTypeScopeMatch` for `resourceType: 'Binary'`,
   `accessRequested` = `c`/`write` (existing CRUDS mapping, `create → 'c'`). A `user/`/`system/`/`access/`
   scope alone is not sufficient in this branch, and no `access/` code is required (patient tokens carry
   none, as for every other patient-scoped write).
2. `PatientScopeManager.canWriteResourceAsync`: for `isPatientScopedPersonContextCreate` return true **iff**
   `personIdFromJwtToken` is a non-empty string and the resource's `securityContext` is exactly
   `Patient/person.{personIdFromJwtToken}` (after stamping this is always so). No Person/Patient link
   expansion is needed; this removes the `getPatientIdsFromScopeAsync` cost for this path.
3. `ScopesManager.isAccessTagChangeAllowedByScopes` / `isAccessToResourceAllowedBySecurityTags`: same
   patient-scope short-circuit, but only when `isCreate`.

Stamping (a new step in `Create.createAsync` (`src/operations/create/create.js`, between
`removeUnderscoreFieldsRecursive` and `validateResourceMetaSync`, ~lines 160-180), executed only when
`isPatientScopedPersonContextCreate`):

| Incoming `securityContext` | Result |
|---|---|
| absent (or `null`) | server sets `{reference: 'Patient/person.' + personIdFromJwtToken}` |
| exactly the caller's own `Patient/person.{personIdFromJwtToken}` (a trailing `\|authority` is ignored) | accepted unchanged (idempotent) |
| anything else (another person, a real Patient, another resource type, a reference-less value) | `403 Forbidden` with a reason; never silently overwritten (a mismatch signals a bug or an attack and should be visible in logs); the supplied value is not echoed |
| token has patient scope, `personIdFromJwtToken` empty/missing | `403` (defence in depth, §4.1) |

Decision on "overwrite vs reject": reject on mismatch (as the coordinator decision allows). Overwriting
silently would mask client bugs and make audit trails misleading.

Setting it is **synchronous and in-process**: a property assignment on the request body that is already in
memory, using a claim already resolved at authentication. No I/O, no await on the hot path, so there is no
reason to defer it; deferring (e.g. post-response) would be incorrect because it must be durable with the
first write. The audit entry is the part that is correctly asynchronous (§8).

The rejection (row 3 of the table above) returns `403` with an OperationOutcome whose diagnostic names the
problem ("the securityContext ... is set from the token and cannot be supplied by the client") without
echoing the supplied value, and the server logs it at `warn` (§8).

#### 4.3.1 Owner/access tags on the new `Binary`: limited to the caller's Person (amended 2026-10-14)

Verified in code: `validateResourceMetaSync` requires exactly one `owner` tag and the client supplies
owner/access tags on every create. For a patient-scoped create, `ScopesManager.isAccessTagChangeAllowedByScopes`
returns `true` immediately when `isCreate` and the type is patient-accessible (`scopesManager.js` ~line
189: "a patient scoped caller is authorized via the patient/person the resource belongs to, not via
access codes"), and `canWriteResourceAsync` checks only the patient/person linkage, not the tags. So
**today no patient-scoped create of any other resource type has its `access`/`owner` tags constrained**, and a
member could already tag, for example, a `Condition` with another tenant's access code. That gap is
pre-existing and resource-type-independent; it stays recorded as follow-up F-1 (§12).

The first version of this design kept the same behavior for `Binary` (parity). Review found that is not
safe for `Binary`: a member could put any `owner`/`access` tag on the Binary, and a system or user token for
another tenant (`access/otherTenant.read`) would then see content a member planted in that tenant's view
(the person filter in §4.4 only narrows reads for patient-scoped callers). So for `Binary` the server no
longer trusts body-supplied tenant tags. On a patient-scoped create, in `create.js` right after the
`securityContext` is set:

- the caller's Person is loaded server-side by the token's person id (`personIdFromJwtToken`);
- every `owner` and `access` code in the body's `meta.security` must be among the owner/access codes of that
  Person **or `bwell`**, so a member can only label a Binary for tenants that already see their Person, or for
  the platform;
- the body must carry an owner tag;
- anything else, or a Person that cannot be loaded, is rejected with `403` (fail closed). The response does not
  echo the supplied codes, and the rejection is counted on the create metric (reason `tenant_tag_not_on_person`).

Why `bwell` is allowed: health-data-service writes member uploads as owner/access `bwell`, so a client
tenant does not see them. A real member Person carries its client's slug (for example `bwell_demo`, checked
on dev and staging 2026-10-14), so the Person's codes alone would reject that legitimate path. The allowed
set is computed in one helper (`getAllowedTenantTagCodes`, `src/utils/personSecurityContext.js`).

The check is keyed on the create condition only, not on the token's scopes, so it also applies to mixed
tokens (`access/*.* user/*.* patient/*.*`): with `access/*.*` the scope comparison accepts any tag.

The early returns in `ScopesManager` stay (a patient-scoped caller has no access scope to compare against);
the tag check lives in `create.js`, not there.

Mixed-scope tokens are patient-scoped (§5.4). `$merge`, `PUT`, `PATCH`, `DELETE` of `Binary` are untouched
and keep returning the existing `Write not allowed using user scopes if patient scope is present`.

### 4.4 Read path

> **Superseded by §0.2 in the stacked PR.** The text below is the transitional model implemented in #2635.

Single choke point: add one predicate in `SearchManager.constructQueryAsync`
(`src/operations/search/searchManager.js`, after the access-tag/patient-filter block and before
`queryRewriterManager.rewriteQueryAsync`, ~line 458). Condition: `resourceType` is in
`personSecurityContextResources` **and** `hasPatientScope({scope})` (equivalently `isUser`). **Not gated on the
flag** (§16.3).

```js
// pseudo-code (PatientQueryCreator.getQueryWithPersonSecurityContext)
// patientIds = PatientScopeManager.getPatientIdsFromScopeAsync(...): 'person.{uuid}' (proxy) + linked patients
const uuids = patientIds.filter(isUuid).map(p => `Patient/${p}`);       // the proxy id is matched here too
const others = patientIds.filter(id => !isUuid(id)).map(p => `Patient/${p}`);
const owned = OR([ { [f('securityContext._uuid')]: { $in: uuids } },
                   { [f('securityContext._sourceId')]: { $in: others } } ]);   // each clause only if non-empty
const unowned = AND([ { [f('securityContext._uuid')]:     { $not: { $regex: '^Patient/' } } },
                      { [f('securityContext._sourceId')]: { $not: { $regex: '^Patient/' } } } ]);
if (!personId) {
  query = { _uuid: '__invalid__' };                        // fail closed: never "no filter" (review.md §3.D)
} else if (!strict) {                                      // mixed token: keep today's behavior for unowned Binary
  query = AND(query, owned ? OR([unowned, owned]) : unowned);
} else {                                                   // pure patient token (§4.4.1): owned by the caller only
  query = AND(query, owned || { _uuid: '__invalid__' });
}
```

`getPatientIdsFromScopeAsync` is the machinery every patient-scoped read already uses (cached per request); it
adds one Person/link resolution to a patient-scoped Binary read that previously needed none.

`f()` is `FieldMapper({useHistoryTable}).getFieldName`, so the same predicate is correct against
`resource.securityContext.*` in `*_History` collections.

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

#### 4.4.1 Member read with `patient/Binary.read` alone (decision)

Today a token with only patient scopes cannot read `Binary` at all (§1.2): the scope gate treats `Binary`
as not patient-accessible, so it falls to the `user/`+`system/` branch and then needs an `access/` code.
Decision: members can read with `patient/Binary.read`, like other patient-scoped reads.

Gate change (flag on, `isPersonSecurityContextResource`, `hasPatientScope`, action `read`/`search`): in
`ScopesValidator.isScopesValidAsync`, evaluate the patient scopes (`getPatientScopes`) for `Binary`, as for
creates in §4.3, instead of requiring a `user/`/`system/` scope + access code **when the token has no
`user/`/`system/` scope**. A token that also carries `user/`/`system/` scopes keeps today's evaluation (and
therefore today's behavior for unowned Binary).

The read predicate then has **two modes**, chosen by whether the token holds any `user/` or `system/` scope
(the same namespaces the existing resource-type gate uses):

| Caller | Predicate on `Binary` | Reads |
|---|---|---|
| Patient-scoped **and** holds a `user/` or `system/` scope (mixed token: `patient/*` + `user/*` + `access/<c>`; the clinical viewers) | access-tag filter AND (unowned OR owned by one of my patients) | my Binary + unowned Binary in tenant (today's behavior preserved) |
| Patient-scoped with **no** `user/` or `system/` scope (pure patient token) | owned by one of my patients, strictly | my Binary only; **unowned Binary are never returned** |

The mode is decided by the namespace alone, not by whether the user/system scope happens to grant `Binary`:
a token like `patient/Binary.read user/Condition.read` is mixed, so its `Binary` read is evaluated through
the user/system scopes as today and is denied (403); it is never silently downgraded to the strict path.
This is deliberately conservative (it can only deny more, never expose more).

The strict mode matters: a pure patient token carries no access code, so `constructQueryAsync` builds no
tenant filter (the `else if (securityTags ...)` branch is skipped). If the "unowned OR own" form were
used there, every unowned `Binary` of every tenant would become readable. Strict mode closes that by
construction, and T39 pins it.

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
read-side filter already makes a foreign owned `Binary` invisible, whichever `DocumentReference` points
at it, so a member who points their `DocumentReference` at another member's `Binary` id gets `null`
from the GraphQL resolver and nothing in `$everything`. We do log (§8) a structured warning when a
patient-scoped `DocumentReference` create/update references a `Binary` id, for later abuse analysis, but
do not block. Revisit if unowned `Binary` by-id access (§12.1) is closed, since that would remove the
remaining way to read a foreign unowned `Binary`.

### 4.6 Size, content type, cloud storage: no Binary-specific limits (decision)

Decision: do whatever fhir-server does today for other calls. Verified facts (from code and
configuration, not measurements):

- **There is no per-resource-type size or content-type limit** on writes. The only limit is the
  server-wide JSON body limit `PAYLOAD_LIMIT` (default `50mb`, `configManager.js:509`), applied by
  `express.json({ limit })` (`src/routeHandlers/fhirServer.js:82-95`), and `validateResourceSizeSync`
  caps only `AuditEvent` (`create.js` raises `PayloadTooLargeError`, 413, for it). This design adds none.
- **The token is not verified before the body is read.** The JSON body parser (`parseFhirJsonBody`) is
  registered at app level in `configureMiddleware`, and authentication runs later, per route, in
  `FhirRouter` (`authenticationMiddleware(config)` in `src/middleware/fhir/router.js`). So an
  unauthenticated or unauthorized caller can make the server read and parse up to `PAYLOAD_LIMIT` before
  it is rejected. This is existing behavior for every endpoint, not something this change introduces, but
  opening member uploads makes it more visible; it is recorded as follow-up F-2 (§12) (authenticate before
  parsing, or a lower pre-auth limit) and is not part of this change.
- Base64 inflates 4/3, so the largest raw payload that fits the 50 MB body limit is about 37.5 MB
  (arithmetic estimate). MongoDB's 16 MB BSON document limit means an inline base64 `Binary` above
  roughly 12 MB raw (estimate) needs cloud-storage offload.
- When `BASE64_FIELD_CLOUD_STORAGE_ENABLED` is on, `Binary.data` over `BASE64_FIELD_DATA_THRESHOLD_KB`
  (default 64 KB, `configManager.js:~960`) is offloaded to the resource bucket by `Base64DataManager`
  (called in `create.js` before insert, ~line 223); history for `Binary` goes to cloud storage because
  `CLOUD_STORAGE_HISTORY_RESOURCES` defaults to `['Binary']` (`configManager.js:865`).

Rate limiting and malware scanning remain gateway/storage-tier concerns (dependencies, not in this repo).
If product later wants a per-member cap or a content-type allowlist, it is a self-contained addition at the
stamping step (§4.3) and is deferred (F-3, §12).

## 5. Behavior by token shape

| Token | Create `Binary` | Read `Binary` (REST/GraphQL/`$everything`/`$graph`) |
|---|---|---|
| `patient/Binary.write` (+ person claims) | allowed; securityContext set | needs a read grant (`patient/Binary.read`, §4.4.1, or user/system + access as today) |
| `patient/Binary.read` only (no user/system scope, no access code) | 403 (no create grant) | **new (§4.4.1):** own owned `Binary` only; unowned never returned |
| `patient/*.read` only (no `Binary` grant) | 403 (no create grant) | 403 at scope gate |
| `system/*.*` or `user/*.*` + `access/<c>` (no patient scope) | unchanged; **no auto-stamp** | unchanged (no person filter; sees owned and unowned within tenant) |
| `access/*` + `admin/*`, no patient scope | unchanged | unchanged |
| any token with **any** patient scope plus `user/`/`system/`/`access/` (mixed) | treated as patient-scoped: requires patient create grant, always stamped, tag filter applied; user/system/access privileges do **not** bypass | tag filter applied (so a mixed token reads own owned + unowned only) |
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
`securityContext` themselves. Unowned `Binary` written by system tokens keep today's semantics (§12.1).
We do not forbid or validate a supplied tag on system writes, other than the "single tag" rule, so a
backend can write a tag for any person — this is intentional (backends are trusted by tenant access code).

## 7. Backward compatibility and rollout

> **Read-side rollout superseded by §0.2 / §17 in the stacked PR**: the flag stays off until the backfill has finished.

- Feature flag `ENABLE_PATIENT_SCOPED_BINARY_CREATE` (default false) in `ConfigManager`
  (e.g. `get enablePatientScopedBinaryCreate() { return isTrue(env.ENABLE_PATIENT_SCOPED_BINARY_CREATE); }`),
  matching how `ENABLE_DELEGATED_ACCESS_DETECTION` / `enableDelegatedAccessDetection` are done. The flag
  gates the create carve-out and strict (pure patient token) read authorization. It does **not** gate the read
  filter (§16.3).
- The read filter is a strict no-op for unowned data, so the existing corpus is unaffected, with the flag on or
  off: the only behaviour change with the flag off is for `Binary` whose `securityContext._uuid`/`_sourceId`
  starts with `Patient/`, and no known pipeline writes those today (only this create path does).
- Rollout: (1) deploy flag-off (code dormant), (2) **the read filter, including the `patient/Binary.read`
  gate change, lands before the create carve-out** (decision): it is a no-op for unowned data and no
  owned `Binary` can exist until the create path ships, (3) enable in a lower environment and run the
  integration matrix plus a manual DocumentReference→Binary GraphQL walkthrough, (4) enable per
  environment, (5) backend clients that want per-member isolation start setting `securityContext` on their writes. Rollback = flag
  off: new member creates are rejected again (403, as today) and pure patient tokens lose `Binary` read, but the
  read filter stays on, so already-owned `Binary` remain hidden from other persons' tokens (including mixed
  tokens). **Rollback does not weaken isolation of already-owned Binary** (§16.3). Members' own pure patient
  tokens can no longer read their uploads until the flag is back on; mixed tokens still can.
- No schema/index migration is required.

## 8. Audit logging and observability

- Audit: `Create.createAsync` already queues `auditLogger.logAuditEntryAsync` through
  `postRequestProcessor` (asynchronously, after the response; correct because the audit entry is not on
  the durability path of the write). It records resource type, operation and uuid; the design adds the
  stamped person id to the audit/log context as-is (decision: same as existing code, which already logs
  person ids in plain text, e.g. `personToPatientIdsExpander.js`).
- Logs (`logInfo`/`logWarn`, `src/operations/common/logging.js`): `binary_person_security_context_set`,
  `binary_person_security_context_rejected` (warn, include caller `user`, supplied code, token code), and
  `documentreference_references_binary` (§4.5).
- Metrics (built, see §16): `fhir_binary_patient_create_total{outcome=set|rejected, reason=missing_person_id|client_supplied_security_context}`
  and `fhir_binary_person_filter_applied_total{mode=strict|mixed|no_person_id}`, in `src/utils/metrics.js`
  (the repo's ambient-meter pattern; no PHI or ids in attributes). Alert on a non-zero
  `client_supplied_security_context` rate (tag-forgery signal).

## 9. Security and threat considerations

Walked against `review.md` §3 A, B, C, D, E.

| # | Threat | Mitigation | Residual |
|---|---|---|---|
| T1 | Spoofing: member supplies another person's (or a real patient's) `securityContext` | server sets it from the token and rejects any supplied value other than the caller's own proxy; never trusts the body | none for create |
| T2 | Cross-member read of owned `Binary` by id/search/history/`$everything`/`$graph`/GraphQL | single predicate in `constructQueryAsync` (§4.4) fail-closed on empty person id | by-id read of **unowned** `Binary` still allowed (§12.1); OQ-2 paths to verify |
| T3 | Cross-tenant injection via member-chosen `access`/`owner` tags | every `owner`/`access` code on the `Binary` must be one the caller's own Person carries or `bwell`, else 403 (§4.3.1) | none for `Binary`; other resource types remain a pre-existing gap, follow-up F-1 |
| T4 | Enumeration of ids | filtered resource is indistinguishable from a missing one (empty result / 404, same as a failed access-tag filter) | timing difference negligible; not measured |
| T5 | Mixed-scope bypass (`patient/* system/*`) | branch keyed on `hasPatientScope`; user/system privileges do not bypass | none |
| T6 | Tag removal by a later update | updates by patient tokens forbidden; system tokens may edit tags by design | trusted backends |
| T7 | Empty/undefined person id making the filter match everything | filter builds `_uuid: '__invalid__'` instead (review.md §3.D) | none |
| T8 | Two tenants sharing the same real person (review.md §3.E) | tag holds the **client** person id and the existing access-tag filter is still ANDed (not replaced); mixed tokens keep both | none |
| T9 | Abuse of upload surface (size, type, volume) | server-wide `PAYLOAD_LIMIT` only (§4.6); gateway rate limit | body is parsed before the token is verified (existing, F-2); malware scanning out of scope |
| T10 | Retrieval via DocumentReference of another member pointing at a foreign Binary | read filter (§4.5) | unowned case |
| T11 | Pure patient token reads unowned `Binary` of any tenant (no access tag filter exists for it) | strict mode: `tag = my person id` only (§4.4.1) | none |

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

- **A. (chosen, revised 2026-10-09) Person ownership on `Binary` through `securityContext` (`Patient/person.{person_uuid}`), set by the server on create, filtered on read.** (The first version used a custom `clientPersonId` security tag; see §0.1.) Smallest
  surface, backward compatible, no backfill, matches existing `meta.security` conventions.
- **B. Subscription-style `personFilterWithQueryMapping`** (add `Binary` with a filter on
  extension/identifier). Rejected: `personFilterWithQueryMapping` is consulted by
  `canAccessResourceWithPatientScope`/`isPatientRelatedResource`, which would make `Binary` fully
  "patient-filterable" for every caller and turn the person filter into the *only* gate for all `Binary`
  reads, including every existing unowned one — an immediate regression for GraphQL
  `DocumentReference → Binary` for existing data unless a full backfill precedes enablement. It also uses
  an extension, which `Binary` does not support in a queryable form without adding a field to a
  pass-through payload resource.
- **C. Reverse lookup through `DocumentReference`** (`Binary` readable iff some patient-visible
  `DocumentReference` references it). Rejected: an extra query per `Binary` read (N+1 on `$everything`),
  breaks for uploads that precede their `DocumentReference`, and cannot gate the create itself.
- **D. `Binary.securityContext` = Patient reference + `patientFilterMapping: Binary: 'securityContext.reference'`**
  (the FHIR-native approach, Mintu's recommendation). As a *full* switch it hides every existing `Binary`
  (none has a `securityContext`) from any token holding a patient scope, including the mixed viewer tokens, so
  it needs a one-time backfill of about 60M Binary plus helix/PROA pipeline changes first. **Adopted in a
  transitional form (§0.1):** the same field and the same Patient-reference convention, but the read filter
  treats a Binary with no securityContext as unowned (unchanged), so only new member uploads are owned and no
  backfill is needed up front. The backfill and the switch to the plain mapping become a later, separate
  work item.
- **E. Backend service-client workaround** (member calls a backend that writes with a system token).
  Rejected as the end state: it is today's behavior and is precisely what leaves `Binary` untied to a
  person; but it remains available and compatible (§6).

## 12. Open questions and follow-ups

12.1 (follow-up, out of scope) By-id read of **unowned** `Binary` by a patient-scoped caller remains
possible within the tenant. Close by backfilling tags or moving to alternative D, then flipping the filter
to "tag required for patient-scoped callers".

Open questions for reviewers:

Follow-ups (not part of this change; each applies beyond `Binary`):

- F-1. Constrain `access`/`owner` tags on **all other** patient-scoped creates (today unconstrained, §4.3.1; `Binary` is already constrained).
- F-2. Authenticate before reading/parsing the request body, or apply a lower pre-auth body limit (§4.6).
- F-3. Optional per-member upload cap and content-type allowlist for patient-scoped `Binary` create.

Resolved in review (see §0): former OQ-1 (tag hardening: parity), OQ-3 (limits: none beyond today's),
OQ-4 (logging: as-is), OQ-5 (member read: yes via `patient/Binary.read`, §4.4.1), OQ-6 (tag URI: approved).

Still open:

- OQ-2. Confirm during implementation that cache/text-format paths (§4.4) run after the filter. Not a
  decision; verified when the read filter is implemented (tests T25, T26).

## 13. Quantitative notes (estimates vs measured)

Nothing in the bullets below was measured, and they were written for the earlier tag-based filter (`meta.security`,
`$not/$elemMatch`); the `securityContext` filter that was built is measured in "Measured" at the end of this section,
which supersedes them.

- Extra read cost: one additional `$or` clause evaluated per **already-selected** document (id lookup
  by `_uuid`, or access-tag match, selects first). Estimate: O(documents returned), a few BSON field
  reads each; negligible next to `Binary` payload transfer. The `$not/$elemMatch` branch cannot use an
  index but is never the driving predicate for by-id/`$everything`/GraphQL reads. A free-text
  `GET /Binary` search with no id would scan under the access-tag filter today as well; the new clause
  does not change the access path.
- Index (superseded by the measurements at the end of this section): originally "no new index required". The existing `{meta.security.code: 1, _uuid: 1}` index
  (`meta_security_code.uuid`) supports an equality probe on the person code if a "list my Binaries" query
  is ever needed. **Plan to measure:** run `explain('executionStats')` for the three query shapes
  (by id, by `DocumentReference` batch of `graphQLFetchResourceBatchSize` ids, unconstrained search; in
  both mixed and strict modes) on a
  seeded `Binary_4_0_0` with owned and unowned documents before enabling in production.
- Write cost: setting `securityContext` is an in-memory property assignment (sub-millisecond, estimate); no added I/O.
- Payload sizes: see §4.6 (arithmetic from configuration defaults).
- Strict-mode read (§4.4.1) is an equality probe on `meta.security` with the person code and can use the
  `meta_security_code.uuid` index; not measured (same `explain` plan as above).

### Measured (local, synthetic)

**Measured locally on mongodb-memory-server, synthetic data, not prod.** 50,000 Binary without
`securityContext` + 320 owned (300 via person proxy `Patient/person.{uuid}`, 20 via a real `Patient/{uuid}`);
filter built by `PatientQueryCreator.getQueryWithPersonSecurityContext` with 3 caller patient ids (proxy + 2
linked). "Before" = generic `Binary_4_0_0` indexes (`meta.source_1`, `uuid`, `sourceId`) plus a per-client
`_access.client1_1._uuid_1` index as prod has; "after" adds `securityContextUuid_uuid` and
`securityContextSourceId_uuid` (created through `IndexManager`). Script (opt-in, excluded from the default
suite): `src/tests/integration/performance/binary_person_filter/binaryPersonFilterExplain.test.js`.

| Shape | Stage | Winning plan | Index | keysExamined | docsExamined | nReturned |
| :- | :- | :- | :- | -: | -: | -: |
| pure patient token (strict): `securityContext._uuid $in [..]` | before | COLLSCAN | none | 0 | 50,320 | 2 |
| pure patient token (strict) | after | FETCH > IXSCAN | `securityContextUuid_uuid` | 4 | 2 | 2 |
| mixed token, tenant filter only (`_access.client1` AND `$or[unowned, owned]`) | before | FETCH > IXSCAN | `_access_client1_1._uuid_1` | 50,320 | 50,320 | 50,002 |
| mixed token, tenant filter only | after | FETCH > IXSCAN | `_access_client1_1._uuid_1` | 50,320 | 50,320 | 50,002 |
| mixed token, by `_uuid` | before | FETCH > IXSCAN | `uuid` | 1 | 1 | 1 |
| mixed token, by `_uuid` | after | FETCH > IXSCAN | `uuid` | 1 | 1 | 1 |

Reading it: the new indexes matter for the pure-patient list (`GET /Binary` with a `patient/Binary.read` token),
which went from a full collection scan to 4 keys / 2 docs. They change nothing for the mixed-token and by-id
shapes: the "unowned" branch (`securityContext._uuid`/`_sourceId` `$not $regex ^Patient/`) is not indexable, so a
mixed-token search without an id stays bounded by the tenant access-tag index exactly as before (it examines all
of the tenant's Binary, as it did without the filter). Index size on the 50,320-doc set: 45 KB each, versus
2.2 MB for `uuid`, i.e. the partial filter keeps the 50k unowned documents out. Not measured: real cardinality
(~60M Binary), non-uuid patient ids hitting the `_sourceId` branch, wall-clock at prod scale.

## 14. Test plan

Tests are specified here as a matrix, and a skeleton using `test.todo` is added at
`src/tests/integration/patientScope/binary_with_patient_scope/binary_with_patient_scope.test.js` so the
cases are visible and tracked without asserting not-yet-existing behavior. All of them are now implemented
(no `test.todo` remains). Style follows
`src/tests/integration/patientScope/create_with_patient_scope/create_with_patient_scope.test.js`
(`getHeadersWithCustomPayload`, merge a Person first and use its `uuid` as `clientFhirPersonId`).

Notation: **P** = `patient/Binary.write` with person claims for person A; **P-B** = same for person B;
**Pr** = patient read-capable mixed token `access/*.* patient/*.* user/*.* admin/*.read` (as in the GraphQL
test); **P-read** = pure patient token with `patient/Binary.read` and no user/system scope or access code; **S** = `system/*.*` + `access/<client>` no patient scope; **S-other** = different tenant access
code; **M** = `patient/*.* system/*.*` (mixed); **flag** = `ENABLE_PATIENT_SCOPED_BINARY_CREATE`.

| ID | Use case | Token | Expected |
|---|---|---|---|
| T1 | Member creates Binary, no securityContext supplied | P, flag on | 201; `securityContext.reference` = `Patient/person.{A}` |
| T2 | Member supplies their own proxy patient | P | 201; unchanged |
| T3 | Member supplies another person's securityContext | P | 403 with reason (see T42); nothing persisted |
| T3b | Member supplies a real Patient or another resource type | P | 403 |
| T4 | Patient scope but no/empty person id | P w/o `clientFhirPersonId` | 401 at auth (and unit test: op-layer 403) |
| T5 | PUT/update Binary | P | 403 |
| T6 | PATCH Binary | P | 403 |
| T7 | DELETE Binary | P | 403 |
| T8 | `$merge` Binary | P | 403 |
| T9 | Member A reads own owned Binary by id | Pr(A) | 200 |
| T10 | Member B reads A's owned Binary by id | Pr(B) | 404 / not found (same as missing) |
| T11 | Member B searches `Binary?_id=` and `Binary` search | Pr(B) | empty bundle; A's does not leak |
| T12 | `_history` and `_history/{vid}` | P/Pr | 403 (unchanged: history rejects patient scope) |
| T13 | `Patient/$everything` / `Person/$everything` as B with A's DocumentReference pointing to A's Binary (and B's own DR pointing at A's Binary) | Pr(B) | A's Binary absent from bundle; B's own present |
| T14 | `$graph` to a Binary: `Communication.payload.contentReference` → Binary, and Binary as the start resource (`DocumentReference.content.attachment.url` is a `uri`, not a Reference, so `$graph` cannot follow it) | Pr(A)/Pr(B) | A sees it; B does not |
| T15 | GraphQL `DocumentReference → attachment.resource` for owner | Pr(A) | Binary returned |
| T16 | GraphQL same, other member | Pr(B) | `resource: null` |
| T17 | Unowned Binary (existing fixtures) | Pr | readable exactly as today (regression against `graphql.documentReference.test.js` expectations) |
| T18 | System token writes Binary without tag | S | 201; no tag added |
| T19 | System token writes Binary owned by `Patient/person.{A}` (or a real patient linked to A) | S | 201; securityContext preserved; readable by Pr(A), not Pr(B) |
| T20 | System token reads owned Binary | S | 200 (no person filter without patient scope) |
| T21 | Cross-tenant: S-other reads/creates | S-other | access-tag filter still denies |
| T22 | Mixed-scope create | M | treated as patient-scoped: requires patient create grant, stamped; `system/*` alone does not bypass; `patient/Condition.write system/*.*` → 403 |
| T23 | Patient token lacking create grant (`patient/Binary.read` only) | P-read | 403 on create |
| T24 | Patient token with only `access/*` + `user/*` (no patient) | S-like | unchanged |
| T25 | `Binary` read with `format=text/plain` path (`fhirResponseWriter`) as B | Pr(B) | not returned (OQ-2) |
| T26 | Cache short-circuit paths in `$everything`/`$graph` | Pr(B) | not returned (OQ-2) |
| T30 | Cloud-storage offload on (`BASE64_FIELD_CLOUD_STORAGE_ENABLED`) with member Binary > threshold | P | 201; tag present on stored doc and in history entry |
| T31 | Flag off | P | 403 with today's message `Write not allowed using user scopes if patient scope is present` |
| T32 | Flag off, owned Binary exists | Pr(B) | no person filter (today's behavior), documents rollback note in §7 |
| T33 | Person id claim empty on read | Pr | filter fails closed (`_uuid: '__invalid__'`) — unit test of query construction |
| T34 | Query shape | Pr | `toHaveMongoQuery` shows `$or` clause ANDed with access-tag filter, using `resource.meta.security` for history |
| T36 | Audit entry written; stamping logged | P | audit logger invoked once with resource uuid |
| T37 | Pure patient token reads own owned Binary by id | P-read(A) | 200 |
| T38 | Pure patient token reads another member's owned Binary by id and by search | P-read(B) | 404 / empty bundle |
| T39 | Pure patient token reads an unowned Binary (any tenant) | P-read | 404 / not returned (strict mode, §4.4.1) |
| T40 | Pure patient token without a `Binary` read grant | `patient/Condition.read` only | 403 |
| T41 | Mixed token reads unowned Binary | Pr | readable as today (clinical viewers unchanged) |
| T42 | Foreign securityContext rejected with reason | P | 403; OperationOutcome says it is set from the token and does not echo the supplied value |

Unit tests (new, `src/tests/unit/...`): `ScopesManager.isPatientScopedPersonContextCreate` truth table
(flag × action × scope shapes, including upper-case `PATIENT/`), stamping function table in §4.3,
`SecurityTagManager` person-filter builder.

## 15. Implementation outline (after approval; not part of this change)

1. `SecurityTagSystem.securityContext`; `ConfigManager` flag and limits.
2. `PatientFilterManager.personSecurityContextResources` + helpers.
3. `ScopesManager.isPatientScopedPersonContextCreate` and the three gate changes (§4.3).
4. `PatientScopeManager`/`Create`: stamping and mismatch rejection (no size/type limits, no tag hardening).
5. `SecurityTagManager.getQueryWithPersonSecurityTag` (mixed and strict modes) and its call in
   `constructQueryAsync`; read-scope gate change for `patient/Binary.read` (§4.4.1). Ships before 4.
6. Tests per §14, docs: add §5/§12 notes to `docs/resource-authorization.md`.

## 16. Implementation notes (what was built)

The create carve-out and strict read authorization are behind `ENABLE_PATIENT_SCOPED_BINARY_CREATE` (default off; flag off = today's behavior for every existing Binary). The read filter is not (§16.3). The
ownership marker is `Binary.securityContext` (§0.1), so `SecurityTagSystem` is unchanged.

- `ConfigManager.enablePatientScopedBinaryCreate`; `PatientFilterManager.personSecurityContextResources`
  (`{ Binary: 'securityContext.reference' }`), `isPersonSecurityContextResource`,
  `getPersonSecurityContextProperty` (Binary is **not** added to any patient/person filter mapping).
- `ScopesManager`: `isPersonContextReadFiltered` (Binary, `hasPatientScope`; no flag), `isPersonContextResourceScoped` (flag AND the former),
  `isPatientScopedPersonContextCreate` (adds `action === 'create'`), `isPersonContextStrictAccess` (adds "no
  `user/`/`system/` scope"). `isAccessTagChangeAllowedByScopes` and `isAccessToResourceAllowedBySecurityTags`
  short-circuit only on a create (`isCreate`), which is threaded explicitly from `CreateOperation` through
  `ScopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes` (default `false`, so update, patch,
  remove and merge are untouched).
- `ScopesValidator.isScopesValidAsync`: evaluates the patient scopes for a Binary create and for a Binary
  read by a pure patient token.
- `PatientScopeManager.canWriteResourceAsync`: for a Binary create requires the `securityContext` to be exactly
  `Patient/person.{token person id}` (defence in depth after it is set).
- `src/utils/personSecurityContext.js`: `getPersonProxyReference`, `hasOwnPersonSecurityContext`,
  `stampPersonSecurityContext` (the §4.3 table). `CreateOperation` calls it right after
  `removeUnderscoreFieldsRecursive`, before meta validation; it now takes `scopesManager` (registered in
  `createContainer.js`).
- `PatientQueryCreator.getQueryWithPersonSecurityContext` and its call in `SearchManager.constructQueryAsync`
  (after the access-tag/patient-filter block, before query rewriting); the caller's patient ids come from
  `PatientScopeManager.getPatientIdsFromScopeAsync`. `getSecurityTagsFromScope` is told a pure-patient Binary
  read is patient-authorized so it does not demand an access code.
- Indexes: `securityContextUuid_uuid` and `securityContextSourceId_uuid` in `src/indexes/customIndexes.js` (`'*'`
  list, `include: ['Binary_4_0_0']`), partial on `securityContext.{_uuid,_sourceId}` existing. See §13 for measurements.
- Metrics: `binaryPatientCreateCounter` / `binaryPersonFilterAppliedCounter` in `src/utils/metrics.js`, emitted from
  `CreateOperation` (set / rejected) and `SearchManager.constructQueryAsync` (filter applied). Log lines
  `binary_person_security_context_set` and `binary_person_security_context_rejected` remain.

### 16.1 OQ-2 verification (read paths that might skip the filter)

- `text/plain` Binary retrieval (`fhirResponseWriter.resolveDerivedTextAsync`) runs on the `resource` the
  read operation already returned (so already filtered), keyed by that resource's own id and
  `sourceAssigningAuthority`; it does not fetch by a caller-supplied reference. **Runs after the filter.**
- `$graph` and GraphQL resolve linked Binary through `constructQueryAsync` (per-request DataLoader only).
- **Resolved by B-7 (key includes the caller's person id, unconditionally, see §16.3).** Original risk: the `$everything` whole-response Redis cache
  (`EverythingHelper.getCacheKey`) is used only for callers with a person id, but its key is built from the
  resolved patient id (or the proxy person id) plus the scope, not the caller's person id. If two different
  persons link the same Patient and both call `$everything` on it with the same scope, a response cached for
  one could include a Binary owned by that person's proxy patient and be served to the other. (A Binary owned
  by the shared real patient is visible to both, so only proxy-owned member uploads are at risk.) Fix options:
  include the caller's person id in the key whenever the flag is on, or exclude Binary from cached
  `$everything` responses. Needs a decision before enabling the flag where Patients are shared between persons.

### 16.3 Read filter independent of the flag

> **Superseded by §0.2 in the stacked PR**: the read filter is now flag-gated and is the ordinary patient filter. The reasoning below is why the transitional model kept it un-gated, and it is the cost §0.2 consequence 1 accepts.

The read filter (`ScopesManager.isPersonContextReadFiltered`, used in `SearchManager.constructQueryAsync`) and the
`$everything` cache key's `callerPersonId` (`EverythingHelper.getCacheKey`) do not depend on
`ENABLE_PATIENT_SCOPED_BINARY_CREATE`. Reasons:

1. **Rollback safety.** Once member-owned Binary exist (`securityContext` = `Patient/person.{A}`), turning the flag
   off must not let member B's mixed token (`patient/*.* user/*.* access/*.*`) with a matching access tag read A's
   upload. If the filter were flag-gated, rollback would remove it.
2. **Per-deployment flag drift.** fhir-server runs as several deployments (fhir-server, -internal, -everything,
   -graphql). A deployment where the flag is unset would serve owned Binary unfiltered.

What stays flag-gated: the member create (`isPersonContextResourceScoped`, `isPatientScopedPersonContextCreate`,
create-time access-tag short-circuits) and strict read authorization (`isPersonContextStrictAccess`,
`ScopesValidator`), so with the flag off a pure patient token still gets 403 on Binary (T32). In the search path
a pure patient token that reaches `constructQueryAsync` anyway (e.g. internal fetches) is evaluated as mixed
(access-tag filter AND unowned-or-own), never more permissive than before. System/user tokens without a patient
scope are unchanged. Cost: one Person/link resolution per patient-scoped Binary read, with the flag off too. The
cache key shape changes once on deploy (one-time $everything cache miss, TTL default 300s). Test:
`binary_flag_rollback.test.js`.

### 16.2 R12: orphan Binary on retry

**Problem.** A client retry or re-upload of the same bytes creates a second `Binary` that no `DocumentReference`
points at.

**Findings (this branch).**
- `create.js:170` does `resource_incoming.id = generateUUID()`, discarding any client id. Intentional per
  FHIR R4 create semantics (the comment at `create.js:169` cites http.html#create: server assigns the id).
- No conditional create. `If-None-Exist` is not read by any route or middleware (grep of `src/routes`,
  `src/middleware`, `src/controllers` is empty). The only hits are the `Bundle.entry.request.ifNoneExist` data
  classes, and a bulk-import doc comment (`bulkImport/handler.js:232`). The capability template only declares
  `conditionalDelete: 'not-supported'` (`capability.template.js:23`).
- `Binary` has no search parameters (`searchParameters.js:662`, `Binary: {}`) and R4 `Binary` has no
  `identifier`, so there is no key a conditional search could match on. Only `_id` could, which defeats the point.
- Update (PUT), patch, delete and `$merge` of `Binary` are rejected for patient tokens by design (N1, §4.3,
  T5/T8 in §14); `scopesManager` short-circuits only `isCreate`.

**Options.**

| Option | Security impact | Invasiveness | Verdict |
| :- | :- | :- | :- |
| 0. Implement `If-None-Exist` for Binary | Would need the search filtered by the person `securityContext` filter, otherwise an existence oracle across members. Not verifiable today: no search param to match on | New feature across routes and create op, plus a new Binary search param (Binary is a pass-through resource) | Not recommended: large, and no key |
| a. PUT `/Binary/{client-uuid}` (update-as-create) | Opens update for patient tokens; ownership of a client-chosen id can be squatted or overwritten by another member unless create-vs-overwrite is guarded | Re-opens N1 and the update path | Rejected: widens the surface |
| b. `$merge` with client id | Same as (a); merge is deliberately untouched (§16) | Re-opens N1 | Rejected |
| c. Deterministic id = hash(person, content) | Hash oracle only if the hash is not salted by person; server-side id override breaks R4 create semantics and the `create.js:170` rule for all callers | Moderate: special case in `create.js`, collision handling needed | Not recommended |
| d. Writer-side dedupe and cleanup (health-data-service): reuse the Binary id for a retry of the same upload (idempotency key on its own side, written back once the `DocumentReference` exists) | None; no change here | None in fhir-server | **Recommended** |

**Decision.** No fhir-server change; no code or tests added. Any fix here either needs a conditional-create
feature plus a new Binary search parameter or reopens update/merge for patient scopes, both outside this PR's
create-only surface. Orphans that still occur are the R16 deletion-finder problem, explicitly out of scope.
If conditional create is wanted later, it should be its own design, with the person `securityContext` filter
applied to the conditional search and a cross-member test (B must not match A's Binary).

## 17. Backfill and rollout for the backfill-first model

The backfill runs as a notebook in [`icanbwell/bwell-data-ops-notebooks`](https://github.com/icanbwell/bwell-data-ops-notebooks), per Mintu's guidance, not as a fhir-server admin script. The closest precedent is `document_reference/fix_document_reference_binary_url.py` (DCON-5502), which reaches fhir-server only through the REST API and writes through `$merge`, so every change goes through the real merge path, with History and an AuditEvent. An earlier commit on this PR built the backfill as an admin runner (`src/admin/runners/`). It has been removed, so this PR only carries the fhir-server change. The ownership rules below still apply to the notebook. **Nothing has run against real data.** Sizes are estimates, not measurements.

### 17.1 Who owns an existing Binary

Existing Binary carry no owner. The only link from a Binary to a person is the `DocumentReference` whose
`content.attachment.url` points at it (the same link `$everything` follows, `nonClinicalResourceExtractor`), and that
DocumentReference has a `subject`.

| Case | Result | Notes |
|---|---|---|
| Exactly one DocumentReference points at the Binary and its subject is a Patient | `securityContext` = `Patient/<uuid>` (the subject's `https://www.icanbwell.com/uuid` extension, or its id when that is already a uuid) | the common case. A subject with no uuid is not touched (`subjectUuidMissing`) |
| Several DocumentReferences with the same subject | that subject | counted as `alreadyOwnedBySame` |
| Several DocumentReferences with **different** subjects | **error: not stamped; reported** (Imran, 2026-10-15) | the notebook does not guess. See 17.4 |
| A Patient subject plus a non-Patient or missing subject | **error: not stamped; reported** (Imran, 2026-10-15) | same rule as different subjects |
| No DocumentReference points at it | not touched | stays hidden from patient-scoped tokens; still readable by system/user tokens |
| The subject is not a Patient (Person, Group, none) | not touched | `skippedSubjectNotPatient` |
| `content.attachment.url` is not `Binary/{id}` (for example an http url) | ignored | same rule as `$everything` |
| Referenced from something other than a DocumentReference (for example `Communication.payload.contentReference`) | not touched | open question: does any member-facing flow depend on it? |

The Binary id is resolved exactly as `$everything` does it: a uuid id is used as is, and a non-uuid id becomes
`generateUUIDv5('{id}|{DocumentReference._sourceAssigningAuthority}')`. Pipelines that write Binary must stamp
`securityContext` at write time (same value rule) **before** the backfill finishes, or new Binary reopen the gap. Helix
and PROA use system tokens, so they are unaffected by the flag but not by this requirement.

### 17.2 The notebook ([bwell-data-ops-notebooks #108](https://github.com/icanbwell/bwell-data-ops-notebooks/pull/108), in review)

- **Modes:** `validate` (one known Binary), then `dry_run` (discovery and transform, no writes), then `run`, the same as DCON-5502. A report of counts and conflicts goes to S3.
- **Scan from DocumentReference, write to Binary.** Stream the DocumentReferences that reference a `Binary/`, resolve each Binary id as in 17.1, and write the subject's `Patient/<uuid>` into the Binary's `securityContext`. Only write where `securityContext` is missing.
- **Conflicts are found before any write.** A read-only pass groups the Binary uuids by their distinct subjects. A Binary with more than one subject is an error: it is reported and never stamped (17.6 Q5).
- **Write path: the default `$merge` (smartMerge on), sending only `resourceType`, `id`, `meta.source`, `meta.security` and `securityContext`. Never `smartMerge=false`, even though DCON-5502 uses it.**
  - With `smartMerge=false` the merge replaces the whole resource (`resourceMerger.js`, the `else` branch `mergedObject = deepcopy(resourceToMerge)`). A body without `data` therefore deletes the bytes, and for an offloaded Binary it also clears the externalized object (`base64DataManager.js`, the `!smartMerge` branch that calls `clearExternalizedLeaf`). `blobStorage.test.js` asserts this ("$merge (smartMerge:false) omitting data … data IS removed").
  - With smartMerge on, `data` is kept, and an offloaded Binary is not even downloaded (`base64DataManager.js`, the smartMerge branch that stashes the leaf as unchanged).
  - Each stamped Binary still gets a new `versionId`, a History entry and an AuditEvent.
  - DCON-5502 needed `smartMerge=false` because it had to remove array entries. Here we only add a field.
  - **Confirmed locally** against `main` with cloud storage on (S3 mocked, 2026-10-15): the default `$merge` with only `securityContext` keeps the bytes and the S3 object, and `smartMerge=false` without `data` wipes them. Still to confirm in a real environment with the notebook's `validate` mode.
- **Bounded concurrency and idempotent re-runs:** an already-stamped Binary is skipped.

### 17.3 Size

About 60M Binary (Mintu's figure); the number of DocumentReferences that point at them is unknown. If the job sustains
500 to 2,000 DocumentReferences per second, 60M is roughly 8 to 33 hours (60M / 2,000 = 8.3 h, 60M / 500 = 33 h). Measure
the real rate with a dry run on a production-sized copy first, then size `--batchSize` and `--sleepMs`.

### 17.4 Limits to know before running it

- **Conflicts:** a Binary referenced by DocumentReferences with different subjects is found by the read-only pass in 17.2, reported, and never stamped (17.6 Q5). Stamping the first owner found would silently take access away from the other subject.
- Shared access: a Binary owned by a real Patient becomes readable by every person linked to that Patient (same as the
  transitional model).
- A Binary that no DocumentReference points at gets no owner, so patient-scoped tokens cannot read it. Only
  system/user tokens can.
- No reconciliation query exists yet (owned + ambiguous + none = total); count `securityContext` presence directly.

### 17.5 Sequence

1. Ship #2643 with the flag off (reads and writes identical to `main`).
2. Pipelines start stamping `securityContext` at write time.
3. Build the partial index `securityContextUuid_uuid` (defined in `customIndexes.js`, partial on `securityContext._uuid`,
   so it indexes only owned Binary) online and off-peak, before enabling the flag.
4. Run the notebook's `validate` and `dry_run` in a lower environment: rate, how many would be stamped, Binary not found, conflicts.
5. Run it for real in a lower environment, then production (data-ops); reconcile counts.
6. Turn the flag on in a lower environment; walk DocumentReference to Binary through GraphQL and `$everything` as a
   member; then enable per environment, **all deployments at once** (§0.2 consequence 1).
7. Follow-up (DCON-6075): remove the flag and the create-only special cases that no longer need it, leaving
   `Binary: 'securityContext.reference'` in `patientFilterMapping`.

### 17.6 Open questions for Mintu and Imran

1. Is losing mixed-token reads of unowned Binary (clinical viewers) acceptable at flag-on, given the backfill leaves
   un-owned and conflicting Binary hidden?
2. Through `$merge`, each stamped Binary gets a new version, a History entry and an AuditEvent, as in DCON-5502. Is that acceptable for ~60M Binary, and who runs and approves it in production?
3. Which pipelines write Binary today besides helix and PROA, and can they stamp `securityContext` before the backfill ends?
4. Does anything other than a DocumentReference link a Binary to a patient in a member-facing flow?
5. A Binary referenced by DocumentReferences with different subjects: leave it unowned (hidden from patient-scoped tokens) and report it, or something else?
   **Answered (Imran, 2026-10-15): an error case, not stamped and reported.**
