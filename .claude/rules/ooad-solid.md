---
paths:
  - "**/*.py"
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.java"
  - "**/*.kt"
  - "**/*.go"
---

# Object-Oriented Analysis and Design

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