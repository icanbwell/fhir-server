# Unified write pipeline

## Why

POST, PUT, PATCH, `$merge`, the `$import` worker and the admin resource writer each run their own
copy of the same write steps: scope check, find the stored resource, access checks, validation,
build the new document, attachments, write, audit, respond. The copies run the steps in different
orders, pick different variants of the same check, and skip different checks. Adding or changing a
check means finding and editing every copy.

This work adds one pipeline that runs every step for every one of those operations, in one place
and in one order. Where an operation behaves differently today, the difference is a named setting
in that operation's profile, so all the differences can be read side by side. No incident drove
this; the goal is consistency and maintainability.

**Base.** This work is based on `main` plus the earlier write-flow cleanup, which removes unused
dependencies, parameters and the write-only patches plumbing and ships first as its own PR.
Throughout this doc, "today" and "the old path" mean that code. The concurrent write resolver, a
separate change that detects which writes in a bulk write lost a version race and rebases only
those, lands later. It changes how the shared bulk inserter handles those writes, so it affects
both paths alike, with one exception: for a new resource sent by id and by `_uuid` in one request,
the old path's result depends on which retry code is in place (see "Testing"). Where this doc
describes conflict handling by the resolver, the one-by-one replay does that job until it merges.

## Goals

- One pipeline class runs the write steps, in a fixed order, for: POST (create), PUT (update),
  PATCH, `$merge` (buffered and streaming, and the GraphQL mutations that call it), the `$import`
  worker, and the admin resource writer.
- Each operation supplies a profile: settings plus pluggable pieces. A profile picks a variant of a
  step; it cannot remove a step. A check that an operation does not run today is an explicit `off`
  in its profile.
- The new path is behind a switch per operation. With an operation's switch off, its existing code
  runs exactly as today.
- In the new path, PUT and PATCH write with a version check and retry on conflict. Group PATCHes
  that change members are the exception (see "Concurrency").

## Non-goals

- DELETE, delete-by-query and `$graph` DELETE. They are not touched.
- Fewer preSave runs. The new path may run preSave as often as the pieces it reuses do.
- Fixing behavior the new path has to reproduce. Issues found while mapping the flows are tracked
  separately.
- Other writers: the `$import` kickoff Task insert, the bulk-import Task state writes
  (`bulkImportTaskStateMachine`), the admin ExportStatus PUT, the admin deletes (`deletePerson`,
  `deletePatientDataGraph`, `deletePersonDataGraph`, including the link cleanup they do through
  `AdminResourceWriter`), and the raw admin runners.
- Removing the old path. That happens later, once each switch has been on everywhere.

## Anti-goals

Any of these is a failure even if the code works:

- A response that differs from today, other than the accepted differences below.
- Any change to what the old path does while the switches are off, other than the streaming
  `$merge` audit fix (accepted difference 8).
- A profile that skips a central check without an `off` setting that shows it.
- An existing test edited to make the new path pass.

## Constraints

- **Responses and outputs stay the same.** That covers status codes, bodies, headers,
  OperationOutcome text, per-resource `$merge` results, `$import` output lines, access-log entry
  data, audit events, history rows, Kafka change events and Group member writes. These are the only
  accepted differences:
  1. A request that fails two checks may get a different one of the two errors than today, because
     the step order is fixed (see "Step order").
  2. Concurrent PUT or PATCH requests on the same resource use a version check and retry instead of
     last-write-wins (see "Concurrency").
  3. No-op reporting is fixed (see "No-op fixes").
  4. Admin writes get lookups by `_uuid`, access checks, audit events and the standard error format
     (see "Admin").
  5. `$merge` returns its results in request order instead of sorted by `_uuid` (user decision).
     - Request-level errors, such as Parameters without resources, come first.
     - Duplicate resources are still combined up front as today, and each resource gets one entry,
       at the position of its first item. Changing how duplicates are handled is a separate piece
       of work.
     - The audit `ids` and the access-log results follow the same order. For batches larger than
       the audit's id limit, that changes which ids share an AuditEvent.
     - Resources of different types that share one `_uuid` also come back in request order. Today
       the written one comes first.
     - Patient and person change events are sent in the order the writes run, so they follow the
       request order too. The events themselves are the same.
     - Writes are queued in request order, one at a time. The same new resource can be sent twice
       in one request, once by id and owner tag and once by its `_uuid`. Today two parallel inserts
       can both miss each other's pending write and queue two writes, which adds a second
       `created: false, updated: false` entry. The new path queues one write and returns one entry.
       The stored document is the same either way.
     - Streaming `$merge` still streams each line's failures as soon as the line is read, and the
       written results and placeholders at each commit of 100 resources. Within one line, such as
       a Bundle, its failures come in request order; today the pre-check failures come before the
       merge failures.
  6. `$import` checks the schema of each line's resource before the merge, as `$merge` does (user
     decision). Today the worker only checks the meta of a new resource there, and checks the
     schema of the merged or new document.
  7. PATCH returns 400 instead of 500 when the write returns no result (user decision). Today it
     reads the issue of a result that isn't there and fails with a TypeError.
  8. Streaming `$merge` audits each result once, as buffered `$merge` does, on both paths (user
     decision). Each commit audits the results streamed since the last audit, and the end of the
     stream audits any results left, also when the stream ends with an error or an abort. Today
     each commit queues an audit of the whole result list, read when the request ends, so a stream
     of k batches writes every AuditEvent k times, and a stream whose lines all fail writes none.
     The fix is in the stream code both paths share, so it is the one change to the old path while
     its switch is off, and turning the switch off does not undo it.
