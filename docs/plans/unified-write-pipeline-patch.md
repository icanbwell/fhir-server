# PATCH on the Unified Write Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** With `WRITE_PIPELINE_OPERATIONS` including `patch`, `PatchOperation.patchAsync` runs through `WritePipeline.runAsync`. Its responses, stored documents, history rows, audit events, access-log data and concurrency behavior match the old path's, except for the cases the spec lists as accepted differences.

**Architecture:** PATCH adds `operations/patch/{profile,responder}.js` and named variants for the steps it does differently: a search lookup with the access filter, a stored-document-only access check, the JSON Patch build (with the Group member strategy), an attachments step that keeps `alwaysCreateNew`, and a write that commits Group member rows, promotes Groups and queues today's `_uuid`-only replace. It also adds step 10 (`accessOnResult`) to the pipeline and an after-flush hook on the write step. Every other step is `$merge`'s default.

**Tech Stack:** Node 24, Express, MongoDB, Jest with MongoDB Memory Server.

**Spec:** `docs/specs/unified-write-pipeline.md`. Read "Constraints", "Step order", "Profiles" (the `patch` column), "Concurrency", "No-op fixes", "Testing" and "Changes to announce". The `$merge`, POST and PUT plans (`docs/plans/unified-write-pipeline.md`, `-create.md`, `-update.md`) built the pieces this plan reuses. They describe the layout before the per-operation folders, which `docs/adr/0005-unified-write-pipeline.md` describes correctly.

## Global Constraints

- With the `patch` switch off, PATCH behaves exactly as before. In `src/operations/patch/patch.js` the only changes are the switch check and the constructor wiring it needs.
- Shared building blocks keep today's behavior. New behavior goes in new code, or behind an opt-in whose default is today's and which existing callers never pass. Here those are:
  - the optional `afterFlushAsync` on a writer (the default writer has none);
  - `AttachmentsStep`'s constructor option `alwaysCreateNewBase64` (default `false`).
- The one allowed edit to old code besides the switch: `GroupMemberPatchStrategy.executeMemberOperations` is split so its parsing is shared with the new path (Task 5). It must behave exactly as before; its existing unit tests are the check.
- PATCH asks for scope letter `u` with action `patch`, as today.
- PATCH's write is today's call, so its concurrency behavior is today's. Nothing in the bulk inserter or the executor changes.
- No new metrics. A validation failure is recorded in `fhir_validation_failure_total` by the same validator calls as on the old path.
- Tenant isolation is unchanged: the stored document is found by the same access-filtered search, and every access check goes through `ScopesValidator`, as today.
- No PHI in logs, test fixtures or commit messages. Use synthetic data only.
- New files under `src/` are camelCase. New classes and functions get JSDoc saying what they do, and no other comments.
- No Jira IDs in code, tests or docs.
- Run tests one file at a time, path first: `nvm use && node node_modules/.bin/jest <file> --runInBand --forceExit`. Unit tests also need `--config jest.unit.config.js`. Integration tests need Docker. Never run the full suite or a whole folder; CI runs the rest.
- Lint with the committed config:
  1. `git show HEAD:eslint.config.js > eslint.head.tmp.config.js`
  2. run eslint with `--config eslint.head.tmp.config.js` on the changed files;
  3. delete the temp file. Never stage it.
- Never stage, edit or read the user's local modifications:
  - `.prettierrc`, `Dockerfile`, `Makefile`, `docker-compose.yml`, `eslint.config.js`, `tsconfig.json`
  - `src/operations/common/logging.js`
  - `src/strategies/authService.js`, `src/strategies/jwt.bearer.strategy.js`
  - `src/tests/integration/customMatchers.js`
- Stage files only, by explicit path. Commit nothing until the user asks.

## Decisions

**User:**
- **PATCH keeps today's behavior under concurrency.** It writes by `_uuid` alone: no version filter, no retry, no 409. A concurrent write can still be overwritten, and a resource deleted between the read and the write is re-created by the executor's replay, as today. This replaces the spec's "PATCH is versioned". The version filter and the re-patch rebase come together in the concurrent write resolver's PR, as the spec's Delivery section says.
- Every shared-step decision below is made for the whole epic (POST, PUT, PATCH, `$merge`, `$import`, admin), not deferred to a later operation's PR.
- Decided in the earlier PRs and not reopened: one access flow for every operation with a resource body; `prepareBody` and `validateIncoming` stay two steps; each step is one explicit line in `processAsync`; one folder per operation; profiles are registered with `WritePipeline` at startup.

