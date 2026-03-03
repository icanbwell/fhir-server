# icanbwell - AI Agent Instructions

> **Scope:** Organization-wide baseline. Applies to all repositories in the icanbwell GitHub organization.
> **Owner:** Enterprise Architecture (@bwell/enterprise-architecture)
> **Precedence:** This file sets the floor. Repo-level instruction files (copilot-instructions.md, CLAUDE.md) may add stricter requirements or repo-specific context but must not weaken or contradict these directives. If there is a conflict, this baseline wins. Repo-level overrides may only tighten rules, never loosen them. Any true exception to this baseline requires EA approval with documented rationale, scope, owner, JIRA ticket, and expiry date.

---

## Platform Identity

You are working in the icanbwell GitHub organization. b.well is a cloud-native, multi-tenant, microservice-based, event-driven distributed system. It is a healthcare data platform operating under HIPAA compliance requirements. The platform is FHIR-native and exposes capabilities through a federated GraphQL gateway.

This is a distributed system. Design accordingly. Services are independently deployable, communicate asynchronously by default, and own their private datastores. The shared platform system-of-record is the FHIR server, accessed only via approved APIs and contracts (FHIR APIs, federated graph, events). Workflows that span multiple services use sagas and event choreography, not distributed transactions or synchronous orchestration chains.

Treat these as hard constraints, not suggestions. Code that violates tenant isolation, leaks PHI, bypasses the gateway, introduces unapproved technology, or creates tight coupling between services is incorrect regardless of whether it compiles and passes tests.

---

## Architecture Non-Negotiables

### Event-Driven First
Default to asynchronous communication via Kafka with CloudEvents. If you are choosing a synchronous call between services, document why asynchronous does not work. Do not default to REST calls for cross-service workflows. Synchronous service-to-service calls create temporal coupling - the caller blocks, the callee must be available, and cascading failures propagate. Use sync only for queries where the response is needed immediately to serve a user request and the data cannot be pre-materialized.

### Distributed Systems Patterns

**Sagas, not distributed transactions.** Multi-service workflows use the saga pattern with compensating actions for rollback. Each step publishes an event on success; each step has a defined compensation if a downstream step fails. There is no distributed transaction coordinator. If you are implementing a saga:
- Each step must be independently completable and compensatable.
- Compensating actions must be idempotent (they may execute more than once).
- Use Kafka topics for saga events. Do not use synchronous callback chains disguised as a saga.
- The saga must be resilient to out-of-order delivery and duplicate events.
- Document the saga flow, including the compensation path, in an ADR.

**Choreography over orchestration for cross-service workflows.** Services react to events they care about rather than being directed by a central orchestrator. If you find yourself building a service whose sole purpose is calling other services in sequence and waiting for responses, you are building synchronous orchestration. Redesign it as event choreography where each service publishes domain events and downstream services subscribe. Orchestration is acceptable within a bounded context when it stays async, avoids request-reply chains, and does not become a cross-domain god orchestrator. If orchestration crosses domain boundaries or requires request-reply chains to function, redesign it as choreography.

**Service data ownership.** Services must not read from or write to another service's private datastore directly. The platform system-of-record is the FHIR server; services interact with it through approved APIs and contracts (FHIR APIs, federated graph, events), not by directly accessing its underlying storage. If you need data owned by another service, consume it via events (preferred) or query it via the service's public API. No shared private databases between services.

**Kafka usage patterns:**
- Use CloudEvents envelope format for event metadata.
- Partition keys must ensure ordering for the same entity (typically entity ID or tenant + entity ID).
- Consumers must be idempotent. Assume at-least-once delivery.
- Use consumer groups appropriately for scaling. Understand that repartitioning affects ordering guarantees.
- Dead letter topics for messages that fail processing after retries.
- Do not use Kafka as a request-reply mechanism. That is synchronous communication disguised as async.

**Eventually consistent, not immediately consistent.** In a distributed system, cross-service data will be eventually consistent. Design read paths and user experiences to accommodate this. Do not build features that assume immediate consistency across service boundaries. If strong consistency is required within a bounded context, that logic belongs in a single service.

### FHIR-Native Data Modeling
Use standard FHIR resources before inventing custom schemas. Model workflow state using FHIR-native resources where applicable. Extensions are a last resort - if you need one, flag it as an architectural decision requiring review, not a casual convenience.

FHIR data modeling decisions go through the FDR (FHIR Design Review) process. If your change introduces new FHIR resource usage or modifies how existing resources are structured, reference the relevant FDR or flag that one is needed.

