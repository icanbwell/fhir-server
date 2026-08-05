# Resource Authorization: How a Resource Gets Returned From a Query

This catalogs every distinct mechanism in this codebase that can affect whether a given FHIR
resource is included in the response to a search, read, `$everything`, `$graph`, or GraphQL
query. It is a map of *how*, in code, not a specification of *how it should behave* — for the
authoritative, living specification of intended behavior (including current known gaps and open
questions), see:

- [FHIR Server Security & Data Model Specification](https://icanbwell.atlassian.net/wiki/spaces/ENTARCH/pages/6582730753) (ENTARCH Confluence)
- [Plain-Language Companion](https://icanbwell.atlassian.net/wiki/spaces/ENTARCH/pages/6580764702) to the above

Before reviewing or modifying any code in this area, read `review.md` at the repo root — it's a
standing adversarial-review checklist for this exact surface (see `CLAUDE.md`).

## Mental model

A resource is returned to a caller only if it passes **every** gate below that applies to that
caller/request. Most gates are compiled into the MongoDB query itself (so a resource that fails
never leaves the database); a few are applied to already-fetched resources
(enrichment-time filtering). None of them are optional add-ons — a request that skips one because
it followed an unusual code path (a different traversal operation, a different resource type, a
raw id lookup) is a tenant-isolation bug, not a feature gap.

Request flow: `FhirRouter` → an Operation class (`operations/search/searchBundle.js`,
`searchById.js`, `everything/everythingHelper.js`, `graph/graphHelpers.js`, GraphQLv2
`graphqlv2/dataSource.js`, …) → `ScopesValidator.verifyHasValidScopesAsync` (scope gate, run
before any query is built) → `SearchManager.constructQueryAsync` (`src/operations/search/searchManager.js`
— the central point where nearly all of the mechanisms below get ANDed onto the query) →
`queryRewriterManager` → `DataLayer` → MongoDB.

---

## 1. Access tags (`meta.security`, system `.../access`)

The primary tenant-visibility control. One or more per resource; declares which tenant(s) may
read it. A resource with multiple access tags is visible to *any* tenant whose scope matches *at
least one* of them (shared-visibility, not exclusive-ownership).

```json
"meta": {
  "security": [
    { "system": "https://www.icanbwell.com/owner",  "code": "myhealth" },
    { "system": "https://www.icanbwell.com/access", "code": "myhealth" },
    { "system": "https://www.icanbwell.com/access", "code": "yourhealth" }
  ]
}
```

- `ScopesManager.getAccessCodesFromScopes` (`src/operations/security/scopesManager.js`) parses
  `access/<tag>.<read|write|*>` scopes into the caller's authorized access codes.
- `SecurityTagManager.getSecurityTagsFromScope` / `getQueryWithSecurityTags`
  (`src/operations/common/securityTagManager.js`) turns those codes into the actual Mongo filter
  ANDed onto every query — either a `meta.security` `$elemMatch` scan, or a denormalized
  `_access.<code>: 1` field lookup when an access index exists for that collection
  (`src/operations/common/accessIndexManager.js`, `src/indexes/indexProvider.js`).
- The `_security=https://www.icanbwell.com/access|<code>` search parameter goes through a
  separate but related path: `src/operations/query/filters/securityTag.js`
  (`FilterBySecurityTag`) — this is the caller *searching by* tag, which happens to reuse the same
  access-index field as the *authorization* filter above.

See `readme/security.md` §5.2 for the user-facing description.

## 2. Owner tags (`meta.security`, system `.../owner`)

Exactly one per resource; declares the single authoritative tenant. Unlike access tags, the owner
tag is **not** part of the bulk search-query filter — it's used in narrower checks:

- Single-resource checks like `ScopesManager.doesResourceHaveAnyAccessCodeFromThisList`
  (`scopesManager.js`) require the caller to match *both* an owner tag and an access tag.
- Consent lookups can additionally scope by owner tag (e.g. `CmsConsentManager.getConsentResources`
  takes an `ownerTags` filter, `src/operations/search/cmsConsentManager.js`).
- On write, `ScopesManager.isAccessTagChangeAllowedByScopes` /
  `ScopesValidator.isAccessTagChangeAllowedByAccessScopes` (`scopesValidator.js`) stop a caller
  from adding an access tag for a tenant it isn't itself authorized for.

## 3. Scopes (SMART on FHIR)

Four scope namespaces, all validated before any query is built:

| Scope | Form | Controls |
|---|---|---|
| `user` | `user/<resourceType\|*>.<read\|write\|*>` | which resource types the caller may read/write |
| `access` | `access/<tag\|*>.*` | which access-tagged resources the caller may see (§1) |
| `patient` | `patient/<resourceType\|*>.<read\|write>` | patient-scoped access via the identity graph (§5) |
| `admin` | `admin/*.*` | admin routes and debug/explain query params — **not** a tenant-filter bypass (see §7) |

- `ScopesManager` (`src/operations/security/scopesManager.js`): `parseScopes`,
  `getAccessCodesFromScopes`, `getUserScopes`, `getPatientScopes`, `getAdminScopes`,
  `hasPatientScope`.
- `ScopesValidator.verifyHasValidScopesAsync` (`src/operations/security/scopesValidator.js`), using
  `@asymmetrik/sof-scope-checker`, is called at the top of every read operation
  (`searchBundle.js`, `searchStreaming.js`, `searchById.js`, `history.js`, `everything.js`,
  `graph.js`, `summary.js`) before query construction — a request with an insufficient `user`
  scope for the resource type never reaches the query-building stage at all.

See `readme/security.md` for the full walkthrough and multi-scope examples.

## 4. Caller / account type

The server doesn't just check scopes — *what kind of caller* holds them changes which of the
mechanisms below apply:

- **Service account** (OAuth client-credentials grant) and **admin/tester user account**
  (username+password grant) are authorization-equivalent: both get `user`/`access`/`admin` scopes
  and are filtered purely by §1–§3.
- **Person/Patient (end-user) auth** carries a `patient/` scope and is distinguished at the single
  line `const isUser = scopes.some(s => s.toLowerCase().startsWith('patient/'))`
  (`src/strategies/authService.js`). `isUser` is threaded onto `FhirRequestInfo` and changes which
  branch of `SearchManager.constructQueryAsync` builds the query — the patient-scope path (§5),
  not the tenant/access-tag path (§1) — for that request.
- **Delegated actor** (`userType: 'delegatedUser'`) — a `RelatedPerson`/similar acting on behalf of
  a Person via the JWT `act` claim. Gets consent-gated, read-only access with sensitive-category
  filtering. See §6c and `readme/delegatedActorAccess.md`.
- **CMS partner user** (`userType: 'cms-partner'`) — restricted to `Patient` search/`$everything`
  over GET only, with a `purposeOfUse` claim check, and further restricted to patients the partner
  has consent for (§6b). `src/utils/cmsManager.js` (`CMSManager.verifyAccess`).

`userType` is set in `AuthService.processUserInfo` (`authService.js`) from the JWT's `act` claim or
an allow-listed `user_type` claim.

## 5. Patient-scoped tokens, proxy-patient, and Person/Patient link expansion

When a caller holds a `patient/` scope (§3/§4), access is **not** decided by access tags at all —
it's decided by reachability through that caller's own Person/Patient identity graph. This is a
separate, mutually exclusive branch from §1 in `SearchManager.constructQueryAsync`.

- `PatientScopeManager.getPatientIdsFromScopeAsync` (`src/operations/security/patientScopeManager.js`)
  resolves the JWT's person id into the proxy-patient id (`person.<uuid>`) plus every linked
  `Patient` id, via `PersonToPatientIdsExpander.getPatientIdsFromPersonAsync`
  (`src/utils/personToPatientIdsExpander.js`) — the code that walks `Person.link`.
- `PatientQueryCreator.getQueryWithPatientFilter` (`src/operations/common/patientQueryCreator.js`)
  turns the resolved id set into the actual Mongo restriction, using the per-resource-type
  reference path in `patientFilterManager.js` (`patientFilterMapping`).
- The **proxy-patient** convention (`Patient/person.<uuid>` in a search parameter, e.g.
  `?subject=Patient/person.<id>`) is expanded the same way by
  `PatientProxyQueryRewriter.rewriteArgsAsync` (`src/queryRewriters/rewriters/patientProxyQueryRewriter.js`).
  See `readme/proxyPatient.md`.
- `$everything` (`everything/everythingHelper.js`) and `$graph` (`graph/graphHelpers.js`) both
  re-invoke `SearchManager.constructQueryAsync` at **every traversal hop**, so a resource reached
  via link-following gets the same filter a direct search would apply — not a weaker one. GraphQLv2
  (`src/graphqlv2/dataSource.js`) funnels through the same `searchBundleAsync` path rather than an
  independent query builder.
- **Person `$everything`** narrows the *result set* (not the underlying access check) to only the
  explicitly-requested Person id(s) — a sibling Person sharing the same underlying Patient is
  resolved internally but excluded from the response. See `readme/personEverything.md`.

## 6. Consent

There is no single "consent system" — four independent mechanisms use `Consent` resources to gate
or expand what's returned, each with its own category code and its own code path:

**a. PROA/IAS data-sharing consent** — gated by `ConfigManager.enableConsentedProaDataAccess`
(env `ENABLE_CONSENTED_PROA_DATA_ACCESS`) and a parallel `enableHIETreatmentRelatedDataAccess`
flag. `DataSharingManager.updateQueryConsideringDataSharing`
(`src/operations/search/dataSharingManager.js`) uses `ProaConsentManager.getConsentResources`
(`src/operations/search/proaConsentManager.js`) to find active, `permit`-type Consents and OR's a
connection-type-filtered query branch onto the search.

**b. CMS partner data-sharing consent** — for `userType: 'cms-partner'` callers only (§4).
`DataSharingManager.updateQueryConsideringCmsDataSharing` uses
`CmsConsentManager.getPatientIdsWithConsent` (`src/operations/search/cmsConsentManager.js`) to
restrict `Patient` search to consented patient uuids; fails closed (matches nothing) if no consent
is found.

**c. Delegated-actor consent** — for `userType: 'delegatedUser'` callers (§4). Looks up a single
active Consent tying the grantor Person to the grantee actor, then builds a denied-sensitive-category
list from the Consent's nested `deny` provisions (`src/utils/delegatedAccessRulesManager.js`).
Resources tagged `unclassified` (§8) are *always* excluded for delegated users regardless of the
Consent. Delegated users are further restricted to read-only operations
(`OperationAccessManager` → `DelegatedAccessManager`). Full detail: `readme/delegatedActorAccess.md`.

**d. Patient Data View Control consent** — lets a patient exclude specific resources from their
own `$everything`/GraphQLv2 result via a `dataConnectionViewControl`-category Consent referencing
the resource(s) to hide. `src/utils/patientDataViewController.js`
(`PatientDataViewControlManager.getConsentAsync`), gated by
`configManager.clientsWithDataConnectionViewControl`. Full detail:
`readme/patientDataViewControl.md`.

## 7. Admin scope and the wildcard bypass

There is no dedicated "admin bypass" for tenant filtering. What actually removes the §1 filter is
the **wildcard access code**, granted by a scope like `access/*.read` or `access/*.*`: when
`ScopesManager.getAccessCodesFromScopes` returns `['*']`,
`SecurityTagManager.getSecurityTagsFromScope` returns an empty tag list, which means *no*
`meta.security` filter is ANDed onto the query at all — every tenant's resources become visible.

The literal `admin/` scope namespace is a **different, narrower** mechanism
(`ScopesManager.getAdminScopes`, `ScopesValidator.isAdminScope`): it gates admin-panel routes and
unlocks debug/explain query parameters (`_explain`, `_debug`, `_setIndexHint`). Holding `admin/*.*`
does not, by itself, bypass access-tag filtering — that only happens if the caller *also* has the
`access/*` wildcard.

## 8. Tag-based filters independent of the tenant/consent model

These apply regardless of scope type, on top of everything above:

- **`hidden` tag** (`meta.tag`, system `.../CodeSystem/server-behavior`, code `hidden`) — excluded
  from every search by default (`src/operations/query/r4.js`), unless the caller passes
  `_includeHidden=true`. Does not apply to by-id lookups, history, `DELETE`, or `AuditEvent`.
- **Confidentiality restriction tag** (`meta.security`, system
  `http://terminology.hl7.org/CodeSystem/v3-Confidentiality`, code `R`) — blocks access for
  patient-scoped (`isUser`) callers specifically, regardless of what the patient-scope identity
  graph would otherwise allow. `ScopesValidator.isAccessToResourceRestrictedForPatientScope`
  (`scopesValidator.js`); also consulted in `patientQueryCreator.js`.
- **`unclassified` sensitivity tag** (`meta.security`, system `.../sensitivity-category`) —
  auto-added on write for resource types listed in `UNCLASSIFIED_TAGGING_RESOURCES`; always
  excluded for delegated-actor callers (§6c) regardless of their Consent. See
  `readme/unclassifiedDataTagging.md`.
- **Connection-type tag** (`.../connectionType`) — used by
  `DataSharingManager.getConnectionTypeFilteredQuery` to restrict consent/HIE-driven query
  branches (§6a) to an allow-listed set of connection types.

## 9. How these compose

For a given caller and resource, the resource is returned only if **all** of the following hold:

1. The caller's `user`/`patient` scope permits the resource type and operation (§3).
2. Either: the caller holds the wildcard access code (§7), **or** the resource carries an access
   tag the caller is authorized for (§1), **or** the caller is patient-scoped and the resource is
   reachable through that caller's own identity graph (§5).
3. The resource is not `hidden`-tagged, unless explicitly requested (§8).
4. If the caller is patient-scoped, the resource is not confidentiality-`R`-restricted (§8).
5. If the caller is a delegated actor or CMS partner, the resource passes that caller type's
   consent-driven filter and is not `unclassified` for delegated actors (§6b, §6c).
6. If the requesting client relies on consent-based data-sharing expansion (§6a) or the patient
   has an active data-view-control exclusion (§6d), those results are included/excluded
   accordingly.

Any code path that reaches the database without going through `SearchManager.constructQueryAsync`
— or that fetches by raw id/uuid and defers the access check to after the fetch — is a
red flag under `review.md`'s checklist, since `_uuid`/`id` are deterministic and not secret
(`src/utils/uid.util.js`, see `readme/security.md` §5.3.1).

## Further reading

- `review.md` — adversarial PR-review checklist for this exact surface
- `readme/security.md` — auth/authz walkthrough with worked scope examples
- `readme/proxyPatient.md`, `readme/everything.md`, `readme/patientEverything.md`,
  `readme/personEverything.md`, `readme/graph.md` — traversal/expansion operations
- `readme/delegatedActorAccess.md`, `readme/patientDataViewControl.md`,
  `readme/unclassifiedDataTagging.md` — consent- and tag-driven filtering
- [FHIR Server Security & Data Model Specification](https://icanbwell.atlassian.net/wiki/spaces/ENTARCH/pages/6582730753) —
  canonical rule-by-rule spec of intended behavior, with current implementation status
