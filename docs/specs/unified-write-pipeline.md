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
- In the new path, PUT writes with a version check and retries on conflict. PATCH gets the same
  with the concurrent write resolver; until then it keeps today's `_uuid`-only write (see
  "Concurrency").

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
  `$merge` audit fix (accepted difference 9).
- A profile that skips a central check without an `off` setting that shows it.
- An existing test edited to make the new path pass.

## Constraints

- **Responses and outputs stay the same.** That covers status codes, bodies, headers,
  OperationOutcome text, per-resource `$merge` results, `$import` output lines, access-log entry
  data (except one POST field, see "Source assigning authority in the access log" under POST in
  "Changes to announce", the PUT entry "Failure access-log entry" there, and the PATCH entry
  "A no-op PATCH" there), audit
  events, history rows, Kafka change events and Group member writes.
  These are the only accepted differences:
  1. A request that fails two checks may get a different one of the two errors than today, because
     the step order is fixed (see "Step order").
  2. Concurrent PUT requests on the same resource use a version check and retry instead of
     last-write-wins (see "Concurrency"). PATCH changes the same way once the concurrent write
     resolver lands; until then it keeps last-write-wins.
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
     schema of the merged or new document. It also gets the AuditEvent size limit, which it doesn't
     check today.
  7. PATCH returns 400 instead of 500 when the write returns no result (user decision). Today it
     reads the issue of a result that isn't there and fails with a TypeError.
  8. `$merge` runs the AuditEvent size limit and the pipe-in-id check after identification, on the
     body stripped of its `_` fields, so that it validates before it loads (user decision; see
     "Step order"). Today they run before identification, on the body as sent. So:
     - the AuditEvent size no longer counts the `_` fields a client sends;
     - for a non-UUID id, the AuditEvent size includes the source assigning authority tag that
       identification adds and leaves out the uuid-system identifiers it removes;
     - a size or pipe-in-id failure entry no longer echoes a `_uuid` or `_sourceAssigningAuthority`
       that the client sent in the body.
  9. Streaming `$merge` audits each result once, as buffered `$merge` does, on both paths (user
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
| `merge` | `MergeOperation.mergeAsync` and `mergeAsyncStream` (`src/operations/merge/merge.js`) | `$merge`, plus the GraphQL mutations in `patient.js` and `careTeam.js` that call `mergeAsync`. Streaming (NDJSON) `$merge` goes to `MergeStream` (`src/operations/writePipeline/operations/merge/mergeStream.js`), which reads each line with the `MergeResponder` it holds and runs the shared steps on it. Both paths keep the stream in `mergeAsyncStream`, which takes the path's handler for each line, flush and audit; it stays out of the pipeline core because no other operation streams (user decision) |
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
2. **Identify**: derive each item's `_uuid`, without reading the database
3. **Prepare body** (`_` fields)
4. **Validate incoming**: checks on the body alone: the AuditEvent size limit and the pipe-in-id
   check, for every operation, then the schema check
5. **Find existing**: load the stored doc
6. **Validate new resource**: the meta check for an item with no stored doc
7. **Access before build** (stored doc, and for PUT, POST, merge and import also the incoming
   body: its access and its access-tag change)
7a. **Validate against stored** (PUT only, and temporary): `validateResourceAsync` on the body
   with the stored doc, before the build. Every other operation turns it off
8. **Build new doc**
9. **Validate result**: checks on the built doc, including `validateResourceAsync` (the Group
   member limit, the schema of the write-serialized doc, and Person.link)
10. **Access on result** (`accessOnResult`): the access-tag change from the stored doc to the
   built doc, removals counted. On for PATCH; off for POST, PUT and `$merge`, which check the
   change in step 7
11. **Attachments**
12. **No-op check**
13. **Write** (with concurrency)
14. **Audit**
15. **Respond**

**Why this order (found while planning `$merge`).**
- **"Validate incoming" and "validate new resource" come before "access before build".** For a new
  resource, the access check runs preSave, which asserts on a missing owner tag or source assigning
  authority, and `WriteAllowedByScopesValidator` rethrows anything that isn't a 403. With the access
  check first, a `$merge` create with a UUID id and no owner tag would fail the whole request with a
  500 instead of getting today's per-resource 400 from the meta check.
- **"Validate incoming" means checks on the body alone.** Checks that compare the body with the
  stored doc belong to "validate result", after the access check, so nothing about a stored doc
  reaches a caller who can't access it. Examples: the patient-reference check, and the Person.link
  check against the stored links. PUT runs them in the "validate against stored" step (7a), after
  the access check and before the build, because the build's merge soft-deletes the stored GridFS
  attachments the body drops or changes, and a body that fails them must leave those attachments
  active.
- **"Read items" and the scope check come before the `_uuid` is derived.** `$merge` results include
  `uuid` and `sourceAssigningAuthority`. Today a scope-forbidden entry has neither, because the scope
  check runs before identification. Deriving `_uuid` first would add them to every forbidden entry,
  which is not a two-check failure.
- **`$merge` validates before it loads, as today (user decision).** The old path checks each
  resource's size and pipe-in-id, identifies it, strips its `_` fields, checks the schema, and only
  then bulk-loads the stored docs. So "identify" runs before "prepare body", which saves the derived
  `_uuid` and source assigning authority, and "find existing" runs after "validate incoming": a
  resource that fails a body check is not loaded.
- **The size limit and the pipe-in-id check run at the start of step 4,** on the body stripped of
  its `_` fields, before the saved `_uuid` and source assigning authority are restored. They are
  part of "validate incoming", so they apply to every operation that has a resource body. PATCH has
  none, because its body is a JSON Patch, and turns the whole step off; no other profile turns them
  off: AuditEvent update, patch and remove get 405 from `ResourceOperationAccessProvider`, and every
  operation either rejects a pipe in the id or can't produce one. A resource that fails one of them
  skips the schema check. In `$merge` today they run before identification, on the body as sent.
  That changes what they measure and the entry fields they report (accepted difference 8). It also
  changes which error wins when identification fails too (accepted difference 1): a non-UUID id
  whose owner or source assigning authority tag has no `code` passes "read items", which checks only
  the tag's `system`, and then fails identification with "sourceAssigningAuthority is null". If that
  resource also has a pipe in its id or is an oversized AuditEvent, it now gets the identification
  error instead of the pipe-in-id or size error.
- **"Validate new resource" comes after "find existing".** The meta check (owner tag) applies only to
  a resource that isn't stored yet, so it needs the load. That is also where the old path runs it.

**Batches.** The pipeline works on a batch of items. POST, PUT and PATCH are a batch of one. Steps
run per item, except "find existing" and "write", which run once for the batch: `$merge` and
`$import` keep their bulk preload and single flush. When a check fails for an item, that item is
marked failed and gets no further step; once no item of the batch is active, the remaining steps do
not run. The responder piece decides whether the failure is thrown (single-resource
operations) or reported as that item's result (`$merge`, `$import`).

**One flow, called explicitly; plain-data profiles (user decision).** `WritePipeline` calls each step
itself, one line per step, in the order above, so the whole flow reads top to bottom in one function.
There is no step list and no loop. The step classes live in `src/operations/writePipeline/steps/`.
A profile is plain data that says only what differs from the default: its name, the scope letter
and action, the steps it turns `off`, and the step variants it uses. Every step the profile doesn't
turn off runs. The container gives `WritePipeline` every profile, and the pipeline checks them once,
when it is built. The app builds it at startup, so a profile with an unknown setting, an unknown
step name or an unregistered variant stops the boot. A run with a profile the pipeline was not
given fails before anything runs. Step 10 is `accessOnResult`: it checks that the caller may make
the access-tag changes between the stored doc and the built doc. Its default checker,
`AccessTagChangeChecker`, is on for PATCH, whose body is a JSON Patch, so its access tags are known
only after the build. It is off for POST, PUT and `$merge`, which check the change before the build
(step 7), and `$import` keeps it off when it ships. Admin gets its own variant later.

**Per-operation pieces (user decision).** Each operation has its own folder,
`src/operations/writePipeline/operations/<operation>/`, with two files that it passes to
`WritePipeline.runAsync`:
- `profile.js` holds its profile.
- `responder.js` holds one class. It extends `WriteResponder` (`writePipeline/writeResponder.js`),
  whose constructor fails at startup if a method is missing. The class
  holds everything that depends on the operation's request and response format: reading the request
  into items (step 0), building the results and the response (step 15), and the operation's metrics.
  The metrics stay per operation because they differ: `$merge` records `fhir_merge_outcome_total` and
  its bundle size, and `$import` has its own metrics.

The operation's own file, for example `src/operations/merge/merge.js`, keeps today's code. When the
switch is on, it calls `writePipeline.runAsync({ profile, responder, requestInfo, parsedArgs,
resourceType })`. `runAsync` owns the rest of the request lifecycle:
- running the steps
- the write
- the audit (step 14)
- operation success and failure logging
- the access log

A caller that writes many batches in one longer job, such as streaming `$merge`, does not use
`runAsync`. It calls `processAsync` for each batch and `executeAsync` at each flush, and does its
own audit, logging and response.

Anything else that belongs to one operation is in its folder too: `MergeStream` is in
`operations/merge/`. What POST and PUT share is in `operations/singleResource/`.

POST and PUT throw a failed check instead of reporting it as a result. Their responders share that
in `operations/singleResource/singleResourceResult.js`: the error for each failure stage, the failure access-log
entry (with the failed resource's uuid for both), and the check that the flush returned a result. The rules for a write that carries Group
members are in `groupMemberWrites.js`, for the build, attachments and write steps.

**The audit is shared (user decision).** Every write operation audits the same way, from the write
results. Per resource type, it writes one `create` AuditEvent for the created ids and one `update`
AuditEvent for the updated ids, with the request args. Failed entries get an error AuditEvent each.
`WriteAuditor` (`src/operations/writePipeline/writeAuditor.js`) does this for every run. Only the
reporting of failures differs:
- `$merge` and `$import` report each failure in a 200 response, so the auditor writes one error
  AuditEvent per failed resource.
- POST, PUT and PATCH throw their failure, and the route handler already writes that error audit.

When those operations move to the pipeline, their run must not also write per-item error audits.

An operation that does a step differently, such as POST's insert, PATCH's search lookup or PUT's
replace, adds a named variant to that step. A variant is a separate step instance that
`WritePipeline` holds by step name and variant name (its `stepVariants`). The profile picks it by
name in its `variants` setting, still as plain data, and `WritePipeline` runs it in place of the
default step. A step the profile names no variant for runs its default, and adding a variant doesn't
change the step it replaces. POST is the first user. It picks only `buildDocument: 'insert'`, and
turns `findExisting` off, because a new resource has no stored doc to load and no operation needs a
loader that loads nothing. It runs the shared identify, validate incoming, validate new resource
and validate result steps. Its id is a new UUID, so identify only copies the id to `_uuid`. PUT
picks three variants and turns off only `accessOnResult`: `identify: 'url'` (the identity from the
URL id), `buildDocument: 'replace'` (the `If-Match` / `If-None-Match` checks, then a replace of the
stored doc, or POST's insert when none is stored) and `write: 'httpPreconditions'` (a versioned
write that queues the `If-Match` list, so a replayed write checks it again). PATCH picks five
(`findExisting: 'search'`, `accessBeforeBuild: 'stored'`, `buildDocument: 'patch'`,
`attachments: 'alwaysCreateNew'` and `write: 'patch'`) and turns off the steps that read a resource
body (see "PATCH" under "Profiles"). The identify, load, build and write steps each take the piece
that varies as a constructor argument, so a variant is the same step class with another piece: an
identity resolver (`steps/identify/`), a loader for the stored doc (`steps/load/`), a builder
(`steps/build/`) or a writer (`steps/write/`: `VersionedWriter` by default,
`HttpPreconditionWriter` for PUT, `PatchWriter` for PATCH). The access check takes its checker the
same way (`steps/access/`), and the attachments step takes an option for its base64 upload.

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
that check is part of step 7, not step 10. Otherwise a rejected item would already have had its
stored GridFS attachments deleted inside "build new doc".

**Every operation with a resource body checks its access tags in step 7.** PUT, POST, `$merge` and
`$import` check the access-tag change on the incoming body before the build. For each, the check on
the body gives the same answer as a check on the built doc:
- PUT replaces (`smartMerge: false`), so the built doc has exactly the body's access tags, plus the
  owner and source assigning authority tags the merger forces. A body without `meta.security` gets
  only those two. Removals count.
- POST inserts the body; it doesn't go through the merger.
- `$merge` and `$import` smart-merge, which keeps every stored `meta.security` entry and adds the
  body's new ones. They only add tags, so checking the body's additions, with removals ignored,
  gives the same answer.

## Profiles

The table is today's behavior, mapped from the code at the start of this work and updated for the
concurrent write resolver. Each profile must reproduce its column, except where a cell says "new". The builder confirms every value against the old path; where the table and
the code disagree, the code wins.

| Step | create | update | patch | merge | import | admin |
|---|---|---|---|---|---|---|
| Scope letter | `c` | `u`, also for create-via-PUT | `u` | `u`, also when the resource is new | `u` | none in the pipeline (the admin route checks admin scope, as today) |
| `_` fields | strip | strip | reject with 400 any op whose path starts with `/_` (this also rejects primitive-extension paths such as `/_birthDate`); the reader also rejects a content type other than `application/json-patch+json` with 400, and both checks run before the scope check | strip for validation, then restore `_uuid` and `_sourceAssigningAuthority` | strip | none (no client body) |
| Validate incoming | new: shared with `$merge`: the AuditEvent size limit, the pipe-in-id check, then the raw body's schema (accepted difference 1); the pipe-in-id check never fires, because POST replaces the id with a new UUID | new: shared with `$merge`: the AuditEvent size limit, the pipe-in-id check, then the raw body's schema (accepted difference 1); Person.link moves to validate result; the size and pipe-in-id checks never fire: AuditEvent update gets 405 from `ResourceOperationAccessProvider` before the pipeline, and `IdParser` puts only the part before the first `\|` into the body id | – (the body is a JSON Patch) | on the stripped body: AuditEvent size limit and pipe-in-id check, then schema with relaxed required fields | owner tag backfilled first; pipe-in-id check, as today; new: the AuditEvent size limit and the schema check, as in `$merge` (accepted difference 6) | – (no client body) |
| Find existing | off (no stored-document lookup) | by `_uuid`, as today; new: a bulk preload of one (`BulkPreloadLoader`, no access filter, as today) | `findExisting: 'search'` (`SearchExistingLoader`): the same search with the access filter as today; 0 hits is 404 `Resource not found: <Type>/<id>`, more than 1 is 400 listing the sorted `id\|authority` options; it copies the stored doc's `id`, `_uuid` and `_sourceAssigningAuthority` onto the item | bulk preload by `_uuid`, after validate incoming, so a resource that fails it is not loaded | bulk preload | new: by `_uuid` with the access filter, 404 (see "Admin") |
| Validate new resource | meta; new: after the size and schema checks, as in `$merge` (accepted difference 1) | new: meta, for create-via-PUT (today it runs on the body after the build) | – | meta (owner tag) for a new resource | meta for a new resource, as today | – |
| Access before build | new: right after validate new resource, full check, then access-tag change, on the body (moved from access on result; user decision) | stored doc (403); new: as `$merge`: the stored doc, then the access-tag change from the stored doc to the body, removals counted; for create-via-PUT, POST's full check and access-tag change. Today the tag check runs on the built doc, after the build and the uploads | stored doc, scope letter `u` (`accessBeforeBuild: 'stored'`, `StoredAccessChecker`) | stored doc and incoming body (`WriteAllowedByScopesValidator`) | stored doc and incoming body | new: stored doc and every linked resource |
| Validate against stored | off | on, for an item with a stored doc: `validateResourceAsync` on the body with the stored doc (Group member limit, schema, Person.link, patient reference), as today's PUT does before it merges; temporary, see "Why this order" | off | off | off | off |
| Build new doc | insert | replace (no smart merge), after the extended Group 400 and the `If-None-Match` / `If-Match` 412s; create-via-PUT builds as POST's insert, after the `If-Match` 412 | `buildDocument: 'patch'` (`PatchBuilder`): apply the JSON Patch to a copy of the stored doc; Group member strategy for Group (see "PATCH" below); a patch that changes nothing builds no doc | smart merge | smart merge | insert a new Person; smart merge to add a link; replace to remove a link or rewrite the patient reference |
| Validate result | new: on, `validateResourceAsync` on the built document (Group member limit, schema of the write-serialized document, Person.link), as for a new `$merge` doc | for an update, meta on the built doc, because "validate against stored" has already run `validateResourceAsync` on the body; for create-via-PUT, `validateResourceAsync` on the built doc. Today: `validateResourceAsync` on the body before the build, then the schema of the write-serialized body, then meta on the built doc | meta, schema, Person.link | merged doc: meta, then `validateResourceAsync` with the stored doc (Group member limit, schema, Person.link, patient reference); new doc: `validateResourceAsync` | merged or inserted doc | new: meta, schema, Person.link; patient-reference check off for `updatePatientReference` only |
| Access on result | off (new: done before build) | off; new: the access-tag change is checked before the build. Today it runs here | on: the access-tag change from the stored doc to the built doc, removals counted (`AccessTagChangeChecker`); a no-op has no built doc and is skipped | off (the merged doc is not re-checked today) | off | new: full check and access-tag change for a created Person, access-tag change for an update |
| No-op | – | no write, 200 | no write; new: `updated: false`, the response carries the stored doc, an access-log entry is stored and the result checks are skipped (see "No-op fixes") | `created: false, updated: false` | new: counted as skipped (see "No-op fixes") | no write, silent |
| Write | insert (`If-None-Match: *` rejects existing) | `If-Match` / `If-None-Match`; new: updates are versioned (`_uuid` and the stored `versionId`), and a lost race goes through today's replay, which re-checks `If-Match`, until the resolver (see "Concurrency") | `write: 'patch'` (`PatchWriter`): `_uuid` filter only, as today, with no version filter, no retry and no 409; the version filter comes with the resolver (see "Concurrency") | version filter, concurrent write resolver | version filter, concurrent write resolver | version filter |
| Audit | create | create or update | update | batched | the worker's own batching | new: create or update |
| Respond | thrown errors | thrown errors (412 possible) | thrown errors | per-resource issue, HTTP 200 | per-line result entry | new: thrown errors in the standard format |

Group details that must be kept: Group member writes happen before the Group write, as today, and
the ClickHouse member post-save stays synchronous inside the write.

A Group keeps one entry per member on every write, as the old paths do (`GroupMemberMerger`). In
`$merge`, the build merges the stored Group's own repeated entries first, after its preSave, so a
body that changes nothing else still equals the stored Group and writes nothing. It merges a new
Group's entries after stamping the version and before validation, so the per-member entry limit
fails only that item. A write that sends its members to ClickHouse keeps `member[]` as sent. The
other operations merge members in their own builders.

**PATCH.** Its body is a JSON Patch, so `PatchResponder` reads the request into one stub item that
holds the resource type, the URL id and the patch. The steps that check a resource body
(`identify`, `prepareBody`, `validateIncoming` and `validateNewResource`) or compare one with the
stored doc (`validateAgainstStored`) are `off`; the size and pipe-in-id checks are in
`validateIncoming`, because they apply to every operation that has a resource body. The profile
names five variants:
- `findExisting: 'search'` and `accessBeforeBuild: 'stored'` find the stored doc with the
  access-filtered search and check that the caller may update it, with scope letter `u`. A rejected
  PATCH reaches no GridFS, Group member or ClickHouse write.
- `buildDocument: 'patch'` (`PatchBuilder`) never modifies the stored doc. It prepares the Group's
  member writes (see the table below), applies the rest of the patch to a copy of the stored doc
  with its GridFS attachments and base64 data read back in, reverts the fields a write may not
  change, runs preSave, keeps one entry per member of an embedded Group, and checks the patched doc
  against the schema before it is normalized. So a PATCH that adds a field FHIR does not define is
  rejected with the schema 400, as before; the normalized copy that "validate result" checks has
  already dropped the field. It bumps the version when the doc or a pending member write changed.
  Otherwise the item is a no-op with no built doc, which "access on result" and "validate result"
  skip.
- `attachments: 'alwaysCreateNew'` is the shared attachments step with `alwaysCreateNewBase64` on,
  because today's PATCH uploads a base64 value to a new live key every time: its write has no
  version check. POST, PUT and `$merge` keep the default.
- `write: 'patch'` (`PatchWriter`) runs after every check, in today's order. It marks the stored
  GridFS files that the patch removed or replaced inactive, promotes an embedded Group that went
  over the member limit, commits an extended Group's member rows, then queues `replaceOneAsync` by
  `_uuid` alone, with `groupMemberEventsWritten` set when the patch has member operations. A PATCH
  that fails a check leaves its GridFS files active.

The build prepares a Group's member writes and the write commits them:

| Group type | Build | Write |
|---|---|---|
| embedded (not extended, no external storage) | the JSON Patch, then one entry per member; no member write | promotes the Group when it is over the promotion limit (member rows written, `_extended` set), then the Group |
| extended (`_extended`) | the member operations become pending member writes; the Group is bumped even when only members change | commits the member rows with the candidate's version, last-updated and security tags, then the Group |
| external storage (ClickHouse) | the member operations are parsed and enriched into events; the candidate is the stored Group with its version bumped, plus the non-member patch | the Group; after the flush, the events, for an item the flush updated |

The write step has an optional after-flush hook. `WriteStep.afterFlushAsync({ items, context,
executedResults })` calls the writer's own `afterFlushAsync` when it has one, and
`WritePipeline.runAsync` calls it once, after the flush, after it builds the results and after it
queues the audit, so a write the flush committed is audited even if the hook throws; an error from
the hook is still thrown. The hook has nothing to do when the results throw, because PATCH's
results throw only when the flush returned no result or a result that was neither created nor
updated, and `PatchWriter` writes events only for a Group the flush updated. `WritePipeline`
rejects at construction a `write` variant that has no `afterFlushAsync` function. The default
writers have none, and a streaming `$merge`, which doesn't use `runAsync`, never calls it. Its only
user is PATCH: `PatchWriter` writes an external-storage Group's ClickHouse member events there, so
they follow the Group's commit, as today.

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
of the `$merge` PR; the resolver's access re-check closes it. A PUT's replay replaces instead of
merging, because its entries are queued with `smartMerge: false`: the caller's body replaces the
latest stored version, still without the access re-check.

- **`$merge`, `$import` and the GraphQL mutations** behave in the new path exactly as in the old
  one.
- **PUT and PATCH updates** filter only on `_uuid` today, so they can't lose a race; the resolver
  counts them as won. In the new path PUT filters on `_uuid` and the `versionId` the new doc was
  built from, so a concurrent write makes it lose, and the resolver handles it. PATCH keeps the
  `_uuid`-only filter until the resolver's PR (see its bullet below).
  - **PUT:** the rebase is a replace (`smartMerge: false`), which the resolver already supports for
    a PUT that loses its create.
  - **PUT ships before the resolver (user decision),** with the version filter: the resolver
    changes only the retry, not the filter. Until it lands, a PUT that loses a race goes through
    today's one-by-one replay. The update is queued with `smartMerge: false` and its `If-Match`
    list, so the replay replaces the latest stored version with the caller's body and checks
    `If-Match` against that version again (412 if it no longer matches).
    - When the replay's retries run out, the caller gets today's 500 (`Unable to save resource
      <T>/<uuid> with version <v> (original=<o>) after 10 tries.`). The resolver changes it to 409.
    - A create without `If-None-Match` that loses to another create of the same `_uuid` is replayed
      as a replace of the winner, on the winner's identity, and answers 201, until the resolver.
      Today the replay merges it into the winner. With `If-None-Match: *` it gets 412, as today.
    - The forced Group write (an unchanged ClickHouse-backed Group whose body sends members) keeps
      today's `replaceOneAsync` call and its `If-Match` filter. Without a specific `If-Match` it
      writes by `_uuid` alone, with no version check, like every PATCH until the resolver. With
      one, the `If-Match` versions are in the filter, so a lost write goes through today's replay
      and gets 412 if `If-Match` no longer matches.
    - A changed Group whose body sends members, when the request asks for external storage and
      ClickHouse is on for Group, is also written by `_uuid` alone unless the request sends a
      specific `If-Match`, as today. Its members are not in the stored doc, so a lost versioned
      write whose replay finds the doc unchanged would be skipped with its member write and
      answered 200. With a specific `If-Match` it keeps the version filter, and a lost write gets
      412 from the replay if `If-Match` no longer matches.
    - The new path doesn't pass `alwaysCreateNew` to the base64 upload, now that PUT is versioned:
      an unchanged base64 value keeps its live key, as in `$merge`, and a lost race is reconciled by
      the replay. PATCH still passes it, because its write has no version check yet.
    - After a replay the response body, `ETag` and version are those of the attempt that lost, one
      version behind the stored doc. That is today's replay behavior on both paths; the resolver
      fixes it.
  - **PATCH keeps today's write until the resolver's PR.** It writes by `_uuid` alone: no version
    filter, no retry and no 409. A concurrent write can still be overwritten, and a resource
    deleted between the read and the write is re-created by the executor's replay, as today. The
    resolver's PR adds the version filter and the re-patch rebase together (and `ConflictError`).
    The rebase must re-apply the JSON Patch to the rebase target. The resolver only merges, so it
    needs an opt-in per-entry rebase. The default is today's merge, and the old path never sets it.
    "Validate result" runs again on the re-patched doc.
  - When the rounds run out, the request returns 409 with the `conflict` issue (`ConflictError`,
    which the resolver's PR adds), as a PUT that loses its create does today. A `forbidden` issue
    from the rebase access checks returns 403. For PATCH, the 409, and a 403 where PATCH would have
    given 404, are part of accepted difference 2 from the resolver's PR on.
  - PATCH deletes GridFS files it no longer references before the write: `PatchWriter` marks them
    inactive just before it queues the write, after every check. Once PATCH has a version filter,
    an attempt that does not commit must not have deleted files the stored document still
    references. How to prevent that is for the resolver's PR to decide. The resolver already
    deletes base64 uploads from uncommitted attempts.
- `SKIP_HANDLE_CONCURRENCY` turns conflict handling off in the new path too, as it does in the old
  one.
  - **PUT with conflict handling off.** A versioned write that loses is then not replayed, so it
    would be dropped and still answered 200. So PUT writes by `_uuid` alone, today's
    last-write-wins, unless the request sends a specific `If-Match` (not `*`). With one, it keeps
    the stored `versionId` in the filter, which the build has checked is in the `If-Match` list, as
    today's `If-Match` filter does. A PUT that then loses the race is dropped and answered 200 with
    the caller's body, on both paths: the stored doc stays the competitor's, and history gets a row
    for the dropped version with the caller's body.
  - One edge differs (user decision, kept): an `If-Match` that lists several versions, where a
    competing write moves the doc from one listed version to another before the write. Today the
    filter matches any listed version, so the PUT lands. The new path filters on the version it
    built from, so the PUT is dropped and answered 200.
  - Not changed by this work: with conflict handling off, a `$merge` write that loses its version
    filter is dropped the same way on both paths today.
- **All PATCHes keep today's `_uuid`-only write until the resolver's PR,** with no version check
  and no retry. That includes Group PATCHes that change members, which need care when that PR
  versions PATCH: member rows are committed before the Group document is written
  (`commitPendingMemberWrites`, called from `PatchWriter`), and for ClickHouse-backed Groups the
  member events are appended after the flush. A retry would commit those rows again, or append the
  events twice.
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
- **PATCH:** it already skips the write, but it answers `updated: true`. The new path answers
  `updated: false`, with the stored doc, and stores an access-log entry for the unchanged resource.
  It also skips the shared result checks, because there is no built doc (see "A no-op PATCH" in
  "Changes to announce"). Clients don't see the `updated` field; the response writer only reads
  `created`.
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
  there; it is now `merge,create,update,patch`. `configManager` reads the environment on each call,
  so a test file can set the variable for itself.
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
  the same change events. For POST it is 1 test in 1 file, `create_fast_serializer.test.js`
  (copied as `oldWriteCreateFastSerializer.test.js`), failing only on accepted difference 1: it
  expects a Group over the member limit that also fails the schema check to get the `too-costly`
  400. For PUT it is 2 files: `update_fast_serializer.test.js` (copied as
  `oldWriteUpdateFastSerializer.test.js`), failing only on accepted difference 1 with the same
  over-limit Group with an invalid field, and `blobStorage.test.js` (copied as
  `oldWriteBlobStorage.test.js`), whose PUT with an unchanged base64 value now keeps its live key
  (see "Base64 live key kept" under PUT). Both copies turn only `update` off.
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
    409 with a `conflict` OperationOutcome. PUT's 409 test comes with the resolver PR; until then
    PUT's concurrency test pins today's 500. PATCH's concurrency tests all come with the resolver
    PR, which adds its version filter; until then a unit test pins that it writes by `_uuid` alone
    (`queuesReplaceByUuidWithoutVersionFilter` in `patchWriter.test.js`).
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
  - POST, in `src/tests/integration/operations/writePipeline/operations/create/`:
    - `create.test.js`: parity, 25 cases run on both paths against goldens recorded from the old
      path, plus a routing test for each switch position. One case,
      `typeMismatchWithoutMetaSource`, pins the type-mismatch case of accepted difference 1 with a
      golden per path. Another, `emptyBody`, pins the 400 for a POST with no body with a status
      and a golden per path. Five more, `invalidSchemaWithoutOwner`,
      `personLinkOtherTenantTagNotGrantable`, `auditEventTooLargeWithoutMetaSource`,
      `auditEventTooLargeInvalidSchema` and `groupOverLimitWithInvalidField`, pin the two-check
      cases of `$merge`'s validation order with a golden per path, recorded from each path, and a
      status per path where it differs. One more, `auditEventTooLargeAccessTagNotGrantable`, pins that an oversized AuditEvent with an
      access tag the caller can't grant gets 413 on both paths, with one golden.
    - `create.audit.test.js`, `create.accessLog.test.js` and `create.attachments.test.js`: the
      AuditEvents, the access-log entry, and the attachment stored for a POST rejected with 403, on
      both paths.
    - `create.metrics.test.js`: the `fhir_validation_failure_total` labels and count for each
      failing validation case, on both paths.
  - The unit test `src/tests/unit/operations/writePipeline/operations/create/responder.test.js`, for the
    errors `CreateResponder` throws per failure stage, for a missing body, and for a flush that
    returns no usable result, which can't be produced end to end.
  - PUT, in `src/tests/integration/operations/writePipeline/operations/update/`:
    - `update.test.js`: parity, 51 cases run on both paths against goldens recorded from the old
      path, with the status, body, `ETag` (for a 2xx), `Location` and `Content-Location`, and the
      stored doc and history rows after the request. One case, `auditEventPut405`, pins that an
      AuditEvent PUT gets 405 on both paths, before the pipeline. Twelve cases have a golden and
      status per path, and each traces to a PUT entry in "Changes to announce": `emptyBody`,
      `arrayBody`, `typeMismatchWithoutScope`, `invalidSchemaStoredNotAccessible`,
      `ifMatchMismatchPatientReferenceChanged`, `accessTagRemoveNotGrantableInvalidReference`,
      `createViaPutPersonLinkOtherTenantAccessDenied`, `groupOverLimitWithInvalidField`,
      `noOpGroupOverLoweredLimit`, `base64UnrelatedFieldChanged`, `noMetaSecurityScopedCaller` and
      `noMetaSecurityFullAccess`.
    - `update.audit.test.js`, `update.accessLog.test.js`, `update.attachments.test.js` and
      `update.metrics.test.js`: the AuditEvents, the access-log entry, the GridFS files and base64
      objects stored or deleted, and the `fhir_validation_failure_total` labels and count, on both
      paths.
    - `update.concurrency.test.js`, new path only: two concurrent PUTs both land, `If-Match` and
      `If-None-Match: *` re-checked on a lost race, a lost create replayed as a replace, today's
      500 when the retries run out, and both `SKIP_HANDLE_CONCURRENCY` cases.
  - PUT unit tests, under `src/tests/unit/operations/writePipeline/`: `operations/update/responder.test.js`
    (the errors `UpdateResponder` throws per failure stage, and its results and response),
    `steps/identify/urlIdentityResolver.test.js`, `steps/build/replaceBuilder.test.js`,
    `steps/write/httpPreconditionWriter.test.js` (the queued filter, `If-Match` and `smartMerge`,
    also with conflict handling off) and `httpPreconditions.test.js`; and
    `src/tests/unit/dataLayer/fastDatabaseBulkInserter.test.js` for the two opt-in parameters.
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
  resource that fails two of them may get the other of the two errors than today. One such case is
  known: a resource with a non-UUID id whose owner or source assigning authority tag has no `code`
  now gets the "sourceAssigningAuthority is null" error, even when it also has a pipe in its id or
  is an oversized AuditEvent. Today it gets the pipe-in-id or the size error.
- **Schema failure metric.** An incoming resource that fails the schema check now counts in
  `fhir_validation_failure_total` (`validation_stage="schema"`, `path="save"`, with its resource
  type). Today `$merge` only counts schema failures of the merged or new document, which an
  invalid body never reaches, so dashboards and alerts on this metric see more `$merge` failures.
- **AuditEvent size without the client's `_` fields** (accepted difference 8). The AuditEvent size limit is measured on
  the body after its `_` fields are stripped, so fields starting with `_` that a client sends no
  longer count toward the limit. Today they do.
- **AuditEvent size after identification** (accepted difference 8). For an AuditEvent whose id is not a UUID, the size
  is measured after identification has added the source assigning authority security tag (when only
  an owner tag is present) and removed identifiers with the uuid system. Today it is measured before
  that. An AuditEvent near the limit can now be rejected where it was accepted, or accepted where it
  was rejected; the measured size is closer to the size that is stored.
- **No client `_uuid` in size and pipe-in-id errors** (accepted difference 8). The result entry for a resource that
  fails the size limit or has a pipe in its id no longer includes a `uuid` or
  `sourceAssigningAuthority` taken from `_uuid` or `_sourceAssigningAuthority` fields the client sent
  in the body. Today it echoes them.
- **One scope-check log per resource type.** The scope check runs once for each resource type in
  the request, because its answer depends only on the request and the type. A request with several
  forbidden resources of one type logs `Scope check failed` once for that type; today it logs it
  once per resource. Each forbidden resource still gets its own result entry and its own
  `Write check failed for resource` log.
- **Streaming audits** (accepted difference 9). A streaming `$merge` writes one AuditEvent entry
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
- **AuditEvent size limit** (accepted difference 6). An AuditEvent line over the size limit is now
  rejected with a per-resource error. Today it is written.

**POST**
- **No attachment writes on 403.** Today attachments and base64 data are stored before the access
  check, so a POST rejected with 403 has already stored them. The new path stores nothing for it.
- **Which error a POST gets** (accepted difference 1). The new path reads the body before the scope
  check: it rejects a missing body, an array body, and a body whose `resourceType` doesn't match
  the URL, with 400. A caller without the scope who sends one of these gets that 400 where today it
  gets 403.
- **Type mismatch with another failure** (accepted difference 1, like the scope case above). A
  body whose `resourceType` doesn't match the URL, and that also fails the meta check or the Group
  member limit, gets the type-mismatch 400. Today it gets the meta or member-limit 400. The status
  stays 400 and the outcome text differs. In `fhir_validation_failure_total`, the meta case is now
  counted at the `schema` stage for the URL's type; today it is counted at the `meta` stage for the
  body's type. The member-limit case is now counted as a `schema` failure; today it isn't counted,
  because the member-limit check returns before any failure is recorded.
- **`$merge`'s validation order** (accepted difference 1). POST runs the same validation steps as
  `$merge`, in the same order: the AuditEvent size check (with the pipe-in-id check, which never
  fires for POST), the raw body's schema, the meta check, the access check, then `validateResourceAsync` on the built document (the Group member limit,
  the schema of the write-serialized document and the Person.link tenant check). Today it runs the
  meta check, `validateResourceAsync` on the body (the member limit, the schema, then the
  Person.link tenant check), the schema of the write-serialized body, the size check, then the
  access check. A request that fails two of these checks can get the other error:
  - A body that fails a check in `validateResourceAsync` on the built document (the Group member
    limit, the Person.link tenant check, or the schema of the write-serialized document), and also
    the access check, gets the 403 instead of the 400.
  - A body that fails the schema and the meta check gets the schema 400 instead of the meta 400.
  - An AuditEvent over the size limit that also fails the meta or schema check gets 413 instead of
    400: the size check now runs first, and today it runs after the meta check and both schema
    checks. Today's POST also checks the size before the access check, so an oversized AuditEvent
    that fails the access check gets 413 on both paths.

  In `fhir_validation_failure_total`, the second case is counted at the `schema` stage instead of
  `meta`. The first case no longer counts its Person.link failure (`reference` stage) or its schema
  failure, and the third no longer counts its meta or schema failure, because the access and size
  checks record nothing there. The client's `meta.lastUpdated` is still ignored, as today: the new
  path removes it when it reads the body.
- **Group member limit after the schema and access checks** (accepted difference 1, user
  decision). POST checks the Group member limit in `validateResourceAsync` on the built document,
  after the raw body's schema check and the access check, as `$merge` does. Today it checks the
  limit right after the meta check, before the schema and access checks. A Group over the limit
  that also fails the schema check gets the schema 400 instead of the `too-costly` 400, and is
  counted in `fhir_validation_failure_total` at the `schema` stage, where today it isn't counted.
  An over-limit Group is rejected only after the schema check, the access check and the build, so
  rejecting a large one takes longer than today.
- **400 for a POST with no body.** A POST whose body the server doesn't parse (no `Content-Length`
  or `Transfer-Encoding`, or the `application/fhir+ndjson` content type) gets 400
  `Request body is required.` Today a caller with the scope gets 500, and a caller without the
  scope gets 403. The scope-less case is accepted difference 1: the request fails both the scope
  check and the body check.
- **More operation failures logged.** With the switch on, POST also logs an operation failure when
  there is no body, when the body is an array, when a validation call throws
  (`validateResourceAsync`, for example the Person.link lookup or `DateColumnHandler`), when the
  attachment transform fails, or when the base64 insert fails. The old path threw these before or
  outside its failure logging. Only logging changes.
- **GridFS file metadata.** GridFS files stored by a POST on the new path carry
  `metadata.resource_uuid` and `metadata.resource_sourceId`, as `$merge`'s files already do. Today
  POST's files have only `metadata.active: true`. Nothing in `src` reads these fields.
- **Source assigning authority in the access log.** When a POST fails a check of
  `validateResourceAsync` on the built document (the Group member limit, the Person.link tenant
  check, or the schema of the write-serialized document), its failure access-log entry now carries
  the `sourceAssigningAuthority` from the resource's own tag. Today that field is empty, because
  the old path validates before it reads the tag. Every other field of the entry is unchanged.

**PUT**
- **No attachment writes, and no GridFS deletions, on 403.** Today attachments and base64 data are
  stored before the access-tag check, so a PUT rejected with 403 for an access tag it can't add,
  or a create-via-PUT rejected with 403, has already stored them. A PUT rejected for an access-tag
  change whose body drops a stored GridFS attachment has also had that file marked inactive inside
  the build. The new path checks the access tags before the build, so it stores and deletes
  nothing for these.
- **Which error a PUT gets** (accepted difference 1). The new path reads the body before the scope
  check: it rejects a missing body, an array body, and a body whose `resourceType` doesn't match
  the URL, with 400. A caller without the scope who sends one of these gets that 400 where today it
  gets 403. The type mismatch is now counted in `fhir_validation_failure_total` at the `schema`
  stage; today the 403 isn't counted. An array body gets 400
  `Only single resource can be sent to update.`; today it gets a 400 from a later check, such as
  the missing owner tag for a non-UUID id.
- **`$merge`'s validation order** (accepted difference 1). PUT runs the same validation steps as
  `$merge`, in the same order, except that it validates the body against the stored doc before the
  build, as today: the raw body's schema, the meta check for a create-via-PUT, the access check on
  the stored doc and then on the body's access tags, then `validateResourceAsync` on the body with
  the stored doc (the Group member limit, the schema, references, the patient reference and
  Person.link), then the build with the extended Group 400 and the 412s, and on the built doc the
  meta check (for a create-via-PUT, `validateResourceAsync` on the built doc).
  Today it checks access to the stored doc, runs `validateResourceAsync` on the body, the schema
  of the write-serialized body, the build with its 412s, the meta check, and the access-tag check
  on the built doc last. A request that fails two of these checks can get the other error:
  - A body that fails the schema check, for a stored doc the caller can't access, gets the schema
    400 instead of the 403. It is now counted at the `schema` stage; today it isn't counted.
  - A body that removes an access tag the caller can't write and has an invalid reference gets the
    403 instead of the reference 400, and is no longer counted at the `schema` stage.
  - A create-via-PUT of a Person linked to another tenant's Patient, with an access tag the caller
    can't add, gets the access-tag 403 instead of the Person.link 400, and is no longer counted at
    the `reference` stage.
- **Group member limit after the schema check** (accepted difference 1, as for POST). A Group over
  the member limit that also fails the schema check gets the schema 400 instead of the
  `too-costly` 400, and is counted at the `schema` stage, where today it isn't counted.
- **400 for a PUT with no body.** A PUT whose body the server doesn't parse, as for POST, gets 400
  `Request body is required.` Today a caller with the scope gets 500, and a caller without the
  scope gets 403. The scope-less case is accepted difference 1.
- **Body without `meta.security`.** A PUT with a UUID id whose body has no `meta.security` gets 500
  today (`sourceAssigningAuthority is null` in the merger). The new path answers it as any other
  body that drops the stored access tags: 403 when the caller can't write a dropped tag, and 200
  for a caller who can, with the doc stored with only its owner and source assigning authority
  tags.
- **Versioned updates** (accepted difference 2). Two concurrent PUTs to the same resource both
  land, the version goes up by two, and the stored doc is the later writer's body. Today both
  write by `_uuid` alone, so the later one overwrites the other and both can get the same version.
  A Group PUT that writes ClickHouse members still writes by `_uuid` alone, as today, unless it
  sends a specific `If-Match` (see "Concurrency"). A PUT that keeps losing the race gets today's replay 500 when the retries run out; today a PUT
  can't lose a race. A create that loses to another create of the same `_uuid` is replayed as a
  replace into the winner instead of being merged into it, and still answers 201. The winner's
  content and access tags are replaced by the caller's, and its owner and source assigning
  authority are kept. There is still no access re-check until the resolver. An update that loses
  to a write of the same content writes nothing and answers 200 as a no-op, as today. With
  `SKIP_HANDLE_CONCURRENCY` PUT keeps today's behavior, except for one `If-Match` edge (see
  "Concurrency").
