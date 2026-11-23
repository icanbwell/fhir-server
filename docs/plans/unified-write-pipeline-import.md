# $import on the Unified Write Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** With `WRITE_PIPELINE_OPERATIONS` including `import`, the `$import` worker writes each range's resources through `WritePipeline` instead of its own merge code. Result lines, counters, stored documents, history rows, AuditEvents, metrics and the Task flow match the old path, except for the differences listed under "Differences from the old path".

**Architecture:** The worker keeps everything that is specific to reading a range: the S3 reader, the `{ifNoneExist, resource}` wrapper and its claim set, the default tags, byte offsets, batching by lines read, the output files, the retry rules and the state machine. Only the two closures that write (`mergeBufferedResourceAsync` and the merge and flush part of `flushBatchAsync`) move: with the switch on they call a new `ImportBatchWriter`, which runs `WritePipeline.processAsync` and `executeAsync` with an `import` profile and an `ImportResponder`, as `MergeStream` does for streaming `$merge`. `runAsync` is not used, because it logs through `fhirLoggingManager` and the HTTP context.

**Tech Stack:** Node 24, Express, MongoDB, Kafka, S3, Jest with MongoDB Memory Server.

**Spec:** `docs/specs/unified-write-pipeline.md`. Read "Constraints", "Step order", "Profiles" (the `import` column), "No-op fixes", "Testing" and "Changes to announce" (`$import`). The `$merge`, POST, PUT, PATCH and admin plans (`docs/plans/unified-write-pipeline*.md`) built the pieces this plan reuses; read the `$merge` plan and `operations/merge/mergeStream.js` first.

## Global Constraints

- With the `import` switch off, the worker behaves exactly as before. In `handler.js` the only changes are the switch check, the constructor wiring, and anything extracted without a change in behavior. Existing tests of the old path stay unedited; `handler.workerPath.test.js` must keep passing unchanged.
- Nothing in the bulk inserter, the executor, `MergeManager` or the state machine changes. The state machine and the kickoff Task insert are out of scope (spec "Non-goals").
- The user's rule for this operation: keep today's behavior; every difference is listed below and flagged for the user, and the builder does not accept an unlisted one. A parity run that shows an unlisted difference is a stop-and-report, not a fixture edit.
- The import profile asks for scope letter `u` with action `merge`, as today.
- Tenant isolation is unchanged: every access check goes through the same `ScopesValidator` and `WriteAllowedByScopesValidator` calls as today. A line's access check answers the same for the same input.
- No new metrics. Import's own metrics (`recordImportResourceOutcomes`, `recordImportRanges`, range duration) stay where they are, fed from the pipeline's entries.
- No PHI in logs, test fixtures or commit messages. Use synthetic data only. The error entry for a thrown error keeps today's shape (see Decision 6); do not add more of the resource to any log.
- New files under `src/` are camelCase. New classes and functions get JSDoc saying what they do, and no other comments.
- No Jira IDs in code, tests or docs.
- Run tests one file at a time, path first: `nvm use && node node_modules/.bin/jest <file> --runInBand --forceExit`. Unit tests also need `--config jest.unit.config.js`. Integration tests need Docker (colima: `DOCKER_HOST=$(docker context inspect --format '{{.Endpoints.docker.Host}}' colima) TESTCONTAINERS_RYUK_DISABLED=true`). Never run the full suite or a whole folder; CI runs the rest.
- Lint with the committed config: `git show HEAD:eslint.config.js > eslint.head.tmp.config.js`, run eslint with `--config eslint.head.tmp.config.js` on the changed files, delete the temp file, never stage it.
- Never stage, edit or read the user's local modifications: `.prettierrc`, `Dockerfile`, `Makefile`, `docker-compose.yml`, `eslint.config.js`, `tsconfig.json`, `src/operations/common/logging.js`, `src/strategies/authService.js`, `src/strategies/jwt.bearer.strategy.js`, `src/tests/integration/customMatchers.js`. Never run `git diff` over a directory.
- Stage files only, by explicit path. Commit nothing until the user asks.

