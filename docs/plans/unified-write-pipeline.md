# Unified Write Pipeline: `$merge` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the write pipeline core and the `$merge` profile behind `WRITE_PIPELINE_OPERATIONS=merge`. With the switch on, `$merge` (buffered, streaming and the GraphQL mutations that call it) returns exactly what it returns with the switch off.

**Architecture:** `WritePipeline` runs a batch of `WriteItem`s through the shared steps in `src/operations/writePipeline/steps/`. `processAsync` calls each step explicitly, one line per step, with no step list and no loop. `runAsync` owns the request lifecycle: read, steps, write, results, audit, logging, access log, response and metrics. A profile (`writePipeline/profiles/<operation>.js`) is plain data that turns steps off; the pipeline refuses unknown settings and unknown step names. A step records a failure as a neutral `WriteFailure`. The operation's responder (`writePipeline/responder/<operation>.js`) turns failures into its own results or errors. It also reads the request, shapes the response and records the operation's metrics. It extends the `WriteResponder` base class. The shared `WriteAuditor` writes the audit for every operation. `MergeOperation.mergeAsync` keeps its old code and, when the switch is on, calls `writePipeline.runAsync({ profile: MERGE_WRITE_PROFILE, responder: this.mergeResponder, ... })`.

**Tech Stack:** Node 24, CommonJS, Express, MongoDB, Jest, OpenTelemetry metrics and traces, the repo's IoC container (`src/createContainer.js`).

**Spec:** `docs/specs/unified-write-pipeline.md` (read "Step order", "Profiles" and "Concurrency" before starting).

## Global Constraints

- With the switch off, the old path behaves exactly as before. In old files, the only changes are the switch check and the constructor wiring it needs.
- With the switch on, `$merge` responses, stored documents, history rows, change events, audit events and access-log data equal the old path's. The one accepted difference: a request that fails two checks may get a different one of the two errors.
- Shared building blocks keep their behavior: `ScopesValidator`, `ResourceValidator`, `ResourceMerger`, `PreSaveManager`, `DatabaseBulkLoader`, `FastDatabaseBulkInserter`, the bulk write executors, `DatabaseAttachmentManager`, `Base64DataManager`, `AuditLogger` and `MergeManager`. Call them; don't change them.
- preSave is unchanged. The new path may run it as often as the pieces it reuses do.
- The base is `main` plus the write-flow cleanup PR, which ships first. Use its signatures: `fastMergeResourceAsync` takes no `base_version` and returns only `updatedResource`; `mergeOneAsync` and `insertOneAsync` take no `base_version` or `patches`; `validateResourceAsync` takes no `id`. The concurrent write resolver lands separately, later.
- `WRITE_PIPELINE_OPERATIONS` is comma-separated, read per call through `configManager`, default empty. Allowed names: `create`, `update`, `patch`, `merge`, `import`, `admin`. An unknown name fails at startup.
- New files are camelCase, under `src/operations/writePipeline/`. Tests mirror them under `src/tests/unit/...` or `src/tests/integration/...`.
- The flow is defined once, in `WritePipeline.processAsync`, as one explicit call per step. A profile is plain data (`name`, `accessRequested`, `action`, `off`), and every step it doesn't turn off runs. Shared code (`steps/` and `writePipeline.js`) never requires a responder, a profile or an operation's folder, and never builds an operation's result.
- No Jira IDs and no new code comments in code, tests or docs. No PHI in logs, fixtures or metrics; fixtures are synthetic.
- Use composition and constructor injection, registered in `src/createContainer.js`. Use `assertTypeEquals` on constructor dependencies, as the surrounding code does.
- Run tests one file at a time:
  - unit: `yarn jest --config jest.unit.config.js --runInBand --forceExit <file>`
  - integration: `yarn jest --runInBand --forceExit <file>`
  - switch-on: `WRITE_PIPELINE_OPERATIONS=merge yarn jest --config jest.writePipeline.config.js --runInBand --forceExit <file>`
- Lint with `yarn run lint`.
- Stage your own files by explicit path. Never stage the user's unrelated local changes. Commit only when the user asks, with the message `<ticket> <description>`.

## Review Focus

These are the failure modes the spec implies but no step obviously exercises. Each has a test in the task named.

1. A Bundle entry with no `resource` is ignored on both paths, as today (200, body `[]`). Parity case `ignores a Bundle entry without a resource` (Task 3).
2. Entries without a `uuid` (structural and scope failures) are ordered as today in a mixed list. Parity case `orders structural and scope failures as today` (Task 3).
3. More than 100 NDJSON lines commit in several batches; placeholders and audit stay as today. Parity case `streams more than one batch` (Task 5).
4. A merge update that loses a concurrency race gets the resolver's `conflict` entry on the new path too. Switch-on run of `bulk_concurrency_resolution.test.js` (Task 6).
5. The GraphQL mutations that call `mergeAsync` behave the same on the new path. Switch-on run of the `patient.generalPractitioner` and `patient.careteam` suites (Task 6).

---

### Task 0: Work branch

**Files:** none

- [ ] **Step 1: Confirm the branch with the user.** A new branch, named by the repo's branch convention, stacked on the write-flow cleanup branch, which sits on `main` (user decision). The concurrent write resolver PR belongs to a colleague and lands separately: never commit onto it.
- [ ] **Step 2: Create the branch.** Carry over `docs/specs/unified-write-pipeline.md` and this plan. The cleanup commits ship first, as their own PR.
- [ ] **Step 3: Verify.** Run `git log --oneline -6`. Expected: the cleanup commits sit directly on `main`, with this branch's commit on top.

### Task 1: Switch