- **Scope letter per operation.** Each operation requires the same scope letter it does today.
- **preSave is unchanged.**
- **Shared building blocks keep today's behavior**, because the old path depends on them: the scopes
  validator, resource validator, resource merger, preSave manager, database bulk loader, fast
  database bulk inserter and bulk write executors, the attachment and base64 data managers, and the
  audit logger. When the new path needs different behavior, it lives in new code or behind a new
  opt-in parameter whose default is today's behavior and which existing callers never pass.
- **Copy or reuse.** Copying logic from the old flows into the new path is allowed when the result
  reads cleaner. Calling the existing functions is also fine.
- **Tenant isolation is unchanged.** The new path adds no new data access path: every lookup and
  access check goes through the same query and access-filter code the old path uses.
- **No PHI in logs or metrics.** Resource ids, `_uuid` and resource type are fine; resource bodies
  are not.
- **Repo rules apply.** Composition over inheritance (at most two levels), constructor injection
  wired in `src/createContainer.js`, camelCase file names under `src/`, and no Jira IDs in code or
  docs.

## Switches

`WRITE_PIPELINE_OPERATIONS` is a comma-separated list of the operations that use the new path. It is
read through a `configManager` getter, in the same style as `KAFKA_ENABLED_RESOURCES`. The default
is empty, meaning every operation uses the old path. An unknown name fails at startup with a clear
error.

| Name | Switch checked in | Covers |
|---|---|---|
| `create` | `CreateOperation.createAsync` (`src/operations/create/create.js`) | POST |
| `update` | `UpdateOperation.updateAsync` (`src/operations/update/update.js`) | PUT, including create-via-PUT |
| `patch` | `PatchOperation.patchAsync` (`src/operations/patch/patch.js`) | PATCH (JSON Patch), including the Group member strategy |
| `merge` | `MergeOperation.mergeAsync` and `mergeAsyncStream` (`src/operations/merge/merge.js`) | `$merge`, plus the GraphQL mutations in `patient.js` and `careTeam.js` that call `mergeAsync`. Streaming (NDJSON) `$merge` goes to `MergeStream` (`src/operations/writePipeline/responder/mergeStream.js`), a `MergeResponder` subclass that runs the shared steps on each line. Both paths keep the stream in `mergeAsyncStream`, which takes the path's handler for each line, flush and audit; it stays out of the pipeline core because no other operation streams (user decision) |
| `import` | the bulk-import handler's per-resource merge (`mergeBufferedResourceAsync` in `src/operations/asyncJobs/bulkImport/handler.js`) and its batch flush | `$import` worker |
| `admin` | the five admin write operations in `AdminPersonPatientLinkManager` (`src/admin/adminPersonPatientLinkManager.js`) and their route handlers in `src/routeHandlers/admin.js` | see "Admin" |

The switch check is the only change to these files. If the switch is on, the call goes to the
pipeline. If it is off, the existing code runs.

## Step order

Every operation runs these steps in this order:

0. **Read items**: split the body into items, merge duplicate entries, and reject any item that
   lacks what's needed to identify it: an id, a resourceType, a supported type, and either a UUID
   id or an owner/source-assigning-authority tag
1. **Scope check**
2. **Identify and find existing**: derive each item's `_uuid`, then load the stored doc
3. **Prepare body** (`_` fields)
4. **Validate incoming**: checks on the body alone
5. **Access before build** (stored doc, and for merge and import also the incoming body)
6. **Build new doc**
7. **Validate result**
8. **Access on result**
9. **Attachments**
10. **No-op check**
11. **Write** (with concurrency)
12. **Audit**
13. **Respond**

**Why this order (found while planning `$merge`).**
- **"Validate incoming" comes before "access before build".** For a new resource, the access check
  runs preSave, which asserts on a missing owner tag or source assigning authority, and
  `WriteAllowedByScopesValidator` rethrows anything that isn't a 403. With the access check first,
  a `$merge` create with a UUID id and no owner tag would fail the whole request with a 500 instead
  of getting today's per-resource 400.
- **"Validate incoming" means checks on the body alone.** Checks that compare the body with the
  stored doc belong to "validate result", after the access check, so nothing about a stored doc
  reaches a caller who can't access it. Examples: the patient-reference check, and the Person.link
  check against the stored links.
- **"Read items" and the scope check come before the `_uuid` is derived.** `$merge` results include
  `uuid` and `sourceAssigningAuthority`. Today a scope-forbidden entry has neither, because the scope
  check runs before identification. Deriving `_uuid` first would add them to every forbidden entry,
  which is not a two-check failure.
- **For `$merge`, two checks run at the start of step 2, before the `_uuid` is derived:** the
  AuditEvent size limit and the pipe-in-id check. That gives them the same input and the same entry
  fields as today.
- **Loading stored docs moves before schema validation for `$merge`.** That reads a few documents
  that fail validation, but responses don't change.

**Batches.** The pipeline works on a batch of items. POST, PUT and PATCH are a batch of one. Steps
run per item, except "find existing" and "write", which run once for the batch: `$merge` and
`$import` keep their bulk preload and single flush. When a check fails for an item, that item is
marked failed. The responder piece decides whether the failure is thrown (single-resource
operations) or reported as that item's result (`$merge`, `$import`).

**One flow, called explicitly; plain-data profiles (user decision).** `WritePipeline` calls each step
itself, one line per step, in the order above, so the whole flow reads top to bottom in one function.
There is no step list and no loop. The step classes live in `src/operations/writePipeline/steps/`.
A profile is plain data that says only what differs from the default: its name, the scope letter
and action, and the steps it turns `off`. Every step the profile doesn't turn off runs. A profile
with an unknown setting or an unknown step name fails before anything runs. Step 8 (access on
result) has no implementation yet. `$merge` never ran it, so the pipeline doesn't call it, and the
first operation that needs it adds both the call and the name.

**Per-operation pieces (user decision).** Each operation adds two files and passes both to
`WritePipeline.runAsync`:
- `src/operations/writePipeline/profiles/<operation>.js` holds its profile.
- `src/operations/writePipeline/responder/<operation>.js` holds one class. It extends `WriteResponder`
  (`responder/writeResponder.js`), whose constructor fails at startup if a method is missing. The class
  holds everything that depends on the operation's request and response format: reading the request
  into items (step 0), building the results and the response (step 13), and the operation's metrics.
  The metrics stay per operation because they differ: `$merge` records `fhir_merge_outcome_total` and
  its bundle size, and `$import` has its own metrics.

The operation's own file, for example `src/operations/merge/merge.js`, keeps today's code. When the
switch is on, it calls `writePipeline.runAsync({ profile, responder, requestInfo, parsedArgs,
resourceType })`. `runAsync` owns the rest of the request lifecycle:
- running the steps
- the write
- the audit (step 12)
- operation success and failure logging
- the access log

**The audit is shared (user decision).** Every write operation audits the same way, from the write
results. Per resource type, it writes one `create` AuditEvent for the created ids and one `update`
AuditEvent for the updated ids, with the request args. Failed entries get an error AuditEvent each.
`WriteAuditor` (`src/operations/writePipeline/writeAuditor.js`) does this for every run. Only the
reporting of failures differs:
- `$merge` and `$import` report each failure in a 200 response, so the auditor writes one error
  AuditEvent per failed resource.