**My calls (for review), each checked against every operation:**
- **Step 10 is added now, for the whole epic.** `WRITE_STEP_NAMES` gets `accessOnResult` between `validateResult` and `attachments`, with one more line in `processAsync`.
  - Its default checks the access-tag change from the stored doc to the built doc (`AccessTagChangeChecker`, removals counted). That is PATCH's check and the check admin's update needs; admin's created-Person full check will be a variant.
  - `create`, `update` and `merge` turn it off: their tag change is checked before the build. `$import` turns it off when it ships.
  - It reuses the `AccessCheckStep` class with a second instance, because the step's job (fail each item the checker rejects) is the same.
- **PATCH's lookup is a `findExisting` variant.** `findExisting: 'search'` runs `FindExistingStep` with `SearchExistingLoader`, which makes the old path's access-filtered search (`SearchManager.constructQueryAsync`, `operation: WRITE`, `accessRequested: 'u'`, the access-index setting) and reads one document.
  - 0 hits is `NotFoundError` (`Resource not found: <T>/<id>`), more than 1 is `BadRequestError` with the old text listing the `id|authority` options. Both fail the item at a new stage `LOOKUP` with the error, and are not access-logged.
  - It sets `item.stored` to the write-serialized document and copies its `_uuid` and `_sourceAssigningAuthority` onto `item.incoming`, so every later failure carries them, as today's validation-failure access-log entry does.
  - It is batch-of-one by construction (PATCH reads one item).
