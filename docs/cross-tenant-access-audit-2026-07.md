# Cross-Tenant / Cross-Client Data Access Audit — fhir-server

**Scope:** Adversarial review of `icanbwell/fhir-server` (this repo) at HEAD (`537691200`) for
issues where a service account belonging to one client/tenant, or a user account in one
client, could read, infer the existence of, or overwrite data belonging to another
client/tenant.

**Trigger:** Follows a confirmed production incident (INC-331) where `$everything` leaked
cross-tenant PROA/IAS patient data in Sandbox and Production, plus an internal cheatsheet
that flagged "cross-tenant Client Person access" and "cross-tenant subscription status" as
urgent open questions.

**Method:** Read the two incident documents and the internal "b.well Person-Patient Model"
Confluence page to establish the data model (Main Person → Client Person per tenant →
Patient per data source → clinical resources, all filtered by a `meta.security` "access"
tag matched against caller OAuth scopes like `access/<tenant>.*`). Dispatched five parallel
code audits (everything/proxy-patient, access-tag enforcement, service-account/IDOR, bulk
export/GraphQL/merge, caching/concurrency), then personally re-read and verified the
highest-severity claims (F1, F2, F3, F5) against the actual source before including them
below. Findings not personally re-verified are marked as such.

---

## Executive summary

