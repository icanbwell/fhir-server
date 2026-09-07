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
both (no resource generates a `_text`/`_content` field), so `R4ArgsParser.parseArgs` creates a
`ParsedArgsItem` with `propertyObj: undefined`, and `R4SearchQueryCreator.buildR4SearchQuery`'s
loop guard (`src/operations/query/r4.js:81`, `if (parsedArg.queryParameterValue &&
parsedArg.propertyObj)`) skips it entirely. Same silent-no-op failure mode #2483 fixed for
composite params — a caller supplying `_text=diabetes` gets no error and an unfiltered result set.

## Scope

Implement both generically across all resource types via the shared query-building layer (same
precedent as composite params) — no REST/GraphQL/MCP-specific code.

- `_text`: regex/boolean-parser match against `text.div` only.
- `_content`: OR-match across every field the resource's already-generated `SearchParameterDefinition`
  table (`src/searchParameters/searchParameters.js`) marks as `string`/`token`/`uri` typed. This
  reuses existing per-resource field metadata rather than adding new resource-schema-walking
  codegen, and needs no data migration.

## Key constraint discovered: MongoDB's one-text-index-per-collection limit

MongoDB allows at most one text index per collection, a `$text` query can't be scoped to a field
subset of that index per-query, and `$text` cannot appear inside `$or`/`$nor`. This rules out
giving `_text` and `_content` independent native text indexes on the same collection, and rules out
using `$text` for any query with explicit `OR`/parens (per the earlier design conversation, this PR
uses a hybrid: native `$text` for pure-AND term lists, a custom regex-based parser otherwise).
Resolution:

- **`_text`** always uses the regex/parser path against `text.div` — a single well-known field, no
  index-scoping conflict, and no relevance benefit to gain from a dedicated index for one field.
- **`_content`** gets the hybrid: pure-AND-of-terms queries use `$text` against a wildcard text
  index (`{"$**": "text"}`); anything with explicit `OR` or parens falls back to the regex parser
  across the resource's string/token/uri fields (per Scope above).

## Staged rollout via config: which collections actually have the text index

Building a wildcard text index on every collection in every environment is an operational rollout
step (index builds on large existing collections take time and should be staged), not something
that can be assumed to exist the moment this code deploys. Attempting `$text` against a collection
with no text index throws a Mongo error outright.

Add a new `ConfigManager` getter, following the existing `ACCESS_TAGS_INDEXED_*` /
`CLOUD_STORAGE_HISTORY_RESOURCES` pattern already used for per-resource-type capability flags
(`src/utils/configManager.js`):

```js
get fullTextIndexedResources () {
    return (env.FULL_TEXT_INDEXED_RESOURCES && env.FULL_TEXT_INDEXED_RESOURCES.split(',').map(r => r.trim())) || [];
}
```

`FilterBySpecialText` checks `configManager.fullTextIndexedResources.includes(resourceType)` before
ever attempting the `$text` fast path for `_content`:

- In the list → hybrid (as above).
- Not in the list → always the regex parser path (same as `_text`), regardless of AND/OR shape.

This decouples the index build/rollout schedule per environment from the code deploy — a
resourceType's collection can get its wildcard index built and only then get added to
`FULL_TEXT_INDEXED_RESOURCES` in that environment's config, with correct (if slower) regex-based
behavior before that point and no risk of a "no text index" Mongo error.

## Approach

**Chosen:** custom boolean parser (AND/OR/parens/quoted phrases) producing an AST, translated to a
Mongo `$and`/`$or` regex tree, with a `$text` fast path for `_content` on configured resourceTypes
when the AST is a pure conjunction of terms.

**Alternatives considered:**
- *Pure native `$text` for everything* — rejected: doesn't support the spec's literal `AND`/`OR`/
  paren grammar (Mongo's own text-search syntax has different rules: implicit OR of terms, quoted
  phrase required, `-term` excluded — "and"/"or"/parens would be literal search terms, not
  operators).
- *Pure regex for everything, no `$text`* — rejected for `_content`: no relevance/index leverage on
  what could be the highest-cardinality search across large collections, which is exactly where a
  wildcard text index earns its keep.

## Architecture & Components

1. **`src/utils/textQueryParser.js`** (new) — tokenizer + recursive-descent parser for `term`,
   `"quoted phrase"`, `AND`/`OR` (case-insensitive keywords), `(`/`)`, implicit `AND` between
   adjacent terms with no explicit operator. Produces an AST (`{type: 'and'|'or'|'term', ...}`).
   Throws `BadRequestError` on unbalanced parens or a dangling operator.
