# SMART v2 fine-grained scopes (`.cruds`) and how they differ from v1

This page explains the SMART App Launch v2 scope grammar the server understands, how it relates to
the v1 `read` / `write` / `*` grammar, what each operation requires in v1 and in v2, the smallest
scope set that makes each operation work, and where v1 callers see a different result than before.
The full design is in
[docs/superpowers/specs/2026-09-13-smart-v2-scope-granularity-design.md](../docs/superpowers/specs/2026-09-13-smart-v2-scope-granularity-design.md).

## 1. The grammar

A v1 scope ends in `.read`, `.write` or `.*`. A v2 scope ends in one or more of these letters:

| Letter | Interaction |
|---|---|
| `c` | create (`POST`, server-assigned id) |
| `r` | read one instance by id (read, vread, instance `_history`) |
| `u` | update, patch, update-as-create (`PUT` to an unknown id, `$merge`) |
| `d` | delete |
| `s` | search (type-level search, type-level history, and the related types reached by `$everything` and `$graph`) |

The letters must appear in the order `c r u d s`. `user/Patient.rs` and `user/*.cud` are valid;
`user/Patient.sr` is not and is ignored.

The prefixes that accept the v2 grammar are `user/`, `patient/`, `system/` and `access/`. `patient/`
scopes use the same letters and are limited to the caller's own patient compartment. `system/` is
for backend-service tokens; it does not bypass tenant isolation, because the `access/` scopes still
decide which records are visible. `admin/` scopes accept the same letters, and only the letters; the
resource segment is ignored (see section 3.7).

### How a v1 scope is read

v1 suffixes are converted to the same letters, in every deployment:

| v1 suffix | Letters |
|---|---|
| `read` | `r`, `s` |
| `write` | `c`, `u`, `d` |
| `*` | `c`, `r`, `u`, `d`, `s` |

This conversion does not depend on any setting. It is why an operation that starts checking a
letter can change the outcome for a v1 token even though no v2 scope is involved: `write` carries no
`r` or `s`, and `read` carries no `c`, `u` or `d`.

### Turning v2 on

v2 suffixes are only honored when `ENABLE_SMART_V2_CRUDS_SCOPES` is set. While it is off, a v2
suffix grants nothing and every operation is reached only with v1 scopes. The per-operation
letters in section 3 are not behind this setting, so the v1 changes in section 4 are live whether
or not it is set.

## 2. The two gates

Every scope decision has two independent parts, and both must pass.

- **Resource gate:** a `user/`, `system/` or `patient/` scope on the resource type, for example
  `user/Observation.rs`.
- **Access gate:** an `access/<tag>` scope for the tenant that owns the record, for example
  `access/tenantA.rs`. The record's `meta.security` access tag must match, or the caller must hold
  `access/*`. The access gate also filters which records a search returns.

Every operation asks the same letter at both gates. A requirement of more than one letter, such as
`ds`, is evaluated per letter: each letter may come from a different scope, and at the access gate a
tenant code qualifies only if it grants every letter, either directly or through `access/*.<letters>`.

A request counts as "by id" when it has an `id` or `_id` parameter and nothing else but formatting,
debug or result-shaping parameters (`_format`, `_pretty`, `_explain`, `_debug`, `_elements`,
`_count`, `_total`, `_sort`). Any other parameter, including `_include` and `_revinclude`, makes it a
search. An `id`/`_id` with a modifier makes it a search too, with one exception: an `id` or `_id`
whose only modifier is `:not` is allowed next to a plain `id`/`_id`, because that is how a consent
exclusion narrows an id lookup. A lone `_id:not=...` is a search. The same rule applies to a
streamed search (`_streamResponse=1`), at both gates.

## 3. What each operation requires

In every table, `<Type>` is the resource type and `<tag>` is the tenant. `*` may replace either.
"Minimum" means the smallest scope set that lets the operation return a normal result; a scope the
operation can do without, such as `s` on a related type, is explained under the table.

### 3.1 Create, update and delete

