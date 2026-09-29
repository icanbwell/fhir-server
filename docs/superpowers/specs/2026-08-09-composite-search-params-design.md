# Composite FHIR Search Parameter Support — Design

## Background

FHIR search parameters of `type: 'composite'` (e.g. `Observation`'s `code-value-quantity`,
`component-code-value-quantity`, `combo-code-value-quantity`; `DocumentReference`'s `relationship`)
pair two or more other search parameters so a caller can match them together against the same
resource instance (or the same repeating sub-element).

This server does not currently support them, and does so silently:

- `generatorScripts/searchParameters/generate_search_parameters.py` only turns a `SearchParameter`
  entry into a filterable `QueryEntry` when it has an `xpath` mapping to a single field
  (`if xpath_transformed:`). Composite entries have no `xpath` — they express their meaning via a
  `component[]` array instead — so they are silently absent from the generated
  `src/searchParameters/searchParameters.js` entirely.
- `searchParametersManager.getPropertyObject` therefore returns `undefined` for any composite param
  code.
- `R4ArgsParser.parseArgs` (`src/operations/query/r4ArgsParser.js:147-172`), when `propertyObj` is
  `undefined` and `handling` isn't `STRICT_SEARCH_HANDLING` (true for every `/mcp` call and most
  REST/GraphQL calls), still creates a `ParsedArgsItem` and moves on — no error.
- `R4SearchQueryCreator`'s filter builder (`src/operations/query/r4.js:221-258`) then skips the
  whole `switch` because `propertyObj` is falsy, contributing **zero** Mongo filter conditions for
  that item.

Net effect: a caller supplying e.g. `code-value-quantity=8480-6$ge140` gets no error and no
filtering — the parameter is accepted and silently ignored, returning an unfiltered result set that
looks like it was filtered.

This gap was found while building `generatorScripts/mcp/generate_mcp_tools.py` (an MCP tool-schema
generator that derives each dedicated `search_<resource>` tool's input schema from
`search-parameters.json`), which currently lists composite params in tool descriptions with no
working filter behind them at all.

Composite params are absent from the ClickHouse-backed analytics path too — the "composite" hits in
`genericClickHouseQueryBuilder.js` are unrelated (composite *pagination cursor* tuples, not FHIR
composite search parameters). There is no existing composite-search-parameter implementation
anywhere in this codebase to build on; this is new.

## Scope

Fix this generically in the shared query-building layer
(`r4.js` / `r4ArgsParser.js` / `generate_search_parameters.py`), not narrowly for MCP. REST, GraphQL,
and MCP all route through the same query builder, so a fix there benefits all three callers
automatically with no caller-specific code changes. Support is for any resource type in
`search-parameters.json` that declares a composite parameter, not just the MCP-curated resource
list — 46 composite parameters total across the FHIR R4 spec bundle (42 with 2 components, 4
genomics ones — `chromosome-variant-coordinate`, `chromosome-window-coordinate`,
`referenceseqid-variant-coordinate`, `referenceseqid-window-coordinate` — with 3).

Once server-side filtering works, close the loop on the originating gap: give
`generate_mcp_tools.py`'s `TYPE_VALUE_SYNTAX_HINTS` a real `'composite'` entry (it currently has none,
so composite fields render with only their bare FHIR description and no value-syntax guidance) so
the MCP tool schemas' composite fields finally carry an honest, working hint.

## How composite parameters resolve (key insight)

A composite parameter's own top-level `expression` field, split on `|`, already tells you every
"scope" it applies to — no need to hardcode FHIR's `combo-` naming convention as a special case:

| Composite param | `expression` | Meaning |
|---|---|---|
| `code-value-quantity` | `Observation` | root scope only: two singular top-level fields, plain AND |
| `component-code-value-quantity` | `Observation.component` | array scope only: both components must match *within the same* `component[i]` |
| `combo-code-value-quantity` | `Observation \| Observation.component` | OR of both shapes above |

Each `component[]` entry within a composite definition carries a `definition` URL pointing at
*another* `SearchParameter` in the same bundle (e.g. `.../SearchParameter/Observation-value-quantity`)
— a definition that already has its own resolvable `xpath` and is already correctly turned into a
regular `QueryEntry` (with `field`/`fields`/`type`) by the existing generator logic. So composite
components can be resolved by looking up that referenced code in the *already-built* per-resource
table, reusing proven field-mapping logic — no new FHIRPath-to-field parser needed for the common
case.

