# SMART v2 Fine-Grained Scope Support (`.cruds`) — Design

## Background

Per the SMART App Launch "Scopes and Launch Context" spec
(https://build.fhir.org/ig/HL7/smart-app-launch/scopes-and-launch-context.html), v2 scopes replace
the coarse v1 `read`/`write`/`*` suffix with a combination of the letters `c` (create), `r` (read/
vread), `u` (update/patch), `d` (delete), and `s` (search-type/system-level history), e.g.
`patient/Observation.rs` or `user/*.cruds`. Before this work the server only understood v1 grammar.

The spec constrains the suffix to an **in-order** subsequence of the literal string `cruds` —
`.rs` is valid, `.sr` is not — and explicitly permits (without requiring) a server to reject
out-of-order or undefined interactions: *"Scope requests with undefined or out of order
interactions MAY be ignored, replaced with server default scopes, or rejected."* This design
rejects them (see Backward compatibility rule below) rather than silently reordering or ignoring
them, since a silent reorder risks granting more than the caller asked for.

Before this work the enforcement path was strictly binary:

- `src/operations/security/scopesManager.js`'s `parseScopes` just splits the scope string on
  spaces — a "parsed scope" is the raw string. `getAccessCodesFromScopes(action, ...)` (only
  inspects `access/` scopes), `getAdminScopes`/`hasAdminScopeForAction` (`admin/`), and
  `getPatientScopes`/`getUserScopes` (pure prefix filters, no suffix parsing) all reduce every
  check to `accessType === '*' || accessType === action` where `action` is always the literal
  `'read'` or `'write'`.
- `src/operations/security/scopesValidator.js`'s `isScopesValidAsync` types `accessRequested` as
  `"read"|"write"` only and delegates the actual match to `@asymmetrik/sof-scope-checker`, an
  external library that only understands v1 grammar and throws on any other action string.
- Every call site across `src/operations/**` (`create.js`, `update.js`, `patch.js`, `remove.js`,
  `searchById.js`, `searchByVersionId.js`, `history.js`, `searchBundle.js`, `everything.js`, etc.)
  already knew its specific FHIR interaction and threaded it through as an `action` parameter to
  `verifyHasValidScopesAsync`/`hasValidScopesAsync` — but that value was used **only for
  logging**, never for the scope decision. The binary `accessRequested` passed alongside it was
  hardcoded per call site.

That was the lever for v2 support. Every call site now passes its own CRUDS letter as
`accessRequested`, and `action` is still used for logging only.

Throughout this document, "resource gate" means the `patient/` vs (`user/` ∪ `system/`) check for
whether a caller may touch a given resourceType + interaction at all; "access gate" means the
`access/<tag>` tenant-ownership existence check. Both live in `ScopesValidator.isScopesValidAsync`
today; they are independent and both must pass.

## Scope

Add v2 CRUDS granularity to `patient/`, `user/`, `access/`, and `system/` scope prefixes, all while
continuing to fully support v1 `read`/`write`/`*` grammar (mixed v1/v2 scopes in the same
token/request must both work, since SMART permits a client to hold either style and this server
has live v1-only clients today).

- `user/` — resource-type-level grant (SMART-standard semantics), gains CRUDS.
- `patient/` — resource-type-level grant scoped to the caller's own patient compartment
  (self-only, via `personIdFromJwtToken`), gains CRUDS.
- `access/` — this server's own per-record tenant/owner-tag convention (`meta.security` access
  tags), gains CRUDS. This grammar is not SMART-defined; the server has always owned it. **This
  gate is migrated in lockstep with the resource gate, operation by operation — see Phasing.**
- `system/` — resource-type-level grant for backend-service tokens (no end-user/patient in
  context), gains CRUDS. **Decision: `system/` is CRUDS-only and does not bypass tenant isolation**
  — a backend service presenting `system/Patient.rs` still has its visible resources filtered by
  the existing `access/<tag>`/owner-tag checks, exactly as `user/` and `patient/` scopes already
  are today. It is deliberately *not* treated like the existing `admin/` convention (unrestricted
  access to matching resource types); it also has no self-only restriction the way `patient/` does,
  since there is no `personIdFromJwtToken` for a backend-service token.

Explicitly out of scope:

- Consolidating the three independent scope-parsing code paths that exist today
  (`authService.js`'s own space-split, the legacy `sof-scope.middleware.js` +
  `@asymmetrik/sof-scope-checker` no-op-unless-`auth.type === 'smart'` path, and
  `scopesManager.js`/`scopesValidator.js`, the real enforcement path). Only the real enforcement
  path gains v2 awareness; `authService.js` and `sof-scope.middleware.js` are left untouched.
  `src/routeHandlers/admin.js` asks each route for one letter from the caller's `admin/` scopes,
  and the FHIR resource-type checks inside it use letters too (see "Admin routes" below).
- Real SMART launch context (`fhirUser`, `launch/patient` claims replacing the bwell-proprietary
  `personIdFromJwtToken`/`masterPersonIdFromJwtToken` claims) — separate future effort.
- `.well-known/smart-configuration` capability-advertisement changes.
- The `?param=value` scope-constraint syntax the spec defines (e.g.
  `patient/Observation.rs?category=...`) — not parsed at all today; a scope string carrying one is
  currently treated as a malformed suffix and dropped. Tracked as an open item below, not designed
  here.