- **Base64 live key kept.** A PUT that doesn't change a base64 value keeps its live key and
  uploads nothing, as `$merge` does. Today every PUT that writes uploads the value again, to a new
  live key.
- **Failure access-log entry.** The failure entry of a create-via-PUT now carries the derived
  `uuid`, and for a non-UUID id the `sourceAssigningAuthority`; today both are empty. For an
  existing resource with a UUID id, it no longer carries `sourceAssigningAuthority`; the other
  fields are unchanged.
- **More operation failures logged.** With the switch on, PUT also logs an operation failure when
  there is no body. The old path failed on it before its failure logging. The old path also logs
  each 412 at info level; the new path logs a 412 only in the pipeline's failure entry, also at
  info level. Only logging changes.
- **GridFS file metadata.** GridFS files stored by a create-via-PUT on the new path carry
  `metadata.resource_uuid` and `metadata.resource_sourceId`, as POST's files on the new path do.
  Today they have only `metadata.active: true`. Files stored by an update already carry them.

**PATCH**
- **400 instead of 500** (accepted difference 7) when the write returns no result.
- **Which error a PATCH gets** (accepted difference 1). The checks run in the pipeline's fixed
  order, so a patch that fails more than one of them can get a different 400 or 403 than today. The
  access-tag check now follows validation: a patch that fails both gets the validation 400 instead
  of the 403. The Group member limit is checked after the schema check, so an over-limit Group that
  also fails the schema gets the schema 400 instead of the `too-costly` 400. A patch that fails both
  the schema check for an unknown field and the malformed-reference check lists only the schema
  issues. A patch that fails one check gets the same status and error as today.
