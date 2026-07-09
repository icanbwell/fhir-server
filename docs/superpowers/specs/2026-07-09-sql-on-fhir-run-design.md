# SQL on FHIR — `ViewDefinition/$run` operation (Phase 1)

- **Status:** Draft for review
- **Date:** 2026-07-09
- **Author:** Alvin Henrick (with Claude Code)
- **Reference:** [HL7 SQL-on-FHIR v2](https://build.fhir.org/ig/FHIR/sql-on-fhir-v2/), [medplum `evalSqlOnFhir`](https://www.medplum.com/docs/sdk/core.evalsqlonfhir)

## 1. Summary

Implement the HL7 **SQL-on-FHIR v2** `$run` operation in this Express.js + MongoDB
FHIR server. `$run` takes a `ViewDefinition` — a tabular projection of a single
FHIR resource type, with columns and row-inclusion criteria expressed as FHIRPath —
and evaluates it over a set of FHIR resources, streaming back a flat table.

This is the analytics-extraction primitive: define a projection (e.g. "one row per
Patient with id, birthDate, and first official family name") and get NDJSON or CSV
back, ready for a spreadsheet or a downstream Spark/Databricks load.

## 2. Goals / Non-goals

### Goals (Phase 1)
- Spec-conformant `$run` with an **inline** `ViewDefinition`.
- Project over resources that are **stored in MongoDB** or **provided inline** in the request.
- Output **NDJSON** and **CSV**.
- **Synchronous streaming** execution with a guardrail against runaway scans.
- Full core `ViewDefinition` grammar: `select`, `column` (with `collection`),
  `where`, `constant`, `forEach`, `forEachOrNull`, `unionAll`, nested `select`,
  and the required SQL-on-FHIR FHIRPath functions
  (`getResourceKey`, `getReferenceKey`, `ofType`, etc.).
- Correctness validated against HL7's official SQL-on-FHIR v2 test suite.

### Non-goals (deferred to later phases)
- Stored / CRUD `ViewDefinition` resources and the instance form
  `ViewDefinition/[id]/$run`.
- Parquet output.
- Asynchronous execution (202 + poll) and landing output in S3 / Delta / a lakehouse.
- JSON-array output format.

## 3. Background

SQL-on-FHIR v2 defines a `ViewDefinition` logical resource. Each `ViewDefinition`
is bound to one FHIR resource type (`resource`) and produces zero or more rows per
resource instance. Columns and filters are FHIRPath expressions. The `$run`
operation evaluates a `ViewDefinition` against provided or stored resources and
returns the resulting table.

medplum implements the evaluation core as
`evalSqlOnFhir(view, resources): OutputRow[]` in `@medplum/core`. This design keeps
that separation — a pure evaluation engine — but makes it **streaming** so it works
over large stored result sets without buffering.

## 4. Architecture

### 4.0 Execution model (read this first)

There is **no input SQL** and **no query pushdown**. The input is a `ViewDefinition`
(declarative JSON whose columns/filters are FHIRPath). Execution is:

1. **Fetch resources** — for the stored case, query MongoDB for the target
   `resourceType` via a **secured streaming cursor** (same auth/query-rewriter path
   as `$search`; see §7). For the inline case, iterate the resources in the request.
   Either way, resources are consumed one at a time — the collection is never fully
   loaded.
2. **Evaluate in-process** — for each resource, apply the ViewDefinition's FHIRPath
   `where`/`column`/`forEach`/`unionAll` in Node to produce rows. This is medplum's
   `evalSqlOnFhir` algorithm (`packages/core/src/sql-on-fhir/eval.ts`), ported
   here but made **streaming** (`AsyncIterable<Row>`) instead of materializing the
   whole `OutputRow[]` table in memory.
3. **Write out** — each row is written straight to the NDJSON/CSV response stream.

We do **not** translate the ViewDefinition into a Mongo aggregation. FHIRPath is far
more expressive than Mongo aggregation maps cleanly onto, and every reference
implementation (medplum, Aidbox, Pathling) evaluates FHIRPath in-process. Memory
stays bounded at roughly one resource + its rows. Any future Mongo-side pushdown
would be a niche optimization layered behind the source seam, never a replacement
for the in-process engine.

### 4.1 Request flow

```
POST /4_0_0/ViewDefinition/$run     (primary, spec-aligned type-level form)
POST /4_0_0/$run                    (system-level convenience form)
  → sqlOnFhir.config.js route registration (new)
  → CustomOperationsController
  → FhirOperationsManager.run(args, { req, res })
  → SqlOnFhirRunOperation.runAsync({ requestInfo, parsedArgs, req, res })
```

This mirrors the existing `$export` / `$everything` wiring. No changes to the
router core — a new route config plus an `enableSqlOnFhirRoutes()` registration
call, following the pattern in `src/middleware/fhir/`.

### 4.2 Components

Each is a single-purpose, independently testable unit.

1. **`ViewDefinition` custom resource class**
   - `src/fhir/classes/4_0_0/custom_resources/viewDefinition.js` + register in
     `custom_resources/index.js`.
   - Typing/validation only — **not** stored. Same pattern as the existing
     `ExportStatus` custom resource.

2. **`ViewResolver`** (the extension seam)
   - Phase 1: returns the inline `ViewDefinition` supplied in the request.
   - Later phases: resolves a stored `ViewDefinition` by id/url.
   - Nothing downstream knows or cares where the view came from — this is what
     lets stored/CRUD views be added later without touching the engine.

3. **`ViewDefinitionValidator`**
   - Structural validation: valid `resource` type, unique `column` names,
     only-supported constructs, well-formed FHIRPath (best-effort compile check).
   - Fails fast with a `400 OperationOutcome` **before** any streaming begins.

4. **`FhirPathEvaluator`** (new DI service)
   - Wraps the HL7 `fhirpath` npm library.
   - Binds `ViewDefinition.constant`s as FHIRPath environment variables and
     registers the SQL-on-FHIR function set.
   - Single responsibility: `(expression, resource, context) → values`.

5. **`ViewRunner`** (the core engine)
   - Pure streaming transform:
     `(ViewDefinition, AsyncIterable<Resource>) → AsyncIterable<Row>`.
   - Implements the grammar: apply `where`; for passing resources, expand
     `select` / `forEach` / `forEachOrNull` / `unionAll` / nested `select` and
     evaluate each `column`'s FHIRPath to produce one or more rows.
   - No DB, no HTTP, no framework knowledge — this is the medplum
     `evalSqlOnFhir` analog, made streaming. Tested against the HL7 conformance
     suite in isolation.

6. **Resource source**
   - *Inline:* iterate the resources provided in the request body.
   - *Stored:* a `databaseQueryFactory` cursor **built through the same security /
     query rewriters and access-index filtering as `$search`** (see §7), with
     `maxTimeMS` applied.

7. **Output writers**
   - NDJSON row writer (`application/x-ndjson`) — one JSON object per row.
   - CSV row writer (`text/csv`) — header row + one line per row.
   - Column order follows `ViewDefinition` column order.
   - Adapt the existing CSV / NDJSON response streamers rather than inventing new ones.

8. **`SqlOnFhirRunOperation`** (orchestrator)
   - Sequence: validate scopes → resolve view → validate view → guardrail check →
     open source → `ViewRunner` → pipe rows to the negotiated output writer → end.
   - Registered in `src/createContainer.js`; dispatched via
     `FhirOperationsManager.run()`.

### 4.3 Data flow

```
request
  → scope check (read on target resourceType)
  → resolve view (inline)
  → validate view (400 on failure, pre-stream)
  → guardrail check (stored + unfiltered → reject pre-stream)
  → open source: inline iterator | secured Mongo cursor
  → for each resource:
        apply `where`; if it passes,
        expand select/forEach/unionAll and evaluate columns → 1..N rows
        write each row to the NDJSON/CSV stream
  → end stream
```

## 5. Interfaces (sketch)

```js
// ViewRunner — pure, streaming, framework-agnostic
async function *runView(viewDefinition, resourceIterable, { fhirPathEvaluator }) {
    // yields plain row objects: { columnName: value, ... }
}

// ViewResolver — the seam
async function resolveView(parsedArgs /*, requestInfo */) {
    // Phase 1: return inline ViewDefinition from the request body / Parameters
    // Later:   look up a stored ViewDefinition by id or url
}

// SqlOnFhirRunOperation
async function runAsync({ requestInfo, parsedArgs, req, res }) { /* orchestrates */ }
```

Row values follow the SQL-on-FHIR column model: a `column` with `collection: true`
yields an array; otherwise a scalar (or null when the FHIRPath yields empty).

## 6. Error handling & decisions

- **Invalid / unsupported `ViewDefinition`** → `400 OperationOutcome`, emitted
  before streaming starts.
- **Per-resource FHIRPath runtime error** → **fail the request** (deterministic).
  *Decision D1 — reversible:* the alternative is skip-the-row-and-continue with a
  logged warning. Fail-fast chosen so a broken projection surfaces immediately
  rather than silently dropping rows. Flip if soft-fail is preferred.
- **Guardrail on stored `$run`** → an unfiltered full-collection `$run` is
  **rejected pre-stream** with a `400`.
  *Decision D2 — reversible:* alternative is to silently apply a max-row cap.
  Requiring an explicit filter (or a bounded `_count`) chosen so results are never
  silently truncated. `maxTimeMS` on the cursor bounds runtime; if exceeded
  mid-stream, the response is terminated and the error logged.
- **Missing SMART scope** → `403`.

## 7. Security (non-negotiable)

Stored `$run` **must** use the identical authorization path as `$search`:
SMART scope enforcement on the target resourceType, patient-compartment / proxy
query rewriting, and access-index / consent filtering. `$run` must never surface a
resource the caller could not already read via `$search`.

Concretely: construct the stored query with the same `queryRewriters` +
`ScopesManager` the search operation uses. **Do not** hand-roll a raw Mongo query
that bypasses these layers.

## 8. Testing

- **Conformance:** run `ViewRunner` against HL7's **official SQL-on-FHIR v2 test
  suite** (JSON cases) as unit tests — the gold standard for correctness. Track and
  document any intentionally skipped cases (e.g. Parquet-only, deferred constructs).
- **Unit:** `FhirPathEvaluator` (SQL-on-FHIR functions, `constant` binding),
  `ViewDefinitionValidator` (rejection cases).
- **Integration** (MongoDB Memory Server, existing jest harness + custom matchers):
  - inline-resource path,
  - stored-resource path **with security filtering asserted** (a caller must not
    see resources outside their scope/compartment),
  - NDJSON output shape,
  - CSV output shape (header + rows, collection-column flattening rule),
  - guardrail rejection (stored + unfiltered → 400),
  - `403` on missing scope.

## 9. Dependencies

- Add `fhirpath` to `package.json`, then run `make update` to regenerate `yarn.lock`.
- **Caution:** this repo version-locks some packages. Pin a known-good `fhirpath`
  version and verify its SQL-on-FHIR function support (`getResourceKey`,
  `getReferenceKey`, `ofType`) during implementation; register any missing
  functions in `FhirPathEvaluator` if the library version lacks them.

## 10. Files touched (anticipated)

New:
- `src/operations/sqlOnFhir/sqlOnFhirRunOperation.js`
- `src/operations/sqlOnFhir/viewRunner.js`
- `src/operations/sqlOnFhir/viewResolver.js`
- `src/operations/sqlOnFhir/viewDefinitionValidator.js`
- `src/utils/fhirPathEvaluator.js`
- `src/fhir/classes/4_0_0/custom_resources/viewDefinition.js`
- `src/middleware/fhir/sqlOnFhir/sqlOnFhir.config.js`
- tests under `src/tests/sqlOnFhir/` (unit + integration + conformance)

Modified:
- `src/createContainer.js` (register new services)
- `src/operations/fhirOperationsManager.js` (add `run` dispatch)
- `src/fhir/classes/4_0_0/custom_resources/index.js` (register ViewDefinition)
- `src/middleware/fhir/router.js` (register `$run` routes)
- `package.json` (add `fhirpath`)

## 11. Open questions for reviewer

1. Confirm decisions **D1** (fail-fast on FHIRPath error) and **D2** (require a
   filter on stored `$run`).
2. Endpoint form: type-level `ViewDefinition/$run` only, or also the system-level
   `/$run` convenience alias? (Design assumes both; type-level is the spec-aligned one.)
3. CSV flattening rule for `collection: true` columns — JSON-encode the array into
   the cell, or join with a separator? (Design leaves this to implementation;
   flag a preference if you have one.)