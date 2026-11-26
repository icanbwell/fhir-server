# POST (create) on the Unified Write Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** With `WRITE_PIPELINE_OPERATIONS` including `create`, `CreateOperation.createAsync` runs through `WritePipeline.runAsync`, and its responses, stored documents, audit events and access-log data match the old path's. The exceptions are that a POST rejected with 403 no longer stores its attachments, the two-check cases listed under Decisions (accepted difference 1), and the extra operation-failure logging listed in the spec's "Changes to announce".

**Architecture:** POST adds the two per-operation files the spec asks for, `profiles/create.js` and `responder/create.js`, and one named step variant, `buildDocument: insert`. Variants are separate step instances that `WritePipeline` holds by name. A profile picks one with plain data, and adding a variant doesn't change the step it replaces. POST turns `findExisting` off, because a new resource has no stored document to load. Every other step runs as it does for `$merge`. The access check reuses the `$merge` checker with POST's scope letter.

**Tech Stack:** Node 24, Express, MongoDB, Jest with MongoDB Memory Server.

**Spec:** `docs/specs/unified-write-pipeline.md`. Read "Step order", "Profiles" (the `create` column), "Testing" and "Changes to announce" (POST). The `$merge` plan, `docs/plans/unified-write-pipeline.md`, built everything this plan reuses.

## Global Constraints

- With the `create` switch off, POST behaves exactly as before. In `src/operations/create/create.js` the only changes are the switch check and the constructor wiring it needs.
- Shared building blocks keep today's behavior. New behavior goes in new code, or behind an opt-in parameter whose default is today's and which existing callers never pass. Here that is `WriteAllowedByScopesValidator.validate`'s `accessRequested`, which defaults to `'u'`.
- POST asks for scope letter `c` with action `create`, as today.
- No new metrics. A schema failure is recorded in `fhir_validation_failure_total` exactly where the old path records it.
- Tenant isolation is unchanged: the new path adds no data access path. Every access check goes through `ScopesValidator`, as the old path's does.
- No PHI in logs, test fixtures or commit messages. Use synthetic data only.
- New files under `src/` are camelCase. New classes and functions get JSDoc saying what they do, and no other comments.
- No Jira IDs in code, tests or docs.
- Run tests one file at a time: `nvm use && node node_modules/.bin/jest --runInBand --forceExit <file>`. Unit tests also need `--config jest.unit.config.js`. Never run the full suite or a whole folder; CI runs the rest.
- Stage files only. Commit nothing until the user asks.

## Decisions

**User:**
- POST moves before `$import`, which the spec's Delivery section had first.
- One PR, stacked on the streaming `$merge` PR (#2732).
- (Superseded by the next entry.) POST keeps today's check order. Validate incoming makes today's validation calls unchanged: meta, `validateResourceAsync`, the schema of the write-serialized body, then the AuditEvent size. The access check runs right after them, before build and attachments. Of this reorder, the only behavior change is that a POST rejected with 403 no longer stores its attachments or base64 data. The spec's "Access check before validation" entry is dropped. Its Profiles table already shows this order; Task 7 only finishes the validate-incoming cell.
- POST uses `$merge`'s validation steps and order, decided after Task 7. It runs the shared `ValidateIncomingStep` (the raw body's schema, then meta) and turns `ValidateResultStep` on (`validateResourceAsync` on the built document, after the access check). The shared `ValidateIncomingStep` runs the `$merge` size and pipe-in-id checks, `CreateResponder.readAsync` removes the client's `meta.lastUpdated`, and `SingleResourceValidationStep` is removed. A request that fails two checks can get the other error (accepted difference 1); the spec's "Changes to announce" lists the cases.
- POST turns `findExisting` off, and the size and pipe-in-id checks are built into validate incoming, decided when the `$merge` reorder (identify, prepare body, validate incoming, find existing, validate new resource) was merged in. No operation needs a loader that loads nothing, so POST's find-existing variant and its loader were removed. POST keeps `identify` on, which sets `_uuid` to its new UUID id, and `validateNewResource` runs its meta check because `item.stored` stays null. POST's responses don't change: its id is a new UUID, so identification can't fail and a pipe can't occur, and `CreateResponder.readAsync` already strips the `_` fields, so the size is measured on the same body.
- The Group member limit stays in `ValidateResultStep` (`validateResourceAsync` on the built document) for POST and `$merge`, so POST follows `$merge`'s order, decided after Task 9, which had moved it to the start of `ValidateIncomingStep` and was reverted. A POST Group over the limit that also fails the schema check gets the schema 400 instead of `too-costly` (accepted difference 1).

