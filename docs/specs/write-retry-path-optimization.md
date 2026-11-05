# Write retry path optimization - Design

## Problem

Resource writes queued through `DatabaseBulkInserter` / `FastDatabaseBulkInserter` are written per collection in one `collection.bulkWrite` with optimistic concurrency. A `$merge` update is a `replaceOne` filtered on `{_uuid, 'meta.versionId': <previous>}`, and every create is an `updateOne {_uuid} $setOnInsert` upsert. When a concurrent writer changes a resource first, that resource's filter matches nothing. `BulkWriteResult` reports only totals, so the executor knows how many writes lost, not which ones.

On a shortfall (`upsertedCount` or `modifiedCount` below the expected count), `MongoBulkWriteExecutor` replays **every** entry of that kind one at a time through the update manager's `replaceOneAsync` (`DatabaseUpdateManager` / `FastDatabaseUpdateManager`). Each replay re-reads the resource, re-merges and writes again, up to `REPLACE_RETRIES` (10) times. When several requests update the same resource concurrently:

- A resource that already won in the bulk write is replayed, merges to "no change", and is reported `updated: false`, with no history record and no change event.
- Only one writer can move a resource from version N to N+1, so the writes land one at a time, and every request still waiting re-reads, re-merges and writes again after each one.
- Running out of retries throws, and the whole request fails even though the rest of the batch is already committed.

## Approach

The first `bulkWrite` is unchanged. On a shortfall, the executor identifies the losing entries, rebases only those onto the current documents, and writes them in bulk, for at most 3 rounds. A resource still conflicting after the last round gets a per-resource `conflict` issue on its `MergeResultEntry`. Entries that detection classifies as winners are never replayed.

Two classes in `src/dataLayer/concurrency/`:

- `WriteConflictDetector` classifies the entries of one bulk write as winners or losers, and returns the documents it read.
- `ConcurrentWriteResolver` runs the rebase-and-write rounds.

This applies to the writes whose filter misses when a concurrent writer gets there first, in both the regular and the fast-serializer inserters:

| Write | Inserter method | Filter |
|---|---|---|
| `$merge` update (REST `$merge`, GraphQL mutations, `$import`) | `mergeOneAsync` | `{_uuid, 'meta.versionId': previous}` |
| create with a client-supplied id (PUT on a new id, `$merge` / `$import` creates) | `insertOneAsync` | `insertUniqueId` upsert on `_uuid` |