| Operation | Letters at both gates | Minimum v2 scopes | Minimum v1 scopes |
|---|---|---|---|
| `POST [type]` | `c` | `user/<Type>.c access/<tag>.c` | `user/<Type>.write access/<tag>.write` |
| `PUT [type]/[id]` (update and update-as-create) | `u` | `user/<Type>.u access/<tag>.u` | `user/<Type>.write access/<tag>.write` |
| `PATCH [type]/[id]` | `u` | `user/<Type>.u access/<tag>.u` | `user/<Type>.write access/<tag>.write` |
| `POST [type]/$merge` | `u` | `user/<Type>.u access/<tag>.u` | `user/<Type>.write access/<tag>.write` |
| `DELETE [type]/[id]`, `DELETE [type]?_id=` | `d` | `user/<Type>.d access/<tag>.d` | `user/<Type>.write access/<tag>.write` |
| `DELETE [type]?[other parameters]` | `d` and `s` | `user/<Type>.ds access/<tag>.ds` | `user/<Type>.read user/<Type>.write access/<tag>.read access/<tag>.write` |

- `$merge` creates and updates with a client-supplied identity, so it needs `u`, not `c`. `c` is only
  for a type-level `POST`.
- A `Person` write that adds a `link` also needs the same letter on the target's tenant: `c` for
  `POST`, `u` for `PUT`, `PATCH` and `$merge`.
- A conditional delete searches before it deletes, so it needs `s` as well as `d`.

### 3.2 Read, search and history

| Operation | Letters at both gates | Minimum v2 scopes | Minimum v1 scopes |
|---|---|---|---|
| `GET [type]/[id]` | `r` | `user/<Type>.r access/<tag>.r` | `user/<Type>.read access/<tag>.read` |
| `GET [type]?_id=...`, `?id=...`, also streamed | `r` | `user/<Type>.r access/<tag>.r` | `user/<Type>.read access/<tag>.read` |
| `GET [type]?...`, `POST [type]/_search`, also streamed | `s` | `user/<Type>.s access/<tag>.s` | `user/<Type>.read access/<tag>.read` |
| `GET [type]/[id]/_history/[vid]` (vread) | `r` | `user/<Type>.r access/*.r` | `user/<Type>.read access/*.read` |
| `GET [type]/[id]/_history` | `r` | `user/<Type>.r access/*.r` | `user/<Type>.read access/*.read` |
| `GET [type]/_history` | `s` | `user/<Type>.s access/*.s` | `user/<Type>.read access/*.read` |

- vread and every `_history` also need a non-tenant-specific `access/*` scope that grants the letter.
  A tenant-specific `access/<tag>` code is never enough, because an old version can carry a tenant tag
  the current version has since lost.

### 3.3 Operations on a patient or a resource graph

| Operation | Letters | Minimum v2 scopes | Minimum v1 scopes |
|---|---|---|---|
| `GET Patient/[id]/$everything` | `r` on the root, `s` on each related type | `user/Patient.r access/<tag>.r` returns the Patient only. Add `user/<Related>.s` and `access/<tag>.rs` for each related type | `user/Patient.read access/<tag>.read`, plus `read` on each related type |
| `DELETE Patient/[id]/$everything` | `d` on the root, then `ds` on each related type | `user/Patient.d access/<tag>.d` deletes the Patient only. Add `user/<Related>.ds` and `access/<tag>.ds` | `user/Patient.write access/<tag>.write`, plus `read` and `write` on each related type |
| `GET Patient/[id]/$summary` | `r` on the root, `s` on each type in the summary graph (runs `$graph` internally; every link is a reverse link) | `user/Patient.r access/<tag>.r` returns the Patient only. Add `user/<Type>.s` and `access/<tag>.rs` for each summary type, for example `Condition`, `MedicationRequest`, `Observation` | `user/Patient.read access/<tag>.read`, plus `read` on each summary type |
| `GET [type]/[id]/$expand` | `r` | `user/<Type>.r access/<tag>.r` | `user/<Type>.read access/<tag>.read` |
| `POST [type]/[id]/$graph` | `r` on the root and each forward link, `s` on each reverse link | `user/<Root>.r access/<tag>.r` returns the root only. Add `r` on each forward-link type and `s` on each reverse-link type | `read` on the root and on every linked type |
| `DELETE [type]/[id]/$graph` | `d` on the root and on every deleted resource, `d` for a forward link, `ds` for a reverse link | `user/<Root>.d access/<tag>.d` deletes the root only. Add `d` on each forward-link type and `ds` on each reverse-link type | `write` on the root, `read` and `write` on each reverse-link type |
| `GET Person/[id]/$access-history` | `r` on `Person`, `Patient` and each accessor type; `s` on `AuditEvent` and every patient-linked type | `user/Person.r user/Patient.r user/AuditEvent.s`, `s` on every patient-linked type, `r` on every accessor type, and `access/<tag>.rs` | `read` on all of those types and `access/<tag>.read` |

