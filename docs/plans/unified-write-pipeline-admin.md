# Unified Write Pipeline: Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the five admin resource writes (`createPersonToPersonLink`, `removePersonToPersonLink`, `createPersonToPatientLink`, `removePersonToPatientLink`, `updatePatientReference`) onto the shared `WritePipeline` behind `WRITE_PIPELINE_OPERATIONS=admin`, with the behavior the spec's "Admin" section announces.

**Architecture:** The five operations have no client resource body. Each one reads a few ids from the admin request into one stub item. A new `findExisting` variant loads the target and the linked resources by `_uuid` through the access-filtered search. New `accessBeforeBuild`, `buildDocument` and `accessOnResult` variants check access, build the document from the stored one and check the result. The shared validate, no-op and write steps and the audit run unchanged. A small runner gives each write its own request id and drains the post-request queue before the response, as `AdminResourceWriter` does today. The route handlers answer with the standard error format when the switch is on.

**Tech Stack:** Node, Express, MongoDB, Jest (CommonJS). No new dependencies.

**Spec:** `docs/specs/unified-write-pipeline.md`: the "Admin" section, the admin column of the profiles table, "Testing" (the admin bullets) and "Changes to announce" (Admin). The ADR is `docs/adr/0005-unified-write-pipeline.md`.

**Branch:** the next branch in the stack, on top of the PATCH branch.

**Spec governs:** where this plan and the spec differ, the spec governs; the plan's early decisions
were refined while building.

## Global Constraints

