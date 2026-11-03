# Write retry path optimization - Design

## Problem

Resource writes queued through `DatabaseBulkInserter` / `FastDatabaseBulkInserter` are written per collection in one `collection.bulkWrite` with optimistic concurrency. A `$merge` update is a `replaceOne` filtered on `{_uuid, 'meta.versionId': <previous>}`, and every create is an `updateOne {_uuid} $setOnInsert` upsert. When a concurrent writer changes a resource first, that resource's filter matches nothing. `BulkWriteResult` reports only totals, so the executor knows how many writes lost, not which ones.

On a shortfall (`upsertedCount` or `modifiedCount` below the expected count), `MongoBulkWriteExecutor` replays **every** entry of that kind one at a time through the update manager's `replaceOneAsync` (`DatabaseUpdateManager` / `FastDatabaseUpdateManager`). Each replay re-reads the resource, re-merges and writes again, up to `REPLACE_RETRIES` (10) times. On the local stack, with 7 concurrent `$merge` requests updating the same Patient:

- A resource that already won in the bulk write is replayed, merges to "no change", and is reported `updated: false`, with no history record and no change event.
- Only one writer can move a resource from version N to N+1, so the 7 writes landed one at a time (v2 to v8), and every request still waiting re-read, re-merged and wrote again each time.
- Running out of retries throws, and the whole request fails even though the rest of the batch is already committed.

## Approach

The first `bulkWrite` is unchanged. On a shortfall, the executor identifies the losing entries, rebases only those onto the current documents, and writes them in bulk, for at most 3 rounds. A resource still conflicting after the last round gets a per-resource `conflict` issue on its `MergeResultEntry`. Winners are never replayed.

Two classes in `src/dataLayer/concurrency/`:

- `WriteConflictDetector` classifies the entries of one bulk write as winners or losers, and returns the documents it read.
- `ConcurrentWriteResolver` runs the rebase-and-write rounds.

This applies to the writes whose filter misses when a concurrent writer gets there first, in both the regular and the fast-serializer inserters:

| Write | Inserter method | Filter |
|---|---|---|
| `$merge` update (REST `$merge`, GraphQL mutations, `$import`) | `mergeOneAsync` | `{_uuid, 'meta.versionId': previous}` |
| create with a client-supplied id (PUT on a new id, `$merge` / `$import` creates) | `insertOneAsync` | `insertUniqueId` upsert on `_uuid` |

## Decisions

- **API: `collection.bulkWrite`.** Works on every MongoDB server version, and its `upsertedIds` identify lost creates at no extra cost.
- **Rounds: 3**, configurable with `CONCURRENCY_RESOLUTION_ROUNDS`.
- **Backoff:** full jitter, `random() * CONCURRENCY_RESOLUTION_BACKOFF_MS * 2^(round-1)`, base 25 ms. The worst case adds 175 ms across 3 rounds.
- **Exhaustion: a per-resource issue**, never a thrown error from the executor.
- **HTTP status for a single-resource conflict: 409 Conflict.** `update` (PUT) throws a new `ConflictError` (`src/utils/httpErrors.js`) carrying the issue.

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
2. Otherwise, one `findLatestByUuidsAsync` call (`_uuid $in`, primary read preference, through `DatabaseQueryManager`, so `storageProvider` routing applies) reads the update entries and the lost creates. An update **won** if its stored document equals the replacement it sent: `fast-deep-equal` on `normalize(toWriteDocument(stored))` and `normalize(replacement)`, where `normalize` drops `_id` and every `null`/`undefined` value (the driver stores `undefined` as `null`). It **lost** if the stored document differs or no longer exists.

The version number alone can't identify the winner. Two writers that both read version 4 both send version 5, and only one filter matches. After the race the stored document is version 5 with the winner's content, so comparing content tells each entry whether that version 5 is its own.

### Resolution rounds

For each round, while losers remain:

1. Wait for the backoff.
2. Rebase each loser on the document from the last detection read. The rebase is the same merge the legacy retry runs: `mergeResourceAsync` / `fastMergeResourceAsync` with `smartMerge: true`, base64 reconciliation, then `preSaveAsync` on a clone.
3. Write the rebased losers in one `bulkWrite({ ordered: false })`.
4. Run detection on that write. Its read is the next round's rebase base, so each round costs one read and one write.

The round is unordered because its operations don't depend on each other. The inserter keeps one entry per `_uuid` per batch (repeated writes to a resource fold into one entry), so every operation targets a different document. An unordered write attempts every operation even when one fails, so one entry's write error doesn't stop the other losers from committing.

| Loser state at rebase | Result |
|---|---|
| merge finds no change | `skipped` (same as legacy) |
| lost create, document gone again | re-queued as an `insertUniqueId` upsert |
| update target deleted concurrently | `conflict` issue |
| write error other than duplicate key (for example the 16 MB document limit) | `exception` issue on that entry only |

After the last round, each remaining loser gets a `conflict` issue, and the binaries it uploaded are deleted with `deleteOwnUploadedLiveObjectsAsync`.

### Reporting

| Entry outcome | `created` / `updated` | `issue` | History record | Change event |
|---|---|---|---|---|
| won in the first write | as legacy | none | ✅ | ✅ |
| won in a retry round | as legacy | none | ✅ | ✅ |
| rebase found no change | `false` | none | ❌ | ❌ |
| still conflicting after the last round | `false` | `conflict` | ❌ | ❌ |

A lost create applied as an update keeps `created: true` and event type `C`, matching legacy.

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
- `replaceOneAsync` entries (PUT on an existing resource, PATCH, Group member patch) keep the one-by-one path. Their filter is `{_uuid}`, or `{_uuid, 'meta.versionId': {$in}}` with `If-Match`, where a miss is a 412.
- Entries whose operation shape detection can't classify (`updateOne $set`, or a `replaceOne` with `filter: null` from a folded repeat write) keep the one-by-one path.

## Response contract

| Situation | Before | After |
|---|---|---|
| `$merge`: a resource keeps conflicting | whole request 500 `Internal Server Error` | 200; that entry has a `conflict` issue; every other entry is reported, with history and events |
| PUT on a new id: the create keeps losing | 500 | 409 with a `conflict` OperationOutcome |
| GraphQL mutation: the resource keeps conflicting | GraphQL error (500 underneath) | GraphQL error with the conflict diagnostics |
| a winner in a batch that had a conflict | `updated: false`, no history, no event | `updated: true`, with history and event |

## Constraints

- **Tenancy:** the only new read is `_uuid $in` over entries the request already loaded and authorized, in the same collection the write used.
- **PHI:** none in logs, metrics, issues or fixtures.
- **Public contract:** 500 becomes 409 for a PUT create that keeps losing, and 500 becomes a per-entry issue for `$merge`. Needs a Tech Design Review as a public API change.
- **Events:** schemas unchanged. Winners now emit the change events legacy dropped.
- **Dependencies:** none new; `fast-deep-equal` is already used by `resourceMerger`.
