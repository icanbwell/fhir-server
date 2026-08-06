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

New generator, following the existing Jinja2 convention. Finalized in the implementation plan (see
`docs/superpowers/plans/2026-08-05-mcp-endpoint.md` Task 2) after this section's first draft turned
out to be inaccurate in two ways once actually written: (1) it isn't necessary to consume
`generate_resource_fields_type.get_resources_fields_data()` at all — REST/GraphQL query args are
always flat strings regardless of the FHIR type, so every generated field is simply
`z.string().optional()`, with no JSON-Schema-type mapping to do; (2) a bare `(type)` suffix on each
field's description (the original plan) isn't enough for an agent to actually *write* a correct
filter value — FHIR's per-type value syntax (date/number comparator prefixes, `token`'s `system|code`,
`quantity`'s `value|system|code`, `reference`'s `ResourceType/id`) needs to be spelled out, or an
agent has no way to know, say, that a "before this date" search means prefixing the value with `le`
rather than putting `le` in the parameter name. That per-type syntax is fixed by this server's actual
filter implementations, not by the resource — so it's generated **once**, as a lookup table keyed by
`SearchParameter.type`, and reused for every resource/parameter, rather than repeated by hand:

- `generatorScripts/mcp/generate_mcp_tools.py` — reads the same `search-parameters.json` bundle the
  existing search-parameters generator reads (independently, since that script doesn't expose a
  reusable parsing function — see the plan for the tradeoff). Contains a `TYPE_VALUE_SYNTAX_HINTS`
  dict, keyed by `SearchParameter.type`, verified line-by-line against this repo's actual filter
  classes (`src/operations/query/filters/*.js` + `src/utils/querybuilder.util.js`) rather than the
  FHIR spec text alone — the spec and this server's implementation don't always agree (e.g. this
  server's `canonical` filter does a plain exact match; it does **not** parse the `|version` suffix
  the spec generally allows, so the hint doesn't claim it does). Each generated field's description is
  `"<FHIR description> (<type>[: target types]) <type-specific syntax hint>"`.
- `generatorScripts/mcp/template.mcp_tool.jinja2` — renders one `src/mcp/tools/<resource>.tool.js` per
  **commonly-used** resource: an MCP tool definition (`name: 'search_<resource>'`, `resourceType`,
  `description`, `inputSchema`), where `inputSchema` is a Zod object with one `z.string().optional()`
  field per search parameter (including `_id`, `_lastUpdated`, `_count`, `_sort`, added generically to
  every resource) plus `.passthrough()` so a caller can pass FHIR search modifiers as extra key
  suffixes.
- The tool-level `description` also states, once, the modifier list (`:missing`, `:not`, `:contains`,
  `:exact`, `:above`, `:below`, `:text`, `:of-type`) and the comma-separated-OR convention — both
  verified as type-independent (accepted for any parameter at the code level, per
  `src/operations/query/r4.js`'s modifier dispatch running before the type-specific filter switch, and
  `src/operations/query/r4ArgsParser.js`/`queryParameterValue.js` splitting on `,` before any
  type-specific filter runs) — so, like the syntax table, it's written once rather than per-field.
- `src/mcp/tools/index.js` — generated barrel exporting every dedicated tool definition, analogous to
  `src/searchParameters/index.js`.
- **Commonly-used resource list**: a small **hand-maintained** (not generated) JSON file — single
  source of truth consumed both by the generator (which resources get a dedicated generated file) and
  by `McpToolHandler` at runtime (dedicated-tool-name → resourceType lookup vs. falling through to the
  generic tool for anything not in the list). Confirmed list:
  `Patient, Observation, Condition, MedicationRequest, AllergyIntolerance, Immunization, Procedure,
  DiagnosticReport, Encounter, CarePlan, Coverage, DocumentReference, Practitioner, Organization`.
- `make mcp` target added to the `Makefile` alongside the existing `make searchParameters`, and wired
  into `make generate`.

The generic `fhir_search` tool is hand-written (not generated) since its schema is intentionally
resource-agnostic: `resourceType` (any resource type not in the dedicated list) plus a generic
`filters` object of string key/value pairs passed through verbatim to `R4ArgsParser`, matching REST
query-param semantics. Because it has no per-parameter schema to attach a type-specific hint to, its
description instead spells out a compact version of the same syntax cheat sheet covering every type
at once — kept in sync by hand with the generator's `TYPE_VALUE_SYNTAX_HINTS` (flagged in the plan as
a manual-sync point worth watching).

## 5. Auth & scope enforcement

No new authorization logic beyond one categorical route-level exclusion (see below). `/mcp` sits
behind the same passport JWT middleware already protecting GraphQL, so `req.authInfo` populates the
same way, and `FhirRequestInfoBuilder.fromRequest(req)` builds the same `FhirRequestInfo`
REST/GraphQL/admin use. Scope validation and patient/tenant/security-tag filtering happen
automatically inside `SearchBundleOperation`/`SearchManager` — no MCP-specific code needed there.