### Federated GraphQL Gateway
Client-facing capabilities go through the federated graph. Do not create point-to-point service APIs that bypass the gateway for client access. Public API changes and schema evolution require breaking-change discipline and a Tech Design Review.

### Tenant Isolation
Tenant isolation is mandatory on every persistence model and every query path. This is a correctness constraint, not a best-effort optimization. Every read and write must enforce tenant ownership boundaries. If you are adding a new data access path, verify tenant filtering is present. If you cannot confirm it, flag it.

### No Unapproved Technology
Do not introduce new datastores, caches, queues, search engines, observability sinks, vendors, or significant libraries without checking `approved-tech.yaml` first. The approved technology list lives in the org-level `icanbwell/.github` repository and is distributed to repos via the policy sync workflow. If the technology is not listed, the change requires a Tech Design Review with EA. Infrastructure changes go through Terraform PRs - never provide console instructions or manual steps as the solution.

---

## Object-Oriented Analysis and Design

### Composition Over Inheritance
Build behavior by composing small, focused objects. Do not build deep class hierarchies. If you are extending a base class, evaluate whether delegation or composition would be cleaner. Keep inheritance to a maximum of two levels. If you are going deeper, refactor to composition.

### Program to Interfaces, Not Implementations
Define behavior through protocols (Python), interfaces (TypeScript/Java), or abstract base classes. Consumers depend on the abstraction, never the concrete class. Use structural typing (Python Protocol, TypeScript interfaces) to define contracts. Favor protocols over subclassing.

### Vendor Integrations Behind Abstractions
When integrating a vendor or third-party service, define an interface for the *capability* the vendor provides, not the vendor itself. The vendor is an implementation detail behind an adapter. If the vendor changes tomorrow, the blast radius should be one adapter, not every file that touches that capability.

Bad: `ValidicDeviceDataService`, `ValidicClient`, `ValidicTransformer` spread across the codebase.
Good: `DeviceDataProvider` interface with a `ValidicDeviceDataAdapter` as the concrete implementation.

### Encapsulate What Varies
Identify what changes and isolate it behind an interface. Use the Strategy pattern when behavior varies based on context - inject a strategy rather than adding conditionals or subclass overrides. Use the Template Method pattern when the overall algorithm is fixed but individual steps vary.

### No God Objects
If a class has more than one axis of change or knows about too many concerns, decompose it. Single Responsibility applies at the class level, not just the method level.

### Value Objects for Domain Concepts
Use immutable value types for concepts like identifiers, measurements, date ranges, and money. Equality by value, not identity. Use frozen dataclasses (Python), readonly types (TypeScript), or records (Java).

### Law of Demeter
Do not chain through objects. If you are writing `a.b.c.doThing()`, something is leaking its internals. Ask, don't reach.

---

## SOLID Principles

### Single Responsibility
One reason to change per class or module. If a function does transformation AND persistence, split it. If a service handles both business logic and infrastructure concerns, separate them.

### Open/Closed
Extend behavior through new classes, not by modifying existing ones. No growing conditional chains - use strategy pattern or composition for extensibility.

### Liskov Substitution
Any implementation of an interface must be fully swappable without breaking callers. Do not override methods to throw NotImplementedError or silently change expected behavior.

### Interface Segregation
Keep interfaces small and focused. If a consumer only needs read access, do not force it to depend on an interface that also includes write methods. Split large interfaces into focused ones.

### Dependency Inversion
Depend on abstractions at module and service boundaries. Inject dependencies through constructors. Never instantiate infrastructure inside business logic. Never use service locators when constructor injection is available.

---

## Architectural Boundaries

### Separate Domain from Infrastructure

Keep business logic independent of frameworks, databases, and external services. Domain logic should not import infrastructure concerns. Infrastructure adapts to domain interfaces, not the other way around.

In repos using ports and adapters (hexagonal architecture), respect the layering:
- **Domain layer**: Business logic, domain models, port interfaces. No infrastructure imports.
- **Application layer**: Use case orchestration, service interfaces. Coordinates domain and ports.
- **Infrastructure layer**: Adapters implementing ports (database, HTTP clients, message brokers, vendor integrations).

If the repo does not use explicit hexagonal structure, follow the principle spiritually: domain code exposes interfaces, infrastructure code implements them. Do not let database schemas, REST frameworks, or vendor SDKs leak into business logic.

---

## General Design Principles

### DRY, Pragmatically
Prefer duplication over the wrong abstraction. Extract shared logic only when the pattern is stable and repeats across multiple call sites, or when there is clear semantic reuse. Premature abstraction creates coupling that is harder to undo than duplicated code. If you are unsure whether to extract, leave it duplicated until the pattern is clear.

