# PUT (update) on the Unified Write Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** With `WRITE_PIPELINE_OPERATIONS` including `update`, `UpdateOperation.updateAsync` runs through `WritePipeline.runAsync`. Its responses, headers, stored documents, history rows, audit events and access-log data match the old path's, except for the cases listed under Decisions: the two-check cases (accepted difference 1), versioned updates (accepted difference 2), and the entries this plan adds under PUT in the spec's "Changes to announce".

**Architecture:** PUT adds `profiles/update.js` and `responder/update.js`, and three named variants for the steps it does differently: identify from the URL, the replace build, and a write that honors `If-Match` / `If-None-Match`. Every other step is `$merge`'s, including the access check before the build. Updates are written with a `_uuid` + `versionId` filter. Until the concurrent write resolver lands, a lost race goes through today's one-by-one replay, which keeps replace semantics when the entry is queued with `smartMerge: false`.

**Tech Stack:** Node 24, Express, MongoDB, Jest with MongoDB Memory Server.

**Spec:** `docs/specs/unified-write-pipeline.md`. Read "Constraints", "Step order", "Profiles" (the `update` column), "Concurrency", "Testing" and "Changes to announce". The `$merge` and POST plans (`docs/plans/unified-write-pipeline.md`, `docs/plans/unified-write-pipeline-create.md`) built everything this plan reuses. The old path is mapped in detail, with line numbers, in the research notes the controller hands to each task.

## Global Constraints

- With the `update` switch off, PUT behaves exactly as before. In `src/operations/update/update.js` the only changes are the switch check and the constructor wiring it needs.
- Shared building blocks keep today's behavior. New behavior goes in new code, or behind an opt-in parameter whose default is today's and which existing callers never pass. Here those are:
  - `FastDatabaseBulkInserter.mergeOneAsync`'s `writePrecondition` (default `null`);
  - `FastDatabaseBulkInserter.insertOneAsync`'s `smartMerge` (default `true`);
  - `WriteStep`'s `honorHttpPreconditions` (default `false`).
- PUT asks for scope letter `u` with action `update`, also for create-via-PUT, as today.
- No new metrics. A validation failure is recorded in `fhir_validation_failure_total` by the same validator calls as on the old path.
- Tenant isolation is unchanged: the stored document is loaded by `_uuid`, as today, and every access check goes through `ScopesValidator`, as today.
- No PHI in logs, test fixtures or commit messages. Use synthetic data only.
- New files under `src/` are camelCase. New classes and functions get JSDoc saying what they do, and no other comments.
- No Jira IDs in code, tests or docs.
- Run tests one file at a time, path first: `nvm use && node node_modules/.bin/jest <file> --runInBand --forceExit`. Unit tests also need `--config jest.unit.config.js`. Never run the full suite or a whole folder; CI runs the rest.
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
- PUT moves before `$import` and ships now, with the version filter on updates ("new: updates are versioned too"). It doesn't wait for the concurrent write resolver (#2700): the resolver changes only the retry flow, not the filter. Until it lands, a PUT that loses a race goes through today's one-by-one replay:
  - when the retries run out, the caller gets today's 500;
  - a lost create without `If-None-Match` answers 201, as today;
  - the resolver's 409 and its lost-create 200 come with the resolver.