## Architecture

New pure module `src/operations/security/smartScopeParser.js`. Parses a `patient/`/`user/`/
`access/`/`system/` scope string into a structured shape:

```
{ prefix: 'patient'|'user'|'access'|'system', resourceType: string, cruds: Set<'c'|'r'|'u'|'d'|'s'> }
```

v1 suffixes are normalized into the same shape (spec-fixed mapping, not invented):

| v1 suffix | CRUDS set   |
|-----------|-------------|
| `read`    | `{r, s}`    |
| `write`   | `{c, u, d}` |
| `*`       | `{c, r, u, d, s}` |

The table below gives the CRUDS letter(s) each FHIR interaction requires, extended here with the
operations analyzed since the original pass. It is a specification, not a lookup in the code: every
call site passes its own letter as `accessRequested`.

| Interaction                                   | Required letter | Notes |
|------------------------------------------------|------------------|-------|
| `create`                                       | `c`              | type-level create, POST, server-assigned id |
| `update`, `patch`                              | `u`              | see "`u` covers update-as-create" below |
| `remove`                                       | `d` for a delete addressed only by `id`/`_id`; `d` **and** `s` when any other search parameter is present | see "DELETE behavior" below |
| `searchById` (instance read), vread            | `r`              | vread also needs an `access/*` scope granting `r` |
| instance-level `_history`                      | `r`              | also needs an `access/*` scope granting `r` |
| type/system-level `history`                    | `s`              | also needs an `access/*` scope granting `s` |
| `searchBundle`, `searchStreaming` | `r` when the only search parameter is `id` or `_id`, `s` otherwise | the same by-id rule as `remove`; `_format`, `_pretty`, `_explain` and similar formatting or debug parameters do not make a request a search, and `id`/`_id` with a modifier does |
| `everything` | `r` on the root, which is always addressed by id; `s` on every related type; DELETE asks `d` on the root before it starts | related types the caller cannot search are left out. DELETE then runs through `graph` (DELETE), which asks `d` on the root and on every deleted resource |
| `summary` | `r` on the root Patient, then `s` on each type in the summary graph | both are always addressed by id; the data comes from an internal `$graph` whose links are all reverse links, so a type without `s` is left out; the Composition-only option also searches `Composition` with `s` |
| `expand` | `r` | always addressed by id; currently switched off in the route handler |
| `graph` — each resolution step, including the root | `r` if the step resolves one instance by reference/id, `s` if it searches a type (forward reference vs. reverse/child search) | not a single fixed letter; evaluated per step, same rule for the root call as for every child link. For DELETE see the next row |
| `graph` (DELETE)                               | `d` on the root and on every resource deleted; forward-reference steps are satisfied by `d` (in place of `r`); reverse/child search steps still require `s` | see "DELETE behavior" below |
| `$merge`                                       | `u`              | see "`u` covers update-as-create" below |
| `$import`                                      | `u` on `Task` at the resource gate and `u` on the `access/` tenant codes | request-time gate; `u`, not `c`, because every imported resource is written as a merge (`u`), and the tenant codes copied onto the Task are those granting `u`. Each imported resource is then checked separately in the import worker, as `$merge` does: `u` on its resource type and `u` on its access tags |
| `$export`                                      | `c` on `Task` at the resource gate, plus at least one `access/` tenant code granting `c` and at least one granting `s` | creating the export job is gated like any other create; the tenant codes stamped on the ExportStatus are those granting `c`, and a caller with no tenant code granting `c`, or none granting `s`, is rejected. The runner's tenant filter for the exported data uses every tenant code granting `s`, including ones not stamped on the ExportStatus (see "`$export` behavior"); status polling (`$export/<id>`) is an instance read and uses `r` on the ExportStatus access tag; the runner includes a resource type only if a `user/`/`system/` scope grants `s` on it — types without it are dropped silently, as before |
| `$access-history`                              | `r` on the target type, `s` on `AuditEvent`, `r` on `Patient`, `s` on every patient-linked type, `r` on every accessor type | every resource type the operation reads is checked, and any missing letter is a 403 — see "`$access-history`" below |
| `validate` with an id                          | `r`              | reads the stored resource; a body sent without an id is not scope checked |
| GraphQL v1 and v2                              | the letter of the operation it resolves through | queries resolve through search (`r` by id, `s` otherwise) and mutations through `$merge` and delete; see "GraphQL" below |
| admin routes                                   | `d` on `Patient` for the delete-patient-data routes, `c` on `ExportStatus` to trigger a job, `u` on `ExportStatus` to update one | the `admin/` gate asks one letter per route; see "Admin routes" below |

### `u` covers update-as-create — resolves the `$merge` / PUT inconsistency

The spec is explicit that the update interaction includes creation-with-a-known-id: *"u (update):
Instance level update... including update-as-create"* and *"Some servers allow for an update
operation to create a new instance, and this is allowed by the update scope."* `c` is reserved for
type-level create (POST, server assigns the id) only.

`update.js`'s insert-when-absent branch (client PUTs to an id that doesn't exist yet) is exactly
this update-as-create case, and it is already gated by the single letter `u` today (the action name
is `'update'` regardless of which branch runs at request time) — no code change needed there.

