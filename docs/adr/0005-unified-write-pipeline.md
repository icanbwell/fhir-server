---
status: accepted
date: 2026-11-12
---

# One write pipeline with per-operation profiles

## Context and Problem Statement

POST, PUT, PATCH, `$merge`, the `$import` worker and the admin resource writer each run their own
copy of the same write steps: scope check, find the stored resource, access checks, validation,
build the new document, attachments, write, audit, respond. The copies run the steps in different
orders, pick different variants of the same check, and skip different checks. Adding or changing a
check means finding and editing every copy, and a check that one copy is missing is hard to see.

How should the write operations share their steps so that every central check runs for every
operation, and the places where an operation differs can be read side by side?

## Decision Drivers

- A central check (scope, access, validation, audit) can't be skipped by one operation without
  that being visible in its code.
- Per-operation differences that are kept on purpose are written down in one place per operation.
- Each operation moves to the shared code on its own, and can be switched back without a deploy of
  new code, while the old code keeps running unchanged.
- Responses stay the same as today, apart from a short, announced list of accepted differences.

## Considered Options

- One pipeline plus per-operation profiles
- A base class with one subclass per operation
- A per-operation list of step objects
- Refactoring the old flows in place, without switches

## Decision Outcome

Chosen option: "One pipeline plus per-operation profiles", because it is the only option where the
order and the set of steps live in one function that no operation can change, while the
differences are plain data next to each other.

- `WritePipeline` (`src/operations/writePipeline/writePipeline.js`) calls each step explicitly, one
  line per step, in one fixed order. The step classes are in `writePipeline/steps/`. There is no
  step list and no loop.
- A profile (`writePipeline/operations/<operation>/profile.js`) is plain data: the operation name,
  the scope letter, the variant a step uses, and an explicit `off` for a check the operation does not run
  today. A profile can pick a variant of a step; it can't remove one. The container gives
  `WritePipeline` every profile, and the pipeline checks them when it is built, which the app does
  at startup, so an invalid profile stops the boot instead of failing a request.
- A step variant is a separate step instance that `WritePipeline` holds by step name and variant
  name (`stepVariants`). A profile picks one by name in its `variants` setting, and `WritePipeline`
  runs it in place of the default step. Adding a variant doesn't change the step it replaces, so a
  profile that names no variants runs as before. POST is the first operation to use a variant,
  `buildDocument.insert`. It turns `findExisting` off, because a new resource has no stored
  document to load. PUT uses three variants: `identify.url` (the identity from the URL id),
  `buildDocument.replace` (the `If-Match` / `If-None-Match` checks, then a replace of the stored
  document, or POST's insert when none is stored) and `write.httpPreconditions` (a versioned write
  that queues the `If-Match` list, so a replayed write checks it again). Each of these steps takes
  the piece that varies as a constructor argument: an identity resolver, a builder, or a writer
  (`VersionedWriter` by default, `HttpPreconditionWriter` for PUT). PATCH uses five variants: a
  search lookup with the access filter (`findExisting.search`), a stored-document access check
  (`accessBeforeBuild.stored`), the JSON Patch build (`buildDocument.patch`), an attachments step
  that always uploads a new base64 object (`attachments.alwaysCreateNew`) and a writer
  (`PatchWriter`, `write.patch`). It turns off the steps that read a resource body, because its
  body is a JSON Patch. Admin has two profiles under the one switch value `admin`: `adminLink` (the
  four link operations) and `adminPatientReference` (`updatePatientReference`). Both turn off the
  scope check (the route asserts the admin scope) and the steps that read or compare a resource
  body, and use four variants: `findExisting.adminTargets` and `accessBeforeBuild.adminTargets`
  (the target and the looked-up linked resources through the access filter, with `u` on the
  target and `r` on the Patient of a created Person; `updatePatientReference` doesn't look the new
  Patient up, as today; a link added to a stored Person names its target as sent and is
  checked by the result validation's Person.link check; the
  Person of `createPersonToPatientLink` is looked up with `r` and checked with `u`, so one the
  caller can read but not update is a 403, not a second Person), `buildDocument.admin`
  (`AdminBuilder`, which composes the insert, smart merge and replace builders) and
  `accessOnResult.admin` (the full check with `c` for a created Person).
  `adminPatientReference` adds `validateResult.adminPatientReference`, which turns the validator's
  patient-reference check off for that one operation.
  `$import` has the profile `import`: scope letter `u` with action `merge`, `validateAgainstStored`
  and `accessOnResult` off, and no variants, so it runs the same default steps as `$merge` (the
  bulk preload, the stored and incoming access check, the smart merge and the versioned write).
  The worker keeps reading its files: the reader, the `ifNoneExist` wrapper and its claim, the
  default tags, the batching, the retries and the output files stay in `BulkImportHandler`. At
  each flush it hands the buffered lines to `ImportBatchWriter`
  (`writePipeline/operations/import/importBatchWriter.js`), which backfills the owner tag as the
  old worker does, then calls `processAsync` and `executeAsync` once for the batch, as
  `MergeStream` does. `ImportResponder`, a plain class with no `WriteResponder` base, turns the
  items into today's per-line result entries. The profile sets `itemErrorsFailItem`, so an
  unexpected error from the scope check, the schema check, the meta check, the access check, the
  build or the owner backfill fails only its line, as the old per-line `catch` did; only a flush
  that throws fails the batch. The audit stays the worker's, once per range from
  those entries, so the import path does not use `WriteAuditor`. Counts and audits come from the
  entries after the flush. A flush that throws may have stored some resource types, so the worker
  records the batch's entries as before and does not read a batch of several resource types again
  (the types counted are those of the lines that queued a write; a line that failed a check or is unchanged queues none); a batch of
  one type is read again as before, but only if no earlier batch of the range was flushed. The bulk import worker checks
  `WRITE_PIPELINE_OPERATIONS` at startup in `src/operations/asyncJobs/worker.js`, as the app does.