- **PATCH's item is a stub plus the patch.** `WriteItem` gets `patch` (the JSON Patch operations, `null` otherwise). `PatchResponder.readAsync` builds `incoming: { resourceType, id: parsedArgs.id }` and sets `patch` to the request body. So `identify`, `prepareBody`, `validateIncoming`, `validateNewResource` and `validateAgainstStored` are `off` in the profile, as the spec's table says ("–, the body is a JSON Patch"). Those steps check a resource body and PATCH has none. The spec's sentence "no profile turns the size and pipe checks off" is reworded to say they apply to every operation that has a resource body.
- **The reader keeps today's first checks, in today's order.** `readAsync` rejects a body that is not `application/json-patch+json` (400, today's text) and any operation that targets an internal field (`validatePatchDoesNotTargetInternalFields`, 400), before the scope check. A body that is not a valid JSON Patch fails in the build with today's 400 (`fast-json-patch` `validate`).
- **`accessBeforeBuild: 'stored'`.** `StoredAccessChecker` calls `ScopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes` on the stored doc with `accessRequested: 'u'`. A 403 fails the item at `ACCESS` with the same OperationOutcome text as today's `ForbiddenError`; any other error propagates, as in `IncomingAndStoredAccessChecker`. It runs after the lookup and before the build, so a rejected item never reaches the member strategy or GridFS.
- **`PatchBuilder` is the `buildDocument: 'patch'` variant.** For the one item it runs, in today's order, on copies (`item.stored` is never mutated, so step 10 and the write compare against the stored doc as read):
  1. detect member operations and, for a Group, `determineGroupMemberType` (400 when extended Groups are disabled);
  2. prepare the member writes for the Group's type (table below), and keep only the non-member operations for the JSON Patch;
  3. hydrate the stored copy with GridFS and base64 `RETRIEVE`, validate the patch (400), apply it with `ResourceMerger.fastApplyPatch`;
  4. `overWriteNonWritableFields`, preSave, then `GroupMemberMerger.mergeMembers` with `olderEntries: unchangedStoredEntries(stored.member)`;
  5. compute the applied patch (`DateColumnHandler` flag, the two normalize serializers, `compareObjects`). With no change and no pending member write the candidate is `null` and `noOpCheck` marks the item unchanged; otherwise `fastUpdateMeta` bumps the version and the candidate is the patched doc. The applied patch is kept on the item for the GridFS clean-up in the write.
- **`validateResult` is the default step, with no variant.** For an update it runs the meta check, then `validateResourceAsync` with the stored doc (Group member limit, schema, references, patient reference, Person.link), as `$merge` does. A failure is access-logged with the stored doc's identity, as today. Today's PATCH runs the meta check on the pre-overwrite document and the access-tag check before validation; both are accepted difference 1, which the spec already lists for PATCH.
- **Attachments keep `alwaysCreateNew`.** Today's PATCH uploads a base64 value to a new live key every time, because its write has no version check (the code carries a TODO to drop it once the operation is version aware). It still has none, so PATCH uses an `attachments: 'alwaysCreateNew'` variant: the shared `AttachmentsStep` with `alwaysCreateNewBase64: true`, which passes `{ alwaysCreateNew: true }` to the base64 INSERT. POST, PUT and `$merge` keep the default.
- **GridFS files are marked inactive where today's code does it:** after every check, just before the write. The write step calls `transformAttachments(item.stored, DELETE, appliedPatch.filter(op => op.op !== 'add'))` immediately before queueing the Group. A rejected PATCH (validation, access) never reaches it, so its files stay active, as today; a write that fails after it leaves them inactive, as today.
- **Group member regimes, one table.** The build prepares, the write step commits:

  | Group type | Build | Write (`write: 'patch'`) |
  |---|---|---|
  | embedded (no `useexternalstorage`, not extended) | JSON Patch plus `mergeMembers`; no member write | `promoteExistingGroupIfNeeded` (member rows written and `_extended` set when over the limit), then the Group |
  | extended (`_extended`) | `prepareExtendedMemberWrites`; the Group is bumped even when only members change | `commitPendingMemberWrites` with the candidate's version, last-updated and security tags, then the Group with `groupMemberEventsWritten` |
  | external storage (ClickHouse) | parse and enrich the events (Task 5); the candidate is the stored Group with its version bumped, plus the non-member patch | the Group with `groupMemberEventsWritten`; after the flush, the ClickHouse events are written for a committed item |

  The old external-storage path writes the Group's version twice for a mixed patch and returns before validation, audit and success logging for a member-only one. The new path writes the Group once and runs the shared steps; that cannot be kept identical without a per-item bypass of steps (accepted differences below, for review).
- **The write is today's call.** `PatchWriter` queues `replaceOneAsync({ requestInfo, resourceType, doc, uuid: doc._uuid, contextData })`, with `groupMemberEventsWritten` set in the context data when member operations exist. It does not read `If-Match`, as today.
- **The write step's after-flush hook.** `WriteStep.afterFlushAsync({ items, context, executedResults })` calls the writer's `afterFlushAsync` when it has one. `WritePipeline.runAsync` calls it once, after the flush, the results and the queued audit, for the profile's write step. Its only user is PATCH's ClickHouse events, which today are written after the Group's Mongo commit. It is not called for a streaming `$merge`, which doesn't use `runAsync`.
- **`PatchResponder`** extends `WriteResponder`.
  - `failureResults` uses `throwIfItemFailed` with `ACCESS_LOGGED_STAGES` = `RESULT_VALIDATION` (today's PATCH logs only validation failures).
  - `results` returns the stored doc's entry, neither created nor updated, for an unchanged item, and otherwise uses `firstExecutedResult` and `notWrittenError` (accepted difference 7: 400 instead of 500).
  - `toResponse` returns `{ id, created: false, updated, resource_version, resource }` where `updated` is `false` for a no-op (the spec's no-op fix; the response writer reads only `created`) and the resource is a copy of the candidate, or of the stored doc for a no-op, with GridFS and base64 `RETRIEVE`, identifier and extended-Group enrichment and serialization, as PUT's responder does. Extract the shared response step into `operations/singleResource/` only if it is identical to PUT's.
- **Audit and logging are the pipeline's.** The `update` AuditEvent is written by `WriteAuditor` from the write results, success and failure logging use the profile name `patch`, and the route handler writes the error audit, as for PUT. A resource type of `AuditEvent` gets 405 before the pipeline, as today.

**Accepted differences to add to the spec (for review).** Existing ones that already cover PATCH: 1 (check order) and 7 (400 instead of 500). New, and only these:
- A mixed ClickHouse Group PATCH writes the Group once, with one history row.
- A member-only ClickHouse Group PATCH is now validated, audited and success-logged like every other PATCH.

If you want these two avoided too, the only way is to keep routing external-storage member PATCHes to the old code from the switch check.

## Review Focus

- PATCH writes by `_uuid` alone, with no version filter, exactly as today, so its concurrency behavior and the delete-then-replay case are unchanged. Test: Task 7, `queuesReplaceByUuidWithoutVersionFilter`.
- A PATCH rejected by validation or access leaves the stored GridFS files active; a passing one marks only the removed or replaced files inactive, just before the write. Tests: Task 10, `rejectedPatchLeavesFilesActive`; Task 9, `gridFsAttachmentRemoved`.
- An unchanged base64 value is uploaded again to a new live key, as today. Test: Task 9, `base64ValueUnchangedUploadsAgain`.
- A Group PATCH that changes members commits its member rows once and writes the Group by `_uuid` alone (extended, ClickHouse and promotion). Tests: Task 10, `patch.groupMembers.test.js`; Task 11 runs `group_member_patch_write` and `group_patch_operations` on the new path.
- A PATCH by `id` that matches resources in two tenants gets 400 listing the authorities, and one that matches only another tenant's resource gets 404, never that resource. A PATCH of a resource the caller can't access gets 403, before any GridFS or member write. Tests: Task 9, `multipleMatches400`, `otherTenantOnly404`, `storedNotAccessible403`.
- A PATCH that removes or adds an access tag the caller can't write gets 403 and writes nothing, and one that changes the owner tag has the change reverted. Tests: Task 9, `accessTagChangeForbidden403`, `ownerTagChangeReverted`.

---

### Task 1: Step 10, the `LOOKUP` stage and `WriteItem`'s PATCH fields

**Files:**
- Modify: `src/operations/writePipeline/writePipeline.js` (`WRITE_STEP_NAMES`, constructor, `processAsync`), `writeFailure.js`, `writeItem.js`, `operations/{create,update,merge}/profile.js`, `src/createContainer.js`
- Create: `src/operations/writePipeline/steps/access/accessTagChangeChecker.js`
- Test: `src/tests/unit/operations/writePipeline/writePipeline.test.js`, `steps/access/accessTagChangeChecker.test.js`, the three profile tests if they exist

**Interfaces:**
- Produces:
  - `WRITE_STEP_NAMES` gets `'accessOnResult'` after `'validateResult'`; `WritePipeline` takes `accessOnResultStep` (an `AccessCheckStep`) and `processAsync` calls it on one line after `validateResult`.
  - `WRITE_FAILURE_STAGE.LOOKUP = 'lookup'`.
  - `WriteItem` gets `patch: Array|null`, `memberWrites: Object|null` and `appliedPatch: Array|null`, all default `null` (Tasks 6 and 7 fill them).
  - `class AccessTagChangeChecker` with `checkAsync({ items, context, accessRequested }): Promise<(WriteFailure|null)[]>`: for each item with a built document (an item whose `candidate` is `null` is a no-op and is skipped), `ScopesValidator.isAccessTagChangeAllowedByAccessScopes({ requestInfo, currentResource: item.stored, updatedResource: item.candidate, accessRequested })`; a 403 becomes an `ACCESS` failure whose OperationOutcome carries the thrown `ForbiddenError`'s text; other errors propagate.
  - The create, update and merge profiles add `'accessOnResult'` to `off` and say so in their JSDoc.

- [ ] **Step 1: Write the failing tests.**
  - `writePipeline.test.js`: update `STEP_DEFINITIONS` and the order tests to fourteen steps; the three existing profiles' runs skip `accessOnResult`.
  - `accessTagChangeChecker.test.js`: `allows an unchanged tag set`; `fails an item that adds an access tag the caller can't write`; `fails an item that removes one`; `skips an item whose candidate is null`; `lets a non-403 error through`.
- [ ] **Step 2: Run both files and confirm the new tests fail.**
- [ ] **Step 3: Implement.** Wire the default instance in the container: `accessOnResultStep: new AccessCheckStep({ accessChecker: new AccessTagChangeChecker({ scopesValidator: c.scopesValidator }) })`.
- [ ] **Step 4: Run both files; all pass.** Run `src/tests/unit/createContainer.test.js` unchanged.
- [ ] **Step 5: Stage the new and changed files.**

### Task 2: The write step's after-flush hook

**Files:**
- Modify: `src/operations/writePipeline/writePipeline.js` (`runAsync`), `steps/writeStep.js`
- Test: `src/tests/unit/operations/writePipeline/writePipeline.test.js`, `steps/writeStep.test.js`

**Interfaces:**
- Produces:
  - `WriteStep.afterFlushAsync({ items, context, executedResults }): Promise<void>`: calls `this.writer.afterFlushAsync` when the writer has one.
  - `runAsync` calls it once after the flush, on the profile's write step (the variant when the profile names one), after `responder.results` and the queued audit, so a committed write is audited even when the hook throws.

- [ ] **Step 1: Write the failing tests.**
  - `writeStep.test.js`: `afterFlushAsync calls the writer's hook with the items and results`; `afterFlushAsync is a no-op for a writer without one`.
  - `writePipeline.test.js`: `afterFlushAsync runs once, after the flush, the results and the queued audit, on the profile's write variant`; `an error from the hook is thrown`.
- [ ] **Step 2: Run both files and confirm the new tests fail.**
- [ ] **Step 3: Implement.** One more line in `runAsync`'s step comments' flow, as the existing code reads.
- [ ] **Step 4: Run both files; all pass.**
- [ ] **Step 5: Stage the four files.**

### Task 3: The `alwaysCreateNew` attachments variant

**Files:**
- Modify: `src/operations/writePipeline/steps/attachmentsStep.js`
- Test: the attachments step's unit test under `src/tests/unit/operations/writePipeline/steps/` (create it if absent)

**Interfaces:**
- Produces: `AttachmentsStep` constructor option `alwaysCreateNewBase64` (default `false`). When `true`, `prepareAsync` calls `base64DataManager.transformAsync(doc, BLOB_OP.INSERT, requestInfo, { alwaysCreateNew: true })`; otherwise the call is unchanged.

- [ ] **Step 1: Write the failing tests:** `passes alwaysCreateNew to the base64 insert when asked`; `does not pass it by default` (the existing behavior).
- [ ] **Step 2: Run the file and confirm the first test fails.**
- [ ] **Step 3: Add the option.** Leave every existing construction unchanged.
- [ ] **Step 4: Run the file; all pass.**
- [ ] **Step 5: Stage the two files.**

### Task 4: The search lookup and the stored-document access check

**Files:**
- Create: `src/operations/writePipeline/steps/load/searchExistingLoader.js`, `steps/access/storedAccessChecker.js`
- Test: `src/tests/unit/operations/writePipeline/steps/load/searchExistingLoader.test.js`, `steps/access/storedAccessChecker.test.js`

**Interfaces:**
- Consumes: `FindExistingStep({ existingResourceLoader })`, `AccessCheckStep({ accessChecker })`.
- Produces:
  - `class SearchExistingLoader` with constructor `{ searchManager, databaseQueryFactory, configManager }` and `loadAsync({ items, context }): Promise<void>`. For each item it builds today's query (`useAccessIndex` from the config or `parsedArgs._useAccessIndex`) and reads the matches; 0 fails the item at `LOOKUP` with `NotFoundError`, more than 1 with `BadRequestError` (today's text, authorities sorted); else it sets `item.stored` and copies `_uuid` and `_sourceAssigningAuthority` onto `item.incoming`.
  - `class StoredAccessChecker` with constructor `{ scopesValidator }` and `checkAsync({ items, context, accessRequested })` as in `IncomingAndStoredAccessChecker`.

- [ ] **Step 1: Write the failing tests.**
  - Loader: `one match sets stored and copies the identity`; `no match fails at LOOKUP with a 404 error`; `several matches fail at LOOKUP with a 400 that lists id|authority options sorted`; `the query uses the access index when asked`; `the stored doc is write-serialized`.
  - Checker: `allows an accessible stored doc`; `fails a forbidden stored doc at ACCESS with the validator's text`; `lets a non-403 error through`.
- [ ] **Step 2: Run both files and confirm they fail.**
- [ ] **Step 3: Implement both**, reusing the old path's calls unchanged.
- [ ] **Step 4: Run both files; all pass.**
- [ ] **Step 5: Stage the four files.**

### Task 5: Split the Group member strategy's parsing

**Files:**
- Modify: `src/operations/patch/strategies/groupMemberPatchStrategy.js`
- Test: `src/tests/unit/operations/patch/strategies/groupMemberPatchStrategy.test.js`

**Interfaces:**
- Produces on `GroupMemberPatchStrategy`:
  - `prepareClickHouseMemberWrites({ resourceType, memberOperations, foundResource }): { eventsToAdd: Object[], eventsToRemove: Object[] }`: the operations-limit check, the parsing and the source-assigning-authority check and reference enrichment that `executeMemberOperations` does before and after its Mongo write, with no writes.
  - `writeClickHouseMemberEventsAsync({ resourceType, groupId, events, groupResource }): Promise<void>`: the ClickHouse write at the end of `executeMemberOperations`.
  - `executeMemberOperations` is rebuilt from these two plus its own Mongo write and flush, with the same order and the same errors.

- [ ] **Step 1: Write the failing tests** for the two new methods: the over-limit `too-costly` 400, the unsupported-path 400 text, the missing-`entity.reference` 400, the missing authority error, enrichment, and `writeClickHouseMemberEventsAsync` calling the Group handler once with the events.
- [ ] **Step 2: Run the file and confirm the new tests fail.**
- [ ] **Step 3: Extract the two methods and rebuild `executeMemberOperations` from them.**
- [ ] **Step 4: Run the file; all existing and new tests pass, and run `groupMemberPatchStrategy.bugs.test.js` unchanged.**
- [ ] **Step 5: Stage the two files.**

### Task 6: `PatchBuilder`

**Files:**
- Create: `src/operations/writePipeline/steps/build/patchBuilder.js`
- Test: `src/tests/unit/operations/writePipeline/steps/build/patchBuilder.test.js`

**Interfaces:**
- Consumes: `BuildDocumentStep({ builder, configManager })`; the strategy from Task 5; `WriteItem`'s fields from Task 1.
- Produces: `class PatchBuilder` with constructor `{ resourceMerger, preSaveManager, groupMemberMerger, groupMemberPatchStrategy, databaseAttachmentManager, base64DataManager, configManager }` and `buildAsync({ item, context }): Promise<WriteFailure|null>`. It sets `item.candidate` (or leaves it `null` for a no-op), `item.writeMode = 'update'`, and `item.memberWrites` (`{ type: 'extended'|'externalStorage', ... }` or `null`) and `item.appliedPatch` (the operations that were applied, for the GridFS clean-up).

- [ ] **Step 1: Write the failing tests**, with fake collaborators only at the boundaries (the strategy's repository, the managers):
  - applies an `add`, a `replace` and a `remove`, bumps the version and keeps `item.stored` unmodified;
  - an invalid patch (a failing `test`, a missing path) fails with today's 400 and error text, as a `BUILD` failure;
  - a change to the owner tag or `meta.source` is reverted;
  - a patch with no change leaves `candidate` `null`; with a pending extended member write and no other change it still bumps the version;
  - an embedded Group with a repeated member keeps one entry, and an entry the patch added wins over the stored one;
  - an extended Group sets `memberWrites.type` `extended` and keeps only the non-member operations; extended Groups disabled fails with today's 400;
  - an external-storage Group sets `memberWrites.type` `externalStorage` with the parsed events, and a member-only patch gives a candidate that differs from the stored Group only in its meta;
  - the GridFS and base64 hydration runs on a copy (the stored doc is untouched).
- [ ] **Step 2: Run the file and confirm it fails.**
- [ ] **Step 3: Implement `PatchBuilder`.** Reuse `ResourceMerger.fastApplyPatch`, `overWriteNonWritableFields`, `compareObjects` and `fastUpdateMeta` as they are.
- [ ] **Step 4: Run the file; all pass.**
- [ ] **Step 5: Stage the two files.**

### Task 7: `PatchWriter`

**Files:**
- Create: `src/operations/writePipeline/steps/write/patchWriter.js`
- Test: `src/tests/unit/operations/writePipeline/steps/write/patchWriter.test.js`

**Interfaces:**
- Consumes: `WriteStep({ writer, configManager })`; the hook from Task 2.
- Produces: `class PatchWriter` with constructor `{ databaseBulkInserter, groupMemberPatchStrategy, mongoGroupMemberRepository, databaseAttachmentManager, configManager }`, `queueUpdateAsync({ item, context })`, `queueInsertAsync` (throws: PATCH never inserts) and `afterFlushAsync({ items, context, executedResults })`.
  - `queueUpdateAsync`, in today's order: marks the superseded GridFS files inactive, promotes an over-limit embedded Group (`promoteExistingGroupIfNeeded`), commits an extended Group's member rows (`commitPendingMemberWrites`), then queues `replaceOneAsync` by `_uuid` with the item's context data (`groupMemberEventsWritten` set when member operations exist).
  - `afterFlushAsync`: for an item whose entry in `executedResults` is `updated`, writes an external-storage Group's ClickHouse events (`writeClickHouseMemberEventsAsync`).

- [ ] **Step 1: Write the failing tests** (a fake bulk inserter that records its calls):
  - `queuesReplaceByUuidWithoutVersionFilter`: a plain update calls `replaceOneAsync` with the `_uuid`, the document and the context data, and no `ifMatchVersionIds`;
  - the GridFS files are marked inactive for the removed and replaced paths only (not for `add`), before the Group is queued;
  - an extended Group's rows are committed before the Group is queued, with the candidate's version, last-updated and security tags;
  - a promoted Group commits the promotion rows before the Group is queued;
  - `groupMemberEventsWritten` is set only when member operations exist;
  - `afterFlushAsync` writes the ClickHouse events only for an `updated` entry, and does nothing for a no-op or a failed write;
  - an error from the strategy fails only the item at `WRITE`, wrapped as `WriteStep` does.
- [ ] **Step 2: Run the file and confirm it fails.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the file; all pass.**
- [ ] **Step 5: Stage the two files.**

### Task 8: The profile, the responder and the switch

**Files:**
- Create: `src/operations/writePipeline/operations/patch/profile.js`, `operations/patch/responder.js`
- Modify: `src/operations/patch/patch.js` (switch check and constructor only), `src/createContainer.js` (variants, profile, responder, `PatchOperation` wiring)
- Test: `src/tests/unit/operations/writePipeline/operations/patch/responder.test.js`, `src/tests/unit/operations/patch/patch.test.js`, `src/tests/unit/createContainer.test.js`

**Interfaces:**
- Produces:
  - `PATCH_WRITE_PROFILE = { name: 'patch', accessRequested: 'u', action: 'patch', off: ['identify', 'prepareBody', 'validateIncoming', 'validateNewResource', 'validateAgainstStored'], variants: { findExisting: 'search', accessBeforeBuild: 'stored', buildDocument: 'patch', attachments: 'alwaysCreateNew', write: 'patch' } }`, added to the `profiles` list in the container.
  - `class PatchResponder extends WriteResponder` as described under Decisions, registered as `patchResponder`.
  - `PatchOperation` takes `writePipelineSwitch`, `writePipeline` and `patchResponder`; `patchAsync` starts with `if (this.writePipelineSwitch?.useNewPathFor('patch')) return await this.writePipeline.runAsync({ profile: PATCH_WRITE_PROFILE, responder: this.patchResponder, requestInfo, parsedArgs, resourceType })`.

- [ ] **Step 1: Write the failing tests.**
  - Responder, `test.each` where several inputs share a behavior:
    - `readAsync` rejects a non-JSON-Patch content type (400, today's text) and a patch on `/_uuid`, on `/meta/_x` and with `_uuid` inside a value, before anything else;
    - `readAsync` builds the stub item with `patch` and an `update` context with `smartMerge: false`;
    - `failureResults` throws the failure's error, access-logs only `RESULT_VALIDATION`, and does nothing for no failure;
    - `results` for an unchanged item, a written entry, a missing entry (400) and an unwritten entry (400);
    - `toResponse` for a written and an unchanged item (`updated`, `resource_version`, resource copied, enriched and serialized).
  - `patch.test.js`: the switch on calls `writePipeline.runAsync` with the PATCH profile; the switch off runs the old code (the existing tests pass unchanged).
  - `createContainer.test.js`: the container resolves `patchResponder` and its profile is registered (the app boot check).
- [ ] **Step 2: Run the three files and confirm the new tests fail.**
- [ ] **Step 3: Implement.** Wire the five variants in `stepVariants`: `findExisting.search`, `accessBeforeBuild.stored`, `buildDocument.patch`, `attachments.alwaysCreateNew`, `write.patch`.
- [ ] **Step 4: Run the three files; all pass.**
- [ ] **Step 5: Stage the files.**

### Task 9: The parity test (golden responses from the old path)

**Files:**
- Create: `src/tests/integration/operations/writePipeline/operations/patch/patch.test.js` and its `fixtures/` (inputs, `expected/<name>.json` and `<name>State.json`)

Follow `operations/update/update.test.js` exactly: each case runs on both paths through `WRITE_PIPELINE_OPERATIONS`, with one golden recorded from the old path, or `old`/`newPath` goldens (or `statusByPath`) where an accepted difference applies. Record the goldens from the old path first, then run the new path against them. Assert the stored document and its history after each case, and `await getTestContainer().postRequestProcessor.waitTillDoneAsync({ requestId })` after every write when `mockHttpContext()` is used (see `CLAUDE.md`).

- [ ] **Step 1: Write the cases, as one parameterized table, grouped:**
  - **Request checks:** `notJsonPatch400`, `patchOnInternalField400` (path, nested path, value), `emptyPatch200Unchanged`, `invalidPatchTestOp400`, `invalidPatchMissingPath400`, `auditEventPatch405`.
  - **Lookup and access:** `byUuid200`, `byIdWithAuthority200`, `notFound404`, `multipleMatches400`, `otherTenantOnly404`, `noUpdateScope403`, `storedNotAccessible403`, `patientScopeForbidden403`.
  - **Access tags:** `accessTagChangeForbidden403`, `accessTagChangeAllowed200` (caller with `access/*.*`), `ownerTagChangeReverted`, `sourceChangeReverted`.
  - **Validation:** `invalidMeta400`, `invalidSchema400`, `invalidReference400`, `personLinkOtherTenant400`, `groupOverMemberLimit400`, each with the failure access-log entry.
  - **Writes:** `replaceField200`, `addToArray200`, `removeFromArray200`, `datePatch200`, `noOpDoesNotWrite` (no version bump, no history row, no audit, entry `updated: false`), `versionBumpsByOne`.
  - **Group, embedded:** `memberAddedDuplicateMerged`, `memberRemoved`, `memberAddOverPromotionLimitPromotes`.
  - **Attachments:** `gridFsAttachmentRemoved` (file inactive after, the stored doc consistent), `base64ValueUnchangedUploadsAgain` (a new live key, as today, one golden for both paths).
  - Per-path expectations (accepted differences): `validationBeforeAccessTagCheck` (a patch that fails both gets the validation 400 on the new path and the 403 on the old), `noResultFromWrite400`.
- [ ] **Step 2: Record the goldens from the old path** (`WRITE_PIPELINE_OPERATIONS` without `patch`), then run the file on both paths. Delete any `actual_*.json` the local matcher writes; never stage them.
- [ ] **Step 3: Fix every disagreement that is not an accepted difference.** Report each one found, the case, and the fix, in the task summary.
- [ ] **Step 4: Run the file; all pass.**
- [ ] **Step 5: Stage the test and fixtures by explicit path.**

### Task 10: Audit, access log, attachments and Group members on both paths

**Files:**
- Create under `src/tests/integration/operations/writePipeline/operations/patch/`: `patch.audit.test.js`, `patch.accessLog.test.js`, `patch.attachments.test.js`, `patch.groupMembers.test.js`

Each runs every case on both paths with one expectation, as the PUT files do.

- [ ] **Step 1: `patch.audit.test.js`.** One `update` AuditEvent with the request args for a written PATCH; none for a no-op and for a 4xx; no per-item error audit.
- [ ] **Step 2: `patch.accessLog.test.js`.** The operation result entry for a written PATCH and a no-op; the failure entry (stored doc's id, uuid and authority, the OperationOutcome, `created: false`, `updated: false`) for a validation failure and none for 404, 403 and 400-before-validation.
- [ ] **Step 3: `patch.attachments.test.js`.**
  - A PATCH that removes or replaces an attachment marks only that file inactive, after validation, on both paths.
  - `rejectedPatchLeavesFilesActive`: a validation 400 and an access 403 leave the stored GridFS files active, on both paths.
  - An unchanged base64 value uploads again to a new live key, on both paths.
- [ ] **Step 4: `patch.groupMembers.test.js`.** Extended Group: member add and remove, a mixed patch, one history row, rows committed once. Embedded Group: promotion over the limit. ClickHouse Group (needs the ClickHouse test container): member-only and mixed patches write the events once; per-path goldens where the new path writes the Group once.
- [ ] **Step 5: Run each file; all pass.** Stage the four files by path.

### Task 11: New path by default in tests, and the existing PATCH suites

**Files:**
- Modify: `jest/setEnvVars.js` (`WRITE_PIPELINE_OPERATIONS` becomes `merge,create,update,patch`), `docs/specs/unified-write-pipeline.md` ("Testing" says it is now `merge,create,update,patch`)
- Create (only where needed): `oldWrite<Name>.test.js` copies and their `oldWrite/` fixtures

- [ ] **Step 1: Run each existing PATCH file on the new path, one at a time:**
  - `src/tests/integration/patch/patch/patch.test.js`, `patch_access_tag_change`, `patch_fast_serializer`, `patch_internal_fields`, `patch_meta`, `patch_owner_tag_change`, `patch_with_gridfs`
  - `src/tests/integration/accessLog/accessLogs.patch.test.js`
  - `src/tests/integration/binary/blobStorage/putPatchCleanup.test.js`
  - `src/tests/integration/group/group_member_patch_write.test.js`, `group_patch_operations.test.js`
  - `src/tests/unit/operations/patch/patch.test.js`, `patchSecurityTagEscalation.test.js`
  - the other files that call PATCH: `blobStorage.test.js`, `binaryDelete.test.js`, `liveObjectRetention.test.js`, `patient.reference_update.test.js`, `delegated_access_operations.test.js`, `restricted_resources.test.js`, `graph_extended_group.test.js`, `export.group.extended.test.js`, `auditLogWriteActions.test.js`
- [ ] **Step 2: For each failure, decide.** If the new path is wrong, fix the code. If it fails only because of an accepted difference, update its fixtures to the new behavior and keep the original, switch off, as `oldWrite<Name>.test.js` with the old fixtures in an `oldWrite/` folder (the spec's "Testing" rule). Report each file and the difference in the summary; skip nothing.
- [ ] **Step 3: Check the old path's coverage.** Run `patch.js` coverage with only the parity and `oldWrite` files; add `oldWrite` copies of the files that cover the old member-strategy and GridFS branches until the old `patch.js` is covered about as before. Report the numbers.
- [ ] **Step 4: Run every touched or new file once more; all pass.** Stage by path.

### Task 12: Spec, ADR, lint and security review

**Files:**
- Modify: `docs/specs/unified-write-pipeline.md`, `docs/adr/0005-unified-write-pipeline.md`

- [ ] **Step 1: Update the spec.**
  - Step list: add step 10's name and a "PATCH" note, and `accessOnResult` to the profile table (default on for PATCH, off elsewhere).
  - The `patch` column: the lookup variant, the stored-only access check, the patch build with the Group regimes table, the `attachments` variant that keeps `alwaysCreateNew`, the write (`_uuid` filter only, as today), no-op `updated: false`.
  - Say that PATCH is not versioned in its own PR: the overview line "PUT and PATCH write with a version check", accepted difference 2, "Concurrency" (the PATCH bullets and "Group PATCHes that change members are excluded"), the Testing list of concurrency tests and "Delivery" all change to say that PATCH keeps today's `_uuid`-only write until the resolver's PR, which adds the version filter and the re-patch rebase together. PATCH no longer waits for the resolver.
  - "Changes to announce", under PATCH: the two new differences under Decisions.
  - The sentence about the size and pipe checks: they apply to every operation with a resource body.
- [ ] **Step 2: Update the ADR.** Add the consequences: the step-10 line, the writer's after-flush hook, the `alwaysCreateNewBase64` option, and that PATCH stays unversioned until the resolver.
- [ ] **Step 3: Lint.** Lint every changed and new file with the committed config; fix all findings.
- [ ] **Step 4: Security review.** Run the `/security-review-diff` skill (it reads `review.md`) on the uncommitted diff. Check in particular: the search keeps the access filter; the stored-doc access check runs before any GridFS, member or ClickHouse write; the `_uuid`-only member writes keep tenant isolation; the GridFS soft-delete runs only after every check. State what could not be confirmed. Fix findings or report them.
- [ ] **Step 5: Stage the docs.** Do not commit.