`McpToolHandler` never calls `OperationAccessManager.verifyAccess` directly, matching GraphQL's
precedent — but that precedent was verified provider-by-provider, not assumed (see Resolved Decision
3 above). One consequence carries forward: `/mcp`'s router **must** mount
`forbidForUserTypes([AUTH_USER_TYPES.cmsPartnerUser])`, the same categorical block GraphQL's routers
use (`app.js:441,447,482`), because that block — not a `verifyAccess` call — is what keeps CMS-partner
tokens off GraphQL's unrestricted-by-resource-type search path. Without it, MCP would let a
CMS-partner token (normally locked to `Patient`-only GET searches on REST) search any resource type.

**`review.md` check (Section D — request-scoped state on singletons):** `McpToolHandler` is
registered once in the IoC container and shared across every request/tenant, but it holds no
per-request data as instance state — the per-request `FhirRequestInfo` is fetched fresh on every tool
call via `httpContext.get(MCP_REQUEST_INFO_CONTEXT_KEY)` (`express-http-context`'s
`AsyncLocalStorage`-backed store), the same mechanism already relied on elsewhere in this codebase
(e.g. `postRequestProcessor.executeAsync` reading `httpContext` from inside a `res.once('finish', ...)`
callback). This is checked clean, but because a wrong answer here is exactly the cross-tenant
data-bleed shape `review.md` warns about, the implementation plan's integration tests (Task 10) must
include a concurrency test: two simultaneous MCP requests from two different scoped tokens, asserting
neither sees the other's `FhirRequestInfo`/results.

Per `CLAUDE.md`'s security-sensitive-changes rule, this feature touches "resource search/read" and
(if the generic tool ever allows reference-following in a later phase) cross-resource joins — the
implementation PR must read `review.md` and adversarially review the diff against it before merge.
The CMS-partner-user gap above is exactly the kind of finding that review is meant to catch; it was
caught here during planning instead only because the user pushed back on an initial "GraphQL skips it
so MCP can too" claim rather than accepting it at face value.

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

## 8. Example tool calls

These show the actual wire format — Streamable HTTP, JSON-RPC 2.0, SSE-wrapped responses — verified
against `@modelcontextprotocol/server@2.0.0`'s own documented example (see implementation plan Task 8),
not a hypothetical shape. `<jwt>` is the same bearer token REST/GraphQL callers already use.

### 8.1 Listing available tools

```bash
curl -s -X POST https://<host>/mcp \
  -H 'Authorization: Bearer <jwt>' \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Response (abbreviated — 15 tools total: 14 dedicated + `fhir_search`):

```
event: message
data: {"result":{"tools":[
  {"name":"search_patient",
   "description":"Search FHIR Patient resources using its supported search parameters. Comma-separate multiple values for the same parameter to OR them (e.g. 'active,inactive'). Every parameter also accepts these FHIR search modifiers by appending ':modifier' to the parameter name: :missing, :not, :contains, :exact, :above, :below, :text, :of-type (not every modifier is meaningful for every parameter -- see each parameter's own description for its expected value syntax).",
   "inputSchema":{"type":"object","properties":{
     "birthdate":{"type":"string","description":"The patient's date of birth. (date) Prefix the value with a comparator for a range match: eq, ne, gt, lt, ge, le, sa, eb, ap (e.g. 'ge2020-01-01'). Omit the prefix for an exact match."},
     "name":{"type":"string","description":"A server defined search that matches any of the string fields in the HumanName. (string) Case-insensitive; matches values starting with the given text by default. Append ':exact' to the parameter name for an exact match, or ':contains' for a substring match anywhere in the value."},
     "general-practitioner":{"type":"string","description":"Patient's nominated general practitioner. (reference: Practitioner | Organization | PractitionerRole) Format: 'ResourceType/id', or bare 'id' to match against any of this parameter's allowed target types."}
   },"additionalProperties":true}},
  {"name":"fhir_search",
   "description":"Search any FHIR resource type not covered by a dedicated search_<resource> tool (dedicated tools already exist for: AllergyIntolerance, CarePlan, Condition, Coverage, DiagnosticReport, DocumentReference, Encounter, Immunization, MedicationRequest, Observation, Organization, Patient, Practitioner, Procedure). ...",
   "inputSchema":{"type":"object","properties":{"resourceType":{"type":"string"},"filters":{"type":"object","additionalProperties":{"type":"string"}}},"required":["resourceType"]}}
]},"jsonrpc":"2.0","id":1}
```

### 8.2 Dedicated tool — simple match

```json
{"jsonrpc":"2.0","id":2,"method":"tools/call",
 "params":{"name":"search_patient","arguments":{"name":"Smith","_count":"20"}}}
```

`McpToolHandler.handleSearchToolCall({ resourceType: 'Patient', args: { name: 'Smith', _count: '20' } })`
→ `r4ArgsParser.parseArgs(...)` → `searchBundleOperation.searchBundleAsync(...)` — identical to REST's
`GET /4_0_0/Patient?name=Smith&_count=20`.

### 8.3 Dedicated tool — date range + string modifier

```json
{"jsonrpc":"2.0","id":3,"method":"tools/call",
 "params":{"name":"search_patient",
           "arguments":{"birthdate":"ge2015-01-01","name:contains":"ithso"}}}