- **A no-op PATCH** (accepted difference 3). A PATCH that changes nothing answers `updated: false`,
  where it answered `updated: true`, and the response carries the stored doc. It stores an
  access-log entry for the unchanged resource, where it stored none. It skips the shared result
  checks (the meta check, the Group member limit, references, the patient reference and
  Person.link), because there is no built doc. The old path ran them on an unchanged doc too, so a
  no-op PATCH of a stored doc that fails only one of them now answers 200 `updated: false` where it
  answered 400. The schema check of the patched doc still runs, so a stored doc that fails the
  schema still gets the 400, and a real change to a doc that fails any of these checks gets the 400
  as before.
- **More operation failures logged.** With the switch on, PATCH also logs an operation failure when
  the content type is not JSON Patch and when an operation targets an internal `_` field. Both
  still get today's 400; the old path left them out of its failure log. Only logging changes.
- **Group PATCH on external storage.** A PATCH that changes both the members and other fields of a
  Group stored in ClickHouse writes the Group once, with one history row: history versions 1 and 2,
  where today they are 1, 2 and 2. A PATCH that changes only the members of such a Group is now
  validated, audited and success-logged like every other PATCH, validated against the schema before
  normalization, and its response carries the enriched `identifier` entries every other PATCH
  response has. Today it returns before validation, the audit and the success log.
