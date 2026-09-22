---
paths:
  - "**/*.asyncapi.yaml"
  - "**/*.asyncapi.yml"
  - "**/*.asyncapi.json"
  - "**/events/**"
  - "**/schemas/**"
  - "**/*.avsc"
  - "**/*.proto"
  - "**/kafka/**"
  - "**/*.graphql"
  - "**/*.graphqls"
---

# Distributed Systems & Event Contracts

### Sagas, Not Distributed Transactions
Multi-service workflows use the saga pattern with compensating actions for rollback. Each step publishes an event on success; each step has a defined compensation if a downstream step fails. There is no distributed transaction coordinator. If you are implementing a saga:
- Each step must be independently completable and compensatable.
- Compensating actions must be idempotent (they may execute more than once).
- Use Kafka topics for saga events. Do not use synchronous callback chains disguised as a saga.
- The saga must be resilient to out-of-order delivery and duplicate events.
- Document the saga flow, including the compensation path, in an ADR.

### Kafka Usage Patterns
- Use CloudEvents envelope format for event metadata.
- Partition keys must ensure ordering for the same entity (typically entity ID or tenant + entity ID).
- Consumers must be idempotent. Assume at-least-once delivery.
- Use consumer groups appropriately for scaling. Understand that repartitioning affects ordering guarantees.
- Dead letter topics for messages that fail processing after retries.
- Do not use Kafka as a request-reply mechanism. That is synchronous communication disguised as async.

### Stateful Stream Processing
Use Kafka Streams with a RocksDB state store for consumer state — deduplication, windowing, aggregation, joins. Do not use external datastores (Caffeine, Redis, MongoDB, PostgreSQL) for Kafka consumer state: state belongs co-located with partition assignment and made fault-tolerant via changelog topics. For the dedup-durability rule specifically, see `standards/events.md#std-events-idempotency`.

### Schema Evolution
Additive changes only unless there is an explicit exception with a migration plan approved by EA. Do not remove fields, rename fields, or change field types on existing events.

### Contract Co-Location
If you add or modify an event, update the AsyncAPI specification (or the canonical contract definition) as part of the same change. Do not ship event changes without updating the contract.

### Schema and Client Resilience
Assume clients may receive unknown enum values and new fields at any time. Design for forward compatibility. Do not write exhaustive enum switches without a default/unknown handler. Do not fail on unrecognized fields. GraphQL schema evolution and event schema evolution must be additive - new fields and enum values must not break existing consumers.

For new event schemas, also see the `kafka-event-design` skill.