- POST, PUT and PATCH throw their failure, and the route handler already writes that error audit.

When those operations move to the pipeline, their run must not also write per-item error audits.

A later operation that does a step differently, such as PATCH's search lookup or PUT's replace,
adds a named variant to that step. Its profile then picks the variant by name, still as plain data.

A step records a failure as a neutral value: which check failed, the OperationOutcome or error,
and the item's identity at that moment. The responder turns that value into the operation's result
or thrown error.

**Validate result before access on result (my call).** The access check runs preSave, which asserts
on a missing owner tag or source assigning authority. Validating the meta first means a malformed
document gets the validation error rather than an assertion. This differs from today only for PATCH
requests that fail both the access-tag check and validation; that falls under accepted difference 1.

**Side effects.** Where the pipeline controls ordering, attachment writes happen after every check,
not before as POST, PUT and PATCH do today. Side effects inside reused building blocks stay where
they are. For example, the resource merger deletes GridFS attachments during "build new doc".

**Checks that run before the merge today stay before it (my call).** `$merge` and `$import` check
the incoming body's access in `WriteAllowedByScopesValidator`, before any merge. In the new path
that check is part of step 5, not step 8. Otherwise a rejected item would already have had its
stored GridFS attachments deleted inside "build new doc".

## Profiles

The table is today's behavior, mapped from the code at the start of this work and updated for the
concurrent write resolver. Each profile must reproduce its column, except where a cell says "new". The builder confirms every value against the old path; where the table and
the code disagree, the code wins.

| Step | create | update | patch | merge | import | admin |
|---|---|---|---|---|---|---|
| Scope letter | `c` | `u`, also for create-via-PUT | `u` | `u`, also when the resource is new | `u` | none in the pipeline (the admin route checks admin scope, as today) |
| Find existing | none | by `_uuid` | search with the access filter: 0 hits is 404, more than 1 is 400 | bulk preload by `_uuid` | bulk preload | new: by `_uuid` with the access filter, 404 (see "Admin") |
| `_` fields | strip | strip | reject with 400 any op whose path starts with `/_` (this also rejects primitive-extension paths such as `/_birthDate`) | strip for validation, then restore `_uuid` and `_sourceAssigningAuthority` | strip | none (no client body) |
| Validate incoming | meta, schema, Person.link tenant check | schema, Person.link | – (the body is a JSON Patch) | schema with relaxed required fields; meta (owner tag) for a new resource | owner tag backfilled first; new: then the same checks as `$merge` (accepted difference 6) | – (no client body) |
| Access before build | new: full check, then access-tag change, on the body (moved from access on result; user decision) | stored doc (403) | stored doc | stored doc and incoming body (`WriteAllowedByScopesValidator`) | stored doc and incoming body | new: stored doc and every linked resource |
| Build new doc | insert | replace (no smart merge) | apply the JSON Patch; Group member strategy for Group | smart merge | smart merge | insert a new Person; smart merge to add a link; replace to remove a link or rewrite the patient reference |
| Validate result | – (same doc as incoming) | meta | meta, schema, Person.link | merged doc: meta, then `validateResourceAsync` with the stored doc (schema, Person.link, patient reference); new doc: `validateResourceAsync` | merged or inserted doc | new: meta, schema, Person.link; patient-reference check off for `updatePatientReference` only |
| Access on result | – (new: done before build) | access-tag change only | access-tag change only | off (the merged doc is not re-checked today) | off | new: full check and access-tag change for a created Person, access-tag change for an update |
| No-op | – | no write, 200 | no write; new: internal result `updated: false` (see "No-op fixes") | `created: false, updated: false` | new: counted as skipped (see "No-op fixes") | no write, silent |
| Write | insert (`If-None-Match: *` rejects existing) | `If-Match` / `If-None-Match`; a lost create is rebased as an update (200), and 409 when the rounds run out; new: updates are versioned too (see "Concurrency") | `_uuid` filter only; new: versioned, except Group PATCHes that change members | version filter, concurrent write resolver | version filter, concurrent write resolver | version filter |
| Audit | create | create or update | update | batched | the worker's own batching | new: create or update |
| Respond | thrown errors | thrown errors (412 possible) | thrown errors | per-resource issue, HTTP 200 | per-line result entry | new: thrown errors in the standard format |