### Explicit Over Clever
Readable code over compact code. Name things for what they do, not how they are implemented. Prefer explicit types and contracts at boundaries over inference.

### Fail Fast
Validate inputs at the boundary and reject early. Do not let bad data propagate through layers. Typed and structured errors at boundaries, not stringly-typed error messages or raw exception forwarding.

### No Hidden Global State
All dependencies must be explicit and injectable. No module-level singletons that hold state. No implicit service locators.

### Idempotency by Default
Any consumer that processes events or handles retries must be idempotent. This is not optional in a distributed system with at-least-once delivery. Duplicate processing must produce the same result. Use idempotency keys, deduplication checks, or upsert semantics. Design every Kafka consumer, webhook handler, and retry-capable operation with the assumption that it will be called more than once with the same input.

### Minimal Diff
Make the smallest change that satisfies the requirement. Do not rename, reformat, or reorganize unrelated code in the same PR. Do not refactor modules you were not asked to change. Scope the change to what was requested.

---

## Modern, Idiomatic Code

Use current language idioms for the repo's language version. Do not write legacy-style code.

**Java:** Use records for data carriers, not POJOs with boilerplate getters/setters. Use sealed interfaces for closed type hierarchies. Use pattern matching where available. Use `var` for local variables when the type is obvious from the right side. Use streams and Optional appropriately, not for every operation.

**Python:** Use dataclasses or Pydantic models, not manual dict manipulation. Use type hints everywhere. Use structural pattern matching (3.10+) where it improves clarity. Use `Protocol` for structural typing. Use `async`/`await` for IO-bound operations in async services.

**TypeScript:** Use discriminated unions for variant types, not type casting chains. Use strict mode. Use `readonly` and `as const` where appropriate. Use modern `satisfies` operator for type-safe object literals. Use optional chaining and nullish coalescing instead of manual null checks.

---

## Security

### PHI/PII Protection
Never put PHI or PII in logs, test fixtures, example payloads, comments, commit messages, PR descriptions, or screenshots. Use synthetic or redacted data by default. If you need realistic test data, use a generator that produces synthetic records.

### Authentication and Authorization
All auth flows use OAuth/OIDC. No custom authentication schemes. No hardcoded credentials, tokens, or secrets in code, configuration files, or tests.

---

## Testing

### Testing Is Part of the Change
Every behavioral change ships with tests. Tests are not a follow-up task.

### Parameterized Tests
Use parameterized tests (Jest `test.each`, pytest `@pytest.mark.parametrize`, JUnit `@ParameterizedTest`) for any function with more than two input variations. Data-driven test cases, not copy-pasted test methods with one value changed.

### Arrange-Act-Assert
Structure every test with clear setup, execution, and verification phases. One behavior per test. Multiple asserts are fine when they verify that single behavior.

### Mock Only at External Boundaries
Mock external services, databases, and third-party APIs. Do not mock internal implementation details. If you need extensive mocking to test a unit, the design is too coupled - fix the design, not the test.

### Test Error Paths
Test failure modes, error handling, retries, and edge cases explicitly. Do not test only the happy path.

### Contract Tests at Boundaries
API request/response shapes, event schemas, and external integration contracts must have contract tests. When you change a public API or event schema, update the contract test in the same PR.

### Tenant Isolation in Integration Tests
Integration tests must verify that tenant boundaries are enforced. Cross-tenant data leakage is a correctness bug, not a nice-to-have test case.

### Test Behavior, Not Implementation
Assert on what happened, not how it happened internally. Tests should survive refactoring of internals without breaking.

---

## Event Contracts

Event schemas are real contracts with consumers. Treat them accordingly.

### Schema Evolution
Additive changes only unless there is an explicit exception with a migration plan approved by EA. Do not remove fields, rename fields, or change field types on existing events.

### Contract Co-Location
If you add or modify an event, update the AsyncAPI specification (or the canonical contract definition) as part of the same change. Do not ship event changes without updating the contract.

---

## Operational Realism

Services run in a distributed environment, fail independently, and must handle partial failures gracefully.

### Timeouts and Retries
Every external call must have an explicit timeout. Retries must use exponential backoff with jitter. Do not use unbounded retries. Implement DLQ (dead letter queue) patterns for messages that fail after retry exhaustion.

### Circuit Breakers
Use circuit breaker patterns for synchronous calls to external services. When a dependency is failing, fail fast rather than accumulating blocked threads and cascading the failure upstream.

### Performance Awareness
Do not introduce "fetch the entire record" behavior unless it is an explicit, reviewed decision. Be aware of N+1 query patterns, unbounded list fetches, and full-collection scans. Healthcare records can be large - assume they are. In a microservice architecture, a single slow query can cascade through downstream consumers via backpressure.