## Decisions

**Decided for the whole epic, not reopened here:** one access flow for every operation with a resource body; `prepareBody` and `validateIncoming` stay two steps; each step is one explicit line in `processAsync`; one folder per operation; profiles are registered with `WritePipeline` at startup; `WriteStep` variants are named in `stepVariants` and the profile's `variants`; a check an operation doesn't run is in the profile's `off`. Import adds no new step and no new shared variant: the check below shows every step it needs already exists.

**My calls (for review), each checked against the old code:**
1. **The reader stays in the worker.** `readAndProcessRangeAsync` keeps its per-line work up to and including the claim of an `ifNoneExist` key: parse errors, wrapper detection, `removeUnderscoreFieldsRecursive`, the default owner and source assigning authority tags and `meta.source` (`applyDefaultSecurityTagsIfMissing`), serialization, identity (`_uuid` and source assigning authority), the `ifNoneExist` lookup and skip. This is import-only logic with no counterpart in the merge profile, and keeping it means a line that fails a later check still carries `uuid` and `sourceAssigningAuthority` in its entry, as today (the old worker derives identity before any check).
2. **Owner backfill moves with the pre-pass, not into the pipeline.** Old import runs `ownerColumnHandler.preSaveAsync` (an owner tag from the first access tag) before its checks, so an access-only line is accepted. The merge pipeline reaches that handler only at `attachments`, after the new-resource meta check, and would reject such a line. `ImportBatchWriter` therefore runs the same call on each body before `processAsync`, as `mergeBufferedResourceAsync` does today.
3. **The import profile** (`operations/import/profile.js`, `IMPORT_WRITE_PROFILE`): `name: 'import'`, `accessRequested: 'u'`, `action: 'merge'`, `off: ['validateAgainstStored', 'accessOnResult']`, no variants (the merge defaults: `SourceIdentityResolver`, `ValidateIncomingStep`, `BulkPreloadLoader`, `IncomingAndStoredAccessChecker`, `SmartMergeBuilder`, the default `validateResult`, `AttachmentsStep`, `NoOpStep`, the versioned writer). `identify` and `prepareBody` stay on: for a line with an id they repeat the reader's work idempotently (same `_uuid`, same authority; `prepareBody` strips `_` fields and restores the identity). `identify` does not run the structural checks old import gets from `preMergeChecksMultipleAsync` (id present, resource type present and supported, a uuid id or authority/owner tags); in `$merge` they run in step 0 (read items), which import does not use. So `ImportBatchWriter` runs them, through the `ResourceStructureChecker` `MergeResponder` also uses, after the owner backfill and before `processAsync`, and fails each line that has one at the `STRUCTURE` stage with today's entry (the `createMergeError` OperationOutcome and the byte offset). This keeps the old order (the structural check before the scope check, so a line with no id under a scope that forbids its type still reports the missing id) and keeps such a line out of every step: without it a line with no id would get a random `_uuid` from `identify` and upload its attachments before failing at the write, and a `resourceType` that is not a stored type (for example `Parameters`) would be stored.
4. **`ImportResponder`** (`operations/import/responder.js`) implements `WriteResponder`:
   - `readAsync` is not used for import (the reader builds the items); it throws.
   - `failureResults` and `results` return `MergeResultEntry` objects in today's shapes, one per input line, in input order: created, updated (a line whose `_uuid` was already seen earlier in the same flush is `updated: true`, as `forceUpdated` does today), failed, and `skipped` for an unchanged line (accepted difference, see below). The result for a line is matched by its item index, not by `resourceType|_uuid`, so two lines with one `_uuid` in a batch give two entries, as today.
   - `recordMetrics` does nothing (the handler records import metrics).
   - A thrown error is reported with today's entry (Decision 6).