**Files:**
- Modify: `src/utils/configManager.js` (getter next to `concurrencyResolutionBackoffMs`)
- Create: `src/operations/writePipeline/writePipelineSwitch.js`
- Modify: `src/createContainer.js` (register `writePipelineSwitch`)
- Modify: `src/app.js` (`createApp`, right after `const configManager = container.configManager;`)
- Test: `src/tests/unit/operations/writePipeline/writePipelineSwitch.test.js`

**Interfaces:**
- Produces:
  - `configManager.writePipelineOperations: string[]`: trimmed, empty entries dropped.
  - `class WritePipelineSwitch`:
    - `static OPERATIONS = Object.freeze(['create', 'update', 'patch', 'merge', 'import', 'admin'])`
    - `constructor({ configManager })`
    - `assertValidConfiguration(): void`
    - `useNewPathFor(operation: string): boolean`. No metric: the new path records only the metrics the old path records.

- [ ] **Step 1: Write the failing test**

```js
describe('WritePipelineSwitch', () => {
    const original = process.env.WRITE_PIPELINE_OPERATIONS;
    afterEach(() => {
        if (original === undefined) {
            delete process.env.WRITE_PIPELINE_OPERATIONS;
        } else {
            process.env.WRITE_PIPELINE_OPERATIONS = original;
        }
        jest.restoreAllMocks();
    });
    const createSwitch = () => new WritePipelineSwitch({ configManager: new ConfigManager() });

    test.each([
        { value: undefined, operation: 'merge', expected: false },
        { value: '', operation: 'merge', expected: false },
        { value: 'merge', operation: 'merge', expected: true },
        { value: 'merge', operation: 'create', expected: false },
        { value: ' create , merge ', operation: 'merge', expected: true }
    ])('useNewPathFor($operation) with "$value" is $expected', ({ value, operation, expected }) => {
        if (value === undefined) {
            delete process.env.WRITE_PIPELINE_OPERATIONS;
        } else {
            process.env.WRITE_PIPELINE_OPERATIONS = value;
        }
        expect(createSwitch().useNewPathFor(operation)).toBe(expected);
    });

    test('assertValidConfiguration rejects an unknown operation', () => {
        process.env.WRITE_PIPELINE_OPERATIONS = 'merge,bogus';
        expect(() => createSwitch().assertValidConfiguration()).toThrow(
            'WRITE_PIPELINE_OPERATIONS has unknown operation(s): bogus. Allowed: create, update, patch, merge, import, admin'
        );
    });

});
```

- [ ] **Step 2: Run it.** Use the unit command. Expected: FAIL, `Cannot find module '.../writePipelineSwitch'`.
- [ ] **Step 3: Implement.**
  - Add the getter.
  - `WritePipelineSwitch` reads `configManager.writePipelineOperations` on every call and caches nothing. `assertValidConfiguration` throws an `Error` with exactly the message in the test.
  - Register it as `container.register('writePipelineSwitch', (c) => new WritePipelineSwitch({ configManager: c.configManager }))`.
  - In `createApp`, call `container.writePipelineSwitch.assertValidConfiguration();`.
- [ ] **Step 4: Run it.** Expected: PASS.
- [ ] **Step 5: Stage** the five files.

### Task 2: Pipeline core

**Files:**
- Create: `src/operations/writePipeline/writeItem.js`
- Create: `src/operations/writePipeline/writeFailure.js`
- Create: `src/operations/writePipeline/writeContext.js`
- Create: `src/operations/writePipeline/steps/noOpStep.js`
- Create: `src/operations/writePipeline/writePipeline.js`
- Test: `src/tests/unit/operations/writePipeline/writePipeline.test.js`, `src/tests/unit/operations/writePipeline/writeFailure.test.js`