- Step 10 is `accessOnResult`. It checks that the caller may make the access-tag changes between
  the stored and the built document, and runs after `validateResult`. Its default checker is on for
  PATCH, whose access tags are known only after the build, and off for POST, PUT and `$merge`,
  which check the change before the build. `$import` keeps it off when it ships, and admin has its
  own variant, `accessOnResult.admin`.
- A writer may have an optional `afterFlushAsync` hook. `WriteStep.afterFlushAsync` calls it, and
  `WritePipeline.runAsync` calls that once after the flush, the results and the audit, so a write
  the flush committed is audited even if the hook throws. The default writers have none, and a
  streaming `$merge` never calls it. PATCH uses it to write an external-storage Group's ClickHouse
  member events after the Group's commit.
- The shared `AttachmentsStep` takes the option `alwaysCreateNewBase64`, off by default. PATCH
  turns it on, because its write has no version check, so it keeps uploading a base64 value to a
  new live key every time, as today. POST, PUT and `$merge` keep the default.
- A responder (`writePipeline/operations/<operation>/responder.js`) turns the item results into the
  operation's response and records its metrics. The shared `WriteAuditor` writes the audit events.
- The admin operations carry ids, not a resource body. `AdminWriteRunner`
  (`src/admin/adminWriteRunner.js`) runs one as its own request, with a fresh request id, the ids
  in `requestInfo.body`, the post-request queue drained on success and the request cache cleared in
  `finally`. `AdminResponder` reads the ids into one stub item and builds the response from the
  operation table `ADMIN_OPERATIONS`, so a sixth admin operation is a new entry in that table.
- Streaming (NDJSON) `$merge` keeps its transport out of `WritePipeline`, because no other
  operation streams: `$import` reads its files and flushes its batches itself. The stream stays in
  `MergeOperation.mergeAsyncStream` and `insertAndLog` for both paths; they take a stream handler
  for the per-line merge, the flush and the audit. The new path's handler comes from
  `MergeStream` (`writePipeline/operations/merge/mergeStream.js`), which reads each line with the
  `MergeResponder` it holds, runs the shared steps on it through `WritePipeline.processAsync` and
  flushes every 100 resources through `executeAsync`. `runAsync` is the entry for a whole request;
  `processAsync` with `executeAsync` is the entry for a caller that writes many batches in one
  longer job.