2. **`src/operations/query/filters/specialText.js`** (new) — `FilterBySpecialText extends
   BaseFilter`:
   - For `_text`: AST → regex tree over `text.div` only, always.
   - For `_content`: if `configManager.fullTextIndexedResources` includes this resourceType and the
     AST is a pure `AND` of terms/phrases → `{ $text: { $search: <value> } }`. Otherwise → AST →
     regex tree, OR'd across every `string`/`token`/`uri` field from this resourceType's generated
     `SearchParameterDefinition` table.
   - Rejects all modifiers except `:not` (mirrors composite's posture — `:missing`/`:contains`/etc.
     have no coherent meaning for a free-text boolean query).
3. **`src/operations/query/customQueries.js`** — new `fhirFilterTypes.special` entry.
4. **`src/searchParameters/searchParametersManager.js`** (or wherever `getPropertyObject` lives) —
   special-case `_text`/`_content`: return a synthetic, resourceType-independent
   `SearchParameterDefinition{ type: 'special', fields: [...] }` instead of `undefined`. `fields`
   for `_text` is always `['text.div']`; for `_content` it's derived at request time from that
   resourceType's already-generated table (no new generator step).
5. **`src/operations/query/r4.js`** — new `case fhirFilterTypes.special:` in the existing switch.
6. **`src/utils/configManager.js`** — new `fullTextIndexedResources` getter (see above).
7. **`src/indexes/customIndexes.js`** — add the wildcard text index definition
   (`{"$**": "text"}`), gated so it's only actually created for resourceTypes present in
   `FULL_TEXT_INDEXED_RESOURCES` (index creation should follow the same staged rollout, not create
   indexes on every collection unconditionally the moment this code ships).
8. **`readme/cheatsheet.md`** — document `_text`/`_content` syntax and the `AND`/`OR`/paren grammar.

## Data Flow

**`_content=(bone OR liver) and metastases` on a resourceType in `FULL_TEXT_INDEXED_RESOURCES`:**
```
textQueryParser: AND(OR(bone, liver), metastases)  -- not a pure AND-of-terms (contains an OR node)
FilterBySpecialText: AST has an OR -> regex path
  -> $or: [ {field1: /bone/i}, {field2: /bone/i}, ... ] AND'd with the liver-OR-group,
     AND'd with a metastases-OR-group, across every string/token/uri field for this resourceType
```

**`_content=diabetes hypertension` on a resourceType in `FULL_TEXT_INDEXED_RESOURCES`:**
```
textQueryParser: AND(diabetes, hypertension) -- pure AND of terms
FilterBySpecialText: resourceType configured + pure AND -> { $text: { $search: 'diabetes hypertension' } }
```

**`_content=diabetes hypertension` on a resourceType NOT in `FULL_TEXT_INDEXED_RESOURCES`:**
```
Same AST, but resourceType not configured -> regex path (same as the OR example above, just AND'd)
```

**`_text=diabetes` (any resourceType):**
```
Always regex path against text.div only, regardless of FULL_TEXT_INDEXED_RESOURCES.
```

## Error Handling

- Unbalanced parens / dangling operator / empty value → `BadRequestError` with the offending
  fragment in the message.
- Modifiers other than `:not` → `BadRequestError`, matching composite's posture.
- Attempting `$text` against an unindexed collection is prevented structurally by the
  `fullTextIndexedResources` check — never reaches Mongo without the index.

## Testing Plan

1. **Parser unit tests** — `src/tests/unit/utils/textQueryParser.test.js`: operator precedence,
   parens, quoted phrases, implicit AND, malformed input (unbalanced parens, trailing operator).
2. **Filter unit tests** — `src/tests/unit/operations/query/filters/specialText.test.js`: both code
   paths for `_content` (configured pure-AND → `$text`; configured with OR → regex; unconfigured →
   always regex), and `_text` always regex. Assert exact Mongo filter objects produced.
3. **Config test** — `configManager.fullTextIndexedResources` parsing (extend existing
   `configManager.test.js` conventions for the comma-separated-list getters).
4. **Integration tests** — `src/tests/searchParameters/search_by_text/` and
   `search_by_content/` (new, matching `search_by_composite/` convention) against Mongo Memory
   Server: `_text` narrowing on narrative content; `_content` narrowing both with and without the
   resourceType configured in `FULL_TEXT_INDEXED_RESOURCES` (need the wildcard index actually
   created in the test's Mongo Memory Server instance for the configured case).

## Out of Scope

- Thesaurus/stemming/relevance ranking beyond whatever Mongo's own `$text` provides in the fast
  path — spec marks this "MAY", not required.
- The spec's `_include`/`_revinclude` + `_summary=text` mutual-exclusion rule — not addressed here,
  flagged as a follow-up.
- ClickHouse analytics query path — no full-text search added there.
- Actually creating/backfilling the wildcard text index in any real environment — this design ships
  the index *definition* and the config gate; rolling it out per environment (deciding which
  resourceTypes, when) is a separate operational step, not part of this PR.