**Interfaces:**
- Produces:
  - `WRITE_ITEM_STATUS = Object.freeze({ ACTIVE: 'active', FAILED: 'failed', UNCHANGED: 'unchanged', QUEUED: 'queued' })`
  - `WRITE_FAILURE_STAGE = Object.freeze({ STRUCTURE: 'structure', SCOPE: 'scope', SIZE: 'size', IDENTITY: 'identity', INCOMING_SCHEMA: 'incomingSchema', INCOMING_META: 'incomingMeta', ACCESS: 'access', BUILD: 'build', RESULT_VALIDATION: 'resultValidation', ATTACHMENTS: 'attachments', WRITE: 'write' })`. Each value names which check failed, in neutral wording that no single operation owns.
  - `class WriteFailure`, frozen:
    - `constructor({ stage, subject, operationOutcome = null, error = null })` throws `WriteFailure needs exactly one of operationOutcome or error` unless exactly one of the two is set.
    - `subject` is `{ id, uuid, sourceAssigningAuthority, resourceType }`, captured when the item fails, then copied and frozen.
    - `static subjectOf(resource)` returns `{ id: resource.id, uuid: resource._uuid, sourceAssigningAuthority: resource._sourceAssigningAuthority, resourceType: resource.resourceType }`.
  - `class WriteItem`
    - `constructor({ index: number, incoming: Object })`
    - Fields: `index`, `incoming`, `stored = null`, `candidate = null`, `writeMode = null` (`'insert'` or `'update'`), `contextData = null`, `savedIdentity = null`, `failure = null`, `status = ACTIVE`.
    - Methods: `fail({ failure: WriteFailure }): void`, `markUnchanged(): void`, `markQueued(): void`, `get isActive(): boolean`
  - `class WriteContext`: `constructor({ requestInfo, base_version, parsedArgs, smartMerge, operationName })` sets the fields, then calls `Object.freeze(this)`.
  - every step: `runAsync({ items, context, profile }) -> Promise<void>`. A step fails an item with `item.fail({ failure })`. It never builds an operation's result.
  - A profile is plain data, `{ name, accessRequested, action, off? }`. `name`, `accessRequested` and `action` are strings, and `off` lists step names to skip. Every step the profile doesn't turn off runs.
  - `WRITE_STEP_NAMES = Object.freeze(['scopeCheck', 'findExisting', 'prepareBody', 'validateIncoming', 'accessBeforeBuild', 'buildDocument', 'validateResult', 'attachments', 'noOpCheck', 'write'])`
  - A responder extends `class WriteResponder` (`responder/writeResponder.js`). Its constructor throws `<subclass> must implement: <names>` unless the subclass overrides all five methods:
    - `readAsync({ requestInfo, parsedArgs, resourceType }) -> Promise<{ context, items, requestErrors, wasIncomingAList }>`
    - `failureResults({ items, requestErrors })`
    - `results({ items, requestErrors, executedResults })`
    - `toResponse({ context, results, wasIncomingAList, resourceType, startTime, stopTime })`
    - `recordMetrics({ results, requestInfo, parsedArgs })`
  - `class WriteAuditor` (`writeAuditor.js`):
    - `auditAsync({ context, results })`, as a post-request task.
    - Per resource type, it logs a `create` audit for the created entries and an `update` audit for the updated ones. There are no success audits for AuditEvent.
    - It logs one error audit per entry with an `issue`, with code 413 for `too-long` and 400 otherwise.
  - `class NoOpStep`: `runAsync` marks every item whose `candidate === null` as unchanged.
  - `class WritePipeline`:
    - `constructor({ scopeCheckStep, findExistingStep, prepareBodyStep, validateIncomingStep, accessCheckStep, buildDocumentStep, validateResultStep, attachmentsStep, noOpStep, writeStep, writeAuditor, databaseBulkInserter, fhirLoggingManager, customTracer })`. The step classes come from Task 4.
    - `processAsync({ profile, context, items }) -> Promise<{ items: WriteItem[] }>`. It calls the ten steps explicitly, one line each, in `WRITE_STEP_NAMES` order. Items the responder failed while reading arrive failed.
    - `runAsync({ profile, responder, requestInfo, parsedArgs, resourceType })`: the request lifecycle (Task 4).
    - `executeAsync({ context }) -> Promise<MergeResultEntry[]>`
- [ ] **Step 1: Write the failing tests.** Build fake steps that record their calls and pass `assertTypeEquals` (`Object.create(<StepClass>.prototype)` with `runAsync = jest.fn()`), and use a plain-data fake profile. Build the pipeline with `Object.create(FastDatabaseBulkInserter.prototype)` (with `executeAsync = jest.fn()`) and `new CustomTracer()`.
  - `calls the steps in WRITE_STEP_NAMES order`.
  - `skips a step the profile turns off`.
  - `passes only active items to later steps`: the first step fails item 0. The second step receives only item 1, and so does the last step.
  - One `test.each` for the profile checks, each rejecting with its exact message before any step runs or anything is logged:
    - an unknown key: `Write profile "fake" has unknown setting(s): <keys>`
    - a missing or blank string setting: `Write profile "fake" needs string setting(s): <keys>`
    - `off` that isn't an array: `Write profile "fake" setting "off" must be an array of step names`
    - an unknown `off` entry: `Write profile "fake" turns off unknown step(s): <names>`
  - `passes every step a frozen copy of the profile`: a step that changes the caller's profile does not change what later steps see.
  - `logs items that arrive failed and items a step fails`, and `does not fail the request when logging throws`.
  - `executeAsync forwards to the bulk inserter`: it is called with `{ requestInfo, base_version }` from the context and returns the bulk inserter's result.
  - In `writeFailure.test.js`, one `test.each` covers the constructor:
    - it rejects both and neither of `operationOutcome`/`error`, with the message above
    - `subjectOf` maps the four fields
    - the failure and its subject are frozen
- [ ] **Step 2: Run them.** Use the unit command. Expected: FAIL, because the module can't be found.
- [ ] **Step 3: Implement.**
  - `processAsync` checks the profile first, with the messages above, then logs the items that arrive failed (step `readItems`).
  - It runs everything inside `customTracer.trace({ name: \`WritePipeline.${profile.name}\` })` and sets `write_pipeline.operation` and `write_pipeline.batch_size` on `trace.getActiveSpan()`. Each step gets its own span, `WritePipeline.${profile.name}.${stepName}`.
  - Each step line calls `_runStepAsync`. It skips the step if the profile turns it off, filters the items to `item.isActive`, traces the step, and logs the items that just failed. Never catch errors in the runner: each step decides, matching the old path.
  - Log each failure once, on arrival or right after the step that produced it:
    - `logError('Write step failed for resource', fields)` with the error, or `logInfo('Write check failed for resource', fields)` with `issues`.
    - `issues` holds only each issue's severity, code and expression. Never log `diagnostics` or `details`, because they can carry resource content.
    - `fields` are `operation`, `step`, `stage`, the subject's `resourceType`, `id`, `uuid` and `sourceAssigningAuthority`, and `originService`. No flag gates these logs.
  - Task 4 registers it, with its ten steps built inline in the `writePipeline` registration.
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Stage** the seven files.

### Task 3: `$merge` parity test (golden results from the old path)

**Files:**
- Test: `src/tests/integration/operations/writePipeline/responder/merge/merge.test.js`
- Create: synthetic fixtures under `.../responder/merge/fixtures/` and expected results under `.../responder/merge/fixtures/expected/`

**Interfaces:**
- Consumes: `WritePipeline.runAsync` and `MERGE_WRITE_PROFILE` (Task 4), for the routing tests.