The original INC-331 mechanism ($everything's chunked consent cache) **is fixed** in this
repo. However, the same architectural pattern — a per-request consent cache that must be
scoped per-batch, and query filters that must fail closed when they empty out — was applied
to `$everything` only. Adversarial review found **two newly-confirmed, currently-live gaps**
(access-history cross-tenant leak, and unprotected `access` tag on update/merge) that are
independent of INC-331 but equally serious, plus one **strong, twice-independently-found
candidate** for a second instance of the exact INC-331 bug class in the `$graph` operation
that needs a live test to confirm.

| # | Finding | Severity | Status |
|---|---|---|---|
| F1 | `$access-history` skips tenant check entirely for service accounts | **Critical** | Verified |
| F2 | Update/merge doesn't protect the `access` security tag → cross-tenant self re-tagging | **Critical** | Verified |
| F3 | Write-side tag check uses "any code matches" instead of "all codes authorized" | High | Verified (logic) |
| F4 | `$graph` reuses the pre-fix, unscoped consent cache from INC-331 | **Critical** | Reported by 2 independent audits — needs live test |
| F5 | `PUT` by-UUID existence oracle (403 vs. create-new) for any write-scoped caller | High | Verified |
| F6 | `_uuid` is a deterministic, publicly-computable hash, not a secret | Medium | Verified |
| F7 | `$export/:id` fetches ExportStatus with no tenant filter | High | Reported, not independently re-verified |
| F8 | "Cross-tenant subscription status" leak — not located in this repo | Unclear | Needs escalation |
| F9 | INC-331 root cause ($everything consent cache) | — | **Fixed**, verified |
| F10 | Person `$everything` sibling-record fix bypassable via proxy-patient URL form | Low | Verified via 2 audits + docs |
| F11 | Scope-prefix parsing (`startsWith('access')` vs `'access/'`) | Low | Verified (latent) |
| F12 | 138 IoC services are process-wide singletons with no guardrail against re-introducing the INC-331 cache-key bug class | Low (architectural) | Verified |

Areas that were specifically hunted for problems and found **correctly enforced**: plain
search, search-by-id, history, patch, remove (all route through the same
`SearchManager.constructQueryAsync` + `SecurityTagManager` tag filter and correctly 404
cross-tenant resources at the query level); bulk export's core tenant scoping; GraphQL v1
and v2 (no parallel/unpatched "everything"-style resolver — they reuse the same
`SearchBundleOperation` as REST); the Redis-backed `$everything`/Summary response caches;
and `RequestSpecificCache`/cursor/connection-pooling code (no cross-request state bleed
found).

---

## Critical findings

### F1 — `$access-history` operation leaks cross-tenant metadata to service accounts
**Files:** `src/operations/accessHistory/accessHistory.js:56-107` (missing gate),
`:171-198` (`_getEntityRefsForResourceType`, unscoped query),
`:369-391` (`_findResourcesByUuids`, unscoped query),
`src/utils/personToPatientIdsExpander.js:213-244` (Person resolution has no access check
outside the `$everything` GET path)

**Verified by direct read.** `accessHistoryAsync` calls `scopesValidator.verifyHasValidScopesAsync`
for `resourceType` and `AuditEvent` — this only confirms the caller holds *some*
`<ResourceType>.read` scope, not that the scope covers *this specific* Person's tenant. The
only instance-level ownership check in the whole method is:

```js
if (requestInfo.isUser &&
    resolvedPersonUuid !== requestInfo.personIdFromJwtToken &&
    resolvedPersonUuid !== requestInfo.masterPersonIdFromJwtToken) {
    throw new ForbiddenError('Access denied: you can only view access history for your own Person resource');
}
```

`requestInfo.isUser` is only `true` for patient-scoped end-user tokens. Any client-credential
/ service-account token (`access/<tenant>.* user/*.read`) has `isUser === false`, so this
entire block is skipped. Execution then proceeds to `_collectEntityRefs`, which resolves the
target Person to patient UUIDs via `personToPatientIdsExpander.getPatientProxyIdsAsync` —
and that expander only applies an access-tag check on the Person when the request URL
contains `$everything` **and** the method is GET (see F9/F10 background) — neither is true
here (`$access-history`), so the Person resolution itself is unchecked. It then queries
every patient-linked resource type directly:

```js
const cursor = await dqm.findAsync({
    query: { [uuidField]: { $in: patientRefs } },   // no meta.security / access-tag filter
    options: { projection: { _uuid: 1 } }
});
```

**Attack scenario:** A service account scoped `access/citizen-health.* user/*.read` calls
`GET /4_0_0/Person/<mutual-of-omaha-person-uuid>/$access-history` and receives that person's
full access-history summary — accessor identities/organizations, per-resource-type access
counts, purposes of use, and timestamps — despite having no scope for `mutual-of-omaha` at
all. This is exactly the class of bug the incident cheatsheet's item 2 ("service account for
1 tenant + client person from another tenant should return no data / 404") calls out, on a
different endpoint than the one already fixed.

**Recommendation:** Gate on tenant/access-scope match unconditionally (not `isUser &&`), and
add a `meta.security`/access-tag filter to every query in `_collectEntityRefs` /
`_findResourcesByUuids`, matching the pattern used by `SecurityTagManager` elsewhere.

---

### F2 — Update/merge does not protect the `access` security tag, enabling cross-tenant self re-tagging
**Files:** `src/operations/update/update.js:328-333` (checks *old* resource only),
`:412-425` (persists merged doc with no re-check),
`src/operations/common/resourceMerger.js:134-154` (`overWriteNonWritableFields`)

**Verified by direct read.** For an existing resource, `update.js` validates write access
using only the resource **as currently stored**:

```js
await this.scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes({
    requestInfo, resource: foundResource, base_version
});
...
({ updatedResource, patches } = await this.resourceMerger.mergeResourceAsync({
    ..., currentResource: foundResource, resourceToMerge: resource_incoming, smartMerge: false, ...
}));
doc = updatedResource;
...
await this.databaseBulkInserter.replaceOneAsync({ ..., doc, ... });  // no re-check on `doc`
```

`overWriteNonWritableFields` in `resourceMerger.js` forces the merged document back to the
*current* resource's values for `id`, `meta.versionId`, `meta.lastUpdated`, `meta.source`,
and the `sourceAssigningAuthority`/`owner` security-tag systems — but conspicuously **not**
the `access` system, which is the one every read-side tenant filter
(`SecurityTagManager.getQueryWithSecurityTags`) actually matches on. There is no second
access check after the merge and before `replaceOneAsync` persists it.

**Attack scenario:** A caller with legitimate write access to their own tenant's resource
(`access/clientA.*`) sends `PUT /Observation/<id>` (or the equivalent `$merge`) for a
resource they own, but sets `meta.security` in the body to
`[{system: access, code: 'clientB'}]`. The pre-merge check passes (they own the resource
today, under `clientA`); the merge keeps the client-submitted `access` tag verbatim; the
resource is persisted re-tagged to `clientB` — it silently disappears from `clientA`'s view
and becomes visible under `clientB`'s tenant scope in every subsequent search, `$everything`,
export, or GraphQL query. This is a write-side vector for both exfiltration (move data into
a tenant you control) and sabotage (make another tenant's resource vanish from their own
view, if F3 also lets you target an existing cross-tenant id).

**Recommendation:** Add the `access` system to the protected-fields list in
`overWriteNonWritableFields` (require an explicit, separately-authorized re-tagging
operation instead), and/or re-run `isAccessToResourceAllowedByAccessAndPatientScopes`
against the *post-merge* document before `replaceOneAsync`.

---

### F3 — Write-side security-tag check accepts a resource if *any* one tag matches, not *all*
**File:** `src/operations/security/scopesManager.js:85-118` (`doesResourceHaveAnyAccessCodeFromThisList`)

**Verified by direct read.**

```js
const hasAccessCode = accessCodes.some(c => accessCodesFromAccessTag.includes(c));
return hasOwnerCode && hasAccessCode;
```

This "any of the resource's access codes overlaps any of my authorized codes" logic is
correct for **read** authorization (a resource legitimately shared across multiple tenants
should be visible to any one of them). It is reused for **write** authorization too
(`isAccessToResourceAllowedByAccessScopes(..., accessRequested: 'write')`), where the
correct rule should instead be "*every* access code on the resource must be one I'm
authorized for" — otherwise a caller can tag a resource with both their own legitimate code
and an additional, unauthorized tenant's code, and the check still passes because one match
is enough.

**Attack scenario:** Combined with F2 (or on initial create), a `clientA`-scoped caller
submits a resource with `meta.security: [{access, clientA}, {access, clientB}]`. The write
check passes (overlap on `clientA`), and the resource is persisted visible to **both**
tenants — `clientB` now has access to data it never should have, granted unilaterally by a
`clientA` caller with no `clientB` scope at all.

**Recommendation:** For write authorization specifically, require
`accessCodesFromAccessTag.every(c => accessCodes.includes(c))` (or an explicit "wildcard"
exception only for genuinely privileged admin scopes).

---

### F4 — `$graph` likely reuses the pre-fix, insufficiently-keyed consent cache from INC-331
**Files:** `src/operations/graph/graphHelpers.js` (`constructQueryAsync` call sites around
lines 351, 636, 1425; chunking around line 1734), vs. the fix pattern in
`src/operations/everything/everythingHelper.js:452-498` and
`src/operations/search/dataSharingManager.js:107-110`

**Reported independently by two separate audit passes; not personally re-verified line by
line — recommend a live/integration test before treating as fully confirmed.**

INC-331's root cause was `dataSharingManager`'s per-request consent cache
(`allowedPatientIds`, `patientIdToImmediatePersonUuid`) being keyed only by `requestId`,
while `$everything` internally processes multiple different id-batches (each needing its own
consent computation) under that one `requestId`. The fix threads an `everythingChunkIndex`
through every `constructQueryAsync` call in `everythingHelper.js` so each batch gets an
isolated cache bucket (`dataSharingManager_<N>`).

`$graph` (the GraphDefinition-traversal operation) also batches its starting ids
(`graphBatchSize`, default 10 — the same order of magnitude that triggered INC-331) and also
calls `searchManager.constructQueryAsync(...)` with `requestId` — but, per both audits,
never passes an equivalent chunk/step index. If accurate, every batch and every nested
link-traversal step within one `$graph` request shares a single undifferentiated
`dataSharingManager` cache, reproducing the exact bug class that caused the original PHI
leak, on a code path neither incident-fix commit (`692e025d9`, `537691200`) touched.

**Recommended next step:** Build an integration test — a `$graph` request with more starting
ids than `graphBatchSize`, spanning two Persons that share an underlying Patient, with
`ENABLE_HIE_TREATMENT_RELATED_DATA_ACCESS`/consented-PROA access on — to determine whether
it fails closed (denial, safe) or actually cross-contaminates one batch's consent scope into
another's data. If confirmed, the fix is mechanical: thread a chunk index into `$graph`'s
`constructQueryAsync` calls the same way `everythingHelper.js` already does.

---

## High-severity findings

### F5 — `PUT` by-UUID lookup has no tenant filter at the query level → cross-tenant existence oracle
**File:** `src/operations/update/update.js:222-224` (unscoped query), `:328-333` (post-fetch
check), `:426-432` (create-new branch)

**Verified by direct read.**

```js
if (isUuid(rawId)) {
    query = { _uuid: rawId };          // <- no meta.security / tenant filter, unlike search/patch/remove
} else {
    ({ query } = await this.searchManager.constructQueryAsync({ ... accessRequested: 'write' }));
}
```

Every other by-id path (`searchById.js`, `patch.js`, `remove.js`, `searchByVersionId.js`)
builds its query through `constructQueryAsync`, which ANDs a `meta.security` tenant filter in
*before* the database is queried, so a cross-tenant resource never matches and a plain 404 is
returned. `update.js`'s UUID branch is the one path that fetches the resource **first**,
unscoped, and only checks tenant access *afterward*
(`isAccessToResourceAllowedByAccessAndPatientScopes`, which does correctly throw a 403 for a
cross-tenant resource — so the resource body itself is not returned).

**Attack scenario:** the difference between the two possible outcomes is itself the leak: a
write-scoped caller who `PUT`s a UUID that belongs to another tenant gets a **403** ("no
write access to resource ... with id ..."), while `PUT`ing a UUID that doesn't exist anywhere
falls through to the create-new branch and gets a **200/201**. This 403-vs-201 split lets any
write-scoped service account confirm, with certainty, "a record with this exact UUID exists
and belongs to someone else" — without ever seeing its contents. This is precisely the
"Person IDs are not leaking PII/PHI" concern called out in the incident cheatsheet, just via
a different mechanism (HTTP status code, not response body).

**Recommendation:** Build `update.js`'s UUID-branch query the same way `patch.js`/`remove.js`
do — AND in the tenant/access filter — so a cross-tenant UUID simply misses in the initial
`find` and falls through to the ordinary not-found/create path, indistinguishable from an
id that doesn't exist at all.

---

### F6 — `_uuid` is a deterministic, publicly computable hash, not a secret
**Files:** `src/utils/uid.util.js` (`generateUUIDv5`, fixed `OID_NAMESPACE` constant),
`src/preSaveHandlers/handlers/uuidColumnHandler.js:30`
(`generateUUIDv5(\`${resource.id}|${sourceAssigningAuthority}\`)`)

**Verified by direct read.** The internal `_uuid` — the field every access-tag filter and
by-id query keys off — is a UUIDv5 (name-based, deterministic) hash of the source-system id
and owning tenant slug, computed with a hardcoded namespace constant that is visible in this
open-source repo. Anyone who knows or can guess a target's source-system id (member ID, MRN,
etc.) and owning tenant slug can **compute** the exact `_uuid` offline — no enumeration
against the live server required.

This doesn't by itself defeat any of the correctly-filtered read paths, but it converts F5's
existence oracle from "attacker needs to already know/leak a UUID" into "attacker can target
any specific, named individual at a known tenant with zero prior data exposure." It also
means `_uuid`/`id` must never be treated as an unguessable capability token by any future
code (see F1, F7 — both are cases of "fetch by raw uuid with no further check").

**Recommendation:** Document that `_uuid`/`id` are not secrets and must never be the sole
authorization factor; treat F5 as higher-priority given this.

---

### F7 — `$export/:id` (exportById) fetches ExportStatus with no tenant filter (not independently re-verified)
**File reported:** `src/operations/export/exportById.js`, `src/dataLayer/databaseExportManager.js`
(`getExportStatusResourceWithId` — reported as a raw `findOneAsync` by `_uuid`/`_sourceId`
with no `meta.security` filter, unlike the standard `GET /ExportStatus/{id}` path).

**Status: reported by one audit pass, not personally re-verified against source — recommend
confirming before acting, but flagging given it matches the same "raw uuid lookup, no tenant
filter" pattern independently confirmed in F1 and F5.**

If accurate: any caller with generic export-capable scopes who learns or guesses another
tenant's `ExportStatus` UUID (e.g. via logs, shared tooling, or a Kafka export-completion
event) could fetch that job's metadata — request URL/params (which may embed patient
identifiers), calling user, scope, error details, and S3 output paths.