- Old code stays as it is while the switch is off. The switch check is the only change to `AdminPersonPatientLinkManager`'s five methods and their route handlers' behavior with the switch off.
- The admin scope check at the route (`assertAdminScope`) stays as it is. No resource-type scope is required (spec).
- Every id the caller passes may be a `_uuid`, a plain `id` or `id|authority`, as today, after stripping its prefix; an id that is not a literal, or a plain id that matches more than one accessible resource, is a 400 `invalid` (the spec's Admin "Lookups").
- Lookups use the access filter; a target or linked resource that is missing or not accessible is a 404.
- Output formats: success bodies are unchanged; errors use the error's status code with its `issue` (400 `invalid`, 403 `forbidden`, 404 `not-found`, 409 `conflict`), and 500 is "Internal Server Error". "Link already exists" and "link not present" stay HTTP 200 with today's body.
- Out of scope (spec "Non-goals"): the admin deletes (`deletePerson`, `deletePatientDataGraph`, `deletePersonDataGraph` and the link cleanup through `AdminResourceWriter`), the ExportStatus PUT and the raw admin runners. `AdminResourceWriter` stays for them.
- Code: CommonJS, Prettier style (4 spaces, single quotes, semicolons, 100 columns), JSDoc only (no inline explanatory comments), camelCase file names, no ticket IDs anywhere in code, tests, fixtures or docs, synthetic data only, no PHI in logs.
- Register every new class in `src/createContainer.js`. Override services for tests in `src/tests/createTestContainer.js`.
- Tests: run one file at a time, path first, with `--runInBand --forceExit` (unit tests also `--config jest.unit.config.js`). Integration tests lead; a unit test only where an integration test cannot reach the branch. Multi-input behavior is one `test.each`. Admin integration tests use tokens with specific `access/` scopes, never the default `access/*.*` token, so a missing access check shows.
- Lint with the committed config (`git show HEAD:eslint.config.js > eslint.head.tmp.config.js`, then `npx eslint --config eslint.head.tmp.config.js <files>`, then delete the temp file).
- Never `git commit` or push until asked. Stage your own files by explicit path. Never touch the user's local modifications (`.prettierrc`, `Dockerfile`, `Makefile`, `docker-compose.yml`, `eslint.config.js`, `tsconfig.json`, `src/operations/common/logging.js`, `src/strategies/authService.js`, `src/strategies/jwt.bearer.strategy.js`, `src/tests/integration/customMatchers.js`).

## Decisions made in this plan

Each is a call the spec leaves open. Reverse any of them before work starts; none is hard to change later.

1. **Two profiles under one `admin` switch.** `adminLink` (the four link operations) and `adminPatientReference` (`updatePatientReference`). They differ only in the `validateResult` variant, which turns the patient-reference check off for the second. Profiles stay plain data.
2. **Input travels in `requestInfo.body`.** The runner builds the request info with a fresh `requestId` and `body` set to `{ operation, ...ids }`, so the responder reads it the way PATCH reads its body and no new transport is needed.
3. **The builder composes the existing builders.** `AdminBuilder` makes the full new document from the stored one, then calls `InsertBuilder` (a created Person), `SmartMergeBuilder` (add a link) or `ReplaceBuilder` (remove a link, rewrite a patient reference). The replay after a lost race therefore appends for an add and replaces for a remove, as `AdminResourceWriter` does today with `smartMerge` true or false.
4. **Access letters.** The target is checked with `u`, linked resources with `r` (they are only read and referenced), a created Person with `c`. The Person.link tenant check at result validation still stops cross-tenant linking.
5. **The admin write is versioned from day one.** The default `write` step writes with the stored version (the spec's "Write: version filter"), as `AdminResourceWriter` already does with `previousVersionId`. No new writer.
6. **`AccessFilteredFinder` is extracted from `SearchExistingLoader`.** Both loaders need the same access-filtered query; `SearchExistingLoader` keeps its behavior and tests.
7. **Manual-link Kafka events stay in the manager**, after the pipeline returns, driven by what the responder reports. A no-op produces none. The event carries the same Patient id as today (the spec's "Side outputs").
8. **Epic check.** Only `$import` is left after this. Nothing here is shared with it: the new `WriteItem` fields, the `ResourceValidator` option and the finder are admin-only or default-off.

## File Structure

New under `src/operations/writePipeline/`:
- `steps/load/accessFilteredFinder.js`, `steps/load/adminTargetLoader.js`
- `steps/access/adminTargetsAccessChecker.js`, `steps/access/adminResultAccessChecker.js`
- `steps/build/adminBuilder.js`
- `operations/admin/profile.js` (both profiles), `operations/admin/adminOperations.js` (the five operation definitions as plain data), `operations/admin/responder.js`
- `src/admin/adminWriteRunner.js`

Modified: `writeItem.js`, `steps/validateResultStep.js`, `steps/load/searchExistingLoader.js`, `src/operations/common/resourceValidator.js`, `src/createContainer.js`, `src/admin/adminPersonPatientLinkManager.js`, `src/routeHandlers/admin.js`, `jest/setEnvVars.js`, the spec and the ADR.

## Review Focus

Input classes the spec implies and no task's own tests would exercise by accident; each has its test in the task named.

- A body id that is a plain `id` or `id|authority`: looked up through the access filter; a comma, a backslash, a control character, over 255 characters or an ambiguous plain id: 400, no write (Task 8).
- A target or linked resource in another tenant: 404, not 403 and not a write, with a token whose `access/` scopes cover one tenant only (Task 8).
- Adding a link that exists, removing one that is absent, and a patient reference that already points at the Patient: HTTP 200 with today's message, no write, no audit event, no Kafka event (Task 8).
- `updatePatientReference` pointing at a Patient that does not exist or is not accessible: 404, and the old reference's `_uuid`, `_sourceId` and `_sourceAssigningAuthority` are cleared on success (Tasks 4 and 8).
- `createPersonToPatientLink` for a Person that does not exist, where the Patient carries security tags: the created Person copies them, and the caller needs create access for them (Tasks 3 and 8).

---

### Task 1: Shared hooks: `WriteItem` admin fields and the patient-reference switch

**Files:**
- Modify: `src/operations/writePipeline/writeItem.js`, `src/operations/common/resourceValidator.js` (`validateResourceAsync`), `src/operations/writePipeline/steps/validateResultStep.js`
- Test: the existing unit tests of those three (add cases; do not rewrite them)

**Interfaces:**
- Produces:
  - `WriteItem.adminChange: Object|null`, default `null`: the admin operation's change description (see Task 5).
  - `WriteItem.linked: Array<{ resourceType: string, resource: Object }>`, default `[]`: the resources the change links to.
  - `ResourceValidator.validateResourceAsync({ ..., checkPatientReference = true })`: when `false`, the `validatePatientReference` call is skipped; schema, meta and member-limit checks run as before.
  - `ValidateResultStep` constructor option `checkPatientReference = true`, passed to `validateResourceAsync` for updates and inserts.

- [ ] **Step 1: Write the failing tests.** `WriteItem` defaults; `validateResourceAsync` with `checkPatientReference: false` on a Person whose link changes tenant (passes) and with the default (fails), as the existing patient-reference tests do; `ValidateResultStep` passes the option through.
- [ ] **Step 2: Run the three files; confirm the new tests fail.**
- [ ] **Step 3: Implement.** Add the two fields with JSDoc, the parameter and the step option. Every existing caller keeps the default.
- [ ] **Step 4: Run the three files plus `createContainer.test.js`; all pass.**
- [ ] **Step 5: Stage the changed files.**

### Task 2: `AccessFilteredFinder` and `AdminTargetLoader`

**Files:**
- Create: `steps/load/accessFilteredFinder.js`, `steps/load/adminTargetLoader.js`
- Modify: `steps/load/searchExistingLoader.js` (use the finder; no behavior change)
- Test: unit tests for both new classes; the existing `searchExistingLoader` tests stay unchanged and green

**Interfaces:**
- Consumes: `SearchManager.constructQueryAsync`, `DatabaseQueryFactory`, `ConfigManager`, `R4ArgsParser.parseArgs({ resourceType, args })` (as `adminPersonPatientDataManager.js` uses it).
- Produces:
  - `AccessFilteredFinder.findAsync({ requestInfo, base_version, resourceType, parsedArgs, accessRequested, currentOperationName }): Promise<Object[]>`: the query and cursor code of `SearchExistingLoader`, returning the write-serialized documents.
  - `AdminTargetLoader({ accessFilteredFinder, r4ArgsParser })` with `loadAsync({ items, context })`, the `findExisting` variant `adminTargets`.

`AdminTargetLoader` behavior, per item from `item.adminChange` (Task 5 defines its shape: `target: { resourceType, id }`, `linked: [{ resourceType, id }]`, `createsMissingTarget`):
- Finds the target by `_uuid` through the finder (`id` argument = the uuid, `accessRequested: 'u'`). One match sets `item.stored`. None fails the item at `LOOKUP` with a `NotFoundError`, unless `createsMissingTarget`, which leaves `item.stored` null.
- Finds each linked resource the same way (`accessRequested: 'r'`). One match is pushed to `item.linked`; none fails the item at `LOOKUP` with a `NotFoundError`.
- Copies the identity of what it found onto `item.incoming` (`id`, `_uuid`, `_sourceAssigningAuthority`) so later failures name it, as PATCH's loader does. An error from the search propagates.

- [ ] **Step 1: Write the failing tests.** Finder: returns serialized documents, passes the access letter, no match gives `[]`. Loader (`test.each` over target found / not found / not found with `createsMissingTarget`, linked found / missing): the outcomes above. A tenant case belongs to Task 8 (integration).
- [ ] **Step 2: Run the new files; confirm they fail.**
- [ ] **Step 3: Implement the finder by moving `SearchExistingLoader`'s query code into it, then `AdminTargetLoader`.** `SearchExistingLoader` calls the finder with `accessRequested: 'u'` and `currentOperationName: 'patch'`.
- [ ] **Step 4: Run the two new files and `searchExistingLoader.test.js`; all pass.** Run `patch.test.js` (integration, one file) once to confirm PATCH is unchanged.
- [ ] **Step 5: Stage the changed files.**

### Task 3: Admin access checkers

**Files:**
- Create: `steps/access/adminTargetsAccessChecker.js`, `steps/access/adminResultAccessChecker.js`
- Test: unit tests for both

**Interfaces:**
- Consumes: `ScopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes`, `ScopesValidator.isAccessTagChangeAllowedByAccessScopes`, `AccessTagChangeChecker` (reused for updates).
- Produces, both with `checkAsync({ items, context, accessRequested })` returning one entry per item (null or an `ACCESS` `WriteFailure`), like `StoredAccessChecker`:
  - `AdminTargetsAccessChecker({ storedAccessChecker, scopesValidator })`, the `accessBeforeBuild` variant `adminTargets`: passes the items that have a stored document to PATCH's `StoredAccessChecker` (the target check is the same, `u`), and checks every `item.linked` resource with `r` itself. An item with no stored document (a Person about to be created) skips the target check. A forbidden item fails at `ACCESS` with the validator's forbidden issue; a non-403 error propagates.
  - `AdminResultAccessChecker({ scopesValidator, accessTagChangeChecker })`, the `accessOnResult` variant `admin`: for an item with no stored document (a created Person), checks access to the candidate with `c` and the access-tag change from nothing with `c`; otherwise delegates to the `AccessTagChangeChecker`. A no-op item (null candidate) is skipped.

- [ ] **Step 1: Write the failing tests.** Target forbidden, linked forbidden (the failure names the item), both allowed, error 500 propagates; created Person denied without create access, allowed with it; update delegates; no-op skipped.
- [ ] **Step 2: Run both files; confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run both files; all pass.**
- [ ] **Step 5: Stage the files.**

### Task 4: `AdminBuilder`

**Files:**
- Create: `steps/build/adminBuilder.js`
- Test: unit test

**Interfaces:**
- Consumes: `InsertBuilder`, `SmartMergeBuilder`, `ReplaceBuilder` (each `buildAsync({ item, context })`), `PatientFilterManager.getPatientPropertyForResource`, `generateUUID`.
- Produces: `AdminBuilder({ insertBuilder, smartMergeBuilder, replaceBuilder, patientFilterManager })` with `buildAsync({ item, context })`, the `buildDocument` variant `admin`. It reads `item.adminChange.kind`:
  - `createPerson`: the incoming document is a new Person with a generated id and `_uuid`, `meta.source` and `meta.security` copied from `item.linked[0]` (the Patient) and one link to `Patient/<patient _uuid>`; calls `InsertBuilder`. (Superseded: the link is `Patient/<id as sent>`, see the spec.)
  - `addLink`: (superseded: the link is `<Type>/<id as sent>` and the target is not looked up for a stored Person, see the spec) the incoming document is a copy of `item.stored` with `{ target: { reference: '<Type>/<linked _uuid>' } }` appended. If a link already matches the linked `_uuid` (on `link.target._uuid`, then on the reference string as a fallback), sets `item.candidate = null`, `item.writeMode = 'update'` and returns; else calls `SmartMergeBuilder`.
  - `removeLink`: the incoming document is a copy of `item.stored` without the links that match `adminChange.linkedId` on `link.target._uuid` (or the reference). If none matched, the same no-op as above; else calls `ReplaceBuilder`.
  - `rewritePatientReference`: finds the patient field with `PatientFilterManager`, sets its reference to `Patient/<new Patient _uuid>` and clears its `_uuid`, `_sourceId` and `_sourceAssigningAuthority`. If the reference already points there, the same no-op; else calls `ReplaceBuilder`. A resource type with no patient field fails the item with a `BadRequestError`.
- The builder never modifies `item.stored`.

- [ ] **Step 1: Write the failing tests.** One `test.each` row per kind (builds the expected document and version bump), plus each no-op, a missing patient field, and `item.stored` untouched.
- [ ] **Step 2: Run the file; confirm it fails.**
- [ ] **Step 3: Implement.** If a composed builder rejects the item shape (for example `ReplaceBuilder` and `If-Match` parsing), adjust the incoming document, not the shared builder; report anything that needs a shared change.
- [ ] **Step 4: Run the file; all pass.**
- [ ] **Step 5: Stage the files.**

### Task 5: Operation definitions and `AdminResponder`

**Files:**
- Create: `operations/admin/adminOperations.js`, `operations/admin/responder.js`
- Test: unit tests for both

**Interfaces:**
- Produces:
  - `ADMIN_OPERATIONS`: frozen plain data keyed by operation name. Each entry holds the body parameter names and their types (`target`, `linked`), whether a missing target is created (`createsMissingTarget`, true only for `createPersonToPatientLink`), the change `kind`, the profile name, `smartMerge`, and today's response messages (added, removed, already exists, not present, created, not updated) with the ids today's bodies echo.
  - `AdminResponder extends WriteResponder`:
    - `readAsync({ requestInfo, parsedArgs, resourceType })`: reads `requestInfo.body = { operation, ...ids }`; strips a leading `Person/` or `Patient/`; fails a missing parameter, a non-`_uuid` id, or (for `updatePatientReference`) a resource type that is not in `COLLECTION`, with a `BadRequestError` (400 `invalid`). Builds one stub item `{ resourceType, id: <uuid> }` with `item.adminChange`, and a `WriteContext` whose `smartMerge` comes from the definition.
    - `failureResults`, `results`: use the shared `throwIfItemFailed` and `firstExecutedResult` helpers in `operations/singleResource/singleResourceResult.js`, with no access-logged stages.
    - `toResponse`: returns `{ json, linkEvent }`. `json` is today's success body, or today's "already exists" / "not present" / "not updated" body for a no-op. `linkEvent` is `{ personId, patientId, isLinking }` for a link that was created or removed between a Person and a Patient (the Person's `_uuid` and the Patient's `_uuid`), else `null`.
    - `recordMetrics`: records nothing.

- [ ] **Step 1: Write the failing tests.** `readAsync` `test.each` (each of the five operations with good ids; a missing parameter; a non-uuid; an unsupported resource type; a `Person/<uuid>` prefix stripped); `toResponse` for every operation's success and no-op body and the `linkEvent` values; thrown failures keep the item's error.
- [ ] **Step 2: Run both files; confirm they fail.**
- [ ] **Step 3: Implement.** Take today's message strings from `src/admin/adminPersonPatientLinkManager.js` verbatim.
- [ ] **Step 4: Run both files; all pass.**
- [ ] **Step 5: Stage the files.**

### Task 6: Profiles, container wiring, runner and manager switch

**Files:**
- Create: `operations/admin/profile.js`, `src/admin/adminWriteRunner.js`
- Modify: `src/createContainer.js`, `src/admin/adminPersonPatientLinkManager.js`
- Test: `src/tests/unit/createContainer.test.js` (pin both profiles and the variant names), `src/tests/unit/admin/adminPersonPatientLinkManager.test.js` (routing), a unit test for the runner

**Interfaces:**
- Produces:
  - `ADMIN_LINK_WRITE_PROFILE = { name: 'adminLink', accessRequested: 'u', action: 'admin', off: ['scopeCheck', 'identify', 'prepareBody', 'validateIncoming', 'validateNewResource', 'validateAgainstStored'], variants: { findExisting: 'adminTargets', accessBeforeBuild: 'adminTargets', buildDocument: 'admin', accessOnResult: 'admin' } }`.
  - `ADMIN_PATIENT_REFERENCE_WRITE_PROFILE`: the same with `name: 'adminPatientReference'` and `validateResult: 'adminPatientReference'` added to the variants (a `ValidateResultStep` built with `checkPatientReference: false`).
  - `AdminWriteRunner({ fhirOperationsManager, writePipeline, adminResponder, postRequestProcessor, requestSpecificCache })` with `runAsync({ operation, req, input }): Promise<{ json, linkEvent }>`. It builds the request info with `fhirOperationsManager.getRequestInfo(req)`, a fresh `requestId` and `body: { operation, ...input }`, picks the profile from `ADMIN_OPERATIONS`, calls `writePipeline.runAsync`, and in `finally` drains `postRequestProcessor.executeAsync({ requestId })` (on success) and clears `requestSpecificCache.clearAsync({ requestId })`.
  - In the manager: each of the five methods starts with `if (this.writePipelineSwitch.useNewPathFor('admin'))`, calls the runner, sends `linkEvent` through `patientPersonManualLinkingEventProducer.produceEventAsync` when it is not null, and returns `json`. The old code below it is untouched.
- Container: register the new classes, the `adminTargets` variants for `findExisting` and `accessBeforeBuild` in `stepVariants`, the `admin` variants for `buildDocument` and `accessOnResult`, the `adminPatientReference` variant for `validateResult`, the two profiles in the pipeline's profile list, and `writePipelineSwitch` in the manager.

- [ ] **Step 1: Write the failing tests.** Container pin for both profiles; manager routing (switch on calls the runner and the producer once, switch off never touches the runner, a null `linkEvent` produces nothing); runner (fresh request id each call, queue drained on success, cache cleared on error, input in the body).
- [ ] **Step 2: Run the three files; confirm the new tests fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the three files and `writePipeline.test.js`; all pass.**
- [ ] **Step 5: Stage the files.**

### Task 7: Route handlers

**Files:**
- Modify: `src/routeHandlers/admin.js`
- Test: `src/tests/unit/routeHandlers/admin.test.js`

**Interfaces:**
- With the switch on, in the five handlers of `handleAdminPost` only:
  - A missing parameter throws a `BadRequestError` (400 `invalid`, the same message) instead of `res.json({ message })` with 200. This applies with the switch off too: it is a 400 on both paths, with the old `exception` body when the switch is off and the standard OperationOutcome when it is on.
  - The catch answers with the standard OperationOutcome (`convertErrorToOperationOutcome({ error, internalError: statusCode >= 500 })`) instead of `code: 'exception'` with `diagnostics`. The admin-scope 403 from `assertAdminScope` therefore comes back as a `forbidden` OperationOutcome. The catch decides from `req.params.op` and the switch, because `operation` is declared inside the `try`.
- With the switch off, behavior is unchanged except for the missing-parameter 400 above; for every other admin operation it is unchanged.

- [ ] **Step 1: Write the failing tests.** Per operation (`test.each`): missing parameter 400 with the switch on and with it off (standard OperationOutcome on, old `exception` body off); a thrown 404 and a thrown 500 formatted as above; a non-write operation's error format unchanged.
- [ ] **Step 2: Run the file; confirm the new tests fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the file; all pass.**
- [ ] **Step 5: Stage the file.**

### Task 8: Integration tests for the admin changes

**Files:**
- Create: `src/tests/integration/operations/writePipeline/operations/admin/admin.test.js` and its fixtures (synthetic Persons, Patients and an Encounter, in two tenants)
- Modify: `src/tests/integration/common.js` (add one helper that returns request headers for a token with given `groups` and `scope`, built on `getTokenWithCustomPayload`; do not change existing helpers)

Run the cases on the new path (`WRITE_PIPELINE_OPERATIONS` with `admin`), parameterized over the five operations with `test.each` where the case applies to all:

- [ ] **Success and no-op bodies.** Each operation's success body and, for the four that have one, its no-op body match today's strings; a no-op writes nothing (no version bump, no history row), writes no audit event and sends no manual-link event.
- [ ] **Ids.** A non-`_uuid` id, a `Person/<uuid>` prefix (accepted), and a missing parameter (400 `invalid`, standard format) for every operation.
- [ ] **404s.** A missing target; a missing linked resource (the other Person, the Patient, the new Patient); a target and a linked resource that exist only in another tenant, with a token whose `access/` scopes cover one tenant. Nothing is written.
- [ ] **403 and format.** The admin-scope failure is a `forbidden` OperationOutcome; a 500 is "Internal Server Error".
- [ ] **Result checks.** A Person link to another tenant's Person is refused for a caller without access to that tenant and allowed for `access/*.*`; a created Person (`createPersonToPatientLink`, no Person) copies the Patient's `meta.source` and `meta.security`, needs create access, and the Patient is checked.
- [ ] **`updatePatientReference`.** It changes the patient reference of an Encounter, clears the old reference's `_uuid`, `_sourceId` and `_sourceAssigningAuthority`, and the same change through PUT, PATCH and `$merge` is still refused.
- [ ] **Audit and events.** `create` for a created Person and `update` otherwise, written before the response; the manual-link events carry today's Patient id: the `_uuid` for a created Person, else the id as sent (spy on the producer).
- [ ] **Concurrency.** Two concurrent adds of the same link leave one link; two concurrent removes leave none, and neither fails.

- [ ] **Run the file; all pass.** Delete any `actual_*.json` files the local matchers write; do not stage them.

### Task 9: Flip the jest default and update the existing admin tests

**Files:**
- Modify: `jest/setEnvVars.js` (`WRITE_PIPELINE_OPERATIONS='merge,create,update,patch,admin'`), the spec's "Testing" default line
- Modify or copy: the existing tests that send one of the five routes: `src/tests/integration/admin/createPersonToPatientLink/createPersonToPatientLink.test.js`, `removePersonToPatientLink/removePersonToPatientLink.test.js`, `removePersonToPersonLink/removePersonToPersonLink.test.js`, `updatePatientReference/updatePatientReference.test.js`, `src/tests/integration/security/admin_v2_cruds_scopes/admin_v2_cruds_scopes.test.js`, `src/tests/integration/utils/errorSanitization/errorSanitization.integration.test.js`, `src/tests/integration/history/seperateHistoryCluster/seperateHistoryCluster.test.js`, `src/tests/unit/admin/adminPersonPatientLinkManager.test.js`, `src/tests/unit/routeHandlers/admin.test.js`

- [ ] **Step 1: Flip the default.**
- [ ] **Step 2: Run each file above once, one at a time.** A file that fails only because of an accepted difference (a plain id instead of a `_uuid`, today's 200-with-message instead of an error, the error format) is updated to the new behavior, and gets an `oldWrite<Name>.test.js` copy that sets `process.env.WRITE_PIPELINE_OPERATIONS = 'merge,create,update,patch'` at the top, so the old path keeps its coverage (as `oldWriteBlobStorage.test.js` does). A file that fails for any other reason is a bug in the new path: stop and report it.
- [ ] **Step 3: Check old-path coverage.** Run the `oldWrite` copies with coverage on `src/admin/adminPersonPatientLinkManager.js`; if a branch lost coverage with the default flipped and no copy covers it, add a copy for the file that does.
- [ ] **Step 4: Stage the files.** The deletes' tests (`removeLinksOnGraphDelete`, `patientData`) are not part of this: they use `AdminResourceWriter` directly. Confirm they still pass with one run each.

### Task 10: Docs and security review

**Files:**
- Modify: `docs/specs/unified-write-pipeline.md` (the Admin section: state what shipped, the two profiles, the access letters; "Testing"), `docs/adr/0005-unified-write-pipeline.md` (consequences: the admin step variants, the two profiles, the runner)

- [ ] **Step 1: Update the spec and the ADR.** Keep the announced differences as they are; add the decisions at the top of this plan that the spec does not already state (letters, the two profiles, input through `requestInfo.body`).
- [ ] **Step 2: Lint every changed file** with the committed config.
- [ ] **Step 3: Security review.** Read `review.md` at the repo root and review the whole diff against it (writes, scopes, tenancy, cross-resource joins on a shared identifier). Record what could not be confirmed.
- [ ] **Step 4: Stage the files.** Do not commit.