- `WRITE_PIPELINE_OPERATIONS` turns the new path on per operation (`create`, `update`, `patch`,
  `merge`, `import`, `admin`). With an operation's name absent, its old code runs exactly as
  before. `$merge` is the first operation; the others follow one PR each.

### Consequences

- Good, because a new check is added once, in a step, and runs for every operation that doesn't
  turn it off in its profile.
- Good, because each operation can be rolled back on its own by removing its name from
  `WRITE_PIPELINE_OPERATIONS`.
- Good, because the profiles show every kept difference between the operations in one folder.
- Good, because PATCH and the admin operations share one access-filtered lookup,
  `AccessFilteredFinder`, instead of each building the query.
- Bad, because the old and the new path both exist until every switch has been on everywhere, so
  a fix to a write flow may have to be made twice in that time.
- Bad, because the step order is fixed: a request that fails two checks can get a different one of
  the two errors than before, and `$merge` returns its results in request order instead of sorted
  by `_uuid`. These are listed in the spec's "Changes to announce".
- Bad, because `$merge` now runs its size and pipe-in-id checks after identification, so it can
  validate before it loads; what they measure and report changes slightly (the spec's accepted
  difference 8).
- Bad, because PATCH stays unversioned until the concurrent write resolver lands: it writes by
  `_uuid` alone, with no version filter, no retry and no 409, as today, so a concurrent write can
  still be overwritten. The resolver's PR adds PATCH's version filter and its re-patch rebase
  together.
- Bad, because tests that pin an accepted difference need two versions while both paths exist: the
  test updated to the new behavior, and an `oldWrite` copy that runs the old path.
- Bad, because the old `AdminResourceWriter` stays: the admin deletes, including their link
  cleanup, still use it, and so do the admin operations while the switch is off.
- Bad, because both paths share the stream in `mergeAsyncStream`, so a fix to it, or a bug in it,
  reaches both: turning the switch off moves only the per-line merge and the flush back. The
  streaming audit fix (each result audited once) is such a fix, so it changes the old path too.

### Confirmation

- Parity tests run each `$merge`, POST, PUT and PATCH case on both paths and compare the responses
  (`src/tests/integration/operations/writePipeline/operations/merge/`,
  `src/tests/integration/operations/writePipeline/operations/create/`,
  `src/tests/integration/operations/writePipeline/operations/update/` and
  `src/tests/integration/operations/writePipeline/operations/patch/`).
- The admin operations have their own integration tests on the new path
  (`src/tests/integration/operations/writePipeline/operations/admin/`), and six `oldWrite` copies of
  existing admin tests keep the old path covered.
- The main CI job runs the whole suite with the shipped switches on (`jest/setEnvVars.js`). Tests
  that fail only on an accepted difference are updated and get an `oldWrite<Name>.test.js` copy
  that turns the switch off. No test is skipped.
- The CI job `coverage report` merges coverage across all test jobs. The old path's coverage with
  the switch on matches what the full suite gave it before.

## Pros and Cons of the Options

### One pipeline plus per-operation profiles

- Good, because the steps and their order are in one function, so a central check can't be
  skipped quietly.
- Good, because per-operation differences are data that can be read side by side.
- Bad, because a difference that isn't a variant of an existing step needs a new named variant,
  registered with `WritePipeline`.

### A base class with one subclass per operation

- Good, because it is a familiar pattern and each operation's code stays together.
- Bad, because a subclass can override a step and quietly skip a check, which is what this work is
  meant to prevent.

### A per-operation list of step objects

- Good, because each operation's flow is easy to change.
- Bad, because each operation assembles its own list, so a missing check is easy to miss.

### Refactoring the old flows in place, without switches

- Good, because there is only one copy of each flow at any time.
- Bad, because there is no safe way to roll back per operation, and every PR risks changing
  responses.

## More Information

- Design: `docs/specs/unified-write-pipeline.md`
- Implementation plan: `docs/plans/unified-write-pipeline.md`