**Recommendation:** Verify `getExportStatusResourceWithId`'s query independently; if
unscoped, route it through the same `SecurityTagManager`-filtered query used by the standard
`ExportStatus` search/read path.

---

## Needs escalation (not a code finding)

### F8 — "Cross-tenant subscription status" leak referenced in the incident cheatsheet was not located in this repo
The incident cheatsheet flags "Cross tenant information (subscription status)" as the single
most urgent item, needing an answer for a 9:30am customer call. The only "subscription"
concept found in this codebase is the standard FHIR `Subscription`/`SubscriptionStatus`/
`SubscriptionTopic` resource family (internal event-notification plumbing), which appears to
go through the same generically-enforced search/read path as any other resource (and is
additionally scoped in `$everything` by the same-day fix, commit `692e025d9`). No
insurance/member "subscription/eligibility status" data model or endpoint was found in this
repo. **This item cannot be cleared or confirmed by this audit** — recommend confirming with
whoever raised it whether it refers to the FHIR `SubscriptionStatus` resource here, or to a
concept living in a separate microservice outside this repo, and running a live cross-tenant
test either way.

### Gecko Security scan follow-up
The incident cheatsheet also references a Gecko Security scan with "2 Critical and others"
already-flagged vulnerabilities (`app.gecko.security/repo/.../vulnerabilities`). This audit
did not have access to that tool and could not cross-reference its findings against the ones
above — recommend pulling that report directly and deduplicating against this document.

