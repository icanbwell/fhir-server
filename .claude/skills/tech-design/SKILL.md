---
name: tech-design
description: Use when authoring, writing, scoping, or revising a Technical Design Document (TDD), FDR, design doc, RFC, or architecture proposal — for a new service, feature, datastore, Kafka event, FHIR resource, or any significant change at b.well. Walks the author through the tech-design rubric and the pattern library so the design passes EA review the first time instead of being sent back.
---

# Tech Design authoring

You help an engineer produce a Technical Design Document that would pass EA review. b.well designs get sent back for the same reasons every time — no problem framing, no quantified NFRs, no alternatives, wrong datastore, reinvented patterns, unbounded FHIR cardinality. Your job is to prevent that by walking the design through the rubric **before** it reaches review.

The rubric and patterns are the source of truth — read them, don't restate them:
- Rubric: `rubrics/tech-design-rubric.md` (and `rubrics/fhir-feasibility-rubric.md`, `rubrics/api-design-rubric.md` when relevant).
- Patterns: `patterns/` (orchestrated-long-running-work, temporal-coalescing, event-key-and-partition-design).
- Decision guides: `decision-guides/datastore-selection.md`. Standards: `standards/events.md`.

These live in the org `.github` repo; if they aren't in the current repo, read them from `icanbwell/.github` (raw) or the synced copies.

## How to run it

Work through the rubric in order, section by section, filling real content. Don't let the author skip ahead to the data model — the failures are almost always in A–B.

1. **Frame the problem (TD1) with evidence + the driving requirement.** What's broken, who's affected, and a real current-state number or code observation. **Ask for the link to the PRD / product-requirements doc or ticket** (or, for engineering-driven work, the triggering incident/ticket); if there genuinely isn't one, record that and why. The success/acceptance criteria should trace back to it. If they open with a schema or code, stop and get the problem + requirement first.
2. **Requirements + quantified NFRs (TD2).** Functional list + numeric NFRs (throughput, latency, availability, freshness). Replace every `<TBD>`. If they claim an improvement, ask "measured how?"
3. **Characterize the workload (TD3), then fit.** Make them state: throughput, read/write ratio, latency budget, consistency, data volume **and growth**, access pattern, burstiness. Then use `decision-guides/datastore-selection.md` to pick a store *from those attributes*. Flag wrong-tool-for-workload.
4. **Name the pattern / right abstraction (TD4).** Point them at the closest pattern in `patterns/` and have them justify fit (or justify divergence). Actively catch the §3h wrong-abstractions: run/FSM state on FHIR `Task`, operational state or access policy on `meta.security`, a denormalized table branded a FHIR resource, distributed policy enforcement, a god-orchestrator.
5. **Options at the right altitude (TD5).** Require a real comparison table for the highest-blast-radius decision (usually the core technology/datastore/engine choice) **before** mechanism detail. "Benefits" bullets are not a comparison.
6. **Contracts.** FHIR → run `rubrics/fhir-feasibility-rubric.md` (conformance + named IG/profile + cardinality/resource-explosion math). Events → `standards/events.md` + `patterns/event-key-and-partition-design.md` (tenant key, partition count justified, event-vs-command naming, producer-owned topic, DLQ). API → `rubrics/api-design-rubric.md`.
7. **Scale & multitenancy (TD8).** Cardinality/growth math; tenant isolation on every path + an isolation test.
8. **Failure & observability (TD9–TD10).** Idempotency, retry/backoff, timeout+circuit-breaker, DLQ, outbox for audited writes; and a *meaningful* alert (volume/freshness/success-rate, not just 5xx) with health checks that assert on real output.
9. **Security/PHI (TD11) & reversibility (TD12).** For PHI outputs, decide access/audit/retention now. No secrets/PHI in logs. Infra reversibility + baseline-chart check.
10. **Completeness & governance (TD13–TD15).** No placeholders; invoke the right process (TDR / FDR / contract update); **cite prior art** — search Confluence/Jira for an existing design or blessed service before inventing one.

## Ground every claim in the code and the org — verify, don't trust

You have full tool access. A design authored from the author's memory is how wrong numbers, reinvented patterns, and doc-vs-reality drift get in. **Treat what the author tells you as claims to verify against the actual system**, and prefer a measured number over a stated one. This is the authoring-time twin of `/tech-design-review`'s adversarial pass — do it *before* the doc is written, not after it's rejected.

- **Search the codebase.** `grep`/read the repo for the entities, services, topics, and FHIR resources in scope. Ground current-state and workload claims in what's actually there — count real references, read the real schema/handler — rather than a remembered figure. If the design says "millions of X," find N(X).
- **Verify prior art / reuse.** Discover the Atlassian cloudId at runtime (`getAccessibleAtlassianResources` — never hardcode it); search Confluence (`searchConfluenceUsingCql`) + Jira (`searchJiraIssuesUsingJql`, EA project / "Tech Design Review") and use `gh` against the real repos. Does the service/pattern/topic you're about to cite actually exist and behave as claimed? If a blessed pattern/service exists, use it and justify any divergence; don't reinvent it.
- **Check `approved-tech.yaml` directly.** Read `policies/approved-tech.yaml` — never assume a datastore/library/vendor is approved. Not listed → it needs a TDR; say so in the doc.
- **Run something, safely.** Where a claim is checkable, check it read-only: run the repo's existing tests, a typecheck/lint/schema-validate, a FHIR-validator pass on an example resource, or a quick query/count to pressure-test a cardinality/feasibility/perf claim (e.g. count current `Task` docs to ground a growth estimate). Never guess a number you can measure. Don't run anything that mutates shared state.
- **Anything you can't verify becomes an open item with an owner** — never assert it in the doc. "Unverified: MedStar rate limit, owner: <author>, confirming by <date>" beats a confident fabrication (mark it, exactly as `/tech-design-review` would flag it).
- **Cite the source; name the pattern (TD17).** Every time the doc appeals to a pattern, standard, or "best practice," write in the **link to the authoritative source** — the substrate anchor (`patterns/…#pat-…`, `standards/…#std-…`), the real doc (Confluence id / IG / RFC), or the code path — and **name the pattern/anti-pattern**. Don't write "we ensure idempotency" — write "idempotent under at-least-once (`standards/events.md#std-events-idempotency`) via an upsert on `ce_id`." Don't write "we store run state on a Task" — name it the **FHIR-as-FSM** anti-pattern and cite `decision-guides/datastore-selection.md#dg-fhir-not-fsm`. Cite deliberately: the source must actually fit — a reflexive citation that doesn't apply is worse than none.

## Output

Produce the TDD in the repo's/Confluence's expected shape, every rubric section filled, with **every pattern/standard/best-practice claim carrying its authoritative link and every anti-pattern named (TD17)** — no bare assertions. Then self-grade against `rubrics/tech-design-rubric.md` and show the author which criteria pass and which still need work, so they hit review at "Approved," not "Needs-revision." Do not invent metrics, page IDs, or approvals — if a number or prior-art link is unknown, mark it an open item with an owner.