- One PR, stacked on the POST PR (#2761).
- Every shared-step decision below is made for the whole epic (POST, PUT, PATCH, `$merge`, `$import`, admin), not deferred to a later operation's PR.
- **No `alwaysCreateNew` on the new path.** Today's PUT always uploads a new base64 live object because its write had no version check; now it has one. PUT uses the shared attachments step, as `$merge` does, so an unchanged base64 value keeps its live key. A lost race is reconciled by the replay (`resolveWriteForExternalizedDataChange`). PATCH, versioned in its own PR, follows the same rule. The TODOs at `update.js:437` and `patch.js:559` stay with the old path and go when it is deleted.
- **One access flow for every operation with a resource body (user's point, confirmed in the code).** PUT uses `$merge`'s access check before the build (`IncomingAndStoredAccessChecker` → `WriteAllowedByScopesValidator`) with `smartMerge: false`, so removals count:
  - with a stored doc, it checks access to the stored doc, then the access-tag change from the stored doc to the incoming body;
  - with none, it makes POST's two calls: the full check, then the access-tag change from `null`.

  This gives today's answer because the built doc's access tags are always the body's. `overWriteNonWritableFields` (`resourceMerger.js` 131-165) forces only the owner and source-assigning-authority tags and dedups the rest. It creates `meta.security` with those two tags when the body has none, so `fastUpdateMeta`'s copy of the stored tags (311-313) never runs for an existing doc. (My earlier claim, that a body without `meta.security` keeps the stored tags, was wrong.) The check now runs before the build, so a PUT rejected for an access-tag change no longer has the stored GridFS files its body drops deleted inside the build. Today it does (announced).

  PUT gets the stored doc from the shared `findExisting` (`BulkPreloadLoader`), which fills the bulk-loader cache this checker reads. Step 10 (access on result) is still needed by PATCH, whose body is a JSON Patch, so its tags are known only after the build, and by admin. The PATCH PR adds it, with the access-tag change from the stored doc to the built doc. PUT, POST, `$merge` and `$import` don't run it.

**My calls (for review), each checked against every operation:**
- **PUT reuses `$merge`'s `validateResult`, with no variant** (the same call POST made).
  - For an update it runs the meta check on the built doc, then `validateResourceAsync` with the stored doc: the Group member limit, the schema of the normalized document, references, the patient reference and Person.link.
  - For create-via-PUT it runs `validateResourceAsync` without a stored doc.
  - Today PUT runs `validateResourceAsync` on the body before the build, then the write-serialized schema, then the meta check after the build. For a replace, the built doc is the body plus the fields the merger protects, so each check sees the same data, and only which error wins changes (accepted difference 1).
  - The patient-reference and Person.link checks still come after the stored-doc access check, so a caller who can't access the stored doc learns nothing about it (`put_cross_client.test.js:100`).
- **A no-op PUT skips `validateResourceAsync`.** `validateResult` runs only on a non-null candidate, as for `$merge`. Today a PUT whose body equals the stored doc still runs it first. The body has passed the raw schema check and changes nothing. So only a stored doc that no longer passes now gets 200 where today it gets 400: a Group over a since-lowered member limit, or a reference format that has since become invalid. This is announced, with a parity case.
- **Identify from the URL:** the `identify: 'url'` variant, `UrlIdentityResolver`.
  - A UUID id becomes `_uuid`.
  - A non-UUID id gets the authority-tag check (400 `NotValidatedError`, with the access log), then `_uuid` and `_sourceAssigningAuthority` computed from a minimal copy, as today (the body's `meta.security` isn't changed), then the URL-authority mismatch `BadRequestError` (400).
  - An owner or source-assigning-authority tag with a `system` but no `code` passes the authority-tag check, which looks only at `system`. It then fails in `UuidColumnHandler` with `AssertionError('sourceAssigningAuthority is null for <T>/<id>')`, a 500. That is today's PUT behavior, and `$merge`'s (the spec's known two-check case), so the new path keeps it. Making it a 400 is a separate fix for every operation.
  - PATCH (search) and admin (`_uuid`) identify differently, so this resolver is PUT's only.
- **PUT reuses `$merge`'s `findExisting` (`BulkPreloadLoader`), with no variant.** For one item it makes the same `_uuid` lookup with no access filter, and it fills the cache the access checker reads. PATCH (search with the access filter) and admin (by `_uuid` with the access filter) need their own loaders anyway. If the parity goldens show a different stored-doc shape from today's `findAsync` + `FhirResourceWriteSerializer`, Task 3 reports it and Task 4 handles it in the loader the access checker reads, not with a second loader.
- **Replace build:** the `buildDocument: 'replace'` variant, `ReplaceBuilder`.
  - With a stored doc it runs, in today's order:
    1. `rejectMemberOnExtendedGroupWrite` (400);
    2. `If-None-Match: *` (412);
    3. the two `If-Match` 412s;
    4. `fastMergeResourceAsync({ smartMerge: false })`, with `ignoreDateOnlyChange` left `false`, so a date-only change is saved;
    5. today's forced Group write, for a ClickHouse Group with members.
  - Without a stored doc it runs the `If-Match` 412, then delegates to `InsertBuilder`.
  - Errors keep today's classes and text, as `BUILD` failures carrying the error. No new failure stage is needed.
- **One reader for the `If-Match` and `If-None-Match` headers:** `HttpPreconditions.fromRequestInfo(requestInfo)` in `src/operations/writePipeline/httpPreconditions.js`. It is a frozen value with:
  - `ifMatch`: the raw header;
  - `ifMatchVersionIds`: from `parseIfMatchVersionIds`;
  - `ifNoneMatch`;
  - `writePrecondition`: `{ ifMatchVersionIds }` when the list is non-empty, else `null`, as `replaceOneAsync` builds it.

  Only PUT honors these headers; PATCH ignores `If-Match`, as today.
- **Versioned write:** the `write: 'httpPreconditions'` variant, `WriteStep` with `honorHttpPreconditions: true`.
  - **Update:** `mergeOneAsync` with the stored `versionId` as `previousVersionId`, `smartMerge: false` from the context, and the opt-in `writePrecondition`. A lost race is then replayed as a replace that re-checks `If-Match` against the latest version. This keeps `update_fast_serializer.test.js:287` (If-Match under a concurrent write) and `:301` (`If-Match: *` against a concurrent delete) passing.
  - **Conflict handling off (ruled in Task 6, user confirmed the edge):** with `SKIP_HANDLE_CONCURRENCY=true` a versioned write that loses is not replayed, so it would be dropped and answered 200. So the update is queued with `previousVersionId: null` (today's `_uuid`-only last-write-wins) unless a specific `If-Match` was sent (not `*`). With one, it keeps the stored `versionId`, which the builder has checked is in the list, as today's `If-Match` filter does; a lost race is then dropped and answered 200, as today. Edge kept: an `If-Match` listing several versions, where a competitor moves the doc to another listed version, lands today and is dropped on the new path. `mergeOneAsync` is not changed to filter on several versions. Tests: `writeStep.test.js` (three handling-off rows), `update.concurrency.test.js` `lostUpdateWithConcurrencyHandlingOff` and `ifMatchLostUpdateWithConcurrencyHandlingOff`.
  - **Forced Group write:** its candidate keeps the stored `versionId`, so it is queued exactly as the old path does: `replaceOneAsync({ requestInfo, resourceType, doc, uuid: doc._uuid, contextData, ifMatchVersionIds })`. Without a specific `If-Match` that is today's `_uuid`-only write, as for Group PATCHes that change members. With one, the `If-Match` versions are in the filter, so a lost write gets today's replay and 412. Tests: `writeStep.test.js` (forced-write rows with and without a specific `If-Match`).
  - **Insert:** `insertOneAsync` with `rejectIfExists: ifNoneMatch === '*'` and the opt-in `smartMerge: false`.
    - With `If-None-Match: *`, a create that finds the resource already stored gets 412 in the build. One that loses the race at write time gets 412 from the executor. Both are as today.
    - Without `If-None-Match`, a lost create is replayed into the winner. Today that replay merges (the insert entry defaults to `smartMerge: true`). The new path replaces, as PUT does everywhere else (accepted difference 2). It still answers 201 until the resolver.
- **The reader shares POST's body checks.** `readSingleResourceBody({ body, id, resourceType, path, operationName })` takes the id to set on the body: POST passes a new UUID, PUT the URL id without its `|authority` suffix. `UpdateResponder.readAsync` rejects a missing body (400 `Request body is required.`) and an array body. It fails a body whose `resourceType` doesn't match the URL at `STRUCTURE`, with the same outcome and metric. These checks move from `CreateResponder.readAsync` into `readSingleResourceBody` in `src/operations/writePipeline/responder/singleResourceBody.js`, used by both responders. PATCH's body is a JSON Patch, so these two callers are the whole set.
  - The two-check consequences are POST's: a caller without the scope gets 400 for these bodies where today it gets 403.
  - Then, as today, the URL id overwrites the body id and every `_` field is stripped.
  - The client's `meta.lastUpdated` is removed. Today `validateResourceAsync` deletes it before its schema check.
- **The failure access-log entry takes `uuid` and `sourceAssigningAuthority` from the failure's subject.** Today they are the stored doc's when one exists, else `undefined`. The raw-body schema check now runs before the load, so the stored doc isn't known yet. The identity derived in step 2 is known, and it is what the lookup uses.
  - For an existing resource the entry matches today's. The one exception is a UUID id, where `sourceAssigningAuthority` is now empty (the identity step derives none).
  - For a new resource, the entry now carries the derived `uuid` (and, for a non-UUID id, the `sourceAssigningAuthority`). Today both are empty (announced).
  - The entry is written for `STRUCTURE`, `IDENTITY` (when it has an outcome), `INCOMING_SCHEMA`, `INCOMING_META` and `RESULT_VALIDATION`.
- **A body without `meta.security` (ruled in Tasks 3 and 4).** A PUT with a UUID id and such a body gets 500 on the old path (the merger's preSave asserts `sourceAssigningAuthority is null`). The new path doesn't reproduce it: identify sets `_uuid`, so the merger skips that preSave, and the shared access check sees the dropped access tags. It answers 403 when the caller can't write a dropped tag (`noMetaSecurityScopedCaller`), and 200 for a caller who can, with the doc stored with only its owner and source-assigning-authority tags (`noMetaSecurityFullAccess`). Announced under PUT.
- **AuditEvent size (ruled in Task 4).** AuditEvent PUT gets 405 from `ResourceOperationAccessProvider` before the pipeline, so the AuditEvent size check never fires for PUT; the parity case `auditEventPut405` pins it on both paths. `UpdateResponder` still maps a `SIZE` failure as `CreateResponder` does (`failure.error ?? PayloadTooLargeError`) and stores its access-log entry.
- **The response keeps today's shape:** `{ id: parsedArgs.id, created, resource_version, resource }` for `fhirResponseWriter.update`.
  - The resource gets GridFS `RETRIEVE`, base64 `RETRIEVE`, identifier enrichment, `groupExtendedTagEnrichmentProvider.enrichAsync` and serialization.
  - On a no-op it is the stored doc, transformed the same way, with a 200 and the access-log entry `{ created: false, updated: false, id, uuid, sourceAssigningAuthority, resourceType }`.
  - After a replay the body is the pre-replay candidate, which is today's stale-ETag behavior. The resolver PR fixes it on both paths.

## Review Focus

- Two concurrent PUTs without `If-Match` to the same resource both land. The version goes up by two, history has both versions, and the stored doc is the later writer's body (replaced, not merged). Test: Task 6, `twoConcurrentPutsBothLand`.
- A ClickHouse Group PUT whose document is unchanged but whose members are sent still writes the members (the forced write) and doesn't fail `mergeOneAsync`'s version assert. Tests:
  - Task 2: the `WriteStep` unit cases `forcedGroupWriteQueuesReplaceWithIfMatchVersionIds` and `forcedGroupWriteQueuesReplaceWithoutIfMatch`;
  - Task 7: runs `group_mongo_member_preservation` and the ClickHouse Group suites on the new path.
- A PUT that changes only a date-only field is saved with a new version (no `ignoreDateOnlyChange`). Tests: Task 3 case `dateOnlyChangeSaved`; Task 7 runs `mergeIgnoreDateOnlyChange.test.js` on the new path.
- A PUT with a UUID id whose body has no `meta.security` gets 500 on the old path. On the new path the shared access check answers it: 403 for a scoped caller who can't write a dropped stored access tag, and 200 with `access/*.*`, with the doc stored with only its owner and source-assigning-authority tags. Test: Task 3, per-path cases `noMetaSecurityScopedCaller` and `noMetaSecurityFullAccess`.
- With `SKIP_HANDLE_CONCURRENCY=true`, a PUT without a specific `If-Match` writes by `_uuid` alone, today's last-write-wins: 200 and the stored doc is the caller's body. With a specific `If-Match` it keeps the stored `versionId`, and a lost race is dropped and answered 200, as today. Tests: Task 6, `lostUpdateWithConcurrencyHandlingOff` and `ifMatchLostUpdateWithConcurrencyHandlingOff`.

---

### Task 1: Opt-in parameters on the bulk inserter, and `HttpPreconditions`

**Files:**
- Modify: `src/dataLayer/fastDatabaseBulkInserter.js` (`mergeOneAsync`, `insertOneAsync`)
- Create: `src/operations/writePipeline/httpPreconditions.js`
- Test: `src/tests/unit/dataLayer/fastDatabaseBulkInserter.test.js`, `src/tests/unit/operations/writePipeline/httpPreconditions.test.js`

**Interfaces:**
- Produces:
  - `mergeOneAsync({ requestInfo, resourceType, previousVersionId, doc, contextData = null, smartMerge = true, writePrecondition = null })`. The queued entry carries `writePrecondition`.
  - `insertOneAsync({ requestInfo, resourceType, doc, contextData = null, rejectIfExists = false, smartMerge = true })`. The queued entry carries `smartMerge`. When an `insertUniqueId` for the `_uuid` is already pending, it is forwarded to `mergeOneAsync` as today.
  - `class HttpPreconditions` with `static fromRequestInfo(requestInfo): HttpPreconditions` and frozen fields `ifMatch: string|undefined`, `ifMatchVersionIds: string[]`, `ifNoneMatch: string|undefined` and `writePrecondition: {ifMatchVersionIds: string[]}|null`.

- [ ] **Step 1: Write the failing tests.**
  - `fastDatabaseBulkInserter.test.js`:
    - `mergeOneAsync queues the writePrecondition it is given`: the queued entry's `writePrecondition` equals `{ ifMatchVersionIds: ['2'] }`, `smartMerge` is `false`, and the filter is `{ $and: [{ _uuid }, { 'meta.versionId': '2' }] }`.
    - `mergeOneAsync without writePrecondition queues null`.
    - `insertOneAsync queues smartMerge false when asked`.
    - `insertOneAsync defaults smartMerge to true`.
  - `httpPreconditions.test.js`, one `test.each` over headers:
    - none → `ifMatchVersionIds: []`, `writePrecondition: null`;
    - `W/"1"` → `['1']`;
    - `"1", "2"` → `['1', '2']`;
    - `*` → `['*']`, `writePrecondition: { ifMatchVersionIds: ['*'] }`;
    - `If-None-Match: *` → `ifNoneMatch: '*'`;
    - `requestInfo.headers` undefined → the same as none.
- [ ] **Step 2: Run both files and confirm the new tests fail.**
- [ ] **Step 3: Add the two parameters and `HttpPreconditions`.** Reuse `parseIfMatchVersionIds` from `src/utils/ifMatchHelper.js`. Leave every existing caller unchanged.
- [ ] **Step 4: Run both files; all pass.** Also run these two unchanged: `src/tests/unit/dataLayer/fastDatabaseUpdateManager.test.js` and `src/tests/unit/dataLayer/bulkWriteExecutors/mongoBulkWriteExecutor.test.js`.
- [ ] **Step 5: Stage the four files.**

### Task 2: PUT's identify, build and write variants

**Files:**
- Create: `src/operations/writePipeline/steps/identify/urlIdentityResolver.js`, `src/operations/writePipeline/steps/build/replaceBuilder.js`
- Modify: `src/operations/writePipeline/steps/writeStep.js` (constructor `honorHttpPreconditions = false`)
- Modify: `src/createContainer.js` (variants `identify.url`, `buildDocument.replace`, `write.httpPreconditions`)
- Test: `src/tests/unit/operations/writePipeline/steps/identify/urlIdentityResolver.test.js`, `steps/build/replaceBuilder.test.js`, `steps/writeStep.test.js`, `src/tests/unit/createContainer.test.js`

**Interfaces:**
- Consumes: `HttpPreconditions` and the `writePrecondition` / `smartMerge` opt-ins (Task 1), `InsertBuilder` (POST).
- Produces:
  - `new UrlIdentityResolver({ resourceValidator, sourceAssigningAuthorityColumnHandler, uuidColumnHandler })`:
    - `resolveAsync({ item, context }): Promise<WriteFailure|null>`;
    - `static parseUrlId(parsedArgs): {id: string, sourceAssigningAuthority: string|undefined}`, which runs `IdParser.parse` on `parsedArgs.getOriginal('id') || parsedArgs.getOriginal('_id')`, falling back to `parsedArgs.id`;
    - it sets `item.incoming._uuid`, plus `item.incoming._sourceAssigningAuthority` for a non-UUID id.
  - `new ReplaceBuilder({ resourceMerger, databaseAttachmentManager, base64DataManager, postSaveHandlerFactory, insertBuilder })` with `buildAsync({ item, context }): Promise<WriteFailure|null>`. It sets `item.candidate` (null for a no-op) and `item.writeMode` (`'update'` or `'insert'`).
  - `WriteStep` with `honorHttpPreconditions: true` queues as stated in Decisions ("Versioned write").

- [ ] **Step 1: Write the failing tests.**
  - `urlIdentityResolver.test.js`, one `test.each`:
    - UUID id → `_uuid` = id, and the body is otherwise unchanged;
    - non-UUID id with an owner tag → `_uuid` and `_sourceAssigningAuthority` from id + owner, with `meta.security` unchanged (no SAA tag pushed);
    - non-UUID id with an SAA tag → derived from the SAA;
    - no authority tag → `IDENTITY` failure with the outcome text `Resource <T>/<id> is missing a security access tag with system: https://www.icanbwell.com/owner`;
    - URL `id|other` vs owner tag `owner` → `IDENTITY` failure carrying a `BadRequestError` with `The sourceAssigningAuthority in the id (<id>|other) does not match the owner/sourceAssigningAuthority tag of the resource (owner)`;
    - URL `id|owner`, matching → no failure;
    - an owner tag with no `code` → throws `sourceAssigningAuthority is null for <T>/<id>`.
  - `replaceBuilder.test.js`, one `test.each` over (stored, headers, body). Each case asserts either the failure's error class and exact message, or the candidate and `writeMode`:
    - extended stored Group + body members → the `BadRequestError` from `rejectMemberOnExtendedGroupWrite`;
    - stored + `If-None-Match: *` → `Version conflict: If-None-Match: * was provided but resource already exists.`;
    - stored v2 + `If-Match: W/"1"` → `Version conflict: If-Match does not match current resource version. Older version: 2, If-Match: W/"1"`;
    - stored without `versionId` + `If-Match` → `Version conflict: Resource does not have a versionId, but If-Match header was provided. If-Match: <raw>`;
    - no stored + `If-Match: *` → `Version conflict: Resource does not exist, but If-Match header was provided. If-Match: *`;
    - stored + `If-Match: *` → built;
    - changed body → candidate version = stored + 1, `writeMode: 'update'`, and a field the body drops is gone (replace);
    - date-only change → candidate not null;
    - identical body → candidate null;
    - identical ClickHouse Group with members and post-save handlers → candidate = the overwritten incoming, with the stored `versionId`;
    - no stored → `InsertBuilder`'s candidate with `versionId: '1'`, `writeMode: 'insert'`.
  - `writeStep.test.js`:
    - `honorHttpPreconditions queues an update with the stored versionId, smartMerge false and the If-Match writePrecondition`;
    - `forcedGroupWriteQueuesWithoutVersionFilter`: candidate and stored share a `versionId` → `previousVersionId: null`;
    - `honorHttpPreconditions queues an insert with rejectIfExists for If-None-Match: * and smartMerge false`;
    - the existing cases still pass, so the default `WriteStep` calls are unchanged.
  - `createContainer.test.js`: the three variants are registered, and the `$merge` and create profiles still resolve.
- [ ] **Step 2: Run each file; the new tests fail.**
- [ ] **Step 3: Implement.** The builder runs the stored-doc checks in the order of `update.js` 371-398. It computes `hasMemberField` from `item.incoming`: a Group whose `member` is a non-empty array (stripping `_` fields doesn't change it). The forced-write condition is `update.js` 413-423, unchanged.
- [ ] **Step 4: Run the four files; all pass.**
- [ ] **Step 5: Stage the changed files.**

### Task 3: PUT parity test (golden responses from the old path)

**Files:**
- Create: `src/tests/integration/operations/writePipeline/responder/update/update.test.js` and its `fixtures/` and `expected/` folders

**Interfaces:**
- Produces: a `test.each` over named cases, each run with `WRITE_PIPELINE_OPERATIONS=''` and with `='update'`.
  - Each case asserts the status, the body (golden), the `ETag`, `Location` and `Content-Location` headers, and the stored doc and history rows after the request.
  - Goldens are recorded from the old path. A case under an accepted difference has a golden and status per path, recorded from each path.

- [ ] **Step 1: Write the cases, following the layout of `responder/create/create.test.js`.** One golden for both paths:
  - Create and update: `createViaPut`, `updateExisting`, `updateByIdWithAuthority`, `noOp` (200, version stays `1`, no history row).
  - Body handling: `bodyIdDiffersFromUrl` (the URL id wins), `clientUnderscoreFieldsStripped`, `lastUpdatedNotAnInstant`, `dateOnlyChangeSaved`, `identifierReplaceKeepsSourceIdAndUuid`.
  - Identity: `idAuthorityMismatch` (400), `nonUuidIdWithoutAuthorityTag` (400), `ownerTagWithoutCode` (500).
  - Scope and access:
    - `scopeMissing`, `storedNotAccessible` (403 each);
    - `storedNotAccessiblePatientReferenceChanged` (403, with no stored reference in the text);
    - `patientScopeOwn`, `patientScopeOther`;
    - `accessTagAddNotGrantable`, `accessTagRemoveNotGrantable` (403 each), `accessTagAddGranted`;
    - `noMetaSecurityScopedCaller` (403), `noMetaSecurityFullAccess`;
    - `createViaPutAccessDenied` (403).
  - Validation: `invalidSchema`, `patientReferenceChanged`, `personLinkOtherTenant`, `metaMissingOwnerOnCreate`, `metaMultipleOwnersOnUpdate` (400 each).
  - Group: `extendedGroupWithMembers` (400), `groupOverLimit` (`too-costly`).
  - Preconditions:
    - `ifMatchMatches`, `ifMatchWeakLowercaseList`, `ifMatchStar`;
    - `ifMatchMismatch`, `ifMatchNoStored`, `ifMatchStoredWithoutVersion` (412 each, where the old path gives it);
    - `ifNoneMatchStarExisting` (412), `ifNoneMatchStarNew` (201).
  - Attachments: `gridfsRoundTrip`, `base64DataChanged` (a new live key on both paths).
- [ ] **Step 2: Add the per-path cases (accepted difference 1, or a change announced in Task 8):**
  - `emptyBody`: old 500, new 400 `Request body is required.`
  - `arrayBody`: 400 on both, with different text.
  - `typeMismatchWithoutScope`: old 403, new 400.
  - `invalidSchemaStoredNotAccessible`: old 403, new schema 400.
  - `ifMatchMismatchPatientReferenceChanged`: old 400, new 412.
  - `accessTagRemoveNotGrantableInvalidReference`: old 400, new 403.
  - `groupOverLimitWithInvalidField`: old `too-costly`, new schema 400.
  - `createViaPutPersonLinkOtherTenantAccessDenied`: old 400, new 403.
  - `noOpGroupOverLoweredLimit`: old 400 `too-costly`, new 200. Store an over-limit Group with the limit raised, then lower it, using the env var the `group_promotion` tests use, and restore it afterwards.
  - `base64UnrelatedFieldChanged`: old has a new live key, new keeps the stored one.
- [ ] **Step 3: Record the goldens from the old path.**
  - Run with recording on, and check each golden for synthetic data only.
  - Then run the file with both switch positions. The old-path half passes. Note every new-path failure in the task report; Task 4 makes them pass.
  - Say in the report whether the stored-doc goldens show `BulkPreloadLoader` returns a different shape from today's `findAsync` + `FhirResourceWriteSerializer`.
- [ ] **Step 4: Stage the test, fixtures and goldens.**

### Task 4: PUT's profile, responder and switch

**Files:**
- Create: `src/operations/writePipeline/profiles/update.js`, `src/operations/writePipeline/responder/update.js`, `src/operations/writePipeline/responder/singleResourceBody.js`
- Modify:
  - `src/operations/writePipeline/responder/create.js` (use `readSingleResourceBody`);
  - `src/operations/update/update.js` (the switch and wiring only);
  - `src/createContainer.js` (register `updateResponder`; pass `writePipelineSwitch`, `writePipeline` and `updateResponder` to `UpdateOperation`).
- Test: `src/tests/unit/operations/writePipeline/responder/update.test.js`, `src/tests/unit/operations/update/update.test.js`, the Task 3 parity file

**Interfaces:**
- Consumes: the variants from Task 2.
- Produces:
  - `UPDATE_WRITE_PROFILE = { name: 'update', accessRequested: 'u', action: 'update', variants: { identify: 'url', buildDocument: 'replace', write: 'httpPreconditions' } }`, frozen, with no `off`.
  - `readSingleResourceBody({ body, id, resourceType, path, operationName }): { item: WriteItem }`.
    - It throws the missing-body and array-body `BadRequestError`s.
    - It fails the item at `STRUCTURE` on a type mismatch and records the schema metric.
    - The array text stays `Only single resource can be sent to create.` for POST. For PUT it is the text recorded in Task 3's `arrayBody` new-path golden: `Only single resource can be sent to update.`
  - `new UpdateResponder({ base64DataManager, databaseAttachmentManager, identifierEnrichmentProvider, groupExtendedTagEnrichmentProvider })`, implementing `readAsync`, `failureResults`, `results`, `toResponse` and `recordMetrics` as stated in Decisions. Its context has `smartMerge: false` and `operationName: 'update'`.

- [ ] **Step 1: Write the failing unit tests.**
  - `responder/update.test.js`, one `test.each` over failure stages, asserting the thrown error's class and message:
    - `SCOPE` and `ACCESS` → `ForbiddenError`;
    - `IDENTITY` with an outcome → `NotValidatedError`, with the access log;
    - `IDENTITY` with an error → that error;
    - `STRUCTURE`, `INCOMING_SCHEMA`, `INCOMING_META` and `RESULT_VALIDATION` → `NotValidatedError`, with the access log `uuid` and `sourceAssigningAuthority` from the failure's subject;
    - `BUILD` → the error;
    - `ATTACHMENTS` and `WRITE` → `error.nested ?? error`.
  - Also in `responder/update.test.js`:
    - `results` throws `No merge result` for an empty flush, and the issue JSON for a result that is neither created nor updated;
    - for an unchanged item, `results` returns the stored-doc entry without throwing;
    - `toResponse` returns `{ id: parsedArgs.id, created, resource_version, resource }` for a write and for a no-op.
  - `update/update.test.js`: `routes to the pipeline when the update switch is on`, plus the existing cases with it off.
- [ ] **Step 2: Run them; they fail.**
- [ ] **Step 3: Implement.** In `update.js`, at the top of `updateAsync`:

  ```js
  if (this.writePipelineSwitch?.useNewPathFor('update')) {
      return await this.writePipeline.runAsync({ profile: UPDATE_WRITE_PROFILE, responder: this.updateResponder, requestInfo, parsedArgs, resourceType });
  }
  ```

  Wire the constructor as `create.js` does. If Task 3 reported a stored-doc shape difference, fix it in `BulkPreloadLoader`'s returned doc only when `$merge`'s parity file still passes. Otherwise stop and report it.
- [ ] **Step 4: Run the tests.**
  1. Run the unit files.
  2. Run the parity file with both switch positions. Every case passes against its golden.
  3. Run `responder/create/create.test.js`, `responder/merge/merge.test.js` and the unit test `responder/create.test.js`, unchanged.
- [ ] **Step 5: Stage the changed files.**

### Task 5: Audit, access log, attachments and metrics on both paths

**Files:**
- Create, in `src/tests/integration/operations/writePipeline/responder/update/`: `update.audit.test.js`, `update.accessLog.test.js`, `update.attachments.test.js`, `update.metrics.test.js`

- [ ] **Step 1: Write the tests.** Each is a `test.each` over both switch positions, following the `create.*` files.
  - `update.audit.test.js`:
    - a PUT with a new id gives one `C` AuditEvent;
    - an existing id gives one `U`;
    - a no-op gives none;
    - a 400, 403 or 412 gives only the route handler's error AuditEvent, never a second one.
  - `update.accessLog.test.js`: the access-log entry for each of these:
    - an update, a create and a no-op;
    - the identity 400;
    - the meta failure on the merged doc;
    - the raw schema failure on an existing resource (non-UUID id) and on a new one. The new one gets a per-path golden (announced).
  - `update.attachments.test.js`:
    - An access-tag 403 and a create-via-PUT 403 store no GridFS file or base64 object on the new path. On the old path they do.
    - An access-tag 403 on a body that drops a stored GridFS attachment leaves the stored file in place on the new path. The old path deletes it.
    - A no-op touches no stored object on both paths.
  - `update.metrics.test.js`: the `fhir_validation_failure_total` labels and count for each failing validation case in Task 3, with a per-path value where an accepted difference applies.
- [ ] **Step 2: Run each file; all pass.** For a mismatch not covered by Decisions, stop and report it.
- [ ] **Step 3: Stage the four files.**

### Task 6: Concurrency on the new path

**Files:**
- Create: `src/tests/integration/operations/writePipeline/responder/update/update.concurrency.test.js`

- [ ] **Step 1: Write the tests, for the new path only.** Make a write lose by wrapping `fastDatabaseBulkInserter.executeAsync`, as `update_fast_serializer.test.js:287` does: write the competing version just before the real flush.
  - `twoConcurrentPutsBothLand`: no `If-Match`. The caller gets 200, the stored version goes from 1 to 3, history has versions 2 and 3, and the stored doc is the caller's body (a field only the competitor wrote is gone).
  - `ifMatchLosesToConcurrentWrite`: 412 with `Version conflict: If-Match does not match current resource version. Older version: 2, If-Match: 1`.
  - `ifMatchStarAgainstConcurrentDelete`: 412 with `Version conflict: Resource no longer exists, but If-Match header was provided. If-Match: *`, and the resource is not recreated.
  - `ifNoneMatchStarLosesCreateRace`: 412 with `Version conflict: If-None-Match: * was provided but resource already exists.`, and the winner's doc is unchanged.
  - `lostCreateReplaysAsReplace`: no `If-None-Match`. The caller gets 201, as today. The stored doc is the caller's body on the winner's identity, replaced rather than merged.
  - `retriesRunOut`: `REPLACE_RETRIES=1`, with the competitor re-written before every attempt. The caller gets 500 with today's text: `Unable to save resource <T>/<uuid> with version <v> (original=<o>) after 10 tries.`
  - `lostUpdateWithConcurrencyHandlingOff`: `SKIP_HANDLE_CONCURRENCY=true`. Pin the status and the stored doc, and assert the response is not a 200 with the caller's body when the stored doc is the competitor's.
- [ ] **Step 2: Run the file; all pass.** If `lostUpdateWithConcurrencyHandlingOff` returns 200 for a write that didn't land, stop and report it: it needs a ruling before Task 7.
- [ ] **Step 3: Stage the file.**

### Task 7: New path by default in tests, and the update suites

**Files:**
- Modify: `jest/setEnvVars.js` (`WRITE_PIPELINE_OPERATIONS='merge,create,update'`)
- Create: `oldWrite<Name>.test.js` copies, and `oldWrite/` fixture folders, for each test that fails only on an accepted difference
- Modify: those tests' fixtures to the new behavior

- [ ] **Step 1: Change the default, then run each of these, one file at a time:**
  - every file under `src/tests/integration/update/`;
  - `operations/common/mergeIgnoreDateOnlyChange/mergeIgnoreDateOnlyChange.test.js`;
  - `patient/reference_update/patient.reference_update.test.js`;
  - `internalAuditLogs/auditLogWriteActions/auditLogWriteActions.test.js`;
  - `accessLog/accessLogs.update.test.js`;
  - `group/group_extended_put_merge_rejection.test.js`, `group/group_promotion.test.js`, `group/group_mongo_member_preservation.test.js`, `group/group_concurrency.test.js`;
  - `binary/blobStorage/putPatchCleanup.test.js`, `binary/blobStorage/blobStorage.test.js`, `binary/blobStorage/liveObjectRetention.test.js`;
  - `patientScope/patient_scope/patient_scope.put.test.js`, and each file in `patientScope/update_with_patient_scope/`;
  - `security/matrix/write_matrix.test.js`, `security/write_v2_cruds_scopes.test.js`.
- [ ] **Step 2: Classify each failure.**
  - A failure caused only by an accepted difference or a Task 8 announce entry: update the test's fixtures and add the `oldWrite` copy, with the switch off and the old fixtures. Two are expected:
    - `update_fast_serializer.test.js:396`: an over-limit Group with an invalid field, the same case as POST's;
    - any base64 test that expects a new live key for a PUT that doesn't change the base64 value.
  - Any other failure is a bug. Fix it in the owning task's code, add a unit or parity case for it, and say so in the report.
- [ ] **Step 3: Run every changed file and every new `oldWrite` copy; all pass.**
- [ ] **Step 4: Stage the changed files.**

### Task 8: Spec, ADR, lint and security review

**Files:**
- Modify: `docs/specs/unified-write-pipeline.md`, `docs/adr/0005-unified-write-pipeline.md`, this plan (Decisions, if a task made a ruling)

- [ ] **Step 1: Update the spec.**
  - "Step order":
    - Step 10 is still unimplemented. It is added by PATCH, whose body is a JSON Patch, and is later used by admin.
    - PUT, POST, `$merge` and `$import` check the incoming body's access tags in step 7, because the merger keeps exactly the body's access tags.
  - Profiles, `update` column:
    - Validate incoming: the shared step's raw-body schema check (accepted difference 1). Person.link moves to validate result.
    - Find existing: by `_uuid`, a bulk preload of one.
    - Validate new resource: meta, for create-via-PUT.
    - Access before build: as `$merge` (the stored doc, then the access-tag change on the body, removals counted); for create-via-PUT, POST's full check and access-tag change. Today the tag check runs after the build and the uploads.
    - Build: replace, with the `If-Match` / `If-None-Match` 412s and the extended Group 400.
    - Validate result: as `$merge`.
    - Access on result: off.
    - Write: versioned updates, `If-Match` / `If-None-Match`, and today's replay until the resolver.
  - "Concurrency":
    - PUT ships before the resolver, with the version filter. A lost race goes into today's replay, with replace semantics and the `If-Match` re-check.
    - When the retries run out, the caller gets today's 500; the resolver changes it to 409.
    - A lost create is replayed as a replace and answers 201 until the resolver.
    - The forced Group write keeps the `_uuid`-only write.
    - The new path drops `alwaysCreateNew`, now that PUT is versioned.
  - "Testing":
    - List the PUT files from Tasks 3, 5 and 6, and the `oldWrite` copies from Task 7.
    - The 409 concurrency test moves to the resolver PR.
  - "Delivery":
    - The order is create, update, import, patch, admin.
    - Only PATCH waits for the resolver, because it needs the re-patch rebase.
  - "Changes to announce": a new **PUT** section with these entries:
    - No attachment writes, and no GridFS deletions, on a 403.
    - The reader's 400s come before the scope check (accepted difference 1).
    - `$merge`'s validation order, with each per-path parity case from Task 3 (accepted difference 1).
    - The over-limit Group with an invalid field.
    - 400 for a PUT with no body.
    - Versioned updates: concurrent PUTs both land, with the version up by two, instead of last-write-wins. A lost create is replaced instead of merged (accepted difference 2).
    - The base64 live key is kept when its value doesn't change.
    - A no-op PUT skips `validateResourceAsync`.
    - The failure access-log entry of a create-via-PUT now carries the derived `uuid`. For an existing resource with a UUID id, it no longer carries `sourceAssigningAuthority`.
    - More operation failures are logged, as for POST.
    - GridFS file metadata, as for POST.
- [ ] **Step 2: Update the ADR's variant paragraph** to list PUT's three variants.
- [ ] **Step 3: Lint every changed JS file with the committed config.** Fix all errors.
- [ ] **Step 4: Run the repo's security review (`review.md`) on the diff.** Focus on:
  - the stored-doc access check running before any comparison with the stored doc;
  - the access-tag check on the body matching today's check on the built doc;
  - the `_uuid` lookup adding no new data path;
  - the replay's missing access re-check, which is unchanged from today (the resolver closes it);
  - no PHI in logs or fixtures.

  Fix every concrete finding, or record it with a reason.
- [ ] **Step 5: Stage the docs.**