- A related type, forward link or reverse link the caller cannot reach is left out of the result,
  not rejected. A `Scope check failed` line is logged at info level and the response is still 200.
  A denied `$everything` returns 200 with a Bundle holding one `OperationOutcome`.
- `$access-history` is different: any missing letter returns 403 for the whole request, because a
  count with a type silently missing reads as "nobody accessed it".
- `$summary` and `$expand` are always addressed by id. `$summary` builds its data with `$graph`, so a
  summary type the caller cannot reach is left out, not rejected, like in `$everything`. With the
  proxy-patient `_includeSummaryCompositionOnly` option it also searches `Composition`, which needs
  `s` and returns 403 when missing.
- `$expand` is currently switched off in the route handler: it returns `{}` with 200 without reading
  or checking anything. The letters above are what the operation asks once it is switched on.

### 3.4 Bulk export and import

The request, the status check and the worker of each operation are listed together.

| Operation | Letters | Minimum v2 scopes | Minimum v1 scopes |
|---|---|---|---|
| `$export` start (`/$export`, `Patient/$export`, `Group/[id]/$export`) | `c` on `Task`; tenant codes granting `c` are stamped on the job; at least one code granting `s` | `user/Task.c user/<Type>.s access/<tag>.cs` | `user/Task.write user/<Type>.read access/<tag>.read access/<tag>.write` |
| `$export` status (`GET $export/[id]`) | `r` on a tenant code stamped on the job | `access/<tag>.r` on a tenant the job is stamped with. To start and poll with one token: `access/<tag>.crs` | `access/<tag>.read` on a stamped tenant |
| `$export` runner | `s` on each exported type and on the tenant filter | the `s` scopes of the start request | the `read` scopes of the start request |
| `$import` request | `u` on `Task`; tenant codes granting `u` | `user/Task.u access/<tag>.u` | `user/Task.write access/<tag>.write` |
| `$import` worker, per imported resource | `u` on the resource's type and tenant tags | `user/<Type>.u access/<tag>.u` for every imported type | `user/<Type>.write access/<tag>.write` for every imported type |

- The runner exports every tenant code that grants `s`, including ones not stamped on the job. A caller
  holding `access/tenantA.c access/tenantB.s` can start an export, the job is tagged with tenantA
  only, and the exported data is tenantB's.
- The runner leaves out any resource type the caller has no `s` on, without an error.
- A job is stamped with the codes that grant `c`, so a caller whose `r` codes are on other tenants
  cannot poll its own job. This is listed in section 6.
- An imported line that fails either gate is recorded in the error output and the rest of the import
  continues.

### 3.5 GraphQL v1 and v2

GraphQL has no scope check of its own. Every query is resolved through search and every mutation
through `$merge` or delete, so the letters are the ones in sections 3.1 and 3.2.

| Operation | Letters | Minimum v2 scopes | Minimum v1 scopes |
|---|---|---|---|
| Query by id, and each reference followed to another resource | `r` per type | `user/<Type>.r access/<tag>.r` for every type in the query | `user/<Type>.read access/<tag>.read` |
| Query with any other search argument | `s` per type | `user/<Type>.s access/<tag>.s` for every type in the query | `user/<Type>.read access/<tag>.read` |
| `updateGeneralPractitioner(remove: false)` | `r` and `u` on `Patient`, `r` on `Practitioner` | `user/Patient.ru user/Practitioner.r access/<tag>.ru` | `read` and `write` on `Patient`, `read` on `Practitioner` |
| `updateGeneralPractitioner(remove: true)` | `r`, `u` and `d` on `Patient` | `user/Patient.rud access/<tag>.rud` | `read` and `write` on `Patient` |
| `updateCareTeam` | `u` on `CareTeam` | `user/CareTeam.u access/<tag>.u` | `user/CareTeam.write access/<tag>.write` |