The test runs every case once per path, with the same expected result for both: `test.each` over cases × `['old', 'new']`. The path is set by `process.env.WRITE_PIPELINE_OPERATIONS = path === 'new' ? 'merge' : ''`, restored in `afterEach`. Fixture resources use the owner and access code `client`, `meta.source` `http://example.com/source`, and synthetic names and ids.

| Case name | Prior merges | Request body to `/4_0_0/Patient/$merge` | Headers | Expected |
|---|---|---|---|---|
| `creates a new resource` | – | `patient.json` | `getHeaders()` | `created.json`, and `GET /4_0_0/Patient/<id>` equals `storedCreated.json` |
| `reports an unchanged resource` | `patient.json` | `patient.json` | `getHeaders()` | `unchanged.json` |
| `updates an existing resource` | `patient.json` | `patientUpdated.json` | `getHeaders()` | `updated.json`, and the GET equals `storedUpdated.json` |
| `orders structural and scope failures as today` | – | `[patientWithoutId.json, observation.json, patient.json]` | `getHeaders('user/Patient.* access/client.*')` | `mixedFailures.json` |
| `rejects a resource the caller cannot access` | – | `patientOtherTenant.json` | `getHeaders('user/*.* access/client.*')` | `accessForbidden.json` |
| `reports a schema error` | – | `patientInvalidBirthDate.json` | `getHeaders()` | `schemaError.json` |
| `reports a new resource missing its owner tag` | – | `patientUuidIdWithoutOwner.json` | `getHeaders()` | `missingOwner.json` |
| `merges duplicate entries of one resource` | – | `[patientPartOne.json, patientPartTwo.json]` (same id) | `getHeaders()` | `duplicates.json` |
| `unwraps a Bundle` | – | `bundle.json` (two entries) | `getHeaders()` | `bundle.json` |
| `rejects Parameters without resources` | – | `parametersEmpty.json` | `getHeaders()` | `parametersEmpty.json` |
| `returns a batch-response Bundle with Prefer: return=OperationOutcome` | – | `[patient.json, patientWithoutId.json]` | `getHeadersPreferOperationOutcome()` | `preferOperationOutcome.json` |
| `ignores a Bundle entry without a resource` | – | `bundleWithEmptyEntry.json` | `getHeaders()` | `bundleWithEmptyEntry.json` (200, body `[]`) |

Task 4 later gives the cases whose new-path response differs only by order (spec accepted difference 5) a new-path golden, built by hand from the old one, under `fixtures/expected/newPath/`. The old path keeps these goldens.

- [ ] **Step 1: Write the parity test and the fixtures.** Assert with `expect(resp).toHaveResponse(expected)`. The GET checks use `toHaveResponse` too, so `lastUpdated` is normalized.
- [ ] **Step 2: Generate each expected file from the old path.** Run the case with path `old`, save `resp.body` (or the GET body), and check it has only synthetic data. These files are the contract both paths must meet.
- [ ] **Step 3: Write the routing tests.**
  - `routes $merge to the new path when the switch is on`: spy on `WritePipeline.prototype.runAsync`, merge `patient.json` with path `new`, and expect one call whose argument has `profile: MERGE_WRITE_PROFILE`.
  - `keeps $merge on the old path when the switch is off`: the same spy with path `old`; expect it not to have been called.
- [ ] **Step 4: Run it.** Use the integration command. Expected: every `old` case and every `new` case passes, because the switch isn't wired yet and both run the old code. The routing test FAILS, because nothing records a call yet.
- [ ] **Step 5: Stage** the test and fixtures.

### Task 4: Shared steps, the `$merge` profile and the buffered new path

Every step is one shared class, and `WritePipeline.processAsync` calls them explicitly, in order. A profile only turns steps off. Everything that depends on `$merge`'s request and response format lives in one responder class: reading the request into items, building the results and the response, and the metrics. `WritePipeline.runAsync` owns the rest of the request lifecycle, including the audit through the shared `WriteAuditor`. This task builds the shared steps, `runAsync`, then `$merge`'s responder and profile.

**Files:**
- Create the shared steps under `src/operations/writePipeline/steps/`:
  - `scopeCheckStep.js`
  - `findExistingStep.js`, with:
    - `checks/resourceSizeCheck.js`
    - `checks/pipeInIdCheck.js`
    - `identify/sourceIdentityResolver.js`
    - `load/bulkPreloadLoader.js`
  - `prepareBodyStep.js`
  - `validateIncomingStep.js`
  - `accessCheckStep.js`, with `access/incomingAndStoredAccessChecker.js`
  - `buildDocumentStep.js`, with `build/smartMergeBuilder.js`
  - `validateResultStep.js`
  - `attachmentsStep.js`
  - `writeStep.js`
- Create `src/operations/writePipeline/runInChunks.js`.
- Create, for `$merge` only:
  - `src/operations/writePipeline/responder/merge.js`
  - `src/operations/writePipeline/profiles/merge.js`
- Modify:
  - `src/operations/merge/merge.js`: constructor wiring, plus the switch check at the top of `mergeAsync`
  - `src/createContainer.js`:
    - Register `bundleResourceValidator`, `parametersResourceValidator`, `writePipeline` (its ten steps built inline, with their collaborators) and `mergeResponder`.
    - Add `writePipelineSwitch`, `writePipeline` and `mergeResponder` to `mergeOperation`.
    - Leave the `mergeValidator` registration as it is.
- Test: Task 3's test file (new cases `reports an id with a pipe` and `merges a new resource sent by id and by uuid`) and `src/tests/unit/operations/writePipeline/responder/merge.test.js`