**My calls (for review):**
- **Step variants live in the pipeline.**
  - `WritePipeline` takes `stepVariants`, which maps a step name to variant names and their step instances.
  - A profile's `variants` setting names only the non-default variants it uses.
  - `_runStepAsync` runs the named variant in place of the default step.
  - Adding a variant doesn't change the step it replaces, and the `$merge` profile doesn't change.
- **POST reuses the `$merge` access checker.**
  - `WriteAllowedByScopesValidator`'s new-resource branch makes the same two calls as the old POST: the full access check, then the access-tag change check.
  - It gets an opt-in `accessRequested`, and `IncomingAndStoredAccessChecker` passes it the profile's letter.
  - The responder rebuilds the old `ForbiddenError` from the failure's `issue[0].details.text`. `ForbiddenError` puts its message there, so the rebuilt error is the same.
- **The reader keeps the old read-time work.**
  - It rejects an array body, replaces the id with a new UUID, and strips every `_` field.
  - It also fails a body whose `resourceType` doesn't match the URL, with the outcome `validateResource` builds today. Every step then sees the URL's type, so the scope check is the old one.
  - The consequence is a two-check case (accepted difference 1): an array or mismatched body from a caller without the scope gets 400 where today it gets 403.
  - A mismatched body that also fails the meta check or the Group member limit gets the type-mismatch 400, where today it gets the meta or member-limit 400 (accepted difference 1, like the case above). The status stays 400; only the outcome text and the stage label of the validation-failure metric differ.
- **The responder writes the failure access-log entry.** When the type check, the incoming schema or meta check, the size check or the result validation fails with an OperationOutcome, `CreateResponder` sets the access-log entry before it throws, as the old path does. The pipeline still sets it on success.
- **`toResponse` also gets `items`.** This is an additive change, because POST answers with the written document, not with result entries.

## Review Focus