**Refinement found while designing (genomics case):** scope resolution must happen **per
component**, not per whole composite. Two of the four genomics composites use a `%resource.`
FHIRPath prefix on exactly one of their components to reach back to the resource root, while their
other components stay inside the composite's own array scope. E.g. `chromosome-variant-coordinate`
has `expression: "MolecularSequence.variant"`, but its first component is
`%resource.referenceSeq.chromosome` (root-level) while its other two (`start`, `end`) are fields
*within* `variant[i]`. So each component in `scopes[].components[]` carries its own
`arrayField: null | <path>` rather than inheriting one array field from its parent scope; a
`%resource.`-prefixed component always resolves against the resource root regardless of the
composite's own outer scope.

## Approach

**Chosen: metadata-driven generic composite engine.** (Alternatives considered: a hand-authored
static composite table — rejected, creates a second hand-maintained source of truth that drifts
against this codebase's regenerate-from-spec philosophy, and the stated goal of exhaustive
46-parameter coverage makes that maintenance burden real; and aggregation-pipeline `$expr`
evaluation — rejected, every other filter type in this codebase produces a plain `find()`-compatible
`Filter` object, and `$elemMatch` already covers the same pairing semantics without that structural
detour.)

## Architecture & Components

1. **`generatorScripts/searchParameters/generate_search_parameters.py`** (extended): after building
   the per-resource table of regular `QueryEntry`s, add a second pass over `type == 'composite'`
   entries:
   - Split the composite's own `expression` on `|` into scopes (root vs. an array path).
   - For each component: if its own `expression` starts with `%resource.`, resolve it against the
     resource-root table regardless of the enclosing scope; otherwise resolve its `definition` URL
     → referenced code → look that code up in the per-resource (or generic `Resource`-level, for
     cross-resource components like `clinical-code`) table already built in pass 1.
   - Emit `SearchParameterDefinition{ type: 'composite', scopes: [{ components: [{ field, fields,
     type, arrayField }, ...] }, ...] }` into the same generated `searchParameters.js` regular
     params already live in.
   - Fail loudly (raise) if a component's `definition` URL doesn't resolve to any known code — a
     silently-wrong composite definition is worse than a build failure.

2. **`src/operations/query/filters/composite.js`** (new): `FilterByComposite extends BaseFilter`,
   matching the shape of `token.js`/`quantity.js`. Splits the search value on `$` into exactly
   `components.length` parts (per scope being evaluated); a mismatched count throws
   `BadRequestError`. For each scope: AND together one sub-filter per component — reusing the
   existing per-type filter classes (`FilterByToken`, `FilterByQuantity`, `FilterByDateTime`,
   `FilterByString`, `FilterByReference`) via their own `{field, type}` — wrapping components whose
   `arrayField` is set in a Mongo `$elemMatch` on that path, and ANDing root-scoped (or
   `%resource.`-resolved) components outside any `$elemMatch`. All scopes' conditions are OR'd
   together for the final result.
   - Modifiers `:contains`/`:exact`/`:above`/`:below`/`:text`/`:of-type` are explicitly rejected
     with `BadRequestError` for composite params — they're single-value-type concepts with no
     coherent meaning split across N differently-typed components, and silently applying one to
     only one component risks a caller believing it applied everywhere it didn't.
   - `:not` and `:missing` need no special handling: `:not` is already wrapped in `$nor` generically
     upstream of the type switch, and `:missing` just checks the resolved field paths for absence
     like any other type.
   - Comma-separated OR of multiple composite pairs (e.g. `code-value-quantity=8480-6$ge140,
     8462-4$ge90`) needs no special handling either — `QueryParameterValue`/`R4ArgsParser` already
     split on comma before any type-specific filter runs, so `filterByItem` only ever sees one
     `$`-joined pair at a time.

3. **`src/operations/query/r4.js`**: add `case fhirFilterTypes.composite:` to the existing type
   switch (`andSegments = new FilterByComposite(filterParameters).filter(); break;`), replacing what
   currently falls through to `default: throw new Error('Unknown type=...')`.

4. **`src/operations/query/customQueries.js`**: add `composite: 'composite'` to the
   `fhirFilterTypes` enum.