**Interfaces:**
- Consumes:
  - from Task 2: `WriteItem`, `WriteFailure`, `WRITE_FAILURE_STAGE`, `WriteContext`, `WritePipeline`, `NoOpStep`
  - from Task 1: `WritePipelineSwitch`
- Produces:
  - `WritePipeline.runAsync({ profile, responder, requestInfo, parsedArgs, resourceType })`:
    1. Check the profile, then `assertTypeEquals(responder, WriteResponder)`.
    2. `responder.readAsync`, then `processAsync`, then `failureResults`, then `executeAsync`, then `results`, then `writeAuditor.auditAsync({ context, results })`.
    3. Operation success logging with `action: profile.name`, then the access log `{ operationResult: results }`, then `return await responder.toResponse(...)`.
    4. On error, operation failure logging, then rethrow. In `finally`, `responder.recordMetrics`.
  - **Shared steps and their strategies.**
    - A step's constructor takes only its dependencies. What varies by operation it reads at run time from `profile` (`accessRequested`, `action`) or `context` (`smartMerge`).
    - A strategy returns a `WriteFailure` or `null`, and the step calls `item.fail({ failure })`.
    - A thrown error in a per-item strategy fails only that item, with `error` set.
    - The subject defaults to `WriteFailure.subjectOf(item.incoming)` at the moment of failure.
  - `runInChunks({ items, chunkSize, func })`: `async.mapLimit` per chunk, with `setImmediate` between chunks.
  - In `responder/merge.js`: `class MergeResponder`.
    - `readAsync({ requestInfo, parsedArgs, resourceType }) -> Promise<{ context, items, wasIncomingAList, requestErrors }>`:
      - It builds the `WriteContext` (`smartMerge = isTrue(parsedArgs.smartMerge ?? true)`, `operationName: 'merge'`) and reads `parsedArgs.resource` or else the body.
      - `requestErrors` are failures of the whole request, not of one item, already in `$merge`'s result format.
      - It fails structurally broken items with a `WriteFailure` before the steps run.
    - `toResponse(...)` (the Prefer `OperationOutcome` bundle, or a list or a single result) and `recordMetrics({ results, requestInfo, parsedArgs })` (`recordMergeOutcomes` and `recordInboundBundleSize`, counted from the request).
    - Results come back in request order (spec accepted difference 5):
      - `toResult(failure) -> MergeResultEntry`, built from `failure.subject`:
        - With an `operationOutcome`, it sets `id`, `uuid`, `sourceAssigningAuthority` and `resourceType`, plus `created: false`, `updated: false`, `issue: operationOutcome.issue?.[0] || null` and `operationOutcome`.
        - With an `error`, it returns `MergeResultEntry.createFromError({ error, resource: { id, _uuid: uuid, _sourceAssigningAuthority: sourceAssigningAuthority, resourceType } })`.
      - `failureResults({ items, requestErrors }) -> MergeResultEntry[]`: `requestErrors`, then each failed item's result, in index order.
      - `results({ items, requestErrors, executedResults }) -> MergeResultEntry[]`: `requestErrors` first, then one entry per item, in index order.
        - A failed item gets `toResult`.
        - An unchanged item gets a `created: false, updated: false` placeholder.
        - A queued item gets the executed result with the same `_uuid` and `resourceType`, or the placeholder when there is none.
        - Any executed result that matches no item is appended at the end.
  - In `profiles/merge.js`: `MERGE_WRITE_PROFILE = Object.freeze({ name: 'merge', accessRequested: 'u', action: 'merge' })`. It is not registered in the container.

Each step mirrors the old code it replaces. Cite the base branch's `merge.js`, `mergeManager.js` and `validators/*.js` while implementing. `runAsync` calls the responder's `readAsync` before the steps, and its results, audit and response methods after them.

