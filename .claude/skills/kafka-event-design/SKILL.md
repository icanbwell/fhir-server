---
name: kafka-event-design
description: Use when designing a Kafka event or topic, writing a producer or consumer, defining an event payload/schema, or choosing partition keys and counts at b.well. Applies the real event standard and the key/partition decision procedure (not a one-size formula), and generates a CloudEvents + AsyncAPI-conformant contract.
---

# Kafka Event Design

You generate event contracts that follow b.well's real conventions and, crucially, you help the author **reason about keys and partitions** rather than pasting a formula. Event contracts are harder to change than APIs — get naming, keys, and schema right the first time.

The conventions are in the substrate — read and cite them, don't restate them:
- **Rules:** `standards/events.md` (topic naming, event-vs-command, CloudEvents, idempotency, evolution, DLQ, outbox) — cite anchors like `#std-events-partition-key`.
- **Key/partition decision procedure:** `patterns/event-key-and-partition-design.md` (`#pat-event-key`) — the ordering-unit → cardinality → two-tier → count → re-key steps.
(Both live in `icanbwell/.github` if not in the current repo.)

## First, get the naming and direction right

- **Topic:** `<domain>.<sub-domain>.events` for facts, `<domain>.<sub-domain>.commands` for directives — kebab-case, **no underscores**, owned by the **producer's** bounded context (`#std-events-topic-naming`, `#std-events-topic-ownership`). (Note: the old `{domain}.{entity}.{action}` form and `patient.updated` examples are superseded by this — don't copy them.)
- **Event vs command** (`#std-events-event-vs-command`): a *fact* is past-tense PascalCase (`AppointmentBooked`); a *command* is imperative PascalCase (`BundleData`). A scheduled trigger is an **event** the scheduler owns, not a command.
- **`ce_type`:** reverse-DNS `com.bwell.<domain>.<name>`, `.vN` on breaking changes, independent of the topic name.

## Then, design the key and partition count (don't hand out a formula)

Walk `patterns/event-key-and-partition-design.md`:
1. **Ordering unit** — the smallest entity whose events must stay ordered → the key, always tenant-prefixed (`tenant:<t>:<entity>:<id>`).
2. **Cardinality/skew** — reject low-cardinality or single-super-entity keys (they hot-spot); estimate the busiest key.
3. **Two-tier** for scatter-gather — fan-out by the work-unit id, fan-in by `hash(job+unit)`, lifecycle by the job id (the orchestrator model).
4. **Partition count** — the parallelism ceiling (consumers ≤ partitions), effectively write-once; size for the *estate*; co-partition input/output/changelog for joins.
5. **Re-keying** forces a repartition; **no external lookups inside a stream processor.**

Only after this is settled do you emit a key. Never just print `tenant:X:entity:Y` as "the answer."

## Generate the contract

Produce: the **CloudEvents 1.0** envelope over binary Kafka headers (required `ce_*` + `traceparent`, `#std-events-cloudevents`), the payload schema (Avro/JSON Schema), and co-locate it in the producing service's `src/main/resources/asyncApi.yaml` (AsyncAPI v3, the source-of-truth contract). Payload carries references/ids + tenant + actor + timestamp + schema version — **not** a full snapshot, **not** PHI beyond what's needed, **not** a work batch.

## Consumer requirements (non-negotiable — this is where incidents happen)

- **Idempotent under redelivery** (`#std-events-idempotency`): dedup on `ce_id` / upsert / search-before-create. **Durable** dedup only — in-memory/Caffeine dedup is wiped on deploy/rebalance and silently leaks dupes (four teams hit this; INE-968).
- **Never swallow exceptions** — re-throw so it hits the **DLQ** (`<topic>.dlq`, PHI-safe: ids + error metadata only, `#std-events-dlq`); bad config is graceful-skip+alert, not silent retry-drop (INE-979).
- **Idempotency key on external side-effects** (HAX-45: duplicate vendor submissions).
- **Consumer group** `{service}-{purpose}`, one per purpose (`#std-events-consumer-groups`); isolate resource pools per workload class (INE-939 backpressure).

## Evolution & anti-patterns

- **Additive-only** (`#std-events-evolution`); breaking change = new `.vN` topic/type + migration; include a `schemaVersion`.
- **Never request-reply over Kafka** (`#std-events-no-request-reply`); for audited writes use the **transactional outbox** (`#std-events-outbox`); for long-running work see `patterns/orchestrated-long-running-work.md`.
- Capability-not-vendor names (no `databricks`/vendor in a topic or type).

(Redpanda schema-registry validation is aspirational until the registry is available; until then the AsyncAPI file is the contract.)
