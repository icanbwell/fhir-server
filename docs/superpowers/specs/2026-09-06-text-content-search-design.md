# `_text` / `_content` Full-Text Search Parameters — Design

## Background

Per the FHIR search spec (https://hl7.org/fhir/R4B/search.html#content), `_text` and `_content` are
"special"-type search parameters available on every resource type:

- `_text` searches the resource's narrative (`Resource.text.div`).
- `_content` searches the entire content of the resource.
- The value is a text query supporting multiple words, logical `AND`/`OR`, and parentheses, e.g.
  `Condition?_text=(bone OR liver) and metastases`. A server "MAY" also do thesaurus/related-word
  expansion — explicitly optional.

Both names are already listed in `SPECIFIED_QUERY_PARAMS` (`src/constants.js:181`), so they're
accepted rather than rejected under strict handling — but nothing resolves them to a
`SearchParameterDefinition`. `SearchParametersManager.getPropertyObject` returns `undefined` for
both, so `R4ArgsParser.parseArgs` creates a `ParsedArgsItem` with `propertyObj: undefined`, and
`R4SearchQueryCreator.buildR4SearchQuery`'s loop guard (`src/operations/query/r4.js:81`) skips it
entirely. Same silent-no-op failure mode #2483 fixed for composite params — a caller supplying
`_text=diabetes` gets no error and an unfiltered result set.

## Prior art discovered: ADR-0003 / `hybrid-full-text-search` (branch `atlas-search-tech-design`)

While designing this, found live, unmerged work — also stacked on PR #2564, sibling to
`composite-search-params` — that routes Patient/Person/Practitioner name/identifier search through
MongoDB **Atlas Search** (`$search`/`compound`) against an index called `hybrid-full-text-search`,
owned and provisioned by `person-matching-service`, not this repo. This proves two things that
change this design:

- **Production MongoDB is real Atlas**, not generic self-hosted `mongod` — `$search`,
  `collection.createSearchIndex()`/`listSearchIndexes()`/`dropSearchIndex()` are genuinely
  available, not hypothetical.
- There's an established, working convention worth reusing: per-resource-type env-var gating
  (`ATLAS_SEARCH_ENABLED_<RESOURCE>` / `ConfigManager.isAtlasSearchEnabled(resourceType)`),
  automatic fallback to the pre-existing query path on any Atlas error, and a
  `$search` + `$match`-the-full-existing-filter pipeline shape executed via the existing
  `DatabaseQueryManager.findUsingAggregationAsync({ query: pipeline, extraInfo: {
  matchQueryProvided: true } })` escape hatch.

`hybrid-full-text-search` itself is **not reusable** for `_text`/`_content`: it's owned by a
different service for a different purpose (candidate blocking for `$match`), and only maps
name/identifier/gender/birthDate/telecom — nothing resembling narrative or general resource
content. This design creates its **own**, fhir-server-owned Atlas Search index instead, but
follows the same operational patterns for consistency.

## Scope

Implement `_text`/`_content` generically across all resource types via the shared query-building
layer — no REST/GraphQL/MCP-specific code (same precedent as composite params). Two backends
share one parsed AST:

- **Atlas Search path** (preferred, where configured): a new, fhir-server-owned Atlas Search index
  per collection, queried via `$search`/`compound`, natively expressing the spec's `AND`/`OR`/
  paren grammar through nested `compound.must`/`should` clauses — no regex-tree translation
  needed for this path.
- **Regex fallback path** (always available, used when a resourceType isn't Atlas-configured, or
  on any Atlas error): `_text` matches `text.div`; `_content` OR-matches across every field this
  resourceType's already-generated `SearchParameterDefinition` table
  (`src/searchParameters/searchParameters.js`) marks `string`/`token`/`uri` typed — reusing
  existing per-resource field metadata, no new schema-walking codegen, no migration.

## Which collections use Atlas Search: config, not a per-resource switch

Unlike ADR-0003's fixed 3-resource-type switch (`isAtlasSearchEnabled`), `_text`/`_content` apply
to potentially most/all of the ~150 generated resource types — a switch-per-resourceType doesn't
scale here. Follow the older, list-based convention already in `configManager.js`
(`ACCESS_TAGS_INDEXED_*`, `CLOUD_STORAGE_HISTORY_RESOURCES`) instead:

```js
get fullTextSearchAtlasIndexedResources () {
    return (env.FULL_TEXT_SEARCH_ATLAS_INDEXED_RESOURCES &&
        env.FULL_TEXT_SEARCH_ATLAS_INDEXED_RESOURCES.split(',').map(r => r.trim())) || [];
}
```

A resourceType's collection can get its Atlas Search index built and only then get added to this
list in that environment's config — regex-based (if slower) behavior before that point, no risk of
a "no such index" Mongo error, and the index rollout schedule is fully decoupled from the code
deploy, mirroring ADR-0003's own reasoning for its per-resource flags.

## Approach

**Chosen:** one shared parser (`textQueryParser.js`) produces an AST from the `AND`/`OR`/paren/
quoted-phrase grammar; two interchangeable backends translate that same AST — an Atlas `compound`
builder, and a Mongo regex-tree builder — selected per request based on
`fullTextSearchAtlasIndexedResources` and Atlas error fallback.

**Alternatives considered:**
- *Reuse `hybrid-full-text-search`* — rejected: wrong owner, wrong field mapping (see Prior Art
  above).
- *Plain MongoDB `$text` (classic text index) instead of Atlas Search* — rejected now that Atlas
  Search is confirmed available: `$text` only allows one text index per collection and can't be
  scoped to a field subset per query, whereas Atlas Search supports multiple independently-named
  indexes per collection and per-query `path` scoping — which is exactly what's needed to serve
  `_text` (narrative-scoped) and `_content` (broad) from query-time `path` selection against a
  *single* shared index, and its `compound` operator expresses `AND`/`OR`/parens natively instead
  of needing a bolted-on regex fallback for anything but pure conjunctions.
- *Pure regex for everything, no Atlas* — rejected: no relevance/index leverage on what could be
  the highest-cardinality search across large collections, exactly where Atlas Search earns its
  keep, and the infrastructure to do it properly is now confirmed to exist.

## Architecture & Components

1. **`src/utils/textQueryParser.js`** (new) — tokenizer + recursive-descent parser for `term`,
   `"quoted phrase"`, `AND`/`OR` (case-insensitive keywords), `(`/`)`, implicit `AND` between
   adjacent terms. Produces an AST (`{type: 'and'|'or'|'term'|'phrase', ...}`). Throws
   `BadRequestError` on unbalanced parens or a dangling operator. Shared by both backends below.

2. **`src/operations/search/fullTextSearchQueryBuilder.js`** (new, parallel to the existing
   `atlasSearchQueryBuilder.js`) — AST → Atlas `compound` query:
   - `and` node → `compound.must: [...]`; `or` node → `compound.should: [...]`, `minimumShouldMatch: 1`.
   - `term`/`phrase` leaf → `{ text: { query, path } }` / `{ phrase: { query, path } }`.
   - `path` = `'text.div'` for `_text`; `path: { wildcard: '*' }` for `_content` — one shared,
     dynamically-mapped index serves both; the distinction is made entirely at query time via
     `path`, not via separate indexes or index mappings.
   - Returns `null` (fall-back signal) if: `_text`/`_content` isn't present in `parsedArgs`, or
     `configManager.fullTextSearchAtlasIndexedResources` doesn't include this resourceType, or the
     existing `AtlasSearchQueryBuilder` already returned a non-null compound for this request (see
     Mutual Exclusion below).

3. **Mutual exclusion with the existing `AtlasSearchQueryBuilder`.** MongoDB requires `$search` to
   be the first stage of a pipeline — a single request can't run two independent `$search` stages.
   If a request is eligible for *both* the existing Patient/Person/Practitioner name/identifier
   Atlas path *and* this `_text`/`_content` Atlas path, the existing feature takes precedence and
   `_text`/`_content` falls back to the regex path for that request. Documented as an accepted,
   narrow limitation (see Out of Scope) — merging two compounds into one `$search` stage is real
   future work, not attempted here.

4. **`SearchManager` hook point** — extend the existing branch point ADR-0003 added to
   `constructQueryAsync`/`getCursorForQueryAsync`: after checking `AtlasSearchQueryBuilder`, also
   check `FullTextSearchQueryBuilder` (respecting the precedence rule above). If it returns a
   compound, build
   `[{$search: {index: FULL_TEXT_SEARCH_INDEX_NAME, compound}}, {$match: <existing full query>}, {$sort}, {$skip}, {$limit}, {$project}]`
   and execute via the same `findUsingAggregationAsync({ query: pipeline, extraInfo: {
   matchQueryProvided: true } })` escape hatch — `$match` is the complete existing filter
   (search params + tenant/access tags), unmodified, same as ADR-0003. Wrap in try/catch: any
   Atlas error falls back to the regex path for that request and logs it, mirroring ADR-0003's
   resilience design exactly.

5. **`src/operations/query/filters/specialText.js`** (new) — the regex-fallback backend, wired
   into `r4.js` the normal way (used whenever the Atlas path above wasn't taken — resourceType not
   configured, or the SearchManager-level Atlas attempt errored and this request re-entered the
   normal query-building path):
   - AST → `$and`/`$or` regex tree. `_text` → `text.div` only. `_content` → OR'd across every
     `string`/`token`/`uri` field from this resourceType's generated `SearchParameterDefinition`
     table.
   - Rejects all modifiers except `:not` (mirrors composite's posture).

6. **`src/operations/query/customQueries.js`** — new `fhirFilterTypes.special` entry (regex-path
   only — the Atlas path bypasses `r4.js`'s per-parameter switch entirely, same as ADR-0003's
   feature does for Patient/Person/Practitioner).

7. **`SearchParametersManager.getPropertyObject`** — special-case `_text`/`_content` to return a
   synthetic, resourceType-independent `SearchParameterDefinition{ type: 'special', fields: [...] }`
   instead of `undefined` (needed so the regex fallback path is reachable at all instead of being
   silently dropped by `r4.js`'s loop guard, same root cause as the composite-params bug).

8. **`src/utils/configManager.js`** — new `fullTextSearchAtlasIndexedResources` getter (see above).

9. **New Atlas Search index** — name `fhir-full-text-search`; **one shared dynamic-mapping
   definition** (`{"mappings": {"dynamic": true}}`) applied identically to every configured
   resourceType's collection — unlike `hybrid-full-text-search`'s bespoke per-field mappings, this
   doesn't need per-resource JSON files, since `_text`/`_content` scoping happens via query-time
   `path`, not index-time field selection.

10. **`src/admin/scripts/`** — new `createFullTextSearchIndexes.js` + a new helper module (parallel
    to, not modifying, `atlasSearchIndexHelper.js` — different index, different owning feature),
    iterating `configManager.fullTextSearchAtlasIndexedResources` instead of a hardcoded 3-resource
    list, reusing the same `createSearchIndex`/`listSearchIndexes`/`dropSearchIndex`/
    poll-until-`READY` mechanics already proven out in that module.

11. **`readme/cheatsheet.md`** — document `_text`/`_content` syntax, the `AND`/`OR`/paren grammar,
    and the two-path (Atlas vs. regex) behavior.

## Data Flow

**`_content=(bone OR liver) and metastases` on an Atlas-configured resourceType:**
```
textQueryParser: AND(OR(bone, liver), metastases)
FullTextSearchQueryBuilder: compound.must: [
  { compound: { should: [ {text:{query:'bone',path:{wildcard:'*'}}}, {text:{query:'liver',path:{wildcard:'*'}}} ], minimumShouldMatch: 1 } },
  { text: { query: 'metastases', path: { wildcard: '*' } } }
]
SearchManager: [ {$search: {index:'fhir-full-text-search', compound}}, {$match: <existing filter>}, ... ]
  via findUsingAggregationAsync
```

**Same query on a resourceType NOT in `fullTextSearchAtlasIndexedResources`:**
```
Same AST -> FullTextSearchQueryBuilder returns null (not configured) -> normal r4.js path
-> FilterBySpecialText: $or: [...bone-fields...] AND'd with $or:[...liver-fields...],
   AND'd with $or:[...metastases-fields...], across every string/token/uri field for this resourceType
```

**`_text=diabetes` on an Atlas-configured resourceType:**
```
textQueryParser: term(diabetes)
FullTextSearchQueryBuilder: compound.must: [ { text: { query: 'diabetes', path: 'text.div' } } ]
-- same shared index as _content, path scoped to text.div only
```

**Atlas error mid-request (index in `INITIAL_SYNC`, dropped, etc.):**
```
SearchManager's try/catch around the $search aggregation call fails -> logs -> re-runs the request
through the normal r4.js path -> FilterBySpecialText regex fallback, same as "not configured".
```

## Error Handling

- Unbalanced parens / dangling operator / empty value → `BadRequestError` with the offending
  fragment in the message.
- Modifiers other than `:not` → `BadRequestError`, matching composite's posture.
- Any Atlas error (missing index, `INITIAL_SYNC`, unsupported operator) → caught, logged, regex
  fallback for that request — never a user-visible error, mirroring ADR-0003.
- Overlap with the existing Patient/Person/Practitioner Atlas feature → regex fallback for
  `_text`/`_content` on that request (see Mutual Exclusion).

## Testing Plan

1. **Parser unit tests** — `src/tests/unit/utils/textQueryParser.test.js`: operator precedence,
   parens, quoted phrases, implicit AND, malformed input.
2. **`FullTextSearchQueryBuilder` unit tests** — AST → `compound` shape for `_text`/`_content`,
   eligibility gating (`fullTextSearchAtlasIndexedResources`), and the mutual-exclusion case with
   `AtlasSearchQueryBuilder`.
3. **`FilterBySpecialText` (regex) unit tests** — AST → regex tree, both `_text` and `_content`
   field sets. Assert exact Mongo filter objects produced.
4. **Config test** — `fullTextSearchAtlasIndexedResources` parsing.
5. **Integration tests** — reuse the `jest.atlasSearch.config.js`/`atlasSearchGlobalSetup.js`/
   `atlasSearchTestRunner.js` infra ADR-0003 already built against `mongodb-atlas-local`:
   - Atlas path end-to-end (index configured, real `$search` narrowing results).
   - Regex fallback for an unconfigured resourceType.
   - Simulated Atlas error → confirmed fallback, no user-visible error.
6. **Admin script test** — index creation/recreation against a configured resource list, mirroring
   `atlasSearchIndexHelper.js`'s existing test coverage if any, or adding equivalent coverage.

## Out of Scope

- Merging this feature's `compound` with the existing `AtlasSearchQueryBuilder`'s `compound` into
  one `$search` stage when both would apply to the same request — accepted precedence rule
  instead (see Mutual Exclusion).
- Thesaurus/stemming/relevance ranking beyond what Atlas Search's `text`/`phrase` operators give
  by default — spec marks this "MAY", not required.
- The spec's `_include`/`_revinclude` + `_summary=text` mutual-exclusion rule — flagged as a
  follow-up, not addressed here.
- ClickHouse analytics query path — no full-text search added there.
- Actually creating the Atlas Search index in any real environment, and deciding which
  resourceTypes/when — this design ships the index definition, the admin script, and the config
  gate; rollout scheduling per environment is a separate operational step.