- `updateGeneralPractitioner(remove: true)` deletes the Patient and writes it back, so the delete is
  not rolled back if the write that follows is rejected.

### 3.6 `$validate`

| Operation | Letters | Minimum v2 scopes | Minimum v1 scopes |
|---|---|---|---|
| `GET [type]/[id]/$validate` | `r` | `user/<Type>.r access/<tag>.r` | `user/<Type>.read access/<tag>.read` |
| `POST [type]/$validate` | none | none | none |

- A body sent to `$validate` is neither stored nor read back, so it is not scope checked.
- `GET [type]/[id]/$validate` of a `Person` checks each link target against the caller's tenants with
  `r`, the letter the request was gated with, so a read-only token validates a stored `Person` whose
  targets are in its own tenant. A body keeps the `write` set for that check.

### 3.7 Admin routes

Every `/admin/*` route asks for one CRUDS letter from the caller's `admin/` scopes. The resource
segment (`admin/*`, `admin/Patient`) is ignored, so `admin/*.s` and `admin/Patient.s` are the same.
The letters of all the caller's `admin/` scopes are combined. v1 `admin/*.read` grants `r` and `s`,
`admin/*.write` grants `c`, `u` and `d`, and `admin/*.*` grants all five, so v1 tokens keep working
unchanged. v2 letters on `admin/` scopes are read only when `ENABLE_SMART_V2_CRUDS_SCOPES` is set.
A route with no letter in the caller's scopes returns 403 with the generic message
`user does not have access to this admin route`. The caller's scopes and the letter the route asked
for are logged on the server, not returned.

| Route | Letter | Minimum v2 `admin/` scope | Minimum v1 `admin/` scope |
|---|---|---|---|
| `GET /admin/searchLogResults`, `indexes`, `indexProblems` | `s` | `admin/*.s` | `admin/*.read` |
| `POST /admin/runMatchWithPayload` | `s` | `admin/*.s` | `admin/*.read` |
| `GET /admin/runPersonMatch`, `getCacheKeys` | `r` | `admin/*.r` | `admin/*.read` |
| `GET /admin/showPersonToPersonLink`, `runPersonOneToNMatch` | `r` and `s` | `admin/*.rs` | `admin/*.read` |
| `GET /admin/ExportStatus/[id]` | `r` | `admin/*.r` | `admin/*.read` |
| `GET /admin/ExportStatus` (no id) | `s` | `admin/*.s` | `admin/*.read` |
| `POST /admin/createPersonToPatientLink` | `c` and `u` | `admin/*.cu` | `admin/*.write` |
| `POST /admin/invalidateCache` | `d` | `admin/*.d` | `admin/*.write` |
| `POST /admin/triggerExport`, `createPersonToPersonLink`, `removePersonToPersonLink`, `removePersonToPatientLink`, `updatePatientReference` | `u` | `admin/*.u` | `admin/*.write` |
| `GET /admin/synchronizeIndexes` | `u` | `admin/*.u` | `admin/*.write` |
| `PUT /admin/ExportStatus/[id]` and every other `PUT` route | `u` | `admin/*.u` | `admin/*.write` |
| `DELETE /admin/deletePatientDataGraph`, `deletePersonDataGraph`, `deletePerson` | `d` and `s` | `admin/*.ds` | `admin/*.read admin/*.write`, or `admin/*.*` |
| every other `DELETE` route | `d` | `admin/*.d` | `admin/*.write` |

A v1 `admin/` token behaves as before, with one exception. The three delete routes that search for
related records (`deletePatientDataGraph`, `deletePersonDataGraph`, `deletePerson`) ask for `d` and `s`,
and v1 `write` covers `d` but not `s`. A token that holds only `admin/*.write` is now refused on them;
it needs `admin/*.read` as well, or `admin/*.*`. Every other route's letter is covered by the
`read` or `write` suffix it used to ask for.

The letter follows what the route does. A route that reads one resource by id asks `r`. A route that
searches, or lists several records, asks `s`. A route that changes a Person link asks `u`, and a
delete that first searches for the records it must clean up asks `d` and `s`.