---

## Lower-severity / hardening notes

### F9 — INC-331 root cause is fixed (informational)
**Verified independently by two audit passes reading current code.** Both halves of the
original mechanism are closed as of `87649ed78` (DCON-4598): (1) the consent cache is now
keyed by `requestId` **and** `everythingChunkIndex`, so sequential `$everything` batches no
longer share stale consent data; (2) `getConnectionTypeFilteredQuery` now returns `null`
(zero results) instead of an unscoped query whenever a patient filter empties out. See F4 for
why the same fix does not appear to extend to `$graph`.

### F10 — Person `$everything` sibling-record fix is bypassable via the proxy-patient URL form
**File:** `readme/personEverything.md:97`, `src/operations/fhirOperationsManager.js:283-296`
Commit `537691200` (same-day fix, "DCON-4696") stops `Person/<id>/$everything` from returning
*other* Person/Subscription records that share an underlying Patient — but the restriction
is gated on `resourceType === 'Person'`, i.e. only triggers for the `Person/<id>/$everything`
URL form. Calling the semantically equivalent `Patient/person.<id>/$everything` proxy form
bypasses it (documented in `personEverything.md`). Since sibling Person records under a
shared Patient can belong to different tenants, this re-opens the same minimization gap via
an alternate URL. Recommend applying the same `scopedPersonIds` restriction regardless of
which URL form was used to reach the underlying logic.