5. **`ImportBatchWriter`** (`operations/import/importBatchWriter.js`, registered in `createContainer.js`; constructor takes `writePipeline`, `ownerColumnHandler` and the responder):
   - `writeBatchAsync({ requestInfo, resources })` takes the buffered `{ fhirResource, byteOffset, forceUpdated }` lines of one flush, builds one `WriteContext` (`requestInfo`, `base_version: '4_0_0'`, `parsedArgs: new ParsedArgs({ base_version: '4_0_0' })`, `smartMerge: true`), runs `writePipeline.processAsync({ profile: IMPORT_WRITE_PROFILE, context, items })` and then `writePipeline.executeAsync({ context })`, and returns the entries in input order with their byte offsets (`withSourceByteOffset`, as today).
   - It never calls `WriteAuditor`: import audits once per range from the entries (Decision 7), so `auditAsync` is not used.
   - Counts come from the entries, after the flush: nothing is counted before `executeAsync` returns (accepted difference).
6. **A thrown error keeps today's entry.** Old import reports a thrown merge error with `mergeError.args` (a `MergeResultEntry` built by the merge code, details text `'Error merging: ' + JSON.stringify(resource)`). That text is a known problem (spec "Changes to announce": the whole resource in `details.text`) that is not fixed here. The responder builds the same entry with the same function the merge code uses for it, so the output lines match; if that function is not reachable from the responder, the builder extracts it without a change in behavior and reports it.
7. **Audit stays the worker's.** `queueAuditEntriesForRangeAsync` is called with the entries as today: one task per range, `args = { taskId, filepath, rangeIndex, totalRanges }`, one create and one update audit per resource type with the `_uuid`s, one error audit per failed entry (always code 400, text `bulk import failure`), no success audits for `AuditEvent`, and the entries of a failed range audited too. `WriteAuditor` (per-call args, 413 for too-long) would change the AuditEvents, which are visible output, so it is not used.
8. **Batching and retries stay the worker's.** A batch is the lines read since the last flush (`BULK_IMPORT_BATCH_SIZE`), including errors and skips. `hasFlushedThisAttempt`, `bulkImportRangePartiallyFlushed`, the 3-attempt read retry with its cache clearing, the output writes and `ImportRangeCompleted`/`ImportRangeFailed` publishing do not change. `postRequestProcessor.executeAsync`, `auditLogger.flushAsync` and `requestSpecificCache.clearAsync` stay in the range's `finally`.
9. **The switch.** `BulkImportHandler` gets `writePipelineSwitch` and `importBatchWriter` (both optional in the constructor, so `handler.workerPath.test.js` builds it unchanged). `flushBatchAsync` checks `writePipelineSwitch?.useNewPathFor('import')` once per flush. `WritePipelineSwitch.OPERATIONS` already contains `import`; nothing in the app's startup check changes. The worker process does not call `assertValidConfiguration`; that is the same for every operation and is left alone.
10. **Spec correction.** The old worker already runs the AuditEvent size limit (`MergeManager.preMergeChecksMultipleAsync` calls `validateResourceSizeSync`), so the spec's accepted difference 6, the `import` cell of "Validate incoming" and the "AuditEvent size limit" entry under "Changes to announce" are wrong to call it new. Task 7 fixes the text; only the incoming schema check is new.

## Differences from the old path

Each is listed in the spec (accepted differences 6 and the no-op fixes) or is a consequence of reusing a shared step; the parity test pins each per path (`expectedNew`). The user confirms the list; anything the user removes stays as today and its pipeline piece is adapted.