| Step | Class and collaborators | What it does (old code it mirrors) | Stage on failure |
|---|---|---|---|
| (read) | `MergeResponder.readAsync` (`$merge` only) | <ol><li>Runs `bundleResourceValidator.validate`, then `parametersResourceValidator.validate`. Their `preCheckErrors` are collected as `requestErrors`, and their `wasAList` values are OR-ed.</li><li>Calls `mergeManager.mergeDuplicateResourceEntries`, sets `wasIncomingAList ||= Array.isArray(...)`, and converts `id` to `String`.</li><li>For each item, runs the first four checks of `MergeManager.preMergeChecksAsync`: missing id, missing resourceType, unsupported type, and neither a UUID id nor an owner/SAA tag. A failure's `operationOutcome` comes from `mergeManager.createMergeError(...)`, and its subject's fields match the entry `createMergeError` builds.</li></ol>Errors are not caught, so a `null` entry fails the request. | `structure` |
| scopeCheck | `ScopeCheckStep`, with `profile.accessRequested` and `profile.action` | Calls `scopesValidator.isScopesValidAsync({ requestInfo, resourceType: incoming.resourceType, accessRequested, action, base_version })`. On a forbidden result, the failure's `operationOutcome` is `buildOperationOutcomeFromIssues(forbiddenError.issue)`. | `scope` |
| findExisting | `FindExistingStep({ prechecks: [ResourceSizeCheck, PipeInIdCheck], identityResolver: SourceIdentityResolver, existingResourceLoader: BulkPreloadLoader })` | <ol><li>Per item, in order: the prechecks, then the identity resolver. The first failure stops that item.<ul><li>`ResourceSizeCheck` calls `resourceValidator.validateResourceSizeSync` (stage `size`).</li><li>`PipeInIdCheck` fails with `new Error('Pipe \| is not allowed in id field')` (stage `identity`).</li><li>`SourceIdentityResolver` turns a UUID id into `_uuid`, or else runs the SAA and uuid column handlers (stage `identity`).</li></ul></li><li>The loader then runs once for the remaining items. `BulkPreloadLoader` calls `databaseBulkLoader.loadResourcesAsync({ requestId, base_version, requestedResources })`, then `getResourceFromExistingList`. It calls `fastFindOneAsync({ query: { _uuid } })` only when `isResourceTypeLoaded` is false, and it sets `item.stored`.</li></ol> | `size`, `identity` |
| prepareBody | `PrepareBodyStep` | Sets `item.savedIdentity = { uuid, sourceAssigningAuthority }`, then calls `removeUnderscoreFieldsRecursive(item.incoming)`. | – |
| validateIncoming | `ValidateIncomingStep` | <ol><li>Calls `validateResource({ resourceBody, resourceName, path: requestInfo.path, excludeRequiredFieldErrors: context.smartMerge })`.</li><li>Restores `_uuid` and `_sourceAssigningAuthority` from `savedIdentity`, whether or not validation failed.</li><li>Calls `resourceValidator.validateResourceMetaSync(incoming)` for items with no `stored`.</li></ol> | `incomingSchema`, `incomingMeta` |
| accessBeforeBuild | `AccessCheckStep`, with `IncomingAndStoredAccessChecker` | Calls `writeAllowedByScopesValidator.validate({ requestInfo, incomingResources, base_version, effectiveSmartMerge: context.smartMerge })`. An item whose `incoming` is not in `validatedObjects` fails with the `preCheckErrors` entry that has the same `_uuid` and `resourceType`. The failure takes that entry's `operationOutcome`, and a subject copied from the entry: its SAA comes from `meta.sourceAssigningAuthority`, as today. Non-403 errors propagate. | `access` |
| buildDocument | `BuildDocumentStep`, with `SmartMergeBuilder`; chunks of `configManager.mergeParallelChunkSize` | <ol><li>Sets `item.incoming = FhirResourceWriteSerializer.serialize({ obj: item.incoming })` for every item.</li><li>Calls `builder.buildAsync({ item, context })` per item, through `runInChunks`.</li></ol>`SmartMergeBuilder` does the `lastUpdated` ISO conversion and makes the existing-vs-new decision from `mergeResourceAsync`:<ul><li>**Existing:** preSave `stored`, then `getExtendedGroupMemberWriteError` (an outcome failure), then `resourceMerger.fastMergeResourceAsync({ ..., ignoreDateOnlyChange: true })`. Sets `candidate` (null when nothing changed) and `writeMode: 'update'`.</li><li>**New:** the `configManager.requireMetaSourceTags` check (a `BadRequestError` with `'Unable to merge resource. Missing either metadata or metadata source.'`), then `versionId '1'` and `lastUpdated`. Sets `candidate = incoming` and `writeMode: 'insert'`.</li></ul> | `build` |
| validateResult | `ValidateResultStep`, with `profile.accessRequested`; same chunks | Skips null candidates.<ul><li>**Update:** `validateResourceMetaSync(candidate)`, then `validateResourceAsync({ accessRequested: profile.accessRequested, ..., resourceToValidate: normalized deepcopy, resourceObj: candidate, currentResource: item.stored })`.</li><li>**Insert:** the same call without `currentResource`.</li></ul>An outcome or a thrown error fails the item. | `resultValidation` |
| attachments | `AttachmentsStep`; same chunks | Skips null candidates.<ul><li>**Update:** mirrors `performMergeDbUpdateAsync` up to, but not including, `mergeOneAsync`: preSave, attachments, base64 `INSERT`, `buildContextDataForHybridStorage(..., { smartMerge })`, the external-storage member rule and the `meta.security` dedupe.</li><li>**Insert:** mirrors `performMergeDbInsertAsync`. The preSave result is not reassigned, and contextData has no options.</li></ul>Errors are wrapped as `new RethrownError({ message: \`Error updating: resource_uuid=${uuid}\` /* or Error inserting */, error })`. | `attachments` |
| noOpCheck | `NoOpStep` | – | – |
| write | `WriteStep` | <ul><li>**Update:** `databaseBulkInserter.mergeOneAsync({ requestInfo, resourceType, doc: candidate, previousVersionId: stored.meta.versionId, contextData, smartMerge })`.</li><li>**Insert:** `insertOneAsync({ requestInfo, resourceType, doc: candidate, contextData })`.</li></ul>Then `markQueued()`. Errors are wrapped as in attachments. | `write` |
| (respond) | `MergeResponder` (`$merge` only) | See Interfaces. | – |
| (audit) | `WriteAuditor.auditAsync` (shared) | A copy of `MergeManager.logAuditEntriesForMergeResults`, run on the results with the request's `requestId`, `base_version` and `parsedArgs`. | – |

- [ ] **Step 1: Implement the shared steps and their strategies.** Keep every building-block call and its arguments as the table says, and send every failure through `WriteFailure`. Register `writePipeline` with its ten steps built inline.
- [ ] **Step 2: Implement `MergeResponder` and `MERGE_WRITE_PROFILE`.** Register the responder.
- [ ] **Step 3: Implement `WritePipeline.runAsync`** from `MergeOperation.mergeAsync`'s lifecycle. Set `results = responder.failureResults(...)` before the write, so the metrics in `finally` still see the failures if the write throws. There is no sort. Everything else stays identical to the old path: logging, the access-log context, the Prefer bundle, the metrics, and the return shape.
- [ ] **Step 4: Wire the switch.**
  - In `MergeOperation`, add the constructor dependencies `writePipelineSwitch`, `writePipeline` and `mergeResponder`, with `assertTypeEquals`.
  - At the top of `mergeAsync`, after the asserts:
    ```js
    if (this.writePipelineSwitch?.useNewPathFor('merge')) {
        return await this.writePipeline.runAsync({
            profile: MERGE_WRITE_PROFILE,
            responder: this.mergeResponder,
            requestInfo,
            parsedArgs,
            resourceType
        });
    }
    ```
  - The optional chaining keeps the existing unit tests unchanged. They build `MergeOperation` with `Object.create(MergeOperation.prototype)` and never set the new fields.
