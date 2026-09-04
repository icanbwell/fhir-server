---
paths:
  - "**/*.py"
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.java"
  - "**/*.kt"
  - "**/*.go"
---

# Operational Realism

Services run in a distributed environment, fail independently, and must handle partial failures gracefully.

### Timeouts and Retries
Every external call must have an explicit timeout. Retries must use exponential backoff with jitter. Do not use unbounded retries. Implement DLQ (dead letter queue) patterns for messages that fail after retry exhaustion.

### Circuit Breakers
Use circuit breaker patterns for synchronous calls to external services. When a dependency is failing, fail fast rather than accumulating blocked threads and cascading the failure upstream.

### Performance Awareness
Do not introduce "fetch the entire record" behavior unless it is an explicit, reviewed decision. Be aware of N+1 query patterns, unbounded list fetches, and full-collection scans. Healthcare records can be large - assume they are. In a microservice architecture, a single slow query can cascade through downstream consumers via backpressure.

### Observability Is a Deliverable
OpenTelemetry tracing propagation must be maintained across service boundaries. Trace context must flow through Kafka headers, HTTP headers, and any other transport. Logs must be structured (JSON) with correlation IDs. Metrics must be meaningful, not just counters. If you add a new service interaction or failure mode, add the corresponding observability. In a distributed system, observability is how you debug production - it is not optional.