- A body whose client `meta.lastUpdated` is not a valid instant, such as `"2024-01-01"`, is created as today, because `CreateResponder.readAsync` removes it before any check (the old path's `validateResourceAsync` deletes it before its schema check). Test: Task 3, case `lastUpdatedNotAnInstant`.
- A patient-scoped caller gets 201 creating an Observation for their own patient and 403 for another patient, as today. Test: Task 3, cases `patientScopeOwn` and `patientScopeOther`.
- A Group with members, with ClickHouse member storage on, writes its members through the same hybrid-storage context data. Test: Task 6 runs `group_create_operations` and the ClickHouse Group create suites on the new path.
- A delegated (act-claim) caller without delegated access gets the same 403 text. Test: Task 6 runs the delegated-access suites on the new path.
- When the flush returns no result, or one that is neither created nor updated, POST gets 400 with the issue JSON and writes no AuditEvent. Test: Task 4, step 1 unit test (a flush failure can't be produced end to end).

---

### Task 1: Named step variants

**Files:**
- Modify: `src/operations/writePipeline/writePipeline.js`
- Modify: `src/operations/writePipeline/responder/writeResponder.js` (the `toResponse` JSDoc), `src/createContainer.js` (pass `stepVariants: {}` until Task 4)
- Test: `src/tests/unit/operations/writePipeline/writePipeline.test.js`

**Interfaces:**
- Produces:
  - Constructor parameter `stepVariants: Object<string, Object<string, {runAsync: function}>>`, frozen.
  - `PROFILE_SETTINGS` gains `'variants'`.
  - The `WriteProfile` typedef gains `@property {Object<string, string>} [variants]`.
  - `processAsync` copies `variants` into the frozen run profile.
  - `runAsync` calls `responder.toResponse({ context, items, results, wasIncomingAList, resourceType, startTime, stopTime })`.

- [ ] **Step 1: Write the failing tests.** These go in `writePipeline.test.js`, as one `test.each` of invalid profiles. Each one throws before any step runs, with this message:

  | Case | Message |
  |---|---|
  | `variants: 'insert'` | ``Write profile "fake" setting "variants" must be an object of step names to variant names`` |
  | `variants: { noOpCheck: 'x' }` with no variants registered for `noOpCheck` | ``Write profile "fake" names a variant for step(s) without variants: noOpCheck`` |
  | `variants: { buildDocument: 'copy' }` when only `insert` is registered | ``Write profile "fake" names unknown variant(s): buildDocument.copy`` |

  Plus these tests:
  - `runs the named variant instead of the default step`: `calls` shows the variant's mark in place of `buildDocument`'s, and the default step isn't called.
  - `passes the profile's variants in the frozen profile copy`: `Object.isFrozen(profile.variants)` is true.
  - A constructor `test.each`: `stepVariants` naming a step that isn't in `WRITE_STEP_NAMES`, and a variant without a `runAsync` function. Both throw.
  - Update `runAsync reads, runs the steps, executes, audits, logs and responds in order` so it expects `items` in the `toResponse` arguments.
- [ ] **Step 2: Run** `node node_modules/.bin/jest --config jest.unit.config.js --runInBand --forceExit src/tests/unit/operations/writePipeline/writePipeline.test.js`. Expected: the new cases FAIL.
- [ ] **Step 3: Implement.**
  - The constructor checks `stepVariants` and freezes it.
  - `_assertValidProfile` checks `variants` in the order of the table above.
  - In `_runStepAsync`, `step` becomes `this.stepVariants[name][profile.variants[name]]` when the profile names a variant.
  - `processAsync`'s explicit calls stay as they are.
  - Update the `WriteResponder.toResponse` JSDoc. `MergeResponder` ignores `items`.
- [ ] **Step 4: Run** the same file, then `src/tests/unit/createContainer.test.js`. Expected: PASS.

### Task 2: Scope letter for the access checker

**Files:**
- Modify: `src/operations/merge/validators/writeAllowedByScopesValidator.js`, `src/operations/writePipeline/steps/access/incomingAndStoredAccessChecker.js`, `src/operations/writePipeline/steps/accessCheckStep.js`
- Test: `src/tests/unit/operations/merge/validators/writeAllowedByScopesValidator.test.js`, `src/tests/unit/operations/writePipeline/steps/access/incomingAndStoredAccessChecker.test.js`, and a new `src/tests/unit/operations/writePipeline/steps/accessCheckStep.test.js`

**Interfaces:**
- Produces:
  - `WriteAllowedByScopesValidator.validate({ requestInfo, incomingResources, base_version, effectiveSmartMerge, accessRequested = 'u' })`
  - `IncomingAndStoredAccessChecker.checkAsync({ items, context, accessRequested })`
  - `AccessCheckStep.runAsync` passes `profile.accessRequested`.

- [ ] **Step 1: Write the failing tests.**
  - `writeAllowedByScopesValidator.test.js`: a `test.each` over `{ given: undefined, expected: 'u' }` and `{ given: 'c', expected: 'c' }`, each for a new resource and for a stored one. Both `isAccessToResourceAllowedByAccessAndPatientScopes` and `isAccessTagChangeAllowedByAccessScopes` receive `accessRequested: expected`.
  - The checker test: it forwards `accessRequested`.
  - `accessCheckStep.test.js`: the checker gets the profile's `accessRequested`.
- [ ] **Step 2: Run** the three files. Expected: FAIL.
- [ ] **Step 3: Implement.** The parameter defaults to `'u'`. `$merge`'s profile already sends `'u'`, so `$merge` doesn't change.
- [ ] **Step 4: Run** the three files and `src/tests/integration/operations/writePipeline/responder/merge/merge.test.js`. Expected: PASS.

### Task 3: POST parity test (golden responses from the old path)

**Files:**
- Create: `src/tests/integration/operations/writePipeline/responder/create/create.test.js`, its `fixtures/` (synthetic resources) and `fixtures/expected/` (goldens)

**Interfaces:**
- Consumes: `getHeaders`, `createTestRequest`, `commonBeforeEach`, `commonAfterEach` from `src/tests/integration/common.js`.
- Follows `merge/merge.test.js`'s shape: `useWritePath(path)` sets `WRITE_PIPELINE_OPERATIONS` to `'create'` or `''`, and `withEachPath(cases)` runs every case on both paths.

- [ ] **Step 1: Write the cases.** Each case runs on both paths against a golden recorded from the old path. POST to `/4_0_0/<type>/`.

  **How each response is compared:**
  - Before `toHaveResponse`, replace the generated id in the body with the golden's id. First assert that `isUuid(resp.body.id)` holds (`src/utils/uid.util.js`).
  - On a 201, also assert `ETag` is `W/"1"` and `Location` is `` `4_0_0/<type>/${resp.body.id}` ``.
  - Where a case lists a stored golden, GET the resource and compare it to that golden.

  **Cases:**

  | Case | Request | Response |
  |---|---|---|
  | `created` | a Patient with the owner and access tags for `client` | 201, plus a stored golden |
  | `returnMinimal` | the same Patient, with `Prefer: return=minimal` | 201 `{}` |
  | `clientIdAndInternalFields` | a body with `id: 'client-id'`, `_uuid`, `_sourceAssigningAuthority: 'other'` and an attachment with `_file_id` | 201. The stored Mongo doc has `_uuid` equal to the new id and `_sourceAssigningAuthority: 'client'`, and the attachment has no client `_file_id`, the same on both paths |
  | `lastUpdatedNotAnInstant` | `meta.lastUpdated: '2024-01-01'` | 201 |
  | `arrayBody` | an array of two Patients | 400 |
  | `typeMismatch` | an Observation posted to `/4_0_0/Patient/` | 400 |
  | `typeMismatchWithoutMetaSource` | an Observation without `meta.source`, posted to `/4_0_0/Patient/` | 400, with a golden per path: the old path's meta outcome and the new path's type-mismatch outcome (accepted difference 1) |
  | `missingOwner` | no owner tag | 400 |
  | `invalidSchema` | `birthDate: 'not-a-date'` | 400 |
  | `auditEventTooLarge` | an AuditEvent over the size limit, built as in `src/tests/integration/create/create/create.test.js` | 413 |
  | `auditEventCreated` | a small AuditEvent | 201 |
  | `noScope` | headers `getHeaders('user/Observation.*')` | 403 |
  | `otherTenant` | a Patient tagged `other-client`, headers `getHeaders('user/*.* access/client.*')` | 403 |
  | `accessTagNotGrantable` | access tags for both `client` and `other-client`, the same headers | 403 |
  | `personLinkOtherTenant` | a Person linked to a Patient that another tenant owns, set up as in `merge/merge_person_link_cross_tenant` | 400 |
  | `patientScopeOwn` | an Observation for the token's own patient, with the patient-scope headers from `patientScope/create_with_patient_scope` | 201 |
  | `patientScopeOther` | the same, for another patient | 403 |
  | `attachmentStored` | a DocumentReference with attachment data, as in `create/create_with_gridfs_test` | 201. The response has no inline data, because GridFS replaces `data` with `_file_id` and the response serializer strips `_file_id`. A stored golden covers the GET that returns the data |

  **Routing tests** (with `jest.spyOn(WritePipeline.prototype, 'runAsync')`):
  - `routes POST to the write pipeline when the switch is on`: the spy is called once, and its `profile.name` is `'create'`.
  - `keeps POST on the old path when the switch is off`: the spy is not called.
- [ ] **Step 2: Record the goldens** from the old path: run with `useWritePath('old')`, then review each golden by hand. The goldens must not contain real data.
- [ ] **Step 3: Run** the file. Expected: before Task 4 wires the switch, every parity case passes on both paths. Only `routes POST to the write pipeline when the switch is on` and `typeMismatchWithoutMetaSource` on the new path fail, because the new path still runs the old code and returns the meta outcome where the golden expects the type-mismatch outcome. That case pins accepted difference 1.

### Task 4: POST's profile, responder, variants and switch

> Later replaced (see Decisions): `SingleResourceValidationStep`, the `validateIncoming.singleResource` variant and `INCOMING_VALIDATION` were removed when POST moved to `$merge`'s validation order. POST now runs the shared `ValidateIncomingStep` and `ValidateResultStep`, and `CreateResponder` handles `RESULT_VALIDATION` like the other validation stages. After the `$merge` reorder, POST's profile names only the `buildDocument.insert` variant and turns off `findExisting` and `noOpCheck`; the find-existing variant and its loader below were removed.

**Files:**
- Create:
  - `src/operations/writePipeline/profiles/create.js`
  - `src/operations/writePipeline/responder/create.js`
  - `src/operations/writePipeline/steps/singleResourceValidationStep.js`
  - `src/operations/writePipeline/steps/build/insertBuilder.js`
  - `src/operations/writePipeline/steps/load/noStoredResourceLoader.js`
- Modify:
  - `src/operations/writePipeline/writeFailure.js` (add `INCOMING_VALIDATION: 'incomingValidation'`)
  - `src/utils/validator.util.js` (export `getResourceTypeMismatchOutcome`; `validateResource` calls it)
  - `src/operations/create/create.js` (constructor wiring and the switch check)
  - `src/createContainer.js`
- Test:
  - `src/tests/unit/operations/writePipeline/responder/create.test.js`
  - `src/tests/unit/operations/create/create.test.js` (add the new constructor dependencies)

**Interfaces:**
- Consumes: Task 1's `stepVariants` and `variants`, and Task 2's `accessRequested`.
- Produces:
  - **The profile.** It isn't operation-specific code in `steps/`, so the grep check that keeps `merge` out of `steps/` keeps `create` out too.
    ```js
    CREATE_WRITE_PROFILE = Object.freeze({
        name: 'create',
        accessRequested: 'c',
        action: 'create',
        variants: { findExisting: 'newResource', validateIncoming: 'singleResource', buildDocument: 'insert' },
        off: ['validateResult', 'noOpCheck']
    })
    ```
  - **`getResourceTypeMismatchOutcome({ resourceBody, resourceName, path }) -> OperationOutcome|null`.** It returns the outcome `validateResource` returns today when the types differ.
  - **`NoStoredResourceLoader.loadAsync()`** does nothing, so `item.stored` stays null.
  - **`InsertBuilder.buildAsync({ item }) -> null`.** It sets `meta.versionId = '1'` and `meta.lastUpdated = new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ss.SSSZ'))`, then `candidate = item.incoming` and `writeMode = 'insert'`. It makes no source-tag check, because the old POST makes none.
  - **`SingleResourceValidationStep({ resourceValidator }).runAsync({ items, context, profile })`.** Per item, in this order, the first failure wins:
    1. `validateResourceMetaSync(incoming)`, failing at `INCOMING_META`.
    2. `validateResourceAsync({ accessRequested: profile.accessRequested, base_version, requestInfo, resourceType: incoming.resourceType, resourceToValidate: incoming, path: requestInfo.path, resourceObj: incoming })`, failing at `INCOMING_VALIDATION`.
    3. `validateResource` on `FhirResourceWriteSerializer.serialize({ obj: incoming })`, failing at `INCOMING_SCHEMA`. On failure it calls `recordValidationFailure(outcome, resourceType, VALIDATION_STAGE.SCHEMA, PATH.SAVE)`.
    4. `validateResourceSizeSync({ resource: incoming, resourceType })`, failing at `SIZE`.

    Then it restores `savedIdentity`, as `ValidateIncomingStep` does. An error thrown from a check propagates, as today.
  - **`CreateResponder({ base64DataManager, identifierEnrichmentProvider })`**, which extends `WriteResponder`:
    - **`readAsync`:**
      - It throws `BadRequestError(new Error('Only single resource can be sent to create.'))` for an array body.
      - It sets `body.id = generateUUID()` and calls `removeUnderscoreFieldsRecursive(body)`.
      - It returns one `WriteItem`. That item already failed at `STRUCTURE` with `getResourceTypeMismatchOutcome` when the type differs from the URL's.
      - The context is `smartMerge: false, operationName: 'create'`.
    - **`failureResults`:** it returns `[]` when the item didn't fail. Otherwise it throws, by stage:

      | Stage | Thrown error |
      |---|---|
      | `SCOPE`, `ACCESS` | `new ForbiddenError(issue[0].details.text)` |
      | `STRUCTURE`, `INCOMING_META`, `INCOMING_VALIDATION`, `INCOMING_SCHEMA` | `new NotValidatedError(operationOutcome)` |
      | `SIZE` | `error` when the size check threw, else `new PayloadTooLargeError(new Error('Payload size too large.'))` |
      | `ATTACHMENTS`, `WRITE` | `error.nested` (the step wraps the original error in a `RethrownError`) |
      | any other error failure | `error` |

      Before throwing a `STRUCTURE`, `INCOMING_SCHEMA`, `INCOMING_META`, `SIZE` or `RESULT_VALIDATION` failure that has an OperationOutcome, it sets `ACCESS_LOGS_ENTRY_DATA` to `{ operationResult: [{ id, uuid: id, sourceAssigningAuthority, resourceType, operationOutcome, created: false, updated: false }] }`, taken from `failure.subject`.
    - **`results`:** it throws the old path's `BadRequestError` (the issue JSON with `getCircularReplacer`, or `'No merge result'`) when the flush returned nothing, or a result that is neither created nor updated. Otherwise it returns `executedResults`.
    - **`toResponse({ context, items })`:** `deepcopy` of `items[0].candidate`, then the base64 `RETRIEVE` transform, then `enrichIdentifierList`, then `FhirResourceSerializer.serialize`.
    - **`recordMetrics`:** does nothing, because POST has no operation metrics.
  - **`CreateOperation`** takes `writePipelineSwitch`, `writePipeline` and `createResponder`. After its argument checks: `if (this.writePipelineSwitch?.useNewPathFor('create')) return await this.writePipeline.runAsync({ profile: CREATE_WRITE_PROFILE, responder: this.createResponder, requestInfo, parsedArgs, resourceType });`
  - **The container** registers `createResponder` and passes `writePipeline` these `stepVariants`:
    - `findExisting.newResource`: `FindExistingStep` with no prechecks, the same `SourceIdentityResolver` and a `NoStoredResourceLoader`.
    - `validateIncoming.singleResource`: `SingleResourceValidationStep`.
    - `buildDocument.insert`: `BuildDocumentStep` with an `InsertBuilder`.

- [ ] **Step 1: Write the failing unit test** `responder/create.test.js`. The flush can't be made to fail end to end, so this is a unit test.
  - One `test.each` for `results`: `[]` and `[{ created: false, updated: false, issue: {...} }]` throw `BadRequestError`, and `[{ created: true }]` returns the list.
  - One `test.each` for `failureResults`, covering one row per stage in the table above: the thrown class, and whether the access-log entry was set.
- [ ] **Step 2: Implement** the files above.
- [ ] **Step 3: Run** the unit test, `src/tests/unit/operations/create/create.test.js`, `src/tests/unit/createContainer.test.js`, then Task 3's parity file. Expected: all PASS, including the new-path cases and both routing tests.

### Task 5: Audit, access log and the attachment change

**Files:**
- Create in `src/tests/integration/operations/writePipeline/responder/create/`: `create.audit.test.js`, `create.accessLog.test.js` and `create.attachments.test.js`

- [ ] **Step 1: Write the cases**, each on both paths.
  - **Audit** uses the real `AuditLogger`, as `mergeStream.audit.test.js` does:
    - `created`: one `create` AuditEvent whose entity is the new `_uuid`.
    - `auditEventCreated`: no `create` AuditEvent.
    - `missingOwner`: the same error AuditEvents on both paths. This shows the pipeline adds none of its own (spec, "The audit is shared").
  - **Access log** registers the real `AccessLogger` and spies on `logAccessLogAsync`, as `accessLog/accessLogs.create.test.js` does:
    - `created`: `operationResult` is the flush result.
    - `missingOwner`: `operationResult` is the failed entry, with the generated id as both `id` and `uuid`.
  - **Attachment change** (this is the accepted change): `stores no attachment for a POST rejected with 403`. Post a DocumentReference with attachment data that is owned and access-tagged for `other-client`, with `getHeaders('user/*.* access/client.*')`, so the 403 comes from the access check. On the old path, GridFS holds one more file afterwards; on the new path, it holds none. Each path has its own expectation.
- [ ] **Step 2: Run** the three files. Expected: PASS.

### Task 6: New path by default in tests, and the create suites

**Files:**
- Modify: `jest/setEnvVars.js` (`WRITE_PIPELINE_OPERATIONS = 'merge,create'`)
- Create: `oldWrite<Name>.test.js` copies, as the spec's Testing section describes

- [ ] **Step 1: Turn POST's switch on** in `jest/setEnvVars.js`.
- [ ] **Step 2: Run, one at a time:**
  - the 16 create test files that existed before this change (they include `group_create_operations`): `find src/tests/integration -path '*create*' -name '*.test.js'`;
  - 4 Group suites: `group_promotion`, `group_with_external_storage_header`, `group_default_fhir_behavior` and `group_patch_operations`;
  - the 7 delegated-access suites: `grep -rl enableDelegatedAccessDetection src/tests/integration`.

  All 27 pass with `create` on. For each failure:
  - If it comes only from an accepted difference (the two-check 400 for an array or mismatched body sent without the scope, or no attachment on 403), update that test's fixtures to the new behavior, and add an `oldWrite<Name>.test.js` copy that turns the switch off and keeps the old fixtures under `oldWrite/`.
  - Any other failure is a bug in Tasks 1–4: fix the code, never the test.
- [ ] **Step 3: Push and read CI.** This is done after review.
  - Compare the coverage of `src/operations/create/create.js` with `main`'s.
  - Add `oldWrite` copies of the create suites that covered the lost lines, until the coverage is close to `main`'s.
  - Record which copies were added, and why, in the spec's Testing section.

### Task 7: Docs, lint and security review

**Files:**
- Modify: `docs/specs/unified-write-pipeline.md`, `docs/adr/0004-unified-write-pipeline.md`, `docs/plans/unified-write-pipeline.md` (follow-on item 2)

- [ ] **Step 1: Update the spec.**
  - **Delivery:** POST before `$import` (user decision).
  - **"Step order":** profiles may name step variants, which `WritePipeline` holds by name.
  - **Profiles table, `create` column:**
    - Validate incoming: today's calls (meta, `validateResourceAsync`, the serialized-body schema check, AuditEvent size).
    - Access before build: right after validate incoming.
    - Validate result: off.
  - **Changes to announce, POST:**
    - Drop "Access check before validation".
    - Keep "No attachment writes on 403".
    - Add the two-check 400 for an array or mismatched body sent without the scope (accepted difference 1).
- [ ] **Step 2: Update the ADR.** Its decision notes that variants are separate step instances that a profile picks by name.
- [ ] **Step 3: Lint** with the committed config: `node node_modules/.bin/eslint <changed files>`. Expected: no errors.
- [ ] **Step 4: Run `/security-review-diff`** against `review.md`: writes, scope parsing, and access tags on a new resource. Fix each finding in code and tests, and say in the PR body which areas it could not confirm.
- [ ] **Step 5: Stage** the changed files by explicit path, never the user's local files, then hand over for review.