`$merge`'s insert branch is architecturally the same operation: the caller supplies the resource's
identity (`_uuid`) and the server inserts if absent, updates if present, decided at runtime — never
a type-level, server-assigned-id create. Per this reading, `$merge` therefore requires **`u` only**,
not the `{c, u}` originally proposed (re-applying closed PR #2601's approach). Requiring `c` in
addition to `u` would make `$merge` *stricter* than the spec's own model for the identical
operation, and would leave `user/Patient.u` able to create a Patient via `PUT /Patient/{id}` but not
via `$merge` — same client-supplied-id upsert, inconsistent answer. This supersedes the `{c,u}`
target originally proposed for this operation.

This also means the "create" column in any per-operation verification table refers specifically to
type-level POST create (`c`); instance creation via PUT or `$merge` is a `u` grant, not a `c` grant.
This is worth stating explicitly wherever such a table appears, since the column header alone is
easy to misread as "any way a new resource comes into existence."

### DELETE behavior — `remove` and `$graph` DELETE

A delete is authorized by `d` alone wherever the target is identified rather than searched for.
Only a step that has to *search* for resources requires `s`. Both the resource gate
(`user/…`) and the access gate (`access/<tag>…`) apply the same letters, and the per-resource tag
check and the Mongo query filter use the same letter as the gates.

**`DELETE [base]/[type]/[id]` and `DELETE [base]/[type]?_id=…`** — `d`.

**`DELETE [base]/[type]?<any other search parameter>`** — `d` **and** `s`. A type-level conditional
delete enumerates resources by search, so it needs the search interaction in addition to the delete.

`remove` passes the whole requirement as one value (`d` or `ds`) to the resource gate, access gate,
query filter and per-resource check. A multi-letter requirement is evaluated per letter: each
letter may be granted by a different scope token (so `user/*.read user/*.write` satisfies `ds`),
and for the access gate a tenant code qualifies only if every letter is granted for it, directly
or through the `*` code.

**`DELETE [base]/[type]/[id]/$graph`**

| Step | Required |
|------|----------|
| root resource, fetched by id | `d` |
| forward-reference link (follows a reference held by a parent) | `d` (replaces `r`) |
| reverse / child link (searches a type for resources referencing a parent) | `s` |
| each resource actually deleted | `d` (resource type and tenant tags) |

A link whose gate fails is skipped silently, as before; a resource the caller lacks `d` on is
skipped silently, as before. `GET`/`POST` `$graph` is unchanged: `r` for forward links, `s` for
reverse links.

**What was allowed before, and what is allowed now**

Previously the `remove` access gate, query filter and per-resource check all required the coarse
`write` set (`c`, `u` and `d`), and `$graph` DELETE required `write` at the root and for each
deleted resource, with every link gate still requiring `read` (`r`). A v2 token carrying only
`d` was therefore rejected outright by both operations.

`$graph` DELETE:

| Grant (resource gate and access gate) | Before | Now |
|---|---|---|
| v1 `read` + `write`, or v1 `*` | whole graph | whole graph |
| v1 `write` only (`cud`) | root only; link gates need `r`, children skipped silently | root and forward-reference children; reverse children need `s` and are skipped |
| v2 `rds` | rejected (lacks `c`, `u`) | whole graph |
| v2 `ds` | rejected | whole graph |
| v2 `d` only | rejected | root and forward-reference children; reverse children skipped |
| v2 `rs` / read-only | rejected | rejected, nothing deleted |
| `d` on only one of the two gates | rejected | rejected |

`remove`:

| Grant | Request | Before | Now |
|---|---|---|---|
| v1 `write` (`cud`) | by id | allowed | allowed |
| v1 `write` (`cud`) | with search parameters | allowed | **rejected** — `write` carries no `s` |
| v1 `*` or v1 `read` + `write` | either | allowed | allowed |
| v2 `d` only | by id | rejected (needs `c`, `u`) | allowed |
| v2 `d` only | with search parameters | rejected | rejected (needs `s`) |
| v2 `ds` | either | rejected | allowed |
| v2 `rs` / read-only | either | rejected | rejected |

Two of these changes reach v1 clients, because v1
`write` normalizes to a fixed CRUDS set regardless of `ENABLE_SMART_V2_CRUDS_SCOPES`: a v1
`write`-only client that issues a conditional (search-based) delete is now rejected, and a v1
`write`-only client's `$graph` DELETE now also deletes forward-reference children.

### `$import` behavior

| Grant | Operation | Before | Now |
|---|---|---|---|
| v1 `write` with `access/` codes | `$import` | accepted | accepted (needs a `user/` scope covering `Task`) |
| v1 `read` only | `$import` | rejected at the tenant check (no write codes) | rejected |
| `access/<tag>` only, no `user/` scope | `$import` | accepted | **rejected** — `u` on `Task` is now required at the resource gate |
| v2 `user/Task.u` + `access/<tag>.u` | `$import` | rejected (needs `c`, `u`, `d`) | accepted |
| v2 `user/Task.c` + `access/<tag>.c` | `$import` | rejected | rejected (needs `u`) |
| a scope without `u` on an imported resource's type (e.g. `user/Patient.c`, or `user/Observation.rs` in a mixed file) | `$import` worker | **resource imported** — only its access tags were checked | resource rejected and recorded as a failed entry; the rest of the import continues |

The `$import` request-time gate requires `u`, on `Task` and on the tenant codes, so a caller who
could not write any imported resource is rejected up front instead of getting a Task that imports
nothing. Each imported resource is then checked in the import worker with the caller's own scope,
through the same two gates `$merge` applies: the resource gate checks `u` on the resource's type
(via `MergeManager.preMergeChecksMultipleAsync`), and `WriteAllowedByScopesValidator` checks `u` on
the resource's access tags (and that the caller may add any access tag the resource carries). A
resource that fails either gate is recorded as a failed entry in the error output and skipped; the
rest of the import continues. Before this change the worker checked only the access gate.

### `$access-history` — every resource type it reads, 403 instead of partial data

`GET [base]/Person/[id]/$access-history` resolves one Person, follows its `Person.link` entries to
Patients, collects every patient-linked resource that references those Patients, aggregates the
`AuditEvent` rows for all of them, and resolves each accessor's display name. Previously only the
first two of those reads were gated (`read` on the target type and on `AuditEvent`); the
patient-linked resources and the accessor lookups were read with no scope check at all. Every
resource type the operation reads is now checked:

| Step | Resource type | Required | When checked |
|------|---------------|----------|--------------|
| resolve the target | target type (`Person`) | `r` | before any query |
| aggregate audit records | `AuditEvent` | `s` | before any query |
| Patients reached through `Person.link` | `Patient` | `r` | before any query |
| resources referencing those Patients | every patient-linked type that has a patient reference field | `s` | before any query |
| accessor display names | every accessor type present in the audit rows | `r` | after the audit query, before any accessor lookup |
| proxy-patient accessors | `Person` | `r` | same point, when a `Patient/person.<id>` accessor is present |
| managing organization of a proxy-patient accessor | `Organization` | `r` | before the organization lookup |

The letters follow the same rule as `$graph`: a step that resolves an instance by id or by
reference needs `r`, a step that searches a type needs `s`. The Person and the linked Patients are
resolved by id/reference; the patient-linked resources are found by searching on the patient
reference; the audit rows are a search over `AuditEvent`. Each check applies the same letter to
the resource gate and the access gate.

**Any failed check rejects the whole request with a 403.** This deliberately differs from
`$everything` and `$graph`, which skip a type the caller cannot read. A count-based report that
silently omits a type reads as "nobody accessed it", so partial data is worse than a denial here.
The checks run one at a time and stop at the first failure, which is the only one logged and
thrown, so a narrow token produces one failure entry, not one per type. Running them sequentially
also lets a delegated actor's consent lookup, cached on the actor after the first check, be reused
by every later check instead of each concurrent check issuing its own query (delegated users are
not currently allowed to call `$access-history`, so this only matters if that changes). The accessor checks can only run once
the audit rows are known, so the same token can receive a 200 and later a 403 once a new accessor
type appears in its history.

`hasHistoryAccess` (the wildcard `access/*` requirement for `_history` and vread) has never applied
to `$access-history` and still does not: the operation reads current resources and audit rows, not
historical versions, and tenant-scoped `access/<tag>` codes keep working as before.

A patient-scoped caller is evaluated per type exactly as in a normal search. For a patient-filterable
type the `patient/` scopes decide and the access gate is bypassed; for a type that is not
patient-filterable (`Practitioner`, `Organization`) only `user/`/`system/` scopes count and an
`access/` code is required. Every letter requested here is read-type, so the patient-scope write
restriction never applies.

The patient-linked (clinical) resource scan is filtered by the caller's `access/` tags, the same
way `searchManager` builds a search query: on the non-patient branch each type's query gets the
`getQueryWithSecurityTags` filter for the codes granting `s`, so a tenant-scoped caller only counts
resources tagged for its own tenants; an `access/*` code adds no filter. On the patient branch (a
`patient/` token and a patient-filterable type) no access-tag filter is added, matching search,
since the scan is already limited to the caller's own Patients. This uses the granular letter
directly in `getSecurityTagsFromScope`, the same letter as the gate.

The accessor lookups — each accessor type, the `Person` behind a proxy-patient accessor, and that
Person's managing `Organization` — get the same filter with the letter `r`. An accessor whose record
is outside the caller's tenants is still listed with its counts, since those come from the audit
rows, but its display name falls back to the reference and no `organization` block is returned. On
the patient branch (a patient-filterable accessor type such as `Person` or `RelatedPerson`) no
access-tag filter is added, so a patient-scoped caller still sees who accessed its own records.

Still not filtered by tenant: the Patients reached through `Person.link` (their ids are taken from
the link, never fetched) and the `AuditEvent` aggregation in ClickHouse. The Person resolution is
tag-filtered, as before.

**What was allowed before, and what is allowed now**

| Grant | Before | Now |
|---|---|---|
| v1 `user/*.read` (or `user/*.*`) with an `access/` read code | allowed | allowed |
| v1 `patient/*.read user/*.read access/*.*` | allowed | allowed |
| v1 `user/*.read access/<tenant>.read` | allowed, counting linked clinical resources from every tenant | allowed, counting only linked clinical resources tagged `<tenant>` |
| v1 `user/*.read access/<tenant>.read`, accessor record in another tenant | accessor name and managing organization resolved | accessor listed by reference only, no organization block |
| v1 `user/Person.read user/AuditEvent.read` with an `access/` read code | allowed | **rejected** — no `read` on `Patient` or the patient-linked types |
| v1 `read` on most types but not on an accessor type present in the history | allowed | **rejected** once that accessor appears |
| v1 `patient/*.read` alone | allowed | allowed while every accessor is patient-filterable; **rejected** once a `Practitioner` or `Organization` accessor appears |
| v2 `user/*.s user/Person.r user/Patient.r user/Practitioner.r access/*.rs` | rejected (unparsed) | allowed, for a history whose accessors are all Practitioners |
| v2 with `s` instead of `r` on `Person`, or `r` instead of `s` on `AuditEvent` | rejected | rejected |
| v2 with `r` but not `s` on the patient-linked types | rejected | rejected |
| v2 `access/*.r` or `access/*.s` alone on the access side | rejected | rejected — the checks need a code granting `r` and one granting `s` |

The rejected v1 rows are an exception to the "v1 tokens behave identically" rule: v1 `read`
satisfies every letter required here, but the operation now requires it on many more resource types
than before.

### `$export` behavior

| Grant | Operation | Before | Now |
|---|---|---|---|
| v1 `user/*.read` + `user/*.write` with `access/<tag>.*`, or v1 `*` | `$export` | accepted | accepted |
| v1 read-only (`user/*.read` / `user/Patient.read`), no `user/` scope covering `Task` | `$export` | accepted | **rejected** — `c` on `Task` is now required |
| v2 `user/*.rs user/Task.c` + `access/<tag>.cs` | `$export` | rejected | accepted |
| v2 `user/*.rs user/Task.c` + `access/<tag>.s` | `$export` | rejected | rejected (no tenant code grants `c`) |
| v2 `user/*.rs user/Task.c` + `access/<tag>.c` | `$export` | rejected | rejected (no tenant code grants `s`) |
| v2 `user/*.rs user/Task.c` + `access/tenantA.c access/tenantB.s` | `$export` | rejected | accepted; only tenantA is stamped on the ExportStatus |
| v1 `access/<tag>.read` only | `$export` | accepted, tag stamped on the ExportStatus | **rejected** (no tenant code grants `c`) |
| v1 `access/<tag>.write` only | `$export` | rejected | rejected (no tenant code grants `s`) |
| v1 `access/<tag>.read access/<tag>.write` | `$export` | accepted, tag stamped | accepted, tag stamped |
| v2 `access/<tag>.cs` (no `r`) | polling the status (`$export/<id>`) | rejected | rejected, 403 (needs `r`) |
| v2 `access/<tag>.rs` | polling the status (`$export/<id>`) | rejected | accepted |
| v2 `user/*.rs` + `access/<tag>.s`, no `c` on `Task` | `$export` | rejected | rejected |
| v2 `access/<tag>.r` only | `$export` | rejected | rejected (needs `s`) |
| v1 `write` / v2 `cud` only | `$export` | rejected | rejected (tenant codes need `s`) |
| v2 `user/Patient.rs` | `$export` runner | zero rows, HTTP 200 (literal suffix comparison) | Patient exported |

`$export` requires `c` on `Task` at the resource gate, at least one tenant code granting `c`, and
at least one tenant code granting `s` at request time; only the codes granting `c` are stamped on
the ExportStatus. The runner then
narrows silently to the types the caller's scopes grant `s` on.

The two tenant checks are deliberately different. `c` decides which tenant codes are stamped on
the ExportStatus, since stamping a code on the job record is a create in that tenant. `s` decides
which tenants' data the runner exports: every tenant code granting `s`, not just the stamped ones.
The request-time `s` check only rejects a job that could never export any data. So a caller
holding `access/tenantA.c access/tenantB.s` can start the export, the ExportStatus is tagged with
tenantA only, and the exported data is tenantB's. A caller holding only `access/tenantB.s`, or only
`access/tenantA.c`, cannot start an export at all.

### Create, update and patch

These operations already asked the resource gate for their own letter, but the access gate, the
tenant query filter, the per-resource tag check and the access-tag-change check still used the
coarse `write` set (`c`, `u` and `d`) or `read` (`r`). All of them now use the letter of the
operation: `c` for create, `u` for update, patch and update-as-create.

| Grant | Operation | Before | Now |
|---|---|---|---|
| v1 `read` + `write`, or v1 `*` | any of these | allowed | allowed |
| v2 `user/Patient.c` + `access/<tag>.c` | create | rejected (access gate needs `c`, `u`, `d`) | allowed |
| v2 `user/Patient.u` + `access/<tag>.u` | update, patch, update-as-create | rejected (access gate needs `c`, `u`, `d`) | allowed |
| v2 `u` on one gate and `c` on the other | update, patch | rejected | rejected |

v1 tokens see no change: v1 `write` carries every letter of the old set.

The `Person.link` tenant check (a `Person` write that adds a link must point at a tenant the caller
holds) used the `write` set to find the caller's tenant codes. It now uses the letter of the write:
`c` for create, `u` for update, patch and `$merge`. `$validate` and the other callers that pass no
letter keep the `write` set. A v2 token such as `access/<tag>.u` previously found no codes and had
the link rejected as belonging to another tenant.

### Read, search and history

Search, streaming search, instance read, vread and every `_history` used the `read` literal (`r`) at
the access gate and for the tenant query filter, whatever the resource gate asked. They now use the
same letter at both gates: `r` for a request addressed by `id` or `_id` alone (optionally with
formatting, debug or result-shaping parameters, see `RESULT_SHAPING_QUERY_PARAMS`), `s` otherwise.
`_include`, `_revinclude`, any other parameter, and an `id`/`_id` with a modifier make a request a
search. The `access/*` scope that vread and `_history` require must grant the same letter: `r` for
vread and instance history, `s` for type-level history. `hasHistoryAccess` takes the letter.

| Grant | Operation | Before | Now |
|---|---|---|---|
| v2 `user/Patient.s` + `access/<tag>.r` | search by a parameter | allowed | rejected (access gate needs `s`) |
| v2 `user/Patient.s` + `access/<tag>.s` | search by a parameter | rejected | allowed |
| v2 `user/Patient.r` + `access/<tag>.r` | `?_id=` | rejected (resource gate needed `s`) | allowed |
| v2 `user/Patient.s` + `access/<tag>.s` | `?_id=` | allowed at the resource gate, rejected at the access gate | rejected (needs `r`) |
| v2 `user/Patient.s` + `access/*.s` | type-level `_history` | rejected (`access/*` had to grant `r`) | allowed |
| v2 `user/Patient.s` + `access/*.r` | type-level `_history` | allowed | rejected (`access/*` must grant `s`) |
| v2 `user/Patient.r` + `access/*.s` | instance `_history`, vread | rejected | rejected (`access/*` must grant `r`) |
| v1 anything | search, read, vread, `_history` | as before | as before (`read` carries `r` and `s`) |

### `$everything`

The root is always addressed by id, so it asks `r`; the related types are searched, so they ask
`s`. A DELETE asks `d` on the root before it starts: the root is not searched, and `s` is only needed
on the related types reached through reverse links. A related type without its letter is skipped, as
in `graph` (DELETE).

| Grant | Operation | Before | Now |
|---|---|---|---|
| v2 `user/Patient.r` + `access/<tag>.rs`, with `s` on the related type | `$everything` GET | rejected (resource gate needed `s`) | allowed |
| v2 `user/Patient.s` + `access/<tag>.r` | `$everything` GET | allowed | rejected (the root needs `r` at the resource gate) |
| v1 `write`-only | `$everything` DELETE | rejected (the check asked for `s`) | deletes the root and its forward-reference children |
| v1 `read` + `write` | `$everything` DELETE | allowed | allowed |

`$expand` is also always addressed by id and asks `r`. `$summary` asks `r` on the root Patient and runs an
internal `$graph` over the summary graph, so each type in it needs `s`; a type without it is left out of the result.

### `$validate`

`GET [type]/[id]/$validate` reads the stored resource, so it asks `r` at both gates before the read,
and its tenant filter uses `r`. A body sent to `$validate` reads nothing stored and is not scope
checked.

| Grant | Operation | Before | Now |
|---|---|---|---|
| v1 `access/<tag>.read` alone | validate by id | allowed | **rejected** — `read` on the resource type is now required |
| v1 `user/<Type>.read` + `access/<tag>.read` | validate by id | allowed | allowed |
| any | validate with a body | allowed | allowed |

### GraphQL v1 and v2

GraphQL has no scope check of its own. Queries run through `searchBundle`, so they ask `r` for a
lookup by id (including each reference followed to another resource) and `s` otherwise. The
dataloader adds `_elements` and `_isGraphQLRequest` to every lookup, which is why those parameters
are in the result-shaping list. The mutations call `merge` and, for `updateGeneralPractitioner`
with `remove`, `remove`:

| Mutation | Letters |
|---|---|
| `updateGeneralPractitioner(remove: false)` | `r` and `u` on `Patient`, `r` on `Practitioner` |
| `updateGeneralPractitioner(remove: true)` | `r`, `u` and `d` on `Patient` |
| `updateCareTeam` | `u` on `CareTeam` |

The resolver used to pass its own arguments (`patientId`, `practitionerId`, `remove`) through to the
lookups and to the delete. They became parsed items, so the lookups counted as searches (`s`) and
the delete as a search-based delete (`ds`). The resolver now passes only `id` (and `base_version`).

### Admin routes

Every admin route asks for one CRUDS letter from the caller's `admin/` scopes through
`hasAdminScopeForAction({ scope, accessRequested })`. The resource segment is ignored, and the
letters of all the caller's `admin/` scopes are combined. v1 suffixes expand with
`normalizeSuffixToCruds` (`read` is `r` and `s`, `write` is `c`, `u` and `d`, `*` is all five);
v2 letters are read only when `ENABLE_SMART_V2_CRUDS_SCOPES` is on. The route letters are:

| Routes | Letter |
|---|---|
| `searchLogResults`, `indexes`, `indexProblems`, `runMatchWithPayload`, `ExportStatus` with no id | `s` |
| `runPersonMatch`, `getCacheKeys`, `ExportStatus/[id]` | `r` |
| `showPersonToPersonLink` (reads the Person by id, then searches for the Persons that link to it), `runPersonOneToNMatch` (reads the Patient or Person by id, then asks the matching service for candidates) | `r` and `s` |
| `synchronizeIndexes`, `triggerExport`, `createPersonToPersonLink`, `removePersonToPersonLink`, `removePersonToPatientLink`, `updatePatientReference`, every `PUT` route | `u` |
| `createPersonToPatientLink` (inserts a new Person when the external Person does not exist, otherwise updates it) | `c` and `u` |
| `invalidateCache`, every `DELETE` route not listed below | `d` |
| `deletePatientDataGraph`, `deletePersonDataGraph` (the `$everything` DELETE graph searches related types), `deletePerson` (searches for the Persons that link to it before deleting) | `d` and `s` |

Every route previously asked for `read` or `write`. The letter it now asks for is inside that set, except
for the three delete routes that need `s`: v1 `write` has no `s`, so a token holding only `admin/*.write`
is now refused on them and needs `admin/*.read` as well, or `admin/*.*`.

FHIR resource types and use letters:

| Route | Resource type | Letter at both gates |
|---|---|---|
| `deletePatientDataGraph`, `deletePersonDataGraph` | `Patient` | `d` |
| `triggerExport` | `ExportStatus` | `u` |
| `ExportStatus` update | `ExportStatus` | `u` |

All three previously asked for the `write` set; a v1 `write` token carries every one of these
letters, so v1 callers see no change.

### Bulk export runner

The runner builds the tenant filter it applies to every exported type with `s`, the same letter the
request required. It previously used the default `r`, so a token such as `access/tenantA.c
access/tenantB.s` found no tenant codes and the export failed.

The Person lookup in `PersonToPatientIdsExpander` resolves a Person by id, so it asks for `r`, and
the patient-data-view lookup (`fetchResourcesByArgsAsync`) searches, so it asks for `s`.

## Components & data flow

- **`smartScopeParser.js`** — pure module that parses a scope string and normalizes v1 suffixes to
  CRUDS sets. `isV2Suffix` enforces the in-order subsequence rule. `getRequiredCrudsForAccessRequested`
  turns an `accessRequested` value (`read`, `write`, one letter or an in-order combination such as
  `ds`) into the set of letters that must all be satisfied.
- **`scopesManager.js`** — `getAccessCodesFromScopes`, `getPatientScopes`, `getUserScopes` and the new
  `getSystemScopes` call into `smartScopeParser` instead of doing raw `.`-split / prefix-filtering.
  `hasHistoryAccess` takes the letter that the `access/*` scope must grant.
- **`scopesValidator.js`** — no longer delegates to `@asymmetrik/sof-scope-checker`; the parser decides
  both v1 and v2 cases. `isScopesValidAsync` takes the letter in `accessRequested` and uses it for
  both the resource gate and the access gate; `action` is only for logging. The patient-scope write
  restriction is "requested letters ⊆ `{r, s}`". The coarse `write` literal is still the default of
  the access-tag helpers, but every caller passes a letter.
- **`securityTagManager.js`** (`getSecurityTagsFromScope`) — feeds the MongoDB security filter used by
  `searchManager.js`, `exportManager.js`, `import.js`, `bulkDataExportRunner.js` and
  `personToPatientIdsExpander.js`, and throws `ForbiddenError` on an empty result. It takes the same
  letter as the gates. `constructQueryAsync` still defaults to `r` when a caller omits it; every
  caller now passes one.
- **`ParsedArgs.isRequestById`** — decides whether `searchBundle` and `searchStreaming` ask `r` or `s`.
- **Call sites** (`create.js`, `update.js`, `patch.js`, `remove.js`, `searchById.js`,
  `searchByVersionId.js`, `history.js`, `searchBundle.js`, `searchStreaming.js`, `everything*.js`,
  `summary.js`, `expand.js`, `graph*.js`, `merge*.js`, `import.js`, `export*.js`, `accessHistory.js`,
  `validate.js`, `adminExportManager.js`, `admin.js`) — each passes its own CRUDS requirement and
  updates its own `getAccessCodesFromScopes` and tenant-filter calls in the same change.
- **`admin.js` `admin/` gate, `hasAdminScopeForAction`** — takes `accessRequested`, a CRUDS letter, and each route passes its own.

## Backward compatibility rule

Classification is **per scope string, not per token/request** — a single request's scope set may
freely mix v1 and v2 style scopes (SMART v2 permits this, and this server has live v1-only
clients). A suffix is v1 iff it is exactly `read`, `write`, or `*`; v2 iff it is a non-empty,
duplicate-free, **in-order** subsequence of the literal string `cruds` — i.e. its letters are drawn
from `{c, r, u, d, s}` and appear in that relative order (`rs` and `cud` are valid; `sr` and `duc`
are not). Requiring a subsequence subsumes the duplicate check for free, since `cruds` itself has
no repeated letters. Anything else is malformed. `isV2Suffix` enforces this today.

v1 suffixes are converted to letters regardless of `ENABLE_SMART_V2_CRUDS_SCOPES`. That is why an
operation that starts asking for a letter can change the result for a v1 token even with the flag
off. The v1 differences are listed per operation above and in `readme/scopes_v2.md`.

## Error handling

- A malformed v2 suffix causes that single scope string to be dropped from the granted-scope set;
  it is not fatal to the rest of the token's other (valid) scopes.
- `hasHistoryAccess`'s requirement that the resolved access-code list contain `'*'` is preserved:
  CRUDS granularity decides which letter the `*` code must grant, not whether it must be `*`.
  Regression tests pin that e.g. `access/tenantA.rs` does **not** satisfy `hasHistoryAccess` merely
  because `r`/`s` are present, while `access/*.rs` does. This guard covers `_history` and vread only;
  it never applied to `$access-history`.
- An empty resulting CRUDS set after all filtering produces the same `ForbiddenError` behavior as
  today's empty-access-code case.
- A denied `$everything` or `$graph` is returned as HTTP 200 with a Bundle holding one
  `OperationOutcome`, a denied GraphQL request as 200 with an `errors` array, and a denied `$merge` as
  200 with the rejected resource's `operationOutcome`. Other operations return 403 (see Open items).

## Testing strategy

1. Isolated unit tests for `smartScopeParser.js`: v1→CRUDS normalization table, v2 grammar detection
   (valid combinations, duplicates, unknown letters, empty suffix, out-of-order letters), all four
   prefixes, and `system/` tenant isolation.
2. Characterization tests over `scopesManager` and `scopesValidator` prove v1-only behavior is
   unchanged except where this document lists a difference.
3. Per-operation integration tests exercise genuinely granular grants on **both** gates together:
   `write_v2_cruds_scopes` (create, update, patch, `Person.link`), `read_v2_cruds_scopes` (read,
   search, `$summary`, history, vread, `$validate`), `everything_v2_cruds_scopes` (GET and DELETE) and
   `graphql_v2_cruds_scopes` (v1 and v2 queries, `updateGeneralPractitioner`), `summary_v2_cruds_scopes`
   (summary types need `s` on both gates) and `admin_v2_cruds_scopes`
   (every admin route letter, v1 suffixes, flag off), alongside the existing
   `$graph`, `$merge`, `$import`, `$export` and `$access-history` suites.
4. Unit tests pin the letter each operation passes (`everything`, `searchBundle`, `validate`,
   `adminExportManager`, `bulkDataExportRunner`, `scopesManager.hasHistoryAccess`,
   `scopesManager.hasAdminScopeForAction`) and
   `ParsedArgs.isRequestById`.
5. Foreign-tenant cases pin the tenant filter: a token with the right letter for another tenant gets
   an empty search, a 404 on a read or patch, and a 403 on a create, update or history, including on a
   streamed search and in GraphQL.
6. The query-filter path (`securityTagManager` and its consumers) was reviewed against `review.md`'s
   access/owner-tag checklist, since it changes which documents come back.

## Phasing / rollout

1. **Parser + v1 normalization.** Complete. Merged behind the flag.
2. **Per-operation gate migration (resource gate + access gate together).** Complete for every
   operation in the Architecture table, including the access-gate half that earlier steps had left on
   the coarse set. Each operation changed its resource gate, access gate, tenant filter and per-resource
   tag check in one change, so no operation sat in a state where a narrow `access/<tag>` scope was
   rejected by a still-coarse access gate.
3. **Query-filter path.** Complete: `securityTagManager.js`, `searchManager.js`, `exportManager.js`,
   `import.js`, `bulkDataExportRunner.js`, `personToPatientIdsExpander.js`, the `Person.link` tenant
   check in `resourceValidator.js` and the per-resource tag checks in `scopesManager.js` use the
   granular letter. `fhirLoggingManager` records the first tenant code the token grants for any letter,
   so a search-only or write-only token is still logged with its tenant.
4. **Not started.** Making `accessRequested` a required parameter of `constructQueryAsync` and the
   access-tag helpers, and a deployed end-to-end suite.

## Open items

Accepted as they are:

- **Export status polling.** A job is stamped with the tenant codes granting `c`, and the status check
  needs `r` on a stamped code, so a token such as `access/tenantA.cs` can start an export but not poll
  it. This is expected.
- **Defaults.** `constructQueryAsync` defaults to `r` and the access-tag helpers default to the `write`
  set when a caller omits the letter. Every caller passes one.
- **`$validate` with a body** is not scope checked, and a body that adds a `Person` link still runs the
  target-tenant check with the `write` set, whose error text reveals whether the target exists.
- **`updateGeneralPractitioner(remove: true)`** (GraphQL v1) deletes the Patient and writes it back
  without a transaction.

Open:

- **Admin routes that change Person or Patient data.** Except for the resource checks listed under
  "Admin routes", such a route is guarded only by its `admin/` letter, and the resource segment of
  an `admin/` scope is ignored.
- **Denied requests that return 200.** A denied `$merge` (per-resource `operationOutcome`),
  `$everything`, `$graph` and GraphQL request returns 200; read, search, history, create, update,
  patch, delete, `$summary`, `$validate`, `$access-history`, `$import` and `$export` return 403.
  Whether `$everything`, `$graph` and `$merge` should return 403 is undecided.
- **`$expand`** is switched off in the route handler (it returns `{}` with 200 without reading or
  checking anything). `ExpandOperation` asks `r` at both gates and is ready for when it is enabled.
- **GraphQL.** A new GraphQL argument that is not in the by-id list turns a by-id lookup into a search
  that needs `s`.
- **End-to-end coverage.** No deployed-environment suite exercises v2 scopes across all operations.
- **Before enabling the flag.** Audit the identity provider's client scope strings for any value that
  would newly parse as a valid v2 suffix; enabling v2 parsing is a one-way loosening of what is
  honored. Confirm whether any backend-service (client-credentials) client will present `system/`
  scopes — `authService.js`'s token and claims parsing is untouched, so without such a flow `system/`
  lands inert.
- **Out of scope here:** real SMART launch context (`fhirUser`, `launch/patient`),
  `.well-known/smart-configuration`, and the `?param=value` scope constraint syntax.
