# AuditEvent Archive to ClickHouse Migration — Design Spec

**Date:** 2026-04-10
**Goal:** Migrate 55TB of AuditEvent data from Atlas Online Archive (via Data Federation) to ClickHouse with zero data loss, verified per-day partition counts.

## Context

- 55TB of AuditEvent data in Atlas Online Archive (Jan 2022 - Mar 2026)
- Accessible via Atlas Data Federation federated connection string
- Target ClickHouse `fhir.audit_event` table (ReplacingMergeTree) already exists
- Want fast completion (days, not weeks) with load tolerance on Atlas Data Federation
- Network connectivity exists between migration host and both Atlas + ClickHouse

## Architecture

**Approach:** Direct stream — MongoDB cursor -> Transform -> ClickHouse batch insert

A standalone Node.js migration script that:

1. Connects to Atlas Data Federation via MongoDB driver (`--federation-url`)
2. Connects to ClickHouse via existing `ClickHouseClientManager`
3. Processes ~1,553 daily partitions with 6 concurrent workers (configurable)
4. Each worker: opens cursor filtered by `recorded` date range, streams in 100K-doc batches, transforms via `AuditEventTransformer`, batch-inserts into `fhir.audit_event`
5. Tracks per-partition progress in ClickHouse state table (`fhir.audit_event_migration_state`)
6. After all partitions complete, runs per-day count verification (source vs ClickHouse)

## State Management

ClickHouse `MergeTree` table with `ALTER TABLE UPDATE` mutations for state transitions:

```
pending -> in_progress -> completed
                       -> failed (retryable via --resume)
```

Each batch checkpoint updates `last_mongo_id` for resume safety.

## Daily Partitions (not monthly)

- ~1,553 days gives finer granularity for parallelism and resume
- ~35GB/day average instead of ~1TB/month
- Better verification granularity
- If one day fails, only ~35GB needs retry

## Verification

Per-day count match: `countDocuments()` from Atlas vs `SELECT count() FROM fhir.audit_event FINAL WHERE toDate(recorded) = ?`

## Files

| File | Purpose |
|------|---------|
| `clickhouse-init/03-audit-event-migration-state.sql` | State table DDL |
| `src/scripts/migrate_audit_events_to_clickhouse.js` | CLI entry point + worker pool |
| `src/scripts/lib/migrationStateManager.js` | ClickHouse state table CRUD |
| `src/scripts/lib/auditEventTransformer.js` | MongoDB doc -> ClickHouse row |
| `src/scripts/lib/partitionWorker.js` | Single-day cursor -> transform -> insert |
| `src/scripts/lib/migrationVerifier.js` | Per-day count verification |
| `src/tests/scripts/migrate_audit_events_to_clickhouse.test.js` | Unit tests |

## CLI Interface

```bash
node src/scripts/migrate_audit_events_to_clickhouse.js \
  --federation-url "mongodb+srv://..." \
  --start-date 2022-01-01 \
  --end-date 2026-04-01 \
  --batch-size 100000 \
  --concurrency 6 \
  --dry-run | --verify-only | --resume
```

## Error Handling

- Batch insert: 3x retry with exponential backoff
- Cursor timeout: partition marked `failed`, resumable via `last_mongo_id`
- Worker crash: other workers continue, failed partition retried on `--resume`

## Alternatives Considered

1. **Export to NDJSON files then ClickHouse import** — requires 55TB+ intermediate disk, two-phase process
2. **ClickHouse mongodb() table function** — limited BSON support, no transformation control, fragile at scale
