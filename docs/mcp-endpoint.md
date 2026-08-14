# MCP Endpoint: AI Agent Access to FHIR Search

This documents the `/mcp` endpoint, which exposes read-only [Model Context Protocol](https://modelcontextprotocol.io)
(MCP) tools for querying FHIR resources — added so MCP-compatible AI agent clients can search this
server's data without a parallel, drift-prone reimplementation of search, filtering, or access
control.

For the design rationale, the auth gaps found and fixed during implementation, and the resolved
open questions, see `docs/superpowers/specs/2026-08-05-mcp-endpoint-design.md` and
`docs/superpowers/plans/2026-08-05-mcp-endpoint.md`. This doc describes the shipped surface as it
exists in code today.

Per `CLAUDE.md`'s security-sensitive-changes rule, this endpoint touches resource search/read —
read `review.md` before modifying anything under `src/mcp/` or the `/mcp` mount in `src/app.js`.

## Feature flag

The endpoint is gated by `ENABLE_MCP` (default off — falsy/unset means disabled). Set
`ENABLE_MCP=true` to mount it. See `ConfigManager.enableMcp` (`src/utils/configManager.js`).
`McpServer`'s constructor does eager, boot-time work, so the entire mount — including construction
— is skipped when the flag is off, ensuring a mis-wired MCP dependency can't break app boot for
everyone else.

## Scope (v1)

Read-only. Only search tools — no create/update/patch/remove/merge, and no `$everything`/`$graph`/
proxy-patient traversal tools (those are explicitly out of scope for v1 and would need their own
`review.md`-guided design).

## Architecture

```
Express app (src/app.js)
  └─ app.use('/mcp', mcpRouter)   [behind ENABLE_MCP]
       ├─ passport JWT auth (same strategy as REST/GraphQL)
       ├─ forbidForUserTypes([AUTH_USER_TYPES.cmsPartnerUser])
       ├─ buildMcpRequestContext   (builds FhirRequestInfo, stores it in httpContext)
       ├─ createPostRequestCleanupMiddleware()   (audit-log flush + cache cleanup)
       └─ McpServer (src/routeHandlers/mcpServer.js)
            ├─ @modelcontextprotocol/server createMcpHandler + McpServer
            └─ McpToolHandler (src/mcp/mcpToolHandler.js)
                 ├─ r4ArgsParser.parseArgs(...)                    [existing]
                 ├─ patientDataViewControlManager.getConsentAsync  [existing — consent exclusion]
                 ├─ queryRewriterManager.rewriteArgsAsync(...)     [existing — proxy-patient, reference rewriting]
                 └─ searchBundleOperation.searchBundleAsync(...)   [existing — same class REST/GraphQL call]
```

Every tool call bottoms out in `SearchBundleOperation.searchBundleAsync` — the same class
`FhirOperationsManager` (REST) and `FhirDataSource` (GraphQL) call. No MCP-specific data-access code
exists; `src/mcp/` never touches `src/dataLayer/` or MongoDB directly.

### Request flow (`McpToolHandler.handleSearchToolCall`, `src/mcp/mcpToolHandler.js`)

1. Read the per-request `FhirRequestInfo` out of `httpContext` (see [Request-scoped state](#request-scoped-state-on-a-singleton) below).
2. `r4ArgsParser.parseArgs({ resourceType, args })` — MCP tool arguments use the same
   `{ paramName: value }` / `{ 'paramName:modifier': value }` shape as REST query strings.
3. If the caller is patient-scoped (`requestInfo.isUser`), replicate the patient
   data-connection-view-control (consent) exclusion GraphQL v2 applies in
   `src/graphqlv2/dataSource.js`'s `getParsedArgsAsync`: prime the person-owner context via
   `patientScopeManager.getPatientIdsFromScopeAsync`, then merge
   `patientDataViewControlManager.getConsentAsync`'s per-resource-type exclude-id map into the
   parsed args as a real `_id:not` `ParsedArgsItem` (a bare bracket assignment on `parsedArgs` is
   not read by the query builder — see the comment at `mcpToolHandler.js:160-194` for why this must
   be a `.add()` call, and why the exclusion uses `$or` rather than `dataSource.js`'s `$and`).
4. `queryRewriterManager.rewriteArgsAsync(...)` — same call REST/GraphQL make, so
   `id|sourceAssigningAuthority`-form references and `Patient/person.<personId>` proxy-patient
   references resolve correctly.
5. `searchBundleOperation.searchBundleAsync(...)`.
6. Map the result to an MCP tool response: `{ content: [...], structuredContent: bundle }` on
   success, `{ isError: true, content: [...] }` (an `OperationOutcome`, HIPAA/HITRUST-safe — no
   stack traces for 5xx-class errors) on failure.

## Auth and scope enforcement

`/mcp` sits behind the same passport JWT middleware as GraphQL, so `req.authInfo` and the resulting
`FhirRequestInfo` are built identically. SMART scope validation and patient/tenant/security-tag row
filtering happen automatically inside `SearchBundleOperation`/`SearchManager` — no MCP-specific
logic needed there. Three mechanisms live in the *callers* of `SearchBundleOperation` rather than
inside it, so they don't come for free and each needed explicit handling:

- **CMS-partner-user resource-type allowlist.** `CMSManager` restricts CMS-partner tokens to
  `Patient`-only searches; GraphQL enforces this via a router-level
  `forbidForUserTypes([AUTH_USER_TYPES.cmsPartnerUser])` block rather than a per-call
  `OperationAccessManager.verifyAccess`. `/mcp`'s router mounts the identical middleware — without
  it, a CMS-partner token could search any resource type through MCP.
- **Patient data-connection-view-control (consent) exclusion** — see step 3 above. Missing this
  would have let a consent-excluded `Observation` (or other resource) that's correctly hidden from
  a connected app via GraphQL be visible to that same app through `/mcp`.
- **Post-response audit-log flush.** `SearchBundleOperation` only *queues* the PHI-access audit
  entry via `postRequestProcessor.add(...)`; nothing drains that queue automatically. REST and
  GraphQL each flush it explicitly after the response is sent. `/mcp`'s router mounts
  `createPostRequestCleanupMiddleware()` to do the same — without it, every `/mcp` read would be
  silently absent from the audit trail and `PostRequestProcessor`/`RequestSpecificCache` would leak
  one entry per request.

`McpToolHandler` itself never calls `OperationAccessManager.verifyAccess` directly, matching
GraphQL's precedent for read-only search.

### Request-scoped state on a singleton

`McpToolHandler` is registered once in the IoC container and shared across every request/tenant. It
holds no per-request data as instance state: the per-request `FhirRequestInfo` is fetched fresh on
every tool call via `httpContext.get(MCP_REQUEST_INFO_CONTEXT_KEY)` (`express-http-context`'s
`AsyncLocalStorage`-backed store, populated by `buildMcpRequestContext` in `src/app.js`) — the same
pattern `postRequestProcessor.executeAsync` already relies on. This matters because a wrong answer
here is exactly the cross-tenant data-bleed shape `review.md` warns about; the consent-exclusion
lookup in step 3 is likewise re-fetched per call rather than cached on `this`, since caching it
would leak one request's exclude-list into another.

## Tools

Two tiers, following the pattern REST/GraphQL codegen already uses for FHIR classes and GraphQL
schemas:

- **Dedicated tools** (`src/mcp/tools/<resource>.tool.js`, generated) — one `search_<resource>`
  tool per resource in the hand-maintained curated list in
  `generatorScripts/mcp/commonly_used_resources.json`:

  ```
  Patient, Observation, Condition, MedicationRequest, AllergyIntolerance, Immunization, Procedure,
  DiagnosticReport, Encounter, CarePlan, Coverage, DocumentReference, Practitioner, Organization,
  Person, MedicationDispense, Composition, Subscription, SubscriptionStatus, SubscriptionTopic,
  Appointment, ServiceRequest, MedicationStatement, CareTeam, Goal, FamilyMemberHistory,
  ImmunizationRecommendation, ExplanationOfBenefit, Claim, QuestionnaireResponse, RelatedPerson
  ```

  `Subscription`/`SubscriptionStatus`/`SubscriptionTopic` model b.well's per-connection data-source
  metadata (see the internal FDR "Storing connection status and metadata (Subscription)"): one
  `SubscriptionTopic` + `Subscription` + `SubscriptionStatus` triple per patient data connection,
  sharing one deterministic id, letting a caller answer "what are my data sources" (search
  `SubscriptionTopic` by its `identifier`) and "when did my data last arrive" (fetch the matching
  `SubscriptionStatus` by that same id and read `notificationEvent`/error extensions). `Subscription`
  and `SubscriptionStatus` also get an `extension` field (and `SubscriptionStatus` a `subscription`
  field) documenting b.well-specific search parameters that have no standard HL7 `SearchParameter`
  definition (so they don't come from `search-parameters.json` the way every other field here
  does) — `extension` mirrors `patientFilterManager.personFilterWithQueryMapping`'s own
  `extension=.../client_person_id|{person}` filter verbatim, which is also what enforces
  patient-scope isolation for these two resource types (they have no `patient`/`subject` search
  parameter, so they sit outside the generic patient-compartment mechanism every other dedicated
  tool relies on — see `src/fhir/patientFilterManager.js`). Both fields are loaded by the generator
  from `src/searchParameters/customSearchParameterQueries.json` — the same file
  `SearchParametersManager.js` reads at runtime for these non-standard parameters — rather than
  hand-duplicated as a separate Python declaration, so a new custom parameter added there is picked
  up automatically the next time `make mcp` runs (see `generate_mcp_tools.py`'s
  `load_custom_search_parameters_by_resource`). Only `Subscription`/`SubscriptionStatus` surface the
  generic `Resource`-level `extension` field in their schema
  (`RESOURCE_TYPES_NEEDING_GENERIC_CUSTOM_PARAMS`) — a deliberate, hand-maintained UX decision, since
  `extension` is technically usable on every resource but would be noisy to document everywhere.

  Each has a typed Zod `inputSchema` with one `z.string().optional()` field per real FHIR search
  parameter for that resource (plus `_id`, `_lastUpdated`, `_count`, `_sort` on every resource),
  `.passthrough()`-enabled so callers can append modifier suffixes (`name:contains`) not present as
  literal schema keys, and a shared `fhirBundleOutputSchema`
  (`src/mcp/fhirBundleOutputSchema.js`).

- **Generic tool** (`fhir_search`, hand-written — `src/mcp/genericFhirSearchTool.js`) — covers every
  other resource type: a `resourceType` argument plus an untyped `filters` string map, passed
  through to `R4ArgsParser` verbatim. Calling `fhir_search` for a resource type that already has a
  dedicated tool returns an error directing the caller to use the dedicated tool instead.

Each generated field's description is `"<FHIR description> (<type>[: target types]) <type-specific
syntax hint>"` — e.g. a `date` field explains the `ge`/`le`/etc. comparator-prefix convention, a
`token` field explains `system|code` vs. bare `code`, a `reference` field explains `ResourceType/id`
format and lists allowed target types. The per-type hints live in one generated lookup table,
`src/mcp/typeValueSyntaxHints.js`, keyed by `SearchParameter.type` — verified against this
codebase's actual filter implementations (`src/operations/query/filters/*.js`), not just the FHIR
spec text, since the two don't always agree (e.g. this server's `canonical` filter does a plain
exact match and does not parse the `|version` suffix the spec generally allows). The generic tool's
description spells out the same cheat sheet in prose so it isn't left silently unresolved for
resource types with no per-field schema to attach a hint to.

Every FHIR search modifier (`:missing`, `:not`, `:contains`, `:exact`, `:above`, `:below`, `:text`,
`:of-type`) and the comma-separated-OR convention apply the same way regardless of resource or
parameter type, so they're documented once in each tool's top-level description rather than
per-field.

## Code generation

New generator following the existing Jinja2 convention (`generatorScripts/classes/`,
`generatorScripts/graphqlv2/`):

- `generatorScripts/mcp/generate_mcp_tools.py` — reads the same `search-parameters.json` bundle the
  existing search-parameters generator reads, plus
  `src/searchParameters/customSearchParameterQueries.json` for non-standard fields (see `Tools`
  above), builds the `TYPE_VALUE_SYNTAX_HINTS` table, and renders one file per curated resource plus
  the barrel `src/mcp/tools/index.js`.
- `generatorScripts/mcp/template.mcp_tool.jinja2` — per-resource tool template.
- `generatorScripts/mcp/commonly_used_resources.json` — the curated resource list; hand-maintained,
  not generated. It's the single source of truth for both which resources get a generated file and
  (via `DEDICATED_RESOURCE_TYPES` in `genericFhirSearchTool.js`) which resource names the generic
  tool rejects in favor of a dedicated tool.

Run via `make mcp` (wired into `make generate`):

```bash
make mcp
```

## Example tool calls

Wire format is Streamable HTTP, JSON-RPC 2.0, SSE-wrapped responses. `<jwt>` is the same bearer
token REST/GraphQL callers already use.

List available tools:

```bash
curl -s -X POST https://<host>/mcp \
  -H 'Authorization: Bearer <jwt>' \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Dedicated tool, simple match — equivalent to REST's `GET /4_0_0/Patient?name=Smith&_count=20`:

```json
{"jsonrpc":"2.0","id":2,"method":"tools/call",
 "params":{"name":"search_patient","arguments":{"name":"Smith","_count":"20"}}}
```

Dedicated tool, date range plus a string modifier:

```json
{"jsonrpc":"2.0","id":3,"method":"tools/call",
 "params":{"name":"search_patient",
           "arguments":{"birthdate":"ge2015-01-01","name:contains":"ithso"}}}
```

Dedicated tool, token and reference filters:

```json
{"jsonrpc":"2.0","id":4,"method":"tools/call",
 "params":{"name":"search_observation",
           "arguments":{"code":"http://loinc.org|2339-0","patient":"Patient/abc123"}}}
```

Generic tool, a resource type with no dedicated tool:

```json
{"jsonrpc":"2.0","id":5,"method":"tools/call",
 "params":{"name":"fhir_search",
           "arguments":{"resourceType":"Coverage","filters":{"status":"active","beneficiary":"Patient/abc123"}}}}
```

## Dependencies

`@modelcontextprotocol/server`, `@modelcontextprotocol/node` (both `^2.0.0`), and `zod` (`^4.4.3`)
— see `package.json`. The `@modelcontextprotocol/server` SDK's `createMcpHandler` is
per-request/stateless by construction; there is no separate stateful transport mode to configure.

## Testing

- `src/tests/mcp/mcpEndpoint.integration.test.js` — integration coverage via the existing
  `createTestContainer.js`/MongoDB Memory Server pattern: dedicated and generic tool searches match
  equivalent REST results, patient/tenant-scoped tokens restrict results identically to REST/
  GraphQL, error mapping for forbidden/unknown-resource calls, and the audit-cleanup/self-heal path.
- `src/tests/mcp/mcpResourceAuthorization.integration.test.js` — end-to-end proof, through the
  real `/mcp` route, that every `docs/resource-authorization.md` mechanism reachable from a
  read-only search surface is actually enforced when driven by MCP's tool-call argument shape:
  access-tag tenant isolation and the `access/*` wildcard bypass (§1, §7), delegated-actor consent
  gate and sensitivity denylist (§6c, §10 steps 3-5), hidden-tag default exclusion (§8), confidentiality-`R`
  exclusion for patient-scoped callers (§9), and the `AuditEvent` required-filters gate (§3). See
  `docs/superpowers/plans/2026-08-14-mcp-resource-authorization-test-coverage.md` for why other
  sections of that doc (§2, §4, §6a, §6b, admin/debug params) don't need their own MCP-level test.
- `src/tests/mcp/dedicated_tools/` — per-tool coverage for all 31 generated dedicated tools.
- `src/tests/unit/mcp/mcpToolHandler.test.js` — unit coverage for `McpToolHandler`, including
  asserting the consent-exclusion merge against `parsedArgs.parsedArgItems` directly (the structure
  the query builder actually reads), not just the cosmetic bracket property.
- `src/tests/unit/mcp/genericFhirSearchTool.test.js`, `src/tests/unit/routeHandlers/mcpServer.test.js`,
  `src/tests/unit/routeHandlers/mcpFeatureFlag.test.js` — unit coverage for the generic tool
  definition, the route handler, and the `ENABLE_MCP` gate.
- `generatorScripts/mcp/test_generate_mcp_tools.py` — generator unit tests.
- `src/tests/unit/searchParameters/customSearchParameterQueries.test.js` — characterization
  coverage for `SearchParametersManager`'s non-standard search parameters (`extension`,
  `SubscriptionStatus.subscription`, `ExportStatus.status`), backed by
  `customSearchParameterQueries.json`, the same file `generate_mcp_tools.py` reads.

## Known limitations (v1)

- Read-only: no write tools, and no `$everything`/`$graph`/proxy-patient-traversal tools.
- The generic tool's filter-value syntax cheat sheet is generated from the same
  `TYPE_VALUE_SYNTAX_HINTS` table the dedicated tools use, so the two can't silently drift apart —
  but any future addition to that table needs regenerating both call sites (`make mcp`), not just
  one.