- [ ] **Step 5: Check that the shared code stays shared.** Run `grep -rn "MergeResultEntry\|writePipeline/merge\|responder/\|profiles/\|require('\.\./merge\|require('\.\./\.\./merge/merge" src/operations/writePipeline/steps/ src/operations/writePipeline/writePipeline.js`. Expected: no output. A shared step may read `mergeParallelChunkSize` and keep today's response text, but it never requires a responder, a profile or the `$merge` folder, and never builds a `$merge` result.
- [ ] **Step 6: Pin the failure paths the Task 3 cases don't reach.**
  - Add the parity case `reports an id with a pipe`: `[patient.json, patientWithPipeInId.json]`, with `getHeaders()`. Record the golden `pipeInId.json` from the old path.
  - Add the parity case `merges a new resource sent by id and by uuid`: a new Patient by id with the owner tag, then the same Patient with its uuid as the id. Record the old golden from the old path. Build the new-path golden by hand: the old golden minus its second `created: false, updated: false` entry (accepted difference 5). The stored doc is the same on both paths.
  - Write `responder/merge.test.js`:
    - `failureResults` puts `requestErrors` first, then follows the collected order.
    - `toResult` maps an outcome failure and an error failure as the Interfaces section says.
    - One `test.each` covers `results`: a failed item, an unchanged item, a queued item with a matching result and one without, request errors placed first, and an unmatched executed result appended at the end.
- [ ] **Step 6a: Run the parity test.** Use the integration command. Expected: every case PASSES on both paths, and the routing test PASSES.
- [ ] **Step 7: Run the existing merge unit tests** with the unit command: `src/tests/unit/operations/merge/merge.test.js`, `merge.nullSafety.test.js` and `merge.crossTenant.test.js`. Expected: PASS, unchanged.
- [ ] **Step 8: Stage** the new and modified files.

### Task 5: Streaming `$merge` on the new path

**Files:**
- Modify: `src/operations/writePipeline/writePipeline.js` (add `runStreamAsync` and `commitStreamBatchAsync`)
- Modify: `src/operations/writePipeline/responder/merge.js` (add `streamPlaceholdersFor`)
- Modify: `src/operations/merge/merge.js` (the switch check at the top of `mergeAsyncStream`)
- Test: Task 3's test file (new cases)

**Interfaces:**
- Consumes: `MergeResponder`, `MERGE_WRITE_PROFILE`, `WritePipeline.processAsync` and `executeAsync`.
- Produces:
  - `WritePipeline.runStreamAsync({ profile, responder, requestInfo, parsedArgs, resourceType, req, res })`. Confirm this shape with the user when the hold lifts, because streaming is the one transport `runAsync` doesn't cover.
  - `MergeResponder.streamPlaceholdersFor({ items, results }) -> MergeResultEntry[]`: an entry with `created: false, updated: false` for each item whose `_uuid` is in no result. It matches on `_uuid` only, as streaming does today.

- [ ] **Step 1: Add the failing cases.** Send to `/4_0_0/Patient/$merge` with `{ ...getHeaders(), 'Content-Type': 'application/fhir+ndjson', Accept: 'application/fhir+ndjson' }`. Parse the response as `stream_merge_with_id.test.js` does. Generate the golden files from the old path, as in Task 3.
  - `streams NDJSON results`: three lines (`patient.json`, `patientWithoutId.json`, `observation.json`), expected `stream.json` (an array of the parsed lines).
  - `streams more than one batch`: 101 synthetic Patients built in the test (ids `stream-0` to `stream-100`), expected `streamBatches.json`.
  - `routes streaming $merge to the new path`: spy on `WritePipeline.prototype.runStreamAsync`, as in Task 3.
- [ ] **Step 2: Run them.** Expected: the `new` streaming cases pass on the old code, and the streaming routing test FAILS.
- [ ] **Step 3: Implement `runStreamAsync`** as a copy of the old `mergeAsyncStream`. In the transform:
  - Call `responder.readAsync`, then `processAsync`, per line, and push `responder.failureResults({ items, requestErrors })`.
  - Keep the line's unchanged and queued items in `pendingItems`.
  - Commit when `pendingItems.length >= 100`, and in `flush`.
- [ ] **Step 4: Implement `commitStreamBatchAsync`** as a copy of `insertAndLog`:
  1. `executeAsync`, then push the inserted results.
  2. `responder.streamPlaceholdersFor({ items: pendingItems, results })`, where `results` holds the inserted results and every earlier result.
  3. Clear `pendingItems`.
  4. `writeAuditor.auditAsync` with every result so far.
  5. The access-log context with `streamingMerge: true`.
- [ ] **Step 5: Wire the switch** at the top of `mergeAsyncStream`, before `getRequestDecompressor`, with the same optional-chaining check.
- [ ] **Step 6: Run the parity test.** Expected: all cases PASS on both paths.
- [ ] **Step 7: Stage** the files.

### Task 6: Switch-on CI job and the merge suites

**Files:**
- Create: `jest.writePipeline.config.js`
- Create: `src/tests/writePipelineSwitchOnExclusions.js`
- Modify: `.github/workflows/node.js.yml`

**Interfaces:**
- Produces: `writePipelineSwitchOnExclusions: { testName: string, reason: string }[]`, empty to start.

