# MCP Endpoint for FHIR Read Access — Design

**Date:** 2026-08-05
**Branch:** worktree-mcp-endpoint-plan (planning only, no implementation)
**Status:** Draft — written while user was unavailable; open questions below need confirmation before
`writing-plans` output is executed.

## Summary

Add a `/mcp` endpoint that exposes an [MCP](https://modelcontextprotocol.io) (Model Context Protocol)
server providing read-only tools for querying FHIR resources. The endpoint reuses the exact same
business logic and data-access layer the REST API and GraphQL API already share
(`SearchBundleOperation` / `SearchByIdOperation`) — no new Mongo queries, no parallel access-control
logic. Per-resource tool schemas are produced by extending the existing code-generation pipeline that
already generates search parameters and GraphQL schemas from the FHIR `search-parameters.json`
definitions.

## Resolved decisions

- **Read-only, v1 scope.** Only search/read tools. No create/update/patch/remove/merge tools, and no
  `$everything`/`$graph`/proxy-patient traversal tools (those are explicitly flagged as
  security-sensitive in `CLAUDE.md` and deserve their own `review.md`-guided design later).
- **Two tiers of tools**, per explicit direction: dedicated generated tools for a curated list of
  commonly-used resources (one `search_<resource>` tool per resource, typed input schema derived from
  that resource's real search parameters), plus a single generic `fhir_search` tool covering every
  other resource type (untyped/generic filter map + `resourceType` argument).
- **Zero new data-access code.** Every tool handler bottoms out in `container.searchBundleOperation`
  (bundle search) or `container.searchByIdOperation` (read by id) — the same classes
  `FhirOperationsManager` (REST) and `FhirDataSource` (GraphQL) already call. No handler touches
  `src/dataLayer/` or Mongo directly.
- **Generated tool files are pure data, not logic.** Codegen emits `{ name, description, resourceType,
  inputSchema }` objects only. A single hand-written `McpToolHandler` interprets any tool call
  (dedicated or generic) the same way — this mirrors how generated GraphQL resolvers are thin and
  delegate to shared hand-written classes.
- **Auth/scope enforcement is inherited, not reimplemented.** `FhirRequestInfo` is built from the
  incoming HTTP request exactly as `FhirRequestInfoBuilder.fromRequest(req)` does for REST/GraphQL/
  admin today. Because SMART scope checks and patient/tenant/security-tag filtering live inside
  `SearchBundleOperation`/`SearchManager` (not in REST-only middleware), MCP gets the same enforcement
  "for free" once it passes a correctly-built `FhirRequestInfo` — exactly how GraphQL does it today.

## 1. Problem / Goal

Provide AI agent clients (MCP-compatible) a way to query this FHIR server's data — with full support
for the search-parameter filters the REST/GraphQL APIs already support — without introducing a
parallel, drift-prone implementation of search, filtering, or access control.

## 2. Current architecture (relevant findings)

Traced during research (see file/line references for implementation):

- Both REST (`GenericController.search` → `FhirOperationsManager.search`) and GraphQL
  (`FhirDataSource.getResourcesBundle`) ultimately call **`SearchBundleOperation.searchBundleAsync`**
  (`src/operations/search/searchBundle.js`), passing a `FhirRequestInfo`, a `resourceType`, and a
  `ParsedArgs` (built via `R4ArgsParser.parseArgs()`, `src/operations/query/r4ArgsParser.js`).
- Read-by-id likewise has a shared `SearchByIdOperation` (registered in
  `src/createContainer.js:778`).
- SMART scope validation (`ScopesValidator`) and patient/tenant/security-tag row filtering
  (`SearchManager.constructQueryAsync`) happen *inside* `SearchBundleOperation`, so any caller that
  builds a correct `FhirRequestInfo` and calls it gets the same enforcement GraphQL gets today.
  REST additionally runs one extra coarse gate above this (`OperationAccessManager.verifyAccess`,
  called from `FhirOperationsManager.search`) that GraphQL currently bypasses — see Open Questions.
- Search-parameter metadata for every resource is generated today by
  `generatorScripts/searchParameters/generate_search_parameters.py` from HL7's official
  `search-parameters.json` bundle, emitted as `src/searchParameters/searchParameters.js`
  (`{ [ResourceType]: { [paramName]: SearchParameterDefinition } }`, carrying `type`, `field(s)`,
  and `target` resource types for references).
- The repo already has an established Jinja2-template codegen pattern (used for FHIR classes and
  GraphQL schemas: `generatorScripts/classes/*.jinja2`, `generatorScripts/graphqlv2/*.jinja2`) — a
  Python driver reads FHIR definitions and renders per-resource files into `src/<target>/`. This is
  the pattern the new MCP tool generator follows.
- Precedent for a non-REST/non-GraphQL entry point reusing the same container and
  `FhirRequestInfoBuilder.fromRequest(req)` pattern already exists in `src/routeHandlers/admin.js`.
  `MyFHIRServer` (`src/routeHandlers/fhirServer.js`) is the template for "a new protocol surface
  that resolves dependencies from the container and mounts itself on the shared Express `app`."

## 3. Architecture

```
Express app (src/app.js)
  └─ app.use('/mcp', mcpRouter)          [new]
       └─ McpServer (src/routeHandlers/mcpServer.js)      [new, mirrors MyFHIRServer]
            ├─ existing passport JWT auth middleware (same as REST/GraphQL)
            ├─ @modelcontextprotocol/sdk StreamableHTTPServerTransport
            └─ McpToolHandler (src/operations/mcp/mcpToolHandler.js)   [new, hand-written]
                 ├─ resolves tool name → resourceType (+ dedicated vs generic)
                 ├─ FhirRequestInfoBuilder.fromRequest(req)            [existing]
                 ├─ container.r4ArgsParser.parseArgs(...)              [existing]
                 ├─ container.searchBundleOperation.searchBundleAsync  [existing]
                 └─ container.searchByIdOperation.searchByIdAsync      [existing, for _id-only lookups]
```

- **`McpServer`** (new route handler, modeled on `MyFHIRServer`): constructed with
  `(fnGetContainer, config, app)`, pulls `mcpToolHandler` off the container, registers the generated +
  generic tool list with the MCP SDK's server object, and mounts a `StreamableHTTPServerTransport` at
  `/mcp`. Reuses the same passport authentication middleware already applied to GraphQL so
  `req.authInfo` is populated identically.
- **`McpToolHandler`** (new, hand-written, in `src/operations/mcp/`): the *only* new business-logic
  class. Given an MCP `tools/call` request:
  1. Look up the invoked tool's metadata (generated tool defs carry their own `resourceType`; the
     generic `fhir_search` tool reads `resourceType` from the call arguments instead).
  2. Translate MCP call arguments into the REST-style `{ paramName: value }` / `{ 'paramName:modifier':
     value }` shape `R4ArgsParser` already expects.
  3. Build `FhirRequestInfo` via the existing `FhirRequestInfoBuilder.fromRequest(req)`.
  4. Call `r4ArgsParser.parseArgs({ resourceType, args })`, then
     `searchBundleOperation.searchBundleAsync({ requestInfo, resourceType, parsedArgs,
     useAggregationPipeline: false })`.
  5. Map the resulting `Bundle` (or thrown `OperationOutcome`/error) into an MCP tool result
     (`content: [{ type: 'text', text: JSON.stringify(bundle) }]`, or `isError: true` on failure).
- **IoC registration** (`src/createContainer.js`): `mcpToolHandler` registered alongside
  `fhirOperationsManager`, depending on `searchBundleOperation`, `searchByIdOperation`, `r4ArgsParser`,
  `queryRewriterManager`, `configManager`, `fhirLoggingManager` — no new dependency on anything in
  `src/dataLayer/`.

## 4. Code generation

New generator, following the existing Jinja2 convention:

- `generatorScripts/mcp/generate_mcp_tools.py` — reads the same parsed `search-parameters.json`
  structure the search-parameters generator already produces (reuse, don't refork, its parsing) plus
  `generate_resource_fields_type.get_resources_fields_data()` for field typing.
- `generatorScripts/mcp/template.mcp_tool.jinja2` — renders one `src/mcp/tools/<resource>.tool.js` per
  **commonly-used** resource: an MCP `Tool` definition (`name: 'search_<resource>'`, `description`,
  `resourceType`, `inputSchema`), where each search parameter's `SearchParameterDefinition.type` maps
  to a JSON Schema type (`token`/`string`/`uri`/`email`/`phone` → `string`; `number`/`quantity` →
  `number`; `date`/`datetime`/`instant`/`period` → `string` with `format: date-time` note in
  description; `reference` → `string`, with the `target` array folded into the property description).
- `src/mcp/tools/index.js` — generated barrel exporting every dedicated tool definition, analogous to
  `src/searchParameters/index.js`.
- **Commonly-used resource list**: a small **hand-maintained** (not generated) JSON/JS file — single
  source of truth consumed both by the generator (which resources get a dedicated generated file) and
  by `McpToolHandler` at runtime (dedicated-tool-name → resourceType lookup vs. falling through to the
  generic tool for anything not in the list). Proposed starting list (confirm in Open Questions):
  `Patient, Observation, Condition, MedicationRequest, AllergyIntolerance, Immunization, Procedure,
  DiagnosticReport, Encounter, CarePlan, Coverage, DocumentReference, Practitioner, Organization`.
- `make mcp` target added to the `Makefile` alongside the existing `make searchParameters`, and wired
  into `make generate`.

The generic `fhir_search` tool is hand-written (not generated) since its schema is intentionally
resource-agnostic: `resourceType` (enum of all profiled resource types minus the dedicated list) plus
a generic `filters` object of string key/value pairs passed through verbatim to `R4ArgsParser`,
matching REST query-param semantics.

## 5. Auth & scope enforcement

No new authorization logic. `/mcp` sits behind the same passport JWT middleware already protecting
GraphQL, so `req.authInfo` populates the same way, and `FhirRequestInfoBuilder.fromRequest(req)`
builds the same `FhirRequestInfo` REST/GraphQL/admin use. Scope validation and patient/tenant/
security-tag filtering happen automatically inside `SearchBundleOperation`/`SearchManager` — no
MCP-specific code needed there. Whether to *also* call `OperationAccessManager.verifyAccess` (REST's
one extra gate that GraphQL currently skips) is an open question below.

Per `CLAUDE.md`'s security-sensitive-changes rule, this feature touches "resource search/read" and
(if the generic tool ever allows reference-following in a later phase) cross-resource joins — the
implementation PR must read `review.md` and adversarially review the diff against it before merge.

## 6. Error handling

Map exceptions thrown by `searchBundleOperation`/`searchByIdOperation` (`ForbiddenError`,
`NotFoundError`, validation errors that produce an `OperationOutcome`) into MCP's tool-result error
shape (`isError: true`, human-readable `OperationOutcome` text in `content`) rather than letting them
propagate as raw exceptions or leaking stack traces — mirrors what `FhirResponseWriter` already does
for REST error responses.

## 7. Testing

- `src/tests/mcp/` — new integration suite using the existing `createTestContainer.js` pattern
  (MongoDB Memory Server), covering:
  - A dedicated tool (e.g. `search_patient`) returns the same `Bundle` content as the equivalent REST
    search for the same query.
  - The generic `fhir_search` tool works for a resource type with no dedicated tool.
  - Patient-scoped and tenant-scoped tokens restrict MCP results identically to REST/GraphQL
    (regression coverage for the "enforcement is inherited" claim in §5).
  - Error mapping for a forbidden/unknown-resource call.
- Golden-file test for the generator: committed fixture output for one resource's generated tool file,
  regenerate-and-diff in CI the same way other generated artifacts are checked (if such a check
  exists today for GraphQL/class generation — verify during planning and mirror it).

## Open questions (to confirm before/while executing the implementation plan)

1. **Commonly-used resource list** — is the proposed 14-resource list in §4 right, or should it be
   shorter/longer/different?
2. **MCP transport mode** — recommend the SDK's `StreamableHTTPServerTransport` in **stateless** mode
   (no server-side session affinity needed) since this app can run clustered/multi-instance
   (`src/index.js` cluster mode). Confirm stateless is acceptable, or if session-based state is
   wanted for some reason.
3. **REST's extra `OperationAccessManager.verifyAccess` gate** — should MCP call it too (REST parity)
   or is GraphQL's current behavior (skip it, rely solely on `SearchBundleOperation`-internal checks)
   the intended precedent to follow?
4. **MCP client auth model** — is this endpoint for service-to-service/agent clients presenting a
   pre-issued bearer JWT (simplest, matches current REST/GraphQL auth), or do we need full MCP/OAuth
   2.1 discovery metadata (`/.well-known/oauth-authorization-server`) for interactive MCP clients
   (e.g. Claude.ai remote connectors) to complete a login flow? This significantly changes scope.
5. **New dependency** — this requires adding `@modelcontextprotocol/sdk` to `package.json` (via
   `make update`). No known version-lock conflict, but flagging since `CLAUDE.md` calls out that some
   packages (Sentry, OpenTelemetry) are version-locked — confirm no similar constraint applies here.
6. **`$everything`/`$graph`/proxy-patient tools** — confirmed out of scope for v1 (§ Resolved
   decisions) — confirm that's still correct and not secretly expected in the first phase.