```

Patients born on/after 2015-01-01 whose name contains "ithso" anywhere (not just as a prefix) —
exercises both a comparator-prefixed *value* (§4's `TYPE_VALUE_SYNTAX_HINTS['date']`) and a
modifier-suffixed *key* (`name:contains`, accepted via `.passthrough()` even though `name` alone is
the only literal property in the schema).

### 8.4 Dedicated tool — token and reference filters

```json
{"jsonrpc":"2.0","id":4,"method":"tools/call",
 "params":{"name":"search_observation",
           "arguments":{"code":"http://loinc.org|2339-0","patient":"Patient/abc123"}}}
```

`code` uses the token `system|code` format; `patient` uses the reference `ResourceType/id` format —
both exactly as a REST caller would write them as query-string values
(`?code=http://loinc.org|2339-0&patient=Patient/abc123`).

### 8.5 Generic tool — a resource type with no dedicated tool

```json
{"jsonrpc":"2.0","id":5,"method":"tools/call",
 "params":{"name":"fhir_search",
           "arguments":{"resourceType":"Coverage","filters":{"status":"active","beneficiary":"Patient/abc123"}}}}
```

### 8.6 Generic tool — rejected because a dedicated tool exists

```json
{"jsonrpc":"2.0","id":6,"method":"tools/call",
 "params":{"name":"fhir_search","arguments":{"resourceType":"Patient"}}}
```

Response:

```
event: message
data: {"result":{"isError":true,"content":[{"type":"text","text":"Use the dedicated search_patient tool for Patient, not fhir_search."}]},"jsonrpc":"2.0","id":6}
```

### 8.7 Blocked before any tool ever runs: CMS-partner-user token

```bash
curl -s -X POST https://<host>/mcp -H 'Authorization: Bearer <cms-partner-jwt>' ...
```

Response: HTTP `403`, from the `forbidForUserTypes` middleware (§5) — the request never reaches the
JSON-RPC layer, so there is no `tools/call` response body here. Intentionally the same shape GraphQL
returns for this user type today.

## Resolved (confirmed by user on 2026-08-05)

1. **Commonly-used resource list** — the proposed 14-resource list in §4 is confirmed.
2. **MCP transport mode** — moot: verified against the actual `@modelcontextprotocol/server@2.0.0`
   API (this design originally assumed the older monolithic SDK/`StreamableHTTPServerTransport`,
   which is no longer accurate — see the implementation plan). The current SDK's `createMcpHandler`
   is per-request/stateless by construction; there is no separate stateful mode to choose between.
3. **REST's extra `OperationAccessManager.verifyAccess` gate** — **skip the per-call `verifyAccess`
   call** (matches GraphQL's precedent for `SearchBundleOperation` calls), but this required
   unpacking *why* GraphQL skips it rather than assuming "skip = safe," because its three providers
   are not equivalent:
   - `ResourceOperationAccessProvider` blocks writes to `AuditEvent` — moot for a read-only surface.
   - `DelegatedAccessManager` blocks writes for delegated-access users — moot because GraphQL v2 (and
     MCP v1) exposes no mutations at all, so there's no write path to gate.
   - `CMSManager` restricts CMS-partner-user tokens to `CMS_PARTNER_ACCESS.ALLOWED_RESOURCE_TYPES`
     (`['Patient']` only), GET method, `search`/`everything` operations, plus a `purposeOfUse` claim
     check — this is **not** a read/write distinction, it's a resource-type allowlist, so it is *not*
     structurally moot for a read-only surface. GraphQL satisfies it not by calling `verifyAccess` but
     via a **separate categorical block**: `app.js:441,447,482` mounts
     `forbidForUserTypes([AUTH_USER_TYPES.cmsPartnerUser])` in front of both GraphQL routers, 403-ing
     that user type before it ever reaches a resolver.
   - **Consequence for this design:** `/mcp` must mount that same `forbidForUserTypes([AUTH_USER_TYPES.cmsPartnerUser])`
     middleware (see the updated Task 9 in the implementation plan) — without it, a CMS-partner-user
     token would be able to search any resource type via MCP, a real regression relative to both
     REST and GraphQL's behavior for that user type. `McpToolHandler` still never calls
     `OperationAccessManager.verifyAccess` directly (that part of the GraphQL precedent holds), but
     the router-level exclusion it depends on must be replicated explicitly, not assumed to transfer.
4. **MCP client auth model** — bearer JWT only (matching current REST/GraphQL auth) is sufficient for
   now. No OAuth 2.1 discovery/dynamic client registration needed in v1.
5. **New dependency** — resolved during implementation planning: the real current packages are
   `@modelcontextprotocol/server@2.0.0` and `@modelcontextprotocol/node@2.0.0` (not a single
   `@modelcontextprotocol/sdk` package as originally assumed here), plus `zod@^4.4.3`. No known
   version-lock conflict.
6. **`$everything`/`$graph`/proxy-patient tools** — confirmed out of scope for v1.