### Observability Is a Deliverable
OpenTelemetry tracing propagation must be maintained across service boundaries. Trace context must flow through Kafka headers, HTTP headers, and any other transport. Logs must be structured (JSON) with correlation IDs. Metrics must be meaningful, not just counters. If you add a new service interaction or failure mode, add the corresponding observability. In a distributed system, observability is how you debug production - it is not optional.

---

## Architecture Decision Records

When you make a non-trivial implementation decision - choosing a caching strategy, selecting a library, picking an architectural pattern for a new component, deciding between implementation approaches - create an ADR in the repo's `adrs/` directory.

### When to Write an ADR
- Introducing a new dependency or library
- Choosing between competing implementation approaches (e.g., Caffeine vs. Kafka Streams/RocksDB for state management)
- Adding a new architectural pattern not previously used in the repo
- Making a significant trade-off that future developers will need to understand

### ADR Discipline
Use the MADR (Markdown Any/Architectural Decision Records) format from https://adr.github.io/madr/. The canonical template is in the repo's `adrs/` directory or in the org-wide `.github` repository. Show your work. The value of an ADR is the options considered and the reasoning, not just the conclusion. A reviewer should be able to understand why you chose Option 2 over Option 1 without asking. If there is an idiomatic or platform-standard way to solve the problem, prefer it over introducing something new. Document why if you diverge.

---

## Process References

These are the governing processes. If your change falls into one of these categories, reference or initiate the appropriate process.

- **New technology, vendor, or significant pattern:** Requires a Tech Design Review with EA. Create a JIRA ticket (type: "Tech Design Review") in the EA project with a link to your Technical Design Document.
- **FHIR data modeling decisions:** Requires an FDR (FHIR Design Review). Create or update the FDR Confluence page and get FHIR SME approval.
- **Public API changes, cross-team impact, significant system changes:** Requires a Tech Design Review.
- **Repo-local implementation decisions:** Document in an ADR in the repo's `adrs/` directory.

If you are unsure whether your change requires a review, apply the "Is it NEW?" test: are you introducing a new technology, a new vendor, or a new pattern that has not been used in this codebase before? If yes, it needs EA review.

---

## Agent Behavior

### Plan Before Acting
Before making non-trivial changes, propose a short plan. Call out risks: does this touch tenant isolation, PHI, public contracts, event schemas, or introduce a new dependency? Identify which governing artifacts (Tech Design Doc, FDR, ADR, AsyncAPI) are relevant before writing code. Before coding, briefly restate the applicable constraints you are following for this change (tenancy, PHI, contracts, dependencies).

### Don't Guess Commands
Find and use the repo's canonical build, test, and lint commands. Check the Makefile, package.json scripts, build.gradle, or Pipfile. If the commands are unclear, say so and point to where you looked. Do not invent commands.

### Don't Introduce Dependencies Casually
Check `approved-tech.yaml` before adding any new dependency. If the dependency is not listed, flag it for review. Do not assume a library is approved because it is popular.

### Reference Governing Artifacts
If your change touches a public API, event contract, or cross-service behavior, reference the governing document (Tech Design Doc, FDR, ADR, AsyncAPI spec) in the PR description or commit message. If no governing artifact exists and one should, say so.

### Look for Abstraction Opportunities
Before implementing, consider whether the change introduces a concept that should be abstracted. If you are adding a vendor integration, wrap it behind a capability interface. If you are adding branching logic, consider whether a strategy pattern is more appropriate. If you see existing code that couples to a concrete implementation where an interface would reduce blast radius, flag it.

### Flag What Looks Wrong
If you encounter code that violates these principles - tenant isolation missing on a query path, PHI in test fixtures, a vendor name baked into business logic, a synchronous call where an event would be appropriate - flag it in a comment. Do not silently work around it.

### Code Ownership
Do not add "Co-Authored-By", "Generated by", or any other AI attribution to commits, PRs, or code comments. Engineers own their code regardless of what tool assisted in writing it. The tool is irrelevant. The author on the commit is the owner.

### Schema and Client Resilience
Assume clients may receive unknown enum values and new fields at any time. Design for forward compatibility. Do not write exhaustive enum switches without a default/unknown handler. Do not fail on unrecognized fields. GraphQL schema evolution and event schema evolution must be additive - new fields and enum values must not break existing consumers.

---

## Code Style

Follow whatever linter, formatter, and static analysis configuration exists in the repo. Do not duplicate what automated tooling already enforces. These instructions are for architectural and design decisions that linters cannot catch.