5. **`generatorScripts/mcp/generate_mcp_tools.py`**: once the above works, add a real
   `TYPE_VALUE_SYNTAX_HINTS['composite']` entry describing the `$`-joined value format.

No changes are needed to `McpToolHandler`, `SearchBundleOperation`, or any REST/GraphQL entry point —
the fix lives entirely inside the shared query-building layer, so all three callers gain composite
support automatically once this lands.

## Data Flow

**Generation-time** (`make searchParameters`):
```
search-parameters.json (raw HL7 bundle)
  -> generate_search_parameters.py, pass 1: build per-resource table of regular QueryEntrys (unchanged)
  -> generate_search_parameters.py, pass 2 (new): for each type=='composite' entry
       split expression on '|' -> scopes
       for each scope, for each component: resolve (definition URL, or %resource. override) -> code -> lookup in pass-1 table
       emit SearchParameterDefinition{ type:'composite', scopes:[...] }
  -> src/searchParameters/searchParameters.js (generated, new content, same file)
```

**Request-time** (REST, GraphQL, or MCP — all funnel through the same query builder):
```
caller supplies e.g. code-value-quantity=8480-6$ge140
  -> R4ArgsParser.parseArgs: getPropertyObject() now finds the composite's SearchParameterDefinition
     (previously undefined) -> ParsedArgsItem created normally, no special-casing
  -> R4SearchQueryCreator (r4.js): switch(propertyObj.type) hits new `case fhirFilterTypes.composite`
  -> FilterByComposite.filter(): split value on '$' -> ['8480-6', 'ge140']
       for each scope in propertyObj.scopes:
         build one Mongo condition per component (reusing FilterByToken/FilterByQuantity/etc.)
         AND them; wrap arrayField-scoped components in $elemMatch on that path
       OR all scopes' conditions together
  -> andSegments feeds into the same appendAndQuery/$and assembly every other filter type already uses
```

## Testing Plan

1. **Generator tests** — `generatorScripts/searchParameters/test_generate_search_parameters.py`
   (new, naming convention matches `generatorScripts/mcp/test_generate_mcp_tools.py`):
   - Targeted cases for each scope shape: root-only, array-only, OR-of-scopes, and both genomics
     shapes (with and without a `%resource.` override).
   - One exhaustive parametrized test looping over all 46 `type=='composite'` entries in the real
     `search-parameters.json`, asserting each resolves to a valid `scopes[]` structure with every
     component's field/type populated.
   - Failure-mode case: an unresolvable `definition` URL raises during generation.

2. **Filter unit tests** — `src/tests/unit/operations/query/filters/composite.test.js` (new,
   matching the existing `token.test.js`/`quantity.test.js` convention):
   - Root-only AND, array-only `$elemMatch`, OR-of-scopes, and the 3-component `%resource.`-override
     case, each asserting the exact Mongo filter object produced.
   - Mismatched `$`-part count -> `BadRequestError`.
   - Rejected modifier (e.g. `:contains`) -> `BadRequestError`.

3. **End-to-end tests** — `src/tests/searchParameters/search_by_composite/` (new, matching the
   existing `search_by_token/`, `search_by_quantity/` convention), against Mongo Memory Server:
   - REST: `code-value-quantity` (simple AND) and `component-code-value-quantity` (`$elemMatch`)
     each actually narrow results between two similar Observations that differ only in the paired
     vs. unpaired code/value.
   - MCP: the same narrowing, called through `search_observation`'s tool handler — confirms
     `McpToolHandler` needs zero composite-specific code.
   - A regression test asserting the *old* behavior (silent no-op) is gone — the composite filter
     demonstrably changes the result set, not just "doesn't error."

4. **MCP generator test update** — `generatorScripts/mcp/test_generate_mcp_tools.py`: once
   `TYPE_VALUE_SYNTAX_HINTS['composite']` is added, assert a composite field's rendered description
   carries the real hint instead of the bare FHIR description.

## Out of Scope

- Any change to `McpToolHandler`, `SearchBundleOperation`, GraphQL resolvers, or REST route handlers
  — the fix is entirely in the shared query-building layer.
- The ClickHouse-backed analytics search path — no composite search parameter support exists there
  today and this design does not add it.
- Escaping a literal `$` within a single component's own value — FHIR's composite search syntax
  does not define an escape mechanism for this, and no component type in the 46-parameter target
  set (token/quantity/date/string/reference) legitimately produces a literal `$` in its own value
  syntax today.
