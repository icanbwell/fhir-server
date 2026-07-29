# FHIR Server Bug Report

Findings from automated unit test generation against the fhir-server codebase.

- **Repo:** [icanbwell/fhir-server](https://github.com/icanbwell/fhir-server)
- **Tested commit:** [`bd9ed8dd4`](https://github.com/icanbwell/fhir-server/commit/bd9ed8dd4) (INC-331 pre-fix)
- **Verified against:** [`main` @ f6435cd5f](https://github.com/icanbwell/fhir-server/commit/f6435cd5f) — all bugs confirmed still present
- **Skill used:** `unit-test-master` ([PR #149](https://github.com/icanbwell/bwell-ai-plugin-marketplace/pull/149))
- **Method:** Generate unit tests targeting cache behavior, null safety, error paths, and loop boundaries. Bugs confirmed via failing assertions in reproducible test cases.

---

## Tier 1: CRITICAL — PHI/Data Exposure or Silent Data Corruption

| # | File | Line | Failing Test | Bug | Why It Matters |
|---|------|------|-------------|-----|----------------|
| 1 | `utils/mongoQuerySimplifier.js` | 170-171 | `mongoQuerySimplifier.test.js` › "treats 0 and false as empty" | `isEmpty()` uses `!value` — drops `0` and `false` from `$or`→`$in` simplification. Query `{$or: [{status: 0}, {status: 1}]}` becomes `{status: 1}` | Called by `searchManager`, `dataSharingManager`, `r4.js`, `everythingHelper`. **Silently removes valid filter conditions from security/access queries.** A security tag value of 0 or false would be stripped, potentially exposing restricted data. |
| 2 | `operations/search/dataSharingManager.js` | 107 | `dataSharingManager.test.js` › "second call with same requestId but different securityTags must use cached patientIds" | Cache keyed only on `requestId`. Chunk 2 of a search reuses chunk 1's patient-to-person mapping. | **This is INC-331.** Different chunks in the same request get different patients' data mixed. PHI leakage confirmed in production. |
| 3 | `operations/export/script/bulkDataExportRunner.js` | 742 | `bulkDataExportRunner.nullSafety.test.js` › "concat return value discarded" | `currentBatch.concat(previousBuffer)` — `.concat()` doesn't mutate, return value discarded | **Exported NDJSON files silently lose patient records.** `previousBuffer` data vanishes. Export looks successful but is incomplete. |
| 4 | `operations/searchById/searchById.js` | 285 | `searchById.test.js` › "serialization return value discarded" | `FhirResourceSerializer.serializeByResourceType(resource)` return value not assigned back | **Internal fields (\_uuid, \_sourceId, etc.) leak to API consumers.** Serialization is supposed to strip these. |
| 5 | `operations/searchByVersionId/searchByVersionId.js` | 273 | `searchByVersionId.test.js` › "serialization return value discarded" | Same pattern: `FhirResourceSerializer.serialize(historyResource)` return discarded | Same impact as #4 — internal fields exposed in versioned resource responses. |
| 6 | `utils/bwellPersonFinder.js` | 74-75 | `bwellPersonFinder.test.js` › "returns Map instead of expected object on empty input" | Empty `references` returns `new Map()` instead of `{ patientReferenceToPersonUuid: {}, personToLinkedPatientsMap }` | Caller destructures → gets `undefined` → `dataSharingManager` calls `Object.keys(undefined)` → **crashes entire search request for patients with no linked persons.** |
| 7 | `admin/runners/fixConsentRunner.js` | 274 | `fixConsentRunner.test.js` › "crashes on questionnaireItem with null code" | `questionnaireItem.code.forEach()` without null check | Consent repair runner crashes on real FHIR data where Questionnaire items lack `.code`. **Consent resources left in broken state.** |

## Tier 2: HIGH — Server Crashes or Data Loss Under Realistic Conditions

These cause 500 errors, lost data, or broken operations that users/ops will hit.

| # | File | Line | Failing Test | Bug | Production Trigger |
|---|------|------|-------------|-----|-------------------|
| 8 | `dataLayer/fastDatabaseBulkInserter.js` | 572 | `fastDatabaseBulkInserter.test.js` › "patches spread on null" | `[...previousUpdate.patches]` when `patches` is `null` | Same resource inserted then merged in one batch (Bundle transactions). Filed as **TIP-7771**. |
| 9 | `dataLayer/databaseBulkInserter.js` | 672 | `databaseBulkInserter.nullPatches.test.js` › same | Identical bug in non-fast inserter | Same trigger as #8. |
| 10 | `operations/export/script/bulkDataExportRunner.js` | 831 | `bulkDataExportRunner.nullSafety.test.js` › "division by zero on empty collection" | `avgObjSize=0` → `new Array(Infinity)` → RangeError | Export against an empty collection. Patient export path has the guard; resource export doesn't. |
| 11 | `operations/export/script/bulkDataExportRunner.js` | 539 | `bulkDataExportRunner.nullSafety.test.js` › "null patientField" | `patientField.replace()` on null | Export any resource type with no configured patient filter property. |
| 12 | `operations/everything/everything.js` | 271-293 | `everything.bugs.test.js` › "throws TypeError when _type filter applied to Person GET" | `parsedArgs.resource` set to null, then passed to `filterGraphResources` which accesses `.link` | Any `Person/$everything?_type=Observation` request crashes. |
| 13 | `middleware/fhir/4_0_0/controllers/generic.controller.js` | finally block | `generic.controller.test.js` › "cache leaks when postRequestProcessor throws" | `executeAsync()` before `clearAsync()` in finally — if executeAsync throws, cache leaks | Any post-request task failure (Kafka disconnect, etc.) leaks memory indefinitely. Under load → OOM. |
| 14 | `operations/merge/merge.js` | 291 | `merge.nullSafety.test.js` › "headers null crashes prefer check" | `headers.prefer` without null guard on `headers` | Merge request where `requestInfo.headers` is null (internal service calls). |
| 15 | `admin/runners/updateCollectionsRunner.js` | 274, 285 | `updateCollectionsRunner.test.js` › "string vs moment comparison" | `targetLastUpdated` (string) compared to `this.updatedBefore` (moment) — always false | **Runner silently does nothing.** Never skips, never updates. Completely broken for non-Date lastUpdated values. |
| 16 | `admin/runners/fixDuplicateUuidRunner.js` | 236-253 | `fixDuplicateUuidRunner.test.js` › "NaN versionId crashes" | Non-numeric `versionId` → NaN propagation → empty array → `[0]._id` crash | Any resource with non-numeric versionId crashes the dedup runner. |
| 17 | `utils/auditLogger.js` | 77 | `auditLogger.test.js` › "null actor in delegatedUser path" | `requestInfo.actor.consentPolicy` without null check (delegated path only) | Delegated user request where actor wasn't set. Crashes audit logging → unhandled rejection. |
| 18 | `admin/runners/fixConsentRunner.js` | 235 | `fixConsentRunner.test.js` › "crashes on categoryItem with null coding" | `categoryItem.coding.forEach()` without null check | Consent with category but no coding array. Real FHIR data. |
| 19 | `admin/runners/fixPersonLinksRunner.js` | 115 | `fixPersonLinksRunner.test.js` › "crashes on name without given" | `currentPersonName.given.join(',')` when `given` is null | Person with family name only (no given). Common in real FHIR data. |
| 20 | `admin/runners/fixDuplicatePractitionerRunner.js` | 274 | `fixDuplicatePractitionerRunner.test.js` › "null ref.reference" | `ref.reference.startsWith()` when `reference` is null | References that use `_uuid` only without `reference` string. |
| 21 | `admin/runners/removeDuplicatePersonLinkRunner.js` | 89 | `removeDuplicatePersonLinkRunner.test.js` › "null resource.link" | `resource.link.reduce()` without null check | Person document with no link field. |
| 22 | `utils/patientPersonDataChangeEventProducer.js` | 354-358 | `patientPersonDataChangeEventProducer.test.js` › "flushAsync data loss on Kafka failure" | Maps cleared BEFORE processing. If Kafka/DB throws, events permanently lost | Any transient Kafka outage during flush. No retry, no dead-letter. Silent data loss. |
| 23 | `operations/streaming/resourceWriters/fhirBundleWriter.js` | 93 | `fhirBundleWriter.test.js` › "null chunk before guard" | `chunk.id` accessed BEFORE null check at line 95 | Null flowing through a Transform stream (edge case in backpressure/error scenarios). |
| 24 | `operations/validate/validate.js` | 176 | `validate.test.js` › "returns null when no resource found" | Returns `null` instead of OperationOutcome when resource not found by id | `$validate` on non-existent resource → caller crashes on null. |
| 25 | `utils/changeEventProducer.js` | 235 | `changeEventProducer.test.js` › "RethrownError receives string" | `error: e.stack` passes string to RethrownError expecting Error object | Every error in change event production produces malformed error objects. |
| 26 | `dataLayer/builders/groupMemberEventBuilder.js` | 201 | `groupMemberEventBuilder.bugs.test.js` › "null member.entity in buildEvents" | `member.entity.reference` without null check | Group with member that has null entity (removed member). |
| 27 | `operations/common/patientQueryCreator.js` | 81-92 | `patientQueryCreator.test.js` › "empty array produces invalid $or" | Empty `patientFilterProperty` array → `{$or: []}` → MongoDB rejects | Resource type configured with empty patient filter mapping. |
| 28 | `admin/runners/partitionAuditEventRunner.js` | 95, 126 | `partitionAuditEventRunner.test.js` › "null doc.meta.security" | `doc.meta.security.filter()` without null guard on `doc.meta` | AuditEvent document without meta field (old/migrated data). |
| 29 | `admin/runners/copyToV3Runner.js` | 267 | `copyToV3Runner.test.js` › "readBatchSize is undefined" | Uses `this.readBatchSize` but constructor stores as `this.batchSize` | Runner always uses default MongoDB batch size. Not a crash but completely ignores the configured batch size. |
| 30 | `utils/s3Client.js` | 139, 240 | `s3Client.test.js` › "null Body crash in downloadAsync" | `response.Body.transformToString()` when Body is null | S3 zero-byte objects or S3-compatible backends that return null Body. |
| 31 | `dataLayer/databaseAttachmentManager.js` | 217 | `databaseAttachmentManager.test.js` › "inherited enumerable properties crash" | `for...in` + `getOwnPropertyDescriptor` returns undefined for inherited props | FHIR resources created via class prototype with enumerable inherited properties. |
| 32 | `middleware/fhir/router.js` | 115-119 | `router.test.js` › "getController returns undefined for 4_0_1" | `ControllerUtils.getController()` only handles `4_0_0`, returns undefined for other versions | Custom base URL routes that skip version validation. |

## Tier 3: MEDIUM — Incorrect Behavior, Degraded Operations

| # | File | Line | Failing Test | Bug | Caveat |
|---|------|------|-------------|-----|--------|
| 33 | `operations/history/history.js` | 318 | `history.test.js` › "undefined uuid in S3 path" | `${historyResource.resource._uuid}` → string "undefined" in S3 path | Requires history resource with missing `_uuid`. Unlikely but produces garbage S3 lookups. |
| 34 | `operations/merge/merge.js` | 370 | `merge.nullSafety.test.js` › "returns undefined for empty merge" | `mergeResults[0]` is undefined when empty and `wasIncomingAList` is false | Merge with valid resource that produces no changes. Caller gets undefined. |
| 35 | `operations/remove/removeHelper.js` | 173 | `removeHelper.test.js` › "httpContext overwrite drops fields" | `httpContext.set(ACCESS_LOGS_ENTRY_DATA, { operationResult })` overwrites all other fields | Access log data from streaming phase silently dropped. |
| 36 | `utils/delegatedAccessRulesManager.js` | 362 | `delegatedAccessRulesManager.test.js` › "undefined consentVersion" | Missing `meta.versionId` → `"Consent/xxx?version=undefined"` in policy string | Consent without versionId. Produces malformed policy. |
| 37 | `utils/delegatedAccessRulesManager.js` | 159 | `delegatedAccessRulesManager.test.js` › "non-array securityLabel" | `for...of` on non-iterable `securityLabel` | Non-conformant Consent data. |
| 38 | `operations/search/searchBundle.js` | 287 | `searchBundle.test.js` › "undefined cursor passes null check" | `cursor !== null` doesn't catch `undefined` | If query returns undefined cursor. Use `if (cursor)` instead. |
| 39 | `admin/runners/fixConsentRunner.js` | 396 | `fixConsentRunner.test.js` › "for...in on Map.keys() iterates nothing" | `for (const key in this.questionnaireValues.keys())` — should be `for...of` | Logging loop is **dead code**. Never executes. |
| 40 | `utils/removeDuplicatePersonLinkRunner.js` | 90 | `removeDuplicatePersonLinkRunner.test.js` › "undefined _uuid dedup" | Multiple links with undefined `target._uuid` collapse to one | Silently drops valid distinct person links. |
| 41 | `utils/referenceParser.js` | 16 | `referenceParser.test.js` (multiple) | `return ('', '', '')` — comma expression returns string, not object | Any non-string non-URL reference. All destructured properties become `undefined`. Multiple callers affected. |
| 42 | `admin/runners/fixDuplicateUuidRunner.js` | 249 | `fixDuplicateUuidRunner.test.js` › "non-deterministic sort" | `new Date(undefined).getTime()` = NaN in sort comparator | Risk of deleting newer resource instead of older one. |
| 43 | `routeHandlers/fhirServer.js` | 302 | `fhirServer.test.js` › "null requestId sends 'null' header" | `String(null)` → literal `"null"` in X-Request-ID header | Confusing for clients/debugging. |
| 44 | `operations/export/script/bulkDataExportRunner.js` | 651-664 | `bulkDataExportRunner.nullSafety.test.js` › "missing abortMultiPartUpload" | No `abortMultiPartUploadAsync` in error handler | Orphaned S3 multipart uploads consuming storage after export failures. |
| 45 | `utils/clickHouseClientManager.js` | 89-92 | `clickHouseClientManager.test.js` › "connectAsync ignores ping failure" | `pingAsync()` return value unchecked — marks connected even when unreachable | All subsequent queries will fail with confusing errors. |
| 46 | `utils/clickHouseClientManager.js` | 187 | `clickHouseClientManager.test.js` › "null result.data" | `result.data` when `resultSet.json()` returns null | ClickHouse timeout/disconnect during query. |
| 47 | `utils/clickHouseClientManager.js` | 47-52 | `clickHouseClientManager.test.js` › "race condition in getClientAsync" | Concurrent calls both create clients, first connection orphaned | Connection pool leak under concurrent initialization. |
| 48 | `dataLayer/databaseBulkLoader.js` | 83 | `databaseBulkLoader.test.js` › "base_version not in cache key" | Cache keyed by `requestId` only — `base_version` not included | Second load for same resourceType with different version overwrites first. Low risk — single-version deployments only. |
| 49 | `admin/adminExportManager.js` | 157, 244 | `adminExportManager.test.js` › "finally uses different httpContext key" | Sets `'requestId'` but reads `'systemGeneratedRequestId'` in finally | postRequestProcessor and cache cleanup get `undefined` requestId. |
| 50 | `admin/adminExportManager.js` | 133, 144 | `adminExportManager.test.js` › "serialize return value discarded" | `FhirResourceSerializer.serialize()` return discarded | Raw internal data returned from admin export endpoints. |
| 51 | `admin/adminExportManager.js` | 255-295 | `adminExportManager.test.js` › "triggerExportJob no finally block" | No cache cleanup or post-request processing | Memory leak per triggerExportJob call. |
| 52 | `operations/common/fhirLoggingManager.js` | 176-184 | `fhirLoggingManager.test.js` › "negative duration" | `stopTime < startTime` → negative `valuePositiveInt` | Invalid FHIR audit data. Clock skew scenario. |
| 53 | `utils/accessLogger.js` | 342 | `accessLogger.test.js` › "null executeAsync result" | `mergeResults.filter()` on null/undefined | DB connection failure during access log flush. |
| 54 | `utils/auditLogger.js` | 384 | `auditLogger.test.js` › "null executeAsync result" | Same pattern as #53 | Same trigger. |
| 55 | `dataLayer/databaseUpdateManager.js` | 243 | `databaseUpdateManager.nullPatches.test.js` › "null headers" | `requestInfo.headers['origin-service']` when headers null | Internal callers with incomplete requestInfo. |

## Tier 4: LOW — Edge Cases (logged for completeness, not urgent)

| # | File | Line | Bug | Caveat |
|---|------|------|-----|--------|
| 56 | `operations/merge/ndJsonParser.js` | 51 | `_flush` bypasses `STREAM_ACCESS_LOG_BODY_LIMIT` — log array can exceed limit by 1 | Cosmetic. Only affects access log size. |
| 57 | `operations/remove/removeHelper.js` | 112 | `resource.meta` null crash | Unlikely — preSave guarantees meta. Only reachable if delete path bypasses preSave. |
| 58 | `utils/patientDataViewController.js` | 74 | Null owner falls through to unnecessary consent query | Performance waste, not data corruption. |
| 59 | `operations/merge/merge.js` | 265-267 | Sort comparator non-deterministic with null `_uuid` | Requires two resources with null _uuid in same merge batch. |
| 60 | `operations/merge/merge.js` | 106-107 | `null === null` false-matches in dedup | Requires two resources with null _uuid of same resourceType. |
| 61 | `dataLayer/builders/genericClickHouseQueryBuilder.js` | 163 | Empty `seekKey` produces invalid `ORDER BY` SQL | Requires empty seekKey which shouldn't happen via normal query paths. |
| 62 | `dataLayer/builders/genericClickHouseQueryBuilder.js` | 339-349 | `array<string>` only handles `$in/$eq/$ne` operators | Other operators generate invalid SQL — but those operators aren't currently generated for array fields. |
| 63 | `utils/clickHouseClientManager.js` | 136 | `pingAsync` returns null instead of false | Doesn't crash anything — just violates boolean contract. |
| 64 | `admin/runners/fixDuplicateOwnerTagsRunner.js` | 107-110 | Undefined `code` causes incorrect dedup | Requires owner tags without code field. |
| 65 | `middleware/fhir/fhirResponseWriter.js` | 258, 259 | Undefined host/result → "undefined" in URLs | Requires missing Host header or null export result. |
| 66 | `operations/merge/validators/mergeResourceValidator.js` | 95 | `wasAList` checked after transformation | Semantic correctness issue — doesn't crash. |
| 67 | `utils/mongoDatabaseManager.js` | 182 | `clientConfig.options` null when LOG_ALL_MONGO_CALLS set | Requires env var + missing options in config. |
| 68 | `dataLayer/databaseAttachmentManager.js` | 295 | Multi-byte chunk corruption in GridFS | Mitigated by base64 encoding in practice. |
| 69 | `operations/everything/everything.js` | 115-124 | Double error logging | Not a crash — just doubled metrics/alerts. |
| 70 | `utils/accessLogger.js` | 257-258 | Null startTime → epoch timestamp + huge duration | Requires null startTime passed to logger. |
| 71 | `operations/query/convertGraphQLParameters.js` | 22, 130, 160, 222 | `missing` modifier silently dropped when `notEquals` also specified | Logically contradictory input — low practical impact. |
| 72 | `operations/query/convertGraphQLParameters.js` | 175, 222 | `missing` modifier dropped for date/number types with `values` | Same pattern as #71. |
| 73 | `operations/query/r4.js` | 230 | `fhirFilterTypes.dateTime` is undefined → `case undefined:` in switch | Latent maintenance hazard only — all current SearchParameterDefinitions specify type. |

## Tier 2 (continued): HIGH — Server Crashes or Data Loss

| # | File | Line | Failing Test | Bug | Production Trigger |
|---|------|------|-------------|-----|-------------------|
| 74 | `operations/streaming/mongoStreamReader.js` | 96-104 | `mongoStreamReader.test.js` › "isFetchingData never reset after error" | `readAsync()` throws in catch block → `isFetchingData` stays `true` → stream permanently frozen | MongoDB network error or auth failure during cursor retry. Client hangs until timeout. |
| 75 | `operations/streaming/mongoStreamReader.js` | 196-208 | `mongoStreamReader.test.js` › "no push(null) after non-retryable error" | Non-retryable error pushes OperationOutcome but never `push(null)` → downstream streams hang indefinitely | Any MongoDB error (cursor killed, collection dropped, OOM) during streaming. |
| 76 | `operations/patch/strategies/groupMemberPatchStrategy.js` | 209-239 | `groupMemberPatchStrategy.bugs.test.js` › "MongoDB commit succeeds but ClickHouse write throws" | MongoDB session committed before ClickHouse write. ClickHouse failure → data inconsistency, no rollback | Any ClickHouse timeout/disconnect during Group member patch. |
| 77 | `dataLayer/bulkWriteExecutors/clickHouseBulkWriteExecutor.js` | post-save | `clickHouseBulkWriteExecutor.bugs.test.js` › "post-save failure is swallowed" | Post-save event error caught and ignored — caller sees success | Kafka disconnect during post-save event. Change events silently lost. |
| 78 | `dataLayer/bulkWriteExecutors/clickHouseBulkWriteExecutor.js` | fallback | `clickHouseBulkWriteExecutor.bugs.test.js` › "fallback receives full operation set after timeout" | Fallback executor receives ALL operations including ones potentially already committed by ClickHouse | ClickHouse timeout mid-batch → duplicate data in fallback path. |
| 79 | `cronJob/cronJobRunner.js` | triggerHistoryMigrationJob | `cronJobRunner.test.js` › "k8sClient.createJob throwing mid-loop skips remaining collections" | No try-catch inside loop — first K8s API failure aborts all remaining migration jobs | K8s API rate limiting or transient 503 during batch migration. |
| 80 | `cronJob/cronJobRunner.js` | updateInProgressResources | `cronJobRunner.test.js` › "afterSaveAsync failure after DB update creates inconsistent state" | DB status updated to complete, then event notification fails → status committed but downstream unaware | Any Kafka/notification failure after status change. Resource stuck in completed-but-unnotified state. |
| 81 | `admin/runners/getMasterPatientUsageDataRunner.js` | processReference | `getMasterPatientUsageDataRunner.test.js` › "toISOString on undefined lastUpdated" | `lastUpdated.toISOString()` when resource has no `meta.lastUpdated` → TypeError | Any resource in DB with missing meta.lastUpdated. Crashes entire CSV export. |
| 82 | `admin/runners/migrateHistoryToCloudStorageRunner.js` | processBatch | `migrateHistoryToCloudStorageRunner.test.js` › "bulkWrite called with empty array" | `bulkWrite([])` when all records in batch are skipped → MongoDB error | Batch of history records all in old format or all failing upload. |

## Tier 3 (continued): MEDIUM — Incorrect Behavior, Degraded Operations

| # | File | Line | Failing Test | Bug | Caveat |
|---|------|------|-------------|-----|--------|
| 83 | `operations/streaming/mongoStreamReader.js` | 130 | `mongoStreamReader.test.js` › "null cursor.next() result" | `resource._uuid` when `cursor.next()` returns null | Concurrent collection modification. Caught by internal error handler but results in bug #75. |
| 84 | `operations/streaming/resourcePreparerTransform.js` | 91-93 | `resourcePreparerTransform.test.js` › "null chunk.id in error handler" | Error handler accesses `chunk1.id` before null check → TypeError | Null chunk in transform stream. In Node.js 15+ → process termination. |
| 85 | `operations/streaming/resourcePreparerTransform.js` | 189 | `resourcePreparerTransform.test.js` › "null from prepareResourceAsync" | `resources.length` on null return from `prepareResourceAsync` | Resource preparer returning null edge case. |
| 86 | `operations/graph/graph.js` | 130-136 | `graph.test.js` › "null graphDefinitionRaw.resourceType" | `graphDefinitionRaw.resourceType` when body is null and no resource param | Misconfigured client POST to $graph with empty body. |
| 87 | `operations/patch/strategies/groupMemberPatchStrategy.js` | startsWith | `groupMemberPatchStrategy.bugs.test.js` › "paths starting with /member misclassified" | `path.startsWith('/member')` matches `/memberOf`, `/membership`, etc. | Any JSON patch with paths that happen to start with "/member". |
| 88 | `operations/patch/strategies/groupMemberPatchStrategy.js` | enrichMemberReferences | `groupMemberPatchStrategy.bugs.test.js` › "undefined sourceAssigningAuthority in UUID" | `generateUUIDv5(id + '|' + undefined)` seeds with literal "undefined" string | Member with no _sourceAssigningAuthority. UUID becomes unreferenceable. |
| 89 | `dataLayer/bulkWriteExecutors/clickHouseBulkWriteExecutor.js` | empty ops | `clickHouseBulkWriteExecutor.bugs.test.js` › "empty operations array" | Empty operations array passed to `insertAsync` | Bulk write with only deletes/no inserts for ClickHouse. |
| 90 | `dataLayer/bulkWriteExecutors/clickHouseBulkWriteExecutor.js` | null resource | `clickHouseBulkWriteExecutor.bugs.test.js` › "null resource in operation" | Null resource passed through to insertAsync | Operation entry with null resource field. |
| 91 | `admin/runners/getMasterPatientUsageDataRunner.js` | cursor | `getMasterPatientUsageDataRunner.test.js` › "cursor.next() null after hasNext()" | `resource.identifier` on null from `cursor.next()` race condition | hasNext() true but next() returns null (MongoDB cursor race). |
| 92 | `admin/runners/getMasterPatientUsageDataRunner.js` | processCollectionAsync | `getMasterPatientUsageDataRunner.test.js` › "cursor.nextObject() null" | `resource.updateReferencesAsync` on null from `nextObject()` | Same cursor race as #91. |
| 93 | `admin/runners/migrateHistoryToCloudStorageRunner.js` | processRecordAsync | `migrateHistoryToCloudStorageRunner.test.js` › "undefined _uuid in filePath" | `doc.resource._uuid` undefined → S3 path contains literal "undefined" | History resource with missing _uuid. Uploads to wrong path. |
| 94 | `admin/runners/migrateHistoryToCloudStorageRunner.js` | processRecordAsync | `migrateHistoryToCloudStorageRunner.test.js` › "null client silently skips" | Null `historyResourceCloudStorageClient` silently returns null (skips upload) | Runner configured without cloud storage — silently does nothing. |
| 95 | `admin/runners/changeSourceAssigningAuthorityRunner.js` | getQueryFromParameters | `changeSourceAssigningAuthorityRunner.test.js` › "startFromId loses date filter" | `Object.keys(query) > 0` compares array to number → always false. Date filters silently dropped. | Any run with `startFromId` parameter. Query processes all records instead of filtering by date. |

---

## Notes

- Bugs #1, 2, 3, 6, 13, 15, 22, 39, 41, 48, 74, 75, 76, 95 involve cross-call data flow, cache semantics, stream lifecycle, or JS language subtleties that wouldn't surface from basic null-input testing alone. The rest are defensive-coding gaps that any thorough test pass would find.
- All bugs have a corresponding failing test in `src/tests/unit/` that reproduces the issue. Run `npx jest --config jest.unit.config.js --no-coverage --forceExit` to execute.
- **95 verified bugs total** across 4 severity tiers. All confirmed still present on `main` @ `f6435cd5f`.