- [ ] **Step 1: Write the config.** `jest.writePipeline.config.js` spreads `require('./jest.config')`.
  - When the exclusion list isn't empty, it adds `testNamePattern: ^(?!(<escaped full test names joined by \|>)$).*`.
  - The exclusions file exports the array, with a JSDoc typedef for the entry shape.
- [ ] **Step 2: Add the CI job.** Add `build-write-pipeline` beside `build`, as a copy of it with these changes:
  - name `test write pipeline (chunk ${{ matrix.shard }}/${{ strategy.job-total }})`
  - `--config jest.writePipeline.config.js` in place of `jest.config.js`
  - `WRITE_PIPELINE_OPERATIONS: merge` added to the job's `env`

  It keeps its own 16-shard matrix, so `strategy.job-total` stays 16.
- [ ] **Step 3: Run two or three merge-related suites locally with the switch on**, one file at a time, using the switch-on command (user decision). The switch-on CI job runs the rest, on a draft PR. The merge-related suites are:
  - every file under `src/tests/integration/merge/`
  - `src/tests/integration/accessLog/accessLogs.merge.test.js`
  - `src/tests/integration/bugs/mergeWithMissingId/mergeWithMissingId.test.js`
  - `src/tests/integration/patientScope/patient_scope/patient_scope.merge.test.js`
  - `src/tests/integration/organization/merge/organization.merge.test.js`
  - `src/tests/integration/practitioner/practitioner.merge.test.js`
  - `src/tests/integration/practitioner/complex_merge/practitioner.complex.merge.test.js`
  - `src/tests/integration/graphql/patient/patient.generalPractitioner.test.js`
  - `src/tests/integration/graphql/patient/patient.careteam.test.js`

  Expected: PASS.
- [ ] **Step 4: Triage any failure.**
  - A difference outside the accepted one is a bug in the new path: fix it, and add a parity case that would have caught it.
  - A request that fails two checks and now gets the other error is the accepted difference. Add an exclusion with the full test name and the reason, plus a parity case that pins the new behavior.
- [ ] **Step 5: Stage** the three files and any fixes.

### Task 7: ADR, lint and security review

**Files:**
- Create: `adrs/0001-unified-write-pipeline.md`

- [ ] **Step 1: Write the ADR in MADR format.** Sections: Context and Problem Statement, Decision Drivers, Considered Options, Decision Outcome, Consequences. Take the options and the reasoning from the spec's "ADR" section: one pipeline plus profiles (chosen), a subclass per operation, a per-operation step list, and refactoring in place without switches.
- [ ] **Step 2: Lint.** Run `yarn run lint`. Expected: 0 errors, and no new warnings in the changed files.
- [ ] **Step 3: Security review.** Run the repo's `/security-review-diff` against `review.md` (write paths). Fix any finding in the new path. Report findings about the old path without changing it.
- [ ] **Step 4: Stage** the ADR and any fixes.

## Follow-on PRs (outline only, one plan each)

Each PR adds its name to the switch-on job and goes through the same parity-test pattern. Each PR runs the one flow in `WritePipeline.processAsync`. Where the spec's Profiles table says an operation does a step differently, the PR adds a named variant to that step, and its profile picks the variant by name, as plain data. Each PR adds `writePipeline/profiles/<operation>.js` and `writePipeline/responder/<operation>.js`, and its operation file passes both to `writePipeline.runAsync`. The first operation that runs access on result (PUT) adds that step's call and its name to `WRITE_STEP_NAMES`; the profiles that don't run it then turn it off. The user-visible changes each PR must announce are in the spec's "Changes to announce".

1. **`$import` worker.**
   - The profile runs `$merge`'s variants, plus an owner-tag backfill before validation.
   - `ValidateIncomingStep` runs as for `$merge`, so each line gets the incoming schema check (accepted difference 6) and its schema failures are counted in the validation failure metric.
   - Its reader takes buffered NDJSON lines.
   - The responder writes per-line entries with `sourceByteOffset`.
   - No-op lines count as `skipped`.
   - Counts come from the flush results.
2. **POST.**
   - A reader for a single body.
   - `accessRequested: 'c'`.
   - `FindExistingStep` with a loader that finds nothing.
   - Validate incoming: meta and schema.
   - An insert builder.
   - Access before build: the `$merge` checker, whose new-resource branch is the full check plus the tag change, with the scope letter from the profile (`c`). `WriteAllowedByScopesValidator` hard-codes `u`, so it gets an opt-in letter parameter that defaults to `u`. No access on result.
   - The responder throws the first failure as the error the old path throws, and attachments move after the checks.
3. **PUT.**
   - `FindExistingStep` with a by-`_uuid` loader.
   - The body-only part of `validateResourceAsync` moves to validate incoming; the stored-doc checks go to validate result.
   - A replace builder.
   - Versioned updates go through the resolver, with 409 and 403 as described in the spec's "Concurrency".
4. **PATCH.**
   - `FindExistingStep` with a loader that uses the access-filtered search.
   - `PrepareBodyStep` rejects `_` paths.
   - A JSON Patch builder, plus the Group member strategy.
   - An opt-in per-entry rebase is added to the resolver.
   - Group member PATCHes keep the `_uuid`-only write.
   - The internal result says `updated: false` on a no-op.
   - Returns 400 instead of 500 when the write returns no result (accepted difference 7).
5. **Admin.** The five operations, with `_uuid`-only lookups through the access filter, access checks, the patient-reference exception for `updatePatientReference`, audits and the standard error format, as in the spec's "Admin". `createPersonToPatientLink` without `externalPersonId` returns 400 like the other missing parameters, instead of today's 500.