A `mergeOneAsync` write with no previous version (`lastVersionId` missing or `'0'`) filters on `{_uuid}` alone, like the writes in [Preconditions and switches](#preconditions-and-switches).

## Decisions

- **API: `collection.bulkWrite`.** Works on every MongoDB server version, and its `upsertedIds` identify lost creates at no extra cost.
- **Rounds: 3**, configurable with `CONCURRENCY_RESOLUTION_ROUNDS`.
- **Backoff:** full jitter, `random() * CONCURRENCY_RESOLUTION_BACKOFF_MS * 2^(round-1)`, base 25 ms. The worst case adds 175 ms across 3 rounds.
- **Exhaustion: a per-resource issue**, never a thrown error from the executor.
- **HTTP status for a single-resource conflict: 409 Conflict.** `update` (PUT) throws a new `ConflictError` (`src/utils/httpErrors.js`) carrying the issue. A `forbidden` issue from the resolver throws the existing `ForbiddenError` (403).

## Behavior

### Detection

Runs only when the first `bulkWrite` falls short.

**Creates.** An `insertUniqueId` entry is an `updateOne({_uuid}, {$setOnInsert}, {upsert: true})`. The server either inserts the document, and records the operation index in `upserted`, or finds an existing document with that `_uuid` and changes nothing.

| `upsertedIds` | Meaning | Outcome |
|---|---|---|
| has index `i` | this write inserted the document | won |
| no index `i` | a document with this `_uuid` already existed when the write ran | lost; rebased onto that document as an update |

`upsertedIds` keys are operation indices in the original list when the write is ordered, or when every operation is update-kind, so the driver sends a single `update` batch. Resource writes are ordered (`maintainOrder` defaults to `true`; only access and audit logs pass `false`, and they only insert). Every retry round is update-kind only.

**Updates.**

1. `modifiedCount` equals the number of update entries: every update won, and nothing is read. Each versioned replacement carries a new `versionId` and `lastUpdated`, so a successful replace always counts as modified.
2. Otherwise, one `findLatestByUuidsAsync` call reads the update entries and the lost creates: `_uuid $in`, primary read preference, through `DatabaseQueryManager`, so `storageProvider` routing applies. It is a new method; the only fast read today, `fastFindOneAsync`, returns one document. An update **won** if its stored document equals the replacement it sent: `fast-deep-equal` on `FhirResourceWriteSerializer.serialize(deepcopy(toWriteDocument(stored)))` and `FhirResourceWriteSerializer.serialize(deepcopy(replacement))`, with `_id` removed. Both sides go through the write serializer so the same empty-value rules apply to each, and both are copied because the serializers delete properties in place and the replacement is also the document written to history and events. It **lost** if the stored document differs or no longer exists.
3. `toWriteDocument` is the conversion each update manager applies before `collection.replaceOne`: `toJSONInternal()` in `DatabaseUpdateManager` (the class path, `ENABLE_*_FAST_SERIALIZER=false`) and the document as is in `FastDatabaseUpdateManager`. Both paths are covered.

The version number alone can't identify the winner. Two writers that both read version 4 both send version 5, and only one filter matches. After the race the stored document is version 5 with the winner's content, so comparing content tells each entry whether that version 5 is its own.

Detection reads after the write, so a winner can be misclassified. If another writer commits on top of a winner before the detection read, the stored document no longer equals the winner's replacement, and the winner is treated as a loser. Its rebase onto the later document usually finds no change, so it is reported `skipped` and its committed version gets no history record or change event. If the later writer changed a field the winner had set, the rebase writes the winner's value again over the later write. Legacy replays every winner, so both outcomes also happen there, on every shortfall.

### Resolution rounds

For each round, while losers remain:

1. Wait for the backoff.
2. Rebase each loser on the document from the last detection read. The rebase is the same merge the legacy retry runs: `mergeResourceAsync` / `fastMergeResourceAsync` with the entry's `smartMerge`, base64 reconciliation, then `preSaveAsync` on a clone. `insertOneAsync` gains a `smartMerge` parameter (default `true`) that it stores on the entry, and PUT passes `false` for a create, so a PUT that loses its create replaces the stored document as a PUT on an existing resource does.
3. Authorize the rebased write. The request's own checks ran against what it read before its first write, and the rebase writes onto a document another writer changed or created since. So before persisting, the resolver re-runs the update access checks against the rebase target and the fully merged document: `isAccessToResourceAllowedByAccessAndPatientScopes` on the target, then `isAccessTagChangeAllowedByAccessScopes` from the target to the merged document, with `ignoreRemovals` set from the merge mode. These are the same two `ScopesValidator` calls, with the same arguments, that `WriteAllowedByScopesValidator` makes for a found resource. The resolver gets the registered `scopesValidator` through its constructor. The first call runs `preSaveAsync` on the resource it is given, so it gets a copy of the target.
4. Write the rebased losers in one `bulkWrite({ ordered: false })`. A server write error makes the call reject with `MongoBulkWriteError` after the round has run. The resolver catches it, gives each entry at `writeErrors[].index` an `exception` issue, and takes the round's `BulkWriteResult` from `error.result`.
5. Run detection on that write, excluding entries that got a write error. Its read is the next round's rebase base, so each round costs one read and one write.

The round is unordered because its operations don't depend on each other. The inserter keeps one entry per `_uuid` per batch (repeated writes to a resource fold into one entry), so every operation targets a different document. An unordered write attempts every operation even when the server rejects one, so one entry's server-side write error doesn't stop the other losers from committing.

| Loser state at rebase | Result |
|---|---|
| merge finds no change | `skipped` (same as legacy) |
| lost create, document gone again | re-queued as an `insertUniqueId` upsert |
| caller not allowed to update the rebase target or make the merged tag change (step 3) | `forbidden` issue with an `operationOutcome`, as `WriteAllowedByScopesValidator` builds for a 403; the entry is left out of the write |
| update target deleted concurrently | `conflict` issue |
| server-side write error other than duplicate key | `exception` issue on that entry only, from `MongoBulkWriteError.writeErrors[].index` |
| a rebased document over the 16 MB limit | `exception` issue on that entry only. The driver rejects a whole `bulkWrite` on the client when any operation is at or over `maxBsonObjectSize`, without saying which one, so before each round the resolver measures every rebased operation with `BSON.calculateObjectSize` and leaves an oversized entry out of the write |

After the last round, each remaining loser gets a `conflict` issue.

**Uploaded binaries.** A write that does not commit leaves the base64 objects it uploaded unreferenced. The resolver calls `deleteOwnUploadedLiveObjectsAsync` for an entry's last uncommitted write when the entry loses again, before it is rebased (the rebase replaces the upload stash), and when it leaves the loser set without a committed write: `conflict`, `forbidden`, `exception`, oversized, or `skipped`. The call deletes only objects this request uploaded for that write, at `{_uuid}/{lastUpdated}` of the uncommitted version, so committed versions and winners keep theirs. Legacy runs the same call in the `catch` of `replaceOneAsync`.

### Reporting

| Entry outcome | `created` / `updated` | `issue` | History record | Change event |
|---|---|---|---|---|
| won in the first write | as legacy | none | ✅ | ✅ |
| won in a retry round | as legacy | none | ✅ | ✅ |
| rebase found no change | `false` | none | ❌ | ❌ |
| still conflicting after the last round | `false` | `conflict` | ❌ | ❌ |

A lost create is saved as an update of the document another writer created, so the resolver sets its entry to `isCreateOperation: false` and `isUpdateOperation: true` when it rebases it. The executor derives `created` / `updated` and the change event type from those flags, so the entry is reported `updated: true` with event type `U`, and a PUT that loses its create returns 200 instead of 201. Only the request whose create inserted the document reports `created: true` and emits `C`.

For a `skipped` entry, the resolver sets the entry's resource to the stored document from the detection read. PUT returns 200 with that document instead of a 400.

Conflict issue (synthetic ids):

```json
{
    "severity": "error",
    "code": "conflict",
    "details": { "text": "Concurrent update conflict" },
    "diagnostics": "Resource Patient/0b1c2d3e-0000-5000-8000-000000000001 was modified concurrently and could not be saved after 3 attempts",
    "expression": ["Patient/0b1c2d3e-0000-5000-8000-000000000001"]
}
```

### Preconditions and switches

- `If-None-Match: *` is still checked before detection and returns 412 on a lost create.
- `SKIP_HANDLE_CONCURRENCY=true` disables detection, resolution and the one-by-one fallback, as today.
- Writes filtered on `{_uuid}` alone can't lose a version race: `replaceOneAsync` (PUT on an existing resource, PATCH, Group member patch), a `mergeOneAsync` with no previous version, an `updateOne $set`, and a `replaceOne` with `filter: null` from a folded repeat write. Detection reads them with the update entries and counts them as won when their document exists, so they are not replayed. Only an entry whose document is missing keeps the one-by-one path.
- With `If-Match`, a `replaceOneAsync` filter is `{_uuid, 'meta.versionId': {$in}}`, and a miss is a 412.

## Callers

Every issue the executor puts on an entry has `severity: 'error'`, and every caller of `executeAsync` treats an entry with an `issue` as not saved.

| Caller | Handling |
|---|---|
| `$merge` (`merge.js`) | returns the entry with its issue |
| PUT (`update.js`) | `conflict` throws `ConflictError`, `forbidden` throws `ForbiddenError`, other issues keep `BadRequestError`; a `skipped` entry with no issue returns 200 with the stored document |
| `$import` flush (`flushBatchAsync`, `bulkImport/handler.js`) | reads the flush results and records each entry with an issue as a failed line, replacing the created or updated count and audit for that line |
| GraphQL `updateGeneralPractitioner` (`patient.js`) and `updatePreferredProviders` (`careTeam.js`) | check `result[0].issue` as well as `result[0].operationOutcome` |
| `bulkImportTaskStateMachine`, `adminResourceWriter`, `mongoGroupMemberRepository` | already fail on any `issue` |
| POST (`create.js`), PATCH, Group member patch, access and audit loggers | no new issue: POST ids are server-generated, the patches use `replaceOneAsync`, and the loggers only insert |

## Response contract

| Situation | Before | After |
|---|---|---|
| `$merge`: a resource keeps conflicting | whole request 500 `Internal Server Error` | 200; that entry has a `conflict` issue; every other entry is reported, with history and events |
| PUT on a new id: the create keeps losing | 500 | 409 with a `conflict` OperationOutcome |
| GraphQL mutation: the resource keeps conflicting | GraphQL error (500 underneath) | GraphQL error from the resolver's `issue` check |
| `$import`: a resource keeps conflicting | the range fails with `ImportRangeFailed` | that line is reported as failed; the rest of the range is imported |
| a winner in a batch that had a conflict | `updated: false`, no history, no event | `updated: true`, with history and event |
| a create that lost to a concurrent create and was saved as an update (`$merge`, `$import`, PUT on a new id) | `created: true` and event type `C` for every concurrent creator; PUT returns 201 | `updated: true` and event type `U`; PUT returns 200; only the inserting request reports `created` and emits `C` |

## Constraints

- **Tenancy:** the only new read is `_uuid $in`, in the same collection the write used. `_uuid` is derived from the id and `sourceAssigningAuthority`, so a stored document found for a lost create has the same owner. Its access tags and patient can still differ, and a concurrent writer can change the access tags of a document a lost update was authorized against, so every rebased write re-runs the update access checks first (Resolution rounds, step 3).
- **PHI:** none in logs, metrics, issues or fixtures.
- **Public contract:** 500 becomes 409 for a PUT create that keeps losing, 500 becomes a per-entry issue for `$merge`, and a create saved as an update after losing is reported as an update.
- **Events:** schemas unchanged. Winners now emit the change events legacy dropped, and a create saved as an update after losing emits `U` instead of a second `C` for the same resource, which consumers of the change events need to know.
- **Dependencies:** none new; `fast-deep-equal` is already used by `resourceMerger`.
