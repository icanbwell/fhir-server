# icanbwell - Copilot Instructions

You are working in a cloud-native, multi-tenant, HIPAA-compliant healthcare platform. The platform is FHIR-native, event-driven (Kafka + CloudEvents), and exposes capabilities through a federated GraphQL gateway.

## Hard Constraints
- Tenant isolation is mandatory on every data access path. Not optional.
- No PHI/PII in logs, test fixtures, example data, comments, or PR descriptions.
- No new technology, vendors, or patterns without checking approved-tech.yaml and EA review.
- Public API changes require a Tech Design Review.
- Event-driven first. Default to async via Kafka. Justify sync.
- Client-facing access goes through the federated GraphQL gateway. No bypass.

## Design Defaults
- Program to interfaces, not implementations. Vendor integrations behind capability abstractions.
- Composition over inheritance. Strategy pattern over growing conditionals.
- Dependency injection at boundaries. No hidden global state.
- Idempotent consumers. Assume at-least-once delivery.
- Parameterized tests for functions with more than two input variations.
- Mock only at external boundaries.

## Before Coding
- Find and use the repo's canonical build/test/lint commands. Do not guess.
- Propose a plan for non-trivial changes. Call out tenancy, PHI, contract, and dependency risks.
- Check approved-tech.yaml before introducing any dependency.
- If your change touches public API, events, or cross-service behavior, reference the governing artifact (TDD, FDR, ADR, AsyncAPI).

## Repo-Specific Instructions
Check .github/copilot-instructions.md in the specific repository for repo-level context, commands, and additional guidelines that extend these org-wide instructions.