Group details that must be kept: Group member writes happen before the Group write, as today, and
the ClickHouse member post-save stays synchronous inside the write.

## Concurrency

The concurrent write resolver does all conflict handling, in both paths. It detects the writes that
lost a version race and rebases each one onto the stored document. Before writing a rebased
document, it re-runs the two access checks against the rebase target. It writes the losers in bulk
rounds (`CONCURRENCY_RESOLUTION_ROUNDS`, default 3, with jittered backoff), and gives each loser
still conflicting after the last round a per-entry `conflict` issue. The new path calls the
resolver and does not add its own retry.

Until the resolver merges, a write that loses the race goes, in both paths, through the one-by-one
replay in the bulk inserter (`_updateResourcesOneByOneAsync` → `replaceOneAsync`). It merges the
caller's document into the latest stored version without re-running the access checks, so an
access tag removed by another writer between the check and the write can come back, and a create
that loses to another tenant's create of the same `_uuid` is merged into that document (owner and
source assigning authority stay protected). This is today's behavior, found by the security review
of the `$merge` PR; the resolver's access re-check closes it.

- **`$merge`, `$import` and the GraphQL mutations** behave in the new path exactly as in the old
  one.
- **PUT and PATCH updates** filter only on `_uuid` today, so they can't lose a race; the resolver
  counts them as won. In the new path they filter on `_uuid` and the `versionId` the new doc was
  built from, so a concurrent write makes them lose, and the resolver handles them.
  - **PUT:** the rebase is a replace (`smartMerge: false`), which the resolver already supports for
    a PUT that loses its create.
  - **PATCH:** the rebase must re-apply the JSON Patch to the rebase target. The resolver only
    merges, so it needs an opt-in per-entry rebase. The default is today's merge, and the old path
    never sets it. "Validate result" runs again on the re-patched doc.
  - When the rounds run out, the request returns 409 with the `conflict` issue (`ConflictError`), as
    a PUT that loses its create does today. A `forbidden` issue from the rebase access checks
    returns 403. The 409, and a 403 where PATCH would have given 404, are part of accepted
    difference 2.
  - PATCH deletes GridFS files it no longer references before the write. An attempt that does not
    commit must not have deleted files the stored document still references. How to prevent that
    is the builder's call. The resolver already deletes base64 uploads from uncommitted attempts.
- `SKIP_HANDLE_CONCURRENCY` turns conflict handling off in the new path too, as it does in the old
  one.
- **Group PATCHes that change members are excluded.** They keep today's `_uuid`-only write, with no
  version check and no retry. Member rows are committed before the Group document is written
  (`commitPendingMemberWrites` in `patch.js`), and for ClickHouse-backed Groups the member strategy
  writes the Group and appends the ClickHouse member events itself. A retry would commit those rows
  again, or append the events twice. Group PATCHes that don't touch members get the version check
  and retry like any other PATCH.
- PUT with `If-Match` keeps today's 412 behavior. PATCH does not start honoring `If-Match`, because
  that would change responses for clients that send it.
- Today's retry fallback lives inside the bulk write executor and always re-merges the document;
  it cannot re-apply a patch. The new path therefore needs its own conflict handling. That means
  new code, or an opt-in parameter on the bulk inserter or executor that existing callers never
  pass.

## No-op fixes

A no-op is a write whose built document equals the stored one, so nothing is written. Every
operation reports a no-op the way `$merge` does today: `created: false, updated: false`, no write,
no history row, no change event and no update audit.

- **`$import`:** today it counts an unchanged line as updated (`updated++`, `updated: true`) because
  it only knows the resource existed. In the new path the line counts as `skipped`, with
  `created: false, updated: false`. That is the counter and entry shape an `If-None-Exist` match
  already uses. Counts come from the pipeline's per-item results, including the flush results, so a
  rebase that finds no change also counts as skipped.
- **PATCH:** it already skips the write, but its internal result says `updated: true`. The new path
  returns `updated: false`. Clients don't see this field; the response writer only reads `created`.
- PUT, `$merge` and admin already behave this way.

## Admin

The admin profile changes behavior on purpose (accepted difference 4), so admin writes line up
with the other operations. It covers the five admin operations that write through
`AdminResourceWriter`:

| Route (`src/routeHandlers/admin.js`) | What it writes |
|---|---|
| `createPersonToPersonLink` | adds a Person link to another Person |
| `removePersonToPersonLink` | removes a Person link to another Person |
| `createPersonToPatientLink` | adds a Patient link to a Person, or creates a Person with that link |
| `removePersonToPatientLink` | removes a Patient link from a Person |
| `updatePatientReference` | points a resource's patient field at another Patient |

The admin deletes and the ExportStatus PUT are out of scope (see "Non-goals"). The person-match
routes and `triggerExport` don't write resources.

**Lookups.**
- Every id the caller passes (`bwellPersonId`, `externalPersonId`, `personId`, `patientId`,
  `resourceId`) must be a `_uuid`. Anything else gets a 400 `invalid` issue. Lookups by plain `id`,
  `id|authority` and `_sourceId` are dropped. Today those lookups have no tenant filter and return
  an arbitrary first match when an id exists in several tenants.
- Lookups use the access filter, like PATCH (my call). A target that is missing or that the caller
  can't access gets a 404.
- Linked resources are looked up and must exist: the other Person in `createPersonToPersonLink`,
  the Patient in `createPersonToPatientLink` (today only checked when a Person is created), and the
  new Patient in `updatePatientReference` (today never checked).
- Links are matched on `link.target._uuid`, not on the reference string.

**Checks.**
- The admin scope check at the route stays as it is. Resource-type scopes (`user/`, `system/`) are
  not required (my call); the access checks below are the tenant boundary.
- Production admin callers carry `access/*.*`, or access scopes for every tenant they work on, so
  these checks don't block them. That includes `createPersonToPersonLink`, which links Persons
  across tenants: the Person.link tenant check lets `access/*` callers through. A caller with
  narrower access scopes is limited to its own tenants.
- The stored target and every linked resource go through the access check before the build.
- The result goes through meta and schema validation and the Person.link tenant check. A created
  Person gets the full access check and the access-tag change check, like POST. An updated
  resource gets the access-tag change check, like PUT.
- **Allowed exception: patient-reference change.** The validator refuses any change to a resource's
  patient reference, for every caller (`validatePatientReference` in `resourceValidator.js`). The
  admin profile turns that one check off for `updatePatientReference` only. The new Patient must
  exist and be accessible. The rewritten reference is `Patient/<uuid>` with the old `_uuid`,
  `_sourceId` and `_sourceAssigningAuthority` cleared, so preSave recomputes them; today the old
  source assigning authority is left on the reference.
- Removing a link replaces the Person (no smart merge). Normal operations already allow that for
  non-patient callers, so it needs no exception.

**Audit.** Admin writes log `create` (the Person `createPersonToPatientLink` creates) or `update`
audit events, as PUT does. Failures log error audit events, as the FHIR error handler does. The
admin router does not drain the post-request queue, so audit and post-save tasks run before the
response, as `AdminResourceWriter` does today with its own request id.

**Errors.** Errors use the same format as other FHIR operations: the error's status code with its
issue (400 `invalid`, 403 `forbidden`, 404 `not-found`, 409 `conflict`), and 500 as
"Internal Server Error". Today every admin error is `code: 'exception'` with the message in
`diagnostics`. Cases that return HTTP 200 with `{message}` today become errors:
- missing parameters: 400
- target or linked resource not found: 404
- unsupported resource type: 400
- the admin-scope 403: a `forbidden` OperationOutcome

"Link already exists" and "link not present" are no-ops and keep today's 200 body. Success
responses are unchanged.

**Side outputs.** History rows, change events and the Patient/Person manual-link Kafka events stay
as today. Because input is `_uuid`-only, every manual-link event now carries the Patient `_uuid`;
today two of the three branches send the raw `patientId`.

**Rollout.** Admin callers must send `_uuid`s before the admin switch is turned on. Existing admin
tests that pass plain ids fail with the switch on. Like the other accepted differences, they are
updated to the new behavior and get `oldWrite` copies (see "Testing").

## Testing

- **New path by default in tests (user decision).** `jest/setEnvVars.js` sets
  `WRITE_PIPELINE_OPERATIONS` to every switch that has shipped, so the full suite in the existing
  16-shard `test` job, and every local run, uses the new path. Each operation's PR adds its name
  there. `configManager` reads the environment on each call, so a test file can set the variable
  for itself.