Four checks inside admin routes are on FHIR resource types and use letters at both gates in addition
to the `admin/` letter above.

| Route | Resource letters | Minimum v2 scopes for the resource part | Minimum v1 scopes for the resource part |
|---|---|---|---|
| `DELETE /admin/deletePatientDataGraph`, `deletePersonDataGraph` | `d` on `Patient` at both gates | `user/Patient.d access/<tag>.d` | `user/Patient.write access/<tag>.write` |
| `POST /admin/triggerExport` | `u` on `ExportStatus` at both gates | `user/ExportStatus.u access/<tag>.u` | `user/ExportStatus.write access/<tag>.write` |
| `PUT /admin/ExportStatus` | `u` on `ExportStatus` at both gates | `user/ExportStatus.u access/<tag>.u` | `user/ExportStatus.write access/<tag>.write` |
| every other admin route | none | none | none |

## 4. What changes for v1 callers

These changes apply to v1 tokens whether or not `ENABLE_SMART_V2_CRUDS_SCOPES` is set. They happen
because an operation now checks something it used to skip, or checks a letter that `read` or
`write` does not carry. v1 tokens with `user/*.*` and `access/<tag>.*` are not affected by any of
them.

### Delete

- **`$graph` DELETE.** A `write`-only caller used to delete the root resource and silently skip
  every child. It now also deletes forward-reference children. Reverse children still need `read`
  and are skipped without it.
- **Every resource type is checked before anything is deleted.** If any resource type in the result
  lacks `write`, the request returns 403 and nothing is deleted. Before, the check ran per resource
  during the delete loop, so a caller could delete part of the graph and then fail.
- **`DELETE [type]?[search parameters]`.** A `write`-only caller is now rejected, because the search
  needs `read`. A delete by id (`[type]/[id]` or `?_id=`) is unchanged.
- **Person `$everything` DELETE.** The linked Patients are now found with `write` instead of `read`.
  A caller with `write` but no `read` on `Patient` now deletes the linked Patients and their child
  resources, where it has `read` and `write` on those types. A caller whose `read` and `write` codes
  are on different tenants now selects the linked Patients by its `write` codes.
- **`$everything` DELETE no longer needs `read` on the root type.** The root is addressed by id, so
  it only needs `write`. A `write`-only token that used to be rejected now deletes the root and its
  forward-reference children, and skips reverse children and any link type it cannot read, as
  `$graph` DELETE does.
- **Types without access are left out, not rejected.** When a graph or `$everything` DELETE meets a
  link type the caller cannot read, that link is skipped, a `Scope check failed` line is logged at
  info level, and the response is still 200. This is the same as before. A caller that needs a
  complete deletion must hold `read` and `write` on every type in the graph definition.

### Bulk export

- Starting an export needs `write` on `Task` (for example `user/*.write` or `user/Task.write`), so a
  read-only token is now rejected.
- It also needs an `access/` code granting `write` (or `*`) and one granting `read` (or `*`).
  `access/<tag>.read` on its own is now rejected.
- The job is stamped with the caller's `write` access codes instead of its `read` codes. Polling the
  job needs `read` on a stamped code, so a caller whose `write` and `read` codes are on different
  tenants cannot poll its own job.

### Bulk import

- The request needs `write` on `Task`. An `access/<tag>` scope on its own is now rejected.
- Each imported resource is checked for `write` on its own type, as `$merge` does. For example, with
  `user/Task.write user/Patient.read` every Patient line is rejected and reported in the error
  output.
- A line with `|` in its id, or more than one owner tag on a new resource, is rejected, as in
  `$merge`.

### `$access-history`

- It needs `read` on every type it reads: `Person`, `AuditEvent`, `Patient`, the patient-linked
  clinical types and each accessor type that appears in the history. A missing type returns 403
  instead of partial data.
- `patient/*.read` on its own fails once a `Practitioner` or `Organization` accessor appears, since
  those types need a `user/` scope and an `access/` code.
- A tenant-scoped token (`access/<tenant>.read`) now counts only that tenant's resources. Accessors
  in other tenants are listed by reference, without a name or organization.