| # | Difference | Old path | New path | Source |
|---|---|---|---|---|
| 1 | Incoming schema check | only the merged or new document's schema is checked | each line's resource gets the schema check (required-field errors relaxed) before the merge, after `ImportBatchWriter` drops its incoming `meta.versionId` (the build replaces it, and the old path's check never saw it); a line that fails gets an error entry from that check; the failure is counted in `fhir_validation_failure_total` | spec, accepted difference 6 |
| 2 | Unchanged line | counted `updated`, entry `updated: true`, an update audit, and `fhir_import_resources_processed_total{updated}` counts it | counted `skipped`, entry `created: false, updated: false`, no update audit, and no import outcome metric counts it | spec, "No-op fixes" |
| 3 | Per-resource flush failure | reported as created or updated (the flush result is discarded), with create or update audits, even when nothing was stored: on a document-size error the executor fails the whole bulk write of that resource type, so every healthy document of that type in the flush is lost while reported created | reported as failed, from the flush result, in the result file, the error file and the error audit; every line of the flush's rejected resource type is failed (the same lines the old path silently lost); each failed line's claimed `ifNoneExist` key is released, so a later line with the same criteria in the range is tried instead of skipped | follows from "counts come from the pipeline's per-item results" |
| 4 | A flush that throws, or an unexpected error in a check | a flush throw: the batch is already counted, audited and in span attributes and metrics; an unexpected (non-validation) error thrown by a scope, meta, access or schema check fails only that line | a flush throw: nothing of the batch is counted or audited before the flush returns (this includes the error audit of a line that had already failed a check in the batch), and the range fails as today; the old path wrote create audits for a batch whose flush threw although nothing was stored; an unexpected error thrown by a check of one line fails the whole batch and the range (the checks run for the whole batch, with no per-line catch), which is read three times and then fails | follows from Decision 5 and the shared steps |
| 5 | Parallel build | lines of a batch are merged one after another | lines are built and have their attachments processed in parallel chunks (`mergeParallelChunkSize`), as in `$merge`; side effects of different lines interleave | shared steps |
| 6 | Log text of a failed line | `Failed to merge bulk import resource` with `taskId`, `filepath`, `resourceType`, `byteOffset` and `error` (the message), only for a thrown merge error | the pipeline's `Write step failed for resource` / `Write check failed for resource`, plus the worker's own `Failed to merge bulk import resource` line for every failed entry, with `taskId`, `filepath`, `resourceType`, `byteOffset` and `issueCode` instead of `error` (the diagnostics text is left out: it can carry resource values). So the worker now logs one error-level line per failed line, including lines that fail a check on client data, for which the old path logged none | shared logging |
| 7 | A same-batch repeat of a new resource | the repeat skips the new-resource meta check (it is treated as an update of the first line) | the repeat gets the new-resource meta check, because its item has no stored document; a repeat whose meta is invalid as a new resource (for example a second owner tag) fails with the meta error instead of being merged | shared `validateNewResource` step |
| 8 | Key order inside a thrown merge error's text | the `Error merging: <resource>` text lists `_sourceAssigningAuthority` before `_uuid` for a non-uuid id | the shared `prepareBody` step puts `_uuid` back first, so the text lists `_uuid` before `_sourceAssigningAuthority`; nothing else in the entry differs | shared steps; part of the known whole-resource-in-`details.text` problem |

Untested edge of row 3: the oversized-document case is shown for a flush of three Patients. For a flush large enough that the driver splits the bulk write, an earlier part may already be committed, so the new path could report as failed (and release the key of) a Patient that is stored. The old path reports every such line created.

Not differences (the builder proves each with the parity test): result lines and their order, byte-offset extensions, error NDJSON content, counters other than rows 2 to 4, history rows, change events, AuditEvents, `Task.output`, the span attributes, the ifNoneExist behavior, default tags, owner backfill, access-only lines, scope and access results, GridFS and base64 side effects. If any of these differs, stop and report.

## Review Focus

1. **A same-batch duplicate `_uuid`** (two lines for one resource in a batch): two entries, created then updated, one stored document, the same stored result as today. Test in Task 5.
2. **An access-only line** (an access tag, no owner tag, a uuid id): accepted and written, as today. Test in Task 5.
3. **A flush that throws or reports a per-resource error**: the range's counters and audits match today (rows 3 and 4), and a partially flushed range is never retried. Test in Task 6.
4. **A non-object line** (valid JSON that is `null`, a number or an array): today's behavior, whatever it is, is pinned first. Test in Task 1.
5. **A forbidden line**: the entry of a resource-gate, access-gate or read-only-scope failure still names `uuid` and `sourceAssigningAuthority`, because the reader derived identity first; the entries of an other-tenant access tag, a `_uuid` takeover and an access-tag change carry no `sourceAssigningAuthority` today and must not gain one. Test in Task 5.

---

### Task 1: Pin today's behavior with golden outputs

**Files:**
- Create: `src/tests/integration/operations/writePipeline/operations/import/import.test.js`, its `fixtures/` and `fixtures/expected/` files
- Read: `src/tests/integration/asyncJobs/bulkImport/handlerWorker.test.js`, `handlerWorker.preMergeChecks.test.js`, `handlerWorker.scopes.test.js`, `src/tests/integration/operations/writePipeline/operations/merge/merge.test.js` (the `useWritePath` and `withEachPath` helpers)

**Interfaces:**
- Consumes: `BulkImportHandler.handleMessageAsync`, `MockS3NdjsonReader` (`setLinesToYield`, `getWriteCalls`), `MockKafkaClientV2`, the real `AuditLogger` (re-registered as `handlerWorker.test.js` does for its audit tests).
- Produces: a `withEachPath` table of cases. Each case records, from the old path (`WRITE_PIPELINE_OPERATIONS` without `import`): the result and error NDJSON written to S3, the stored documents, the AuditEvents, the span attributes and the `Task.output` entries, normalized for volatile fields (`meta.lastUpdated`, generated ids, `requestId`). Expected files are written from the old path's output.

- [ ] **Step 1: Write the cases, each an NDJSON input and its name:** valid create and update (Patient, Observation); an unchanged line; an `ifNoneExist` create, skip, cross-tenant and same-batch dedupe; an access-only line; a line with two owner tags; a pipe in the id; an AuditEvent over the size limit; a scope-forbidden line and an access-tag-change line (v2 scopes as `handlerWorker.scopes.test.js`); a same-batch duplicate `_uuid`; a non-object JSON line; a malformed JSON line and a too-long line; a Group; a DocumentReference with a large attachment; a multi-batch input (`BULK_IMPORT_BATCH_SIZE=2`).
- [ ] **Step 2: Run it against the old path only** (the new-path column is added in Task 5) and record the expected files. Review each expected file against the old behavior in the code, not only against the output.
- [ ] **Step 3: Run it twice** and confirm the normalized outputs are identical between runs (no flaky field).
- [ ] **Step 4: Stage the files.**

### Task 2: The import profile and responder

**Files:**
- Create: `src/operations/writePipeline/operations/import/profile.js`, `src/operations/writePipeline/operations/import/responder.js`
- Modify: `src/createContainer.js` (register `IMPORT_WRITE_PROFILE` with `WritePipeline`, register `ImportResponder`)
- Test: `src/tests/unit/operations/writePipeline/operations/import/responder.test.js`, `profile.test.js`

**Interfaces:**
- Consumes: `WriteResponder`, `MergeResultEntry` (`withSourceByteOffset`, `createFromError`), the entry builders `MergeResponder` uses.
- Produces: `IMPORT_WRITE_PROFILE` (Decision 3) and `ImportResponder` with `failureResults({ context, items }): MergeResultEntry[]`, `results({ context, items, executedResults }): MergeResultEntry[]` (one entry per item, in item order, matched by index), `recordMetrics(): void`, `readAsync` throwing.

- [ ] **Step 1: Write the failing tests.** One `test.each` over: created, updated, `forceUpdated` duplicate (second line `updated: true`), unchanged (skipped), failed validation (the entry's issue and extension), forbidden (entry keeps `uuid` and `sourceAssigningAuthority`), thrown error (today's entry shape, Decision 6), flush-result error (row 3). A profile test asserts the frozen values and that `WritePipeline` accepts the profile.
- [ ] **Step 2: Run both files; confirm they fail.**
- [ ] **Step 3: Implement the profile and `ImportResponder`.**
- [ ] **Step 4: Run both files; confirm they pass.**
- [ ] **Step 5: Stage the files.**

### Task 3: `ImportBatchWriter`

**Files:**
- Create: `src/operations/writePipeline/operations/import/importBatchWriter.js`
- Modify: `src/createContainer.js`
- Test: `src/tests/unit/operations/writePipeline/operations/import/importBatchWriter.test.js`

**Interfaces:**
- Consumes: `WritePipeline.processAsync({ profile, context, items })` and `executeAsync({ context })`, `WriteItem`, `WriteContext`, `ParsedArgs`, `OwnerColumnHandler.preSaveAsync`, `ImportResponder`.
- Produces: `writeBatchAsync({ requestInfo, resources: Array<{ fhirResource, byteOffset, forceUpdated }> }): Promise<MergeResultEntry[]>` (Decision 5).

- [ ] **Step 1: Write the failing tests** with a fake `writePipeline` (the external boundary): the owner backfill runs on each body before `processAsync`; one context for the batch with `smartMerge: true` and `base_version: '4_0_0'`; `executeAsync` runs once, after `processAsync`; entries come back in input order with byte offsets; a throw from `executeAsync` propagates and no entries are returned; an item that the pipeline fails gets its failure entry.
- [ ] **Step 2: Run; confirm failure.**
- [ ] **Step 3: Implement `ImportBatchWriter`** and register it.
- [ ] **Step 4: Run; confirm it passes.**
- [ ] **Step 5: Stage the files.**

### Task 4: The switch in the handler

**Files:**
- Modify: `src/operations/asyncJobs/bulkImport/handler.js` (constructor takes optional `writePipelineSwitch` and `importBatchWriter`; `flushBatchAsync` calls the writer when the switch is on), `src/createContainer.js` (pass both to `BulkImportHandler`)
- Test: `src/tests/unit/operations/asyncJobs/bulkImport/handler.workerPath.test.js` stays unedited and must pass; add `handler.pipelinePath.test.js` next to it

**Interfaces:**
- Consumes: `writePipelineSwitch.useNewPathFor('import')`, `ImportBatchWriter.writeBatchAsync`.
- Produces: with the switch on, `flushBatchAsync` writes the buffered lines through the writer, derives counters and entries from the returned entries after the call, and leaves the loader preload, `executeAsync`, retries, outputs and audits as they are. With it off, the old code runs untouched.

- [ ] **Step 1: Write the failing tests** (`handler.pipelinePath.test.js`, fakes at the boundaries): switch on routes a flush to the writer and not to `mergeManager`; counters come from the entries (rows 2 and 3); nothing is counted when the writer throws (row 4); the loader preload for the old path is not run on the new path (the `BulkPreloadLoader` does its own); switch off or no switch never calls the writer.
- [ ] **Step 2: Run it; confirm it fails.** Run `handler.workerPath.test.js` and confirm it passes before any change.
- [ ] **Step 3: Implement.** Extract nothing from the old closures unless a shared piece must be reused; any extraction keeps behavior and is covered by `handler.workerPath.test.js`.
- [ ] **Step 4: Run both files; confirm they pass.**
- [ ] **Step 5: Stage the files.**

### Task 5: The parity run on both paths

**Files:**
- Modify: `src/tests/integration/operations/writePipeline/operations/import/import.test.js` and its fixtures (new-path expectations)
- Not modified here: `jest/setEnvVars.js` (changed in Task 7)

**Interfaces:**
- Consumes: Task 1's cases and goldens, `useWritePath('')` and `useWritePath('import')`.
- Produces: every case runs on both paths; the new path's output equals the golden except for the rows of "Differences", which have `expectedNew` files and a `paths` list.

- [ ] **Step 1: Run the table on the new path.** Each failure is either one of the six rows (add `expectedNew`) or an unlisted difference. For an unlisted difference, stop and report it to the user with the case, the old and new output; do not edit a golden.
- [ ] **Step 2: Add the Review Focus cases** (same-batch duplicate `_uuid`, access-only line, scope-forbidden line, non-object line) if Task 1 did not already.
- [ ] **Step 3: Run the file on both paths until it passes.**
- [ ] **Step 4: Stage the files.**

### Task 6: Flush failures, audits and attachments on both paths

**Files:**
- Test: `src/tests/integration/operations/writePipeline/operations/import/import.audit.test.js`, `import.flush.test.js`, `import.attachments.test.js`

**Interfaces:**
- Consumes: the real `AuditLogger`, a flush that throws (mock the bulk inserter's `executeAsync` as the existing partial-flush test does), a per-resource flush error (a document over the size limit), `bulkImportLargeAttachments.test.js`'s fixtures.
- Produces: tests on both paths for: Kafka change events (type, resource and context data per written line) and the import metrics (`recordImportResourceOutcomes`, `recordImportRanges`, range duration), AuditEvent content (create, update and error audits, `requestUrl: '$import'`, `agent.altId`, `network.address`, `who.reference`, the 400 error audits), audits of already flushed resources when a later batch fails, no retry after a partial flush, a DocumentReference attachment stored in GridFS with a client `_file_id` stripped, and `Task.output` entries.

- [ ] **Step 1: Write the tests so each runs on both paths** with the same assertions; per-path expectations only for rows 3 and 4.
- [ ] **Step 2: Run each file; fix the implementation, not the expectation, where a path differs from today.**
- [ ] **Step 3: Stage the files.**

### Task 7: New path by default in tests, the existing import suites, the spec and ADR

**Files:**
- Modify: `jest/setEnvVars.js` (`WRITE_PIPELINE_OPERATIONS='merge,create,update,patch,admin,import'`), `docs/specs/unified-write-pipeline.md` (Decision 10; the `import` column and the differences), `docs/adr/0005-unified-write-pipeline.md` (the import profile and its lookups), this plan if a decision changed
- Test: the existing suites under `src/tests/integration/asyncJobs/bulkImport/` (`handlerWorker.test.js`, `handlerWorker.preMergeChecks.test.js`, `handlerWorker.scopes.test.js`, `bulkImportLargeAttachments.test.js`)

- [ ] **Step 1: Flip the default and run the four existing integration files, one at a time.** A failure that is only one of the six rows: update that expectation to the new behavior and add an `oldWrite<Name>` copy with its fixtures that keeps the old expectation and runs with only `import` off. A failure that is not one of the rows: stop and report.
- [ ] **Step 2: Run `handler.workerPath.test.js` and the new unit files again** to confirm they still pass under the new default.
- [ ] **Step 3: Update the spec text** (the AuditEvent size limit is not new; the import column and differences match this plan; accepted difference 6 lists only the incoming schema check, plus rows 2 to 4 under their own entries) and the ADR. No ticket IDs.
- [ ] **Step 4: Lint the changed files with the committed config.**
- [ ] **Step 5: Stage the files.**

### Task 8: Security review

- [ ] **Step 1: Review the diff against `review.md`** (writes, scope parsing, request-scoped caching, tenant filtering). State what could not be confirmed. Check specifically: the per-range request id still keys every cache the pipeline uses (the preload cache, the pending-history map, the bulk inserter buffer) and is cleared in the range's `finally`; two ranges in one process never share a request id; the access check for each line is the same call as today; the owner backfill cannot give a line an owner it is not allowed to write.
- [ ] **Step 2: Fix any finding in one wave and re-review the fix.**
- [ ] **Step 3: Stage the files.**

## Self-review notes

- Spec coverage: the `import` column (scope letter, `_` fields strip, validate incoming new, find existing preload, validate new resource meta, access before build, off steps, smart merge, validate result, attachments, no-op `skipped`, write, audit by range, metrics) maps to Decisions 3 to 8 and Tasks 2 to 6; accepted difference 6 is row 1 and Decision 10; the no-op fix is row 2.
- Not covered on purpose: the state machine and kickoff Task insert (non-goals), the concurrent write resolver (affects both paths alike), removing the old path.
- Open items for the user are the six rows of "Differences from the old path", before Task 4.
