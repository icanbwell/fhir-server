# Concurrency Support
This FHIR server runs as many parallel containers, so writes to the SAME resource can be processed by different requests at the same time.

## Version check
Every write is built from the version of the resource the request read, and carries the next version number. Its filter only matches while the stored document is still at the version it was built from:

| Write | Filter |
|---|---|
| `$merge` update | `{_uuid, 'meta.versionId': <version it was built from>}` |
| create with a client-supplied id (PUT on a new id, `$merge` / `$import` creates) | upsert on `{_uuid}` with `$setOnInsert` |

Example: the stored document is at version 3 and requests A and B both read it. Both send version 4 with the filter `meta.versionId: "3"`. A commits first, so the stored document is now version 4. B's filter matches nothing, so A's change is never overwritten, and B goes through the process below.

## Process
The FHIR server writes inserts and updates in bulk, one `collection.bulkWrite` per collection.

1. The request loads the current resources and merges its changes onto them. Resources whose merge finds no change are skipped.
2. It sends one `bulkWrite`. If `upsertedCount` and `modifiedCount` match the expected counts, no write lost a race and the request is done.
3. Otherwise `WriteConflictDetector` finds the entries that lost:
    - a create lost when its operation index is not in `upsertedIds`: a document with that `_uuid` already existed.
    - an update lost when its stored document, read once for all update entries (`_uuid $in`, primary), is at another version, differs from the replacement it sent, or no longer exists. The version number alone can't tell: two writers that read version 4 both send version 5, so the detector compares content.
    - when `matchedCount` leaves no match for the versioned updates, a stored document equal to one of them is another request's identical write, so that update lost too.
    - a `{_uuid}`-only write lost when its document no longer exists.
4. `ConcurrentWriteResolver` retries only the losers, for up to 3 rounds. Each round:
    1. waits a random time between 0 and `25 ms × 2^(round - 1)`, so requests that lost together don't retry in lockstep.
    2. checks that the caller may update the stored document from the last detection read, because another writer changed or created it after the request's own checks ran.
    3. rebases each loser onto that document, with the same merge as the original write, and checks the access tags it changes. A lost create becomes an update of the document that won.
    4. writes the rebased losers in one unordered `bulkWrite`, then runs detection on that write.
5. An entry that still loses after the last round gets a `conflict` issue. Other outcomes for a loser:

| Loser state at rebase | Result |
|---|---|
| merge finds no change | skipped, reported with the stored document |
| update target deleted concurrently | `conflict` issue |
| caller not allowed to update the rebase target (checked before a no-change skip) | `forbidden` issue |
| server write error, or rebased document over 16 MB | `exception` issue on that entry only |

Every other entry in the batch is saved and reported with its history record and change event. Base64 objects uploaded for a write that never committed are deleted.

## Responses
| Operation | A resource still conflicting after the last round |
|---|---|
| `$merge` | 200, with the `conflict` issue on that entry |
| PUT | 409 with a `conflict` OperationOutcome (403 for a `forbidden` issue) |
| `$import` | the line is recorded as failed and the rest of the range imports. A lost create saved as an update, or skipped, is counted updated |
| GraphQL mutations | GraphQL error |

## Preconditions and settings
- `If-Match`: an update whose version check fails returns 412. `If-None-Match: *` on a lost create returns 412.
- Writes filtered on `{_uuid}` alone (PUT and PATCH on an existing resource, Group member patch) can't lose a version race. One whose document was deleted concurrently gets a `conflict` issue (409 for PUT); it is not recreated.
- `CONCURRENCY_RESOLUTION_ROUNDS` (default 3) and `CONCURRENCY_RESOLUTION_BACKOFF_MS` (default 25) tune the rounds. `SKIP_HANDLE_CONCURRENCY=true` turns detection and resolution off.
- Each resolution logs one `Resolved concurrent writes` line with the count of each outcome and the uuids that were not saved. At `LOGLEVEL=DEBUG` or `TRACE`, each round also logs a `concurrentWriteResolution_<resourceType>` system event with the uuids still pending.

## Code
- [mongoBulkWriteExecutor.js](../src/dataLayer/bulkWriteExecutors/mongoBulkWriteExecutor.js): the bulk write and the shortfall check
- [writeConflictDetector.js](../src/dataLayer/concurrency/writeConflictDetector.js)
- [concurrentWriteResolver.js](../src/dataLayer/concurrency/concurrentWriteResolver.js)

## Tests
- [src/tests/unit/dataLayer/concurrency/](../src/tests/unit/dataLayer/concurrency/)
- [src/tests/integration/merge/bulk_concurrency_resolution/](../src/tests/integration/merge/bulk_concurrency_resolution/)
- [src/tests/integration/update/put_concurrency/](../src/tests/integration/update/put_concurrency/)