- **A rejected Group PATCH on external storage writes nothing.** A PATCH of a Group stored in
  ClickHouse that has member operations and another operation, and is then rejected because the
  patched Group fails validation, answers the same 400 on both paths. Today it has already bumped
  the Group to the next version and written the ClickHouse member events by then, because the
  member operations run before the rest of the patch is checked, which includes the access-tag
  check. The new path prepares the events in the build and writes them after the flush, so a
  rejected PATCH leaves the stored Group and ClickHouse as they were.
- **GridFS files are replaced in a different order.** The new GridFS files and the base64 upload are
  written before the stored files the patch replaced or removed are marked inactive; today the
  stored files are marked inactive first. A PATCH whose upload fails now leaves the stored files
  active.

**Admin**
- **`createPersonToPatientLink` without `externalPersonId`** returns 400 `invalid`, like the other
  missing parameters (accepted difference 4). Today the manager reads the missing value and fails
  with a 500.

## Delivery

- There is one PR per operation, each turning on only its own switch.
- `$merge` goes first. That PR lands the pipeline core along with the batch model, the bulk preload,
  the smart-merge builder and the per-resource responder.
- The rest follow in this order: create, update, import, patch, admin. POST and then PUT go before
  `$import` (user decision). `$import` follows them because it reuses most of the merge profile.
- The work is based on `main`. The write-flow cleanup PR goes first, and the `$merge` PR stacks on
  it until it merges (user decision). No PR waits for the concurrent write resolver. PUT ships
  before it, with the version filter and today's replay (user decision; see "Concurrency"). PATCH
  ships before it too, with today's `_uuid`-only write; the resolver's PR adds PATCH's version
  filter and its re-patch rebase together.
- Every PR runs the repo's security review against `review.md`, because these are write paths.

## ADR

This pattern is new to the repo, so it gets an ADR in MADR format:
`docs/adr/0005-unified-write-pipeline.md`, next to the repo's other ADRs. Options considered:

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