### F11 — Scope-prefix parsing is loose (`startsWith('access')` vs `'access/'`)
**File:** `src/operations/security/scopesManager.js:64`
`getAccessCodesFromScopes` checks `scope1.startsWith('access')` rather than `'access/'`,
meaning a hypothetical future scope token beginning with the bare substring `access` (no
slash) would be mis-parsed into a tenant code. No current IdP scope was found to collide with
this, so it's latent, not exploitable today. Recommend tightening to `'access/'` as
defense-in-depth against future scope-naming changes.

### F12 — No structural guardrail against reintroducing the INC-331 cache-key bug class
**Files:** `src/createContainer.js` (~138 `register()` calls), `src/utils/simpleContainer.js`
Every service in the IoC container is a lazily-memoized, process-wide singleton shared across
all concurrent requests. Today, per-request state is correctly externalized into
`RequestSpecificCache` (keyed by `requestId`) everywhere checked — no singleton was found
caching request-derived data on `this.*`. But nothing (lint rule, base-class contract, test)
would catch a future change that did so, which is exactly the bug class that caused INC-331.
Recommend a review checklist item or lint rule flagging any singleton service method that
assigns request-derived values to instance fields.

---

## Recommended priority order

1. **F1** and **F2** — both are live, confirmed, currently-exploitable cross-tenant
   confidentiality/integrity breaks with no dependency on any other finding.
2. **F4** — build the live test immediately; if confirmed, this is a second $everything-class
   PHI leak on an unpatched surface.
3. **F3** and **F5** — close together, since F3 is what makes F2 able to *grant* access to an
   arbitrary tenant (not just move data between two tenants you already touch), and F5 is a
   confidentiality leak in its own right.
4. **F7** — verify against source; if confirmed, low effort to fix (route through the
   existing filtered query builder).
5. **F8** — escalate for clarification; cannot be resolved from this repo alone.
6. **F10, F11, F12** — lower urgency; address as hardening/tech-debt alongside the above.