### `$validate`

- `GET [type]/[id]/$validate` now needs `read` on the resource type. Before, a token with only an
  `access/<tag>.read` scope could validate any stored resource of that tenant.

### Admin delete routes

- `DELETE /admin/deletePatientDataGraph`, `deletePersonDataGraph` and `deletePerson` now need `admin/*.read`
  as well as `admin/*.write` (or `admin/*.*`), because they search for the related records they clean
  up. A token with only `admin/*.write` is refused with 403.

### Unchanged for v1

Create, read, vread, update, patch, search, streaming search, `_history`, `$everything` (read),
`$summary`, `$expand`, `$merge`, `$validate` with a body, GraphQL queries and mutations, the admin
routes (except the three delete routes in section 3.7) and batch/transaction behave as before.

## 5. Quick reference

| Goal | Scopes |
|---|---|
| Read one resource, or search by `_id` only | `user/Patient.r access/tenantA.r` |
| Search a type | `user/Patient.s access/tenantA.s` |
| Read and search | `user/Patient.rs access/tenantA.rs` |
| Read `_history` or a version | `user/Patient.r access/*.r`; for a type-level `_history`, `user/Patient.s access/*.s` |
| `$everything` with one related type | `user/Patient.r user/Observation.s access/tenantA.rs` |
| Delete a Patient and its Observations with `$everything` | `user/Patient.d user/Observation.ds access/tenantA.ds` |
| Create | `user/Patient.c access/tenantA.c` |
| Update, patch, `$merge`, or `PUT` to a new id | `user/Patient.u access/tenantA.u` |
| Delete by id | `user/Patient.d access/tenantA.d` |
| Delete with search parameters | `user/Patient.ds access/tenantA.ds` |
| Start and poll a bulk export of Patients | `user/Task.c user/Patient.s access/tenantA.crs` |
| Start a bulk import of Patients | `user/Task.u user/Patient.u access/tenantA.u` |

## 6. Behavior to know about, and what is still open

### Status code of a denied request

| Operation | Denied request returns |
|---|---|
| read, search, `_history`, vread, create, update, patch, delete | 403 with an `OperationOutcome` |
| `$summary` | 403 with a Bundle holding an `OperationOutcome` |
| `$validate` with an id, `$access-history`, `$import` request, `$export` start | 403 |
| `$merge` | 200; the rejected resource's entry carries an `operationOutcome` |
| `$everything` GET and DELETE | 200 with a Bundle holding one `OperationOutcome` |
| `$graph` POST and DELETE | 200 with a Bundle holding one `OperationOutcome` |
| GraphQL v1 and v2 | 200 with an `errors` array |
| `$expand` | 200 with `{}`, because it is switched off |

A related type, link or exported type the caller has no scope for is left out of an `$everything`,
`$graph` or `$export` result without an error, so the response is a 200 with less data.

### Expected behavior

- **Polling an export.** A job is stamped with the tenant codes that grant `c`, and the status check
  needs `r` on a stamped code. A token such as `access/tenantA.cs` can start an export but gets a 403
  polling it; `access/tenantA.crs` does both.
- **Defaults.** The tenant filter in `constructQueryAsync` falls back to `r`, and the helpers behind
  create, update, patch and delete fall back to the v1 `write` set, if a caller omits the letter.
  Every caller passes one today, except the calls that validate a body (`$validate`, and the
  GraphDefinition check in `$graph`), which keep the `write` fallback (see the next item).
- **`$validate` with a body** is not scope checked. When the body adds a `Person` link, the check
  that the target belongs to the caller's tenants still uses the v1 `write` codes, and its error
  text says whether the target exists.
- **`updateGeneralPractitioner(remove: true)`** in GraphQL v1 deletes the Patient and writes it back
  without a transaction.
- **Request logging.** The request logger records the first tenant code the token grants for any
  letter, trying `r`, `s`, `c`, `u`, then `d`. A search-only or write-only token is therefore logged
  with its tenant. It does not affect authorization.
- **A tenant filter that matches nothing returns nothing.** A search or read for a tenant that owns
  no matching record returns an empty result (search) or 404 (read, patch), not a 403, so a caller
  cannot tell another tenant's record from one that does not exist.