- **Retry-dependent case.** The parity case for a new resource sent by id and by `_uuid` in one
  request runs on the new path only. The new path queues one write for it (accepted difference 5);
  the old path's result depends on which retry code is in place, so it is not pinned.
- **Accepted differences (user decision).** No test is skipped. If an existing test fails on the new
  path only because of one of the accepted differences, its fixtures are updated to the new
  behavior, and the file is copied next to it as `oldWrite<Name>.test.js`, with the original name
  in camelCase (`data_sharing_scenario_1.test.js` becomes `oldWriteDataSharingScenario1.test.js`,
  following the repo's file naming rule). The copy turns the switch off and keeps the old
  fixtures, which move to an `oldWrite/` folder next to each changed fixture. For `$merge` that is
  26 tests in 25 files, all failing only on accepted difference 5: 24 expect results sorted by
  `_uuid`, one expects the written result first among resources that share one `_uuid`, and one
  expects change events in the old order. `merge.changeEvents.test.js` checks that both paths send
  the same change events.
- **Old path coverage (my call).** With the new path on by default, the old path is run by the
  `oldWrite` copies and the parity tests only. The coverage report the CI merges across its jobs
  shows how much of it they keep; more test files get `oldWrite` copies until the old path's
  coverage is close to what the full suite gave it before the switch. The `oldWrite` copies and
  their fixtures are deleted with the old path. For `$merge`, the first run with the switch on
  lost coverage only in `mergeManager.js`: 9 statements and 14 branches (the size pre-check, the
  extended Group member rejection, the meta and schema failures on update, and keeping the stored
  members of an externally stored Group). `oldWrite` copies of `auditEventSizeMerge`,
  `group_extended_put_merge_rejection`, `group_mongo_member_preservation` and `merge_meta` cover
  all of it again. Streaming `$merge` was run only by `stream_merge_with_id` and
  `metrics.merge.integration`, so both get `oldWrite` copies too, and its parity and audit tests
  run every case on both paths.
- **New tests:**
  - Integration tests for PUT and PATCH concurrency with the switch on: two concurrent writes both
    land, the version goes up by two, no PATCH operation is lost, and a write that keeps losing gets
    409 with a `conflict` OperationOutcome. A Group member PATCH still takes the `_uuid`-only write.
  - Integration tests for the no-op fixes: an unchanged `$import` line counts as skipped.
  - Integration tests for the admin changes, parameterized over the five operations: non-UUID ids
    get 400; a missing or inaccessible target or linked resource gets 404; a caller without access
    to the tenant gets 403/404, never a write; `updatePatientReference` changes the patient
    reference while PUT, PATCH and `$merge` still refuse it; audit events are written; errors use
    the standard format.
  - Admin tests use tokens with specific `access/` scopes. Today's admin test tokens always carry
    `access/*.*` (`getTokenWithCustomClaims` in `src/tests/integration/common.js`), which would hide
    a missing access check.
  - A `test.each` unit test for parsing `WRITE_PIPELINE_OPERATIONS`, including empty, single,
    several and unknown names.
- The existing access and tenant-isolation suites for these operations run on the new path in the
  main CI job.

## Observability

- One span per pipeline run, `WritePipeline.<operation>`, tagged with the operation and the batch
  size. It has one child span per step, `WritePipeline.<operation>.<step>`. Reading the request,
  the write and the audit get spans of their own: `WritePipeline.<operation>.readItems`,
  `.executeAsync` and `.audit`.
- No new metrics. The new path records the same metrics as the old one, for example
  `recordMergeOutcomes` and `recordInboundBundleSize` for `$merge` (user decision). The switch is a
  per-deployment env value, so which path ran is already known.
- One exception (user decision): validate incoming records each schema failure in
  `fhir_validation_failure_total` with `validation_stage="schema"` and `path="save"`, as POST, PUT
  and PATCH already do. The old `$merge` path never recorded incoming schema failures, so `$merge`
  shows them for the first time, and `$import` will once it moves.
- Failure logs carry the operation, step and failure stage, plus the resource's id, `_uuid`,
  source assigning authority and type, and the origin service. They also carry either the issue
  severity, code and expression, or the error. They never carry resource bodies, diagnostics or
  details text.

## Changes to announce

Changes that callers, dashboards or alerts can notice, to announce when each operation's switch is
first turned on. Entries are added as they are decided. Each says what changes and what happens
today.

**`$merge`**
- **Results in request order** (accepted difference 5). The per-resource results come back in the
  order the resources were sent, after any request-level errors such as a Parameters body without
  resources. Today they are sorted by `_uuid`. The audit `ids` and the access-log results follow
  the same order, so for batches larger than the audit's id limit, different ids share an
  AuditEvent. Patient and person change events are sent in the same order; the events themselves
  don't change. A new resource sent twice in one request, once by id and owner tag and once by its
  `_uuid`, now gets one result entry; today it can also get a second
  `created: false, updated: false` entry.
- **Which error a resource gets** (accepted difference 1). The checks run in one fixed order, so a
  resource that fails two of them may get the other of the two errors than today. The `$merge`
  parity tests and the full suite, which runs the new path, found no such case.
- **Schema failure metric.** An incoming resource that fails the schema check now counts in
  `fhir_validation_failure_total` (`validation_stage="schema"`, `path="save"`, with its resource
  type). Today `$merge` only counts schema failures of the merged or new document, which an
  invalid body never reaches, so dashboards and alerts on this metric see more `$merge` failures.
- **Streaming audits** (accepted difference 8). A streaming `$merge` writes one AuditEvent entry
  per result, as buffered `$merge` does. Today a stream of more than 100 resources writes every
  AuditEvent once per commit (a 150-resource stream writes each create twice), and a stream whose
  lines all fail writes no AuditEvent. This ships to both paths with the deploy, not with the
  `merge` switch.

**`$import`**
- **Incoming schema check** (accepted difference 6). Each line's resource gets the schema check,
  with required-field errors relaxed, before the merge, as in `$merge`. A line that fails gets an
  error line from that check. Today only the merged or new document's schema is checked, so a line
  can import when the merged document is valid, and a failing line's error comes from that later
  check.
- **Schema failure metric.** As for `$merge`.

**POST**
- **Access check before validation** (accepted difference 1). The full access check and the
  access-tag change check run on the body before the reference, Person.link and Group member
  limit checks. A POST that fails both gets 403 where today it gets 400.
- **No attachment writes on 403.** Today attachments and base64 data are stored before the access
  check, so a POST rejected with 403 has already stored them. The new path stores nothing for it.

**PATCH**
- **400 instead of 500** (accepted difference 7) when the write returns no result.

**Admin**
- **`createPersonToPatientLink` without `externalPersonId`** returns 400 `invalid`, like the other
  missing parameters (accepted difference 4). Today the manager reads the missing value and fails
  with a 500.

## Delivery

- There is one PR per operation, each turning on only its own switch.
- `$merge` goes first. That PR lands the pipeline core along with the batch model, the bulk preload,
  the smart-merge builder and the per-resource responder.
- The rest follow in this order (my call): import, create, update, patch, admin. `$import` comes
  next because it reuses most of the merge profile.
- The work is based on `main`. The write-flow cleanup PR goes first, and the `$merge` PR stacks on
  it until it merges (user decision). The PUT and PATCH PRs, which rely on the concurrent write
  resolver, wait for it to merge.
- Every PR runs the repo's security review against `review.md`, because these are write paths.

## ADR

This pattern is new to the repo, so it gets an ADR in MADR format:
`docs/adr/0004-unified-write-pipeline.md`, next to the repo's other ADRs. Options considered:

- **One pipeline plus per-operation profiles (chosen).** The central steps can't be skipped, and
  per-operation differences are data that can be read side by side.
- **A base class with one subclass per operation.** A subclass can override a step and quietly skip
  a check, which is exactly what this work is meant to prevent.
- **A per-operation list of step objects.** Each operation assembles its own list, so a missing
  check is easy to miss.
- **Refactoring the old flows in place without switches.** There is no safe way to roll back per
  operation, and every PR risks changing responses.

## Left to the builder

- Class and file names, and the folder (for example `src/operations/writePipeline/`), within the
  shared-steps rule in "Step order".
- For each step, whether to call the existing function or a cleaner copy.
- The mechanism for conflict handling in the new path (see "Concurrency").
- Metric and span names.
