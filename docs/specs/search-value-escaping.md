# Search Value Escaping (`\$`, `\,`, `\|`, `\\`) — Design

## Background

Per the FHIR search spec (https://hl7.org/fhir/R4B/search.html#escaping), `,`, `|`, `$`, and `\`
are all separator/escape characters. Any literal occurrence of one of the first three in a search
value must be backslash-escaped (`\,`, `\|`, `\$`), and a literal backslash must be escaped as
`\\`. Escaping must be undone before the value is matched.

This server currently has three independent call sites that split on one of these characters with
no escaping awareness at all:

- **`,` (OR values)** — `QueryParameterValue.parseQueryParameterValueIntoArrayIfNeeded`
  (`src/operations/query/queryParameterValue.js:52`) and
  `ParsedArgsItem.applyModifierToQueryParameterValue`
  (`src/operations/query/parsedArgsItem.js:88`) both do a plain `.split(',')`. This affects every
  search parameter type — a `string` value containing a literal comma, e.g. `name=Smith, John`, is
  silently split into two OR'd values today.
- **`|` (token `system|code`, quantity `num|system|code`, canonical `url|version`)** —
  `src/utils/querybuilder.util.js` does a plain `.split('|')` in five places:
  `tokenQueryBuilder` (:162), `tokenQueryContainsBuilder` (:240, plus a nested `.split(',')` on the
  value portion at :295), `tokenIdentifierOfTypeQueryBuilder` (:crossed via the `:295` shared split),
  `quantityQueryBuilder` (:461), and a canonical/reference builder (:1286).
- **`$` (composite components)** — `FilterByComposite.filterOneValue`
  (`src/operations/query/filters/composite.js`, added by #2483) does `value.split('$')` with no
  escaping either. #2483's own design doc dismissed this ("no component type ... legitimately
  produces a literal `$` in its own value syntax today"), but that only considered `$` in
  isolation — it didn't account for the fact that a composite component's value is itself a
  token/string/quantity value that flows through the `,`/`|`-splitting call sites above, which
  *do* have realistic literal-value collisions (a token code containing a pipe, a string value
  containing a comma).

Net effect: any search value containing a literal `,`, `|`, or (post-#2483) `$` that the caller
correctly escaped per spec gets silently mis-split into the wrong number of parts, either
producing a wrong/narrower result set or (for composite) a `BadRequestError` from the component
count check.

## Scope

Fix all three separators generically, in the shared splitting/leaf-value layer, so every current
and future caller of these functions benefits with no caller-specific code. This necessarily
touches `queryParameterValue.js`, `parsedArgsItem.js`, `querybuilder.util.js`, and
`FilterByComposite` together — fixing `$` alone (composite's own gap) isn't possible in isolation,
since a composite component's value is handed to the exact same token/quantity functions that also
need the `|`/`,` fix.

Out of scope: stemming/fuzzy/thesaurus matching, and any Mongo query-shape change beyond correct
escaping of the value itself (that's `_text`/`_content`, a separate stacked PR).

## Key ordering insight

A value can pass through *multiple* splitting stages before reaching a leaf use (e.g. a composite
component: `$`-split, then handed to `tokenQueryBuilder`, which `|`-splits it, whose value part may
then be `,`-split again for `:contains`). Unescaping too early destroys an escape marker a later
stage still needs — e.g. unescaping `\|` to a literal `|` right after the `$`-split would cause the
subsequent `|`-split to wrongly break the token value.

The fix: every split becomes **escape-aware but non-unescaping** (skip delimiter occurrences
preceded by an odd number of backslashes; leave all backslash sequences in the output parts
untouched). Only the true leaf — the point where a string is about to become a literal
`$regex`/exact-match value with no further delimiter-splitting ahead of it — calls a single
**unescape** pass that converts `\$`, `\,`, `\|`, `\\` to their literal characters.

## Approach

**Chosen:** one shared utility module, `src/utils/searchValueEscaping.js`, with two functions:

- `splitUnescaped(value, delimiter)` — escape-aware split, as described above. Replaces every
  `.split(',')` / `.split('|')` / `.split('$')` call site in scope.
- `unescapeSearchValue(value)` — single final unescape pass. Called once per leaf string, at each
  call site's terminal value(s) only.

**Alternatives considered:**
- *Unescape immediately after each split* — rejected: breaks multi-stage values (composite
  components, token `:contains` sub-values) as described above.
- *Single global find-replace on the raw query string before any parsing* — rejected: can't
  distinguish which separator's escape belongs to which stage without already knowing the parse
  structure, and would break composite's reuse of the same string through multiple independent
  modules.

## Architecture & Components

1. **`src/utils/searchValueEscaping.js`** (new) — `splitUnescaped`, `unescapeSearchValue`.
2. **`src/operations/query/queryParameterValue.js`** — `parseQueryParameterValueIntoArrayIfNeeded`
   uses `splitUnescaped(value, ',')` instead of `.split(',')`. Values are still raw (unescaped) at
   this point — each one may need further `|`/`$` splitting downstream.
3. **`src/operations/query/parsedArgsItem.js`** — `applyModifierToQueryParameterValue`'s
   `.split(',')` gets the same treatment.
4. **`src/utils/querybuilder.util.js`** — all five `.split('|')` sites switch to
   `splitUnescaped(target, '|')`; `tokenQueryContainsBuilder`'s nested `.split(',')` on the value
   portion switches to `splitUnescaped(value, ',')`. Every terminal `system`/`value`/`code`/`url`
   string gets `unescapeSearchValue(...)` applied once, immediately before use in a
   `$regex`/exact-match condition (this is the leaf for these functions — nothing splits on these
   strings again after this point).
5. **`src/operations/query/filters/composite.js`** — `filterOneValue`'s `value.split('$')` becomes
   `splitUnescaped(value, '$')`. No `unescapeSearchValue` call here — each resulting component
   string is handed to `FilterByToken`/`FilterByQuantity`/etc., which apply their own splitting and
   unescaping per point 4.
6. **`readme/cheatsheet.md`** — add a short section documenting escaping support (mirrors #2483
   adding composite-value-syntax documentation there).

## Data Flow

**Token search with an escaped pipe in the code:** `code=http://x\|y|actual-code`
```
QueryParameterValue: splitUnescaped(..., ',') -> single value, no comma -> unchanged
tokenQueryBuilder: splitUnescaped(target, '|') -> ['http://x\|y', 'actual-code']
  unescapeSearchValue('http://x\|y') -> 'http://x|y'   (system)
  unescapeSearchValue('actual-code') -> 'actual-code'  (value)
```

**Composite component with an escaped comma in a string value:**
`name-and-code=Smith\, John$1234-5`
```
QueryParameterValue: splitUnescaped(..., ',') -> single value (the internal \, is not a bare ',')
FilterByComposite.filterOneValue: splitUnescaped(value, '$') -> ['Smith\, John', '1234-5']
  component 1 (string) -> FilterByString -> stringQueryBuilder receives 'Smith\, John' raw;
    (string values don't split on ',' today, so no change needed there — just confirm
    unescapeSearchValue is applied before the $regex is built)
  component 2 (token) -> FilterByToken -> as above
```

## Error Handling

- A lone trailing backslash, or a backslash followed by a character that isn't `$`, `,`, `|`, or
  `\`, is passed through literally (lenient) rather than throwing — treating it as a `BadRequestError`
  risks rejecting free-text values that happen to contain a backslash for unrelated reasons.
- No behavior change to existing `BadRequestError` cases (e.g. composite's mismatched part count) —
  those still fire, just on the correctly-split part count now.

## Testing Plan

1. **Unit tests** — `src/tests/unit/utils/searchValueEscaping.test.js` (new): escaped delimiter,
   unescaped delimiter, consecutive escapes (`\\$`), trailing lone backslash, multiple delimiters
   in one value, empty string.
2. **`querybuilder.util.js` tests** — extend existing unit tests for `tokenQueryBuilder`,
   `tokenQueryContainsBuilder`, `quantityQueryBuilder`, and the canonical builder with
   escaped-separator cases.
3. **`FilterByComposite` tests** — extend `src/tests/unit/operations/query/filters/composite.test.js`
   with a component value containing an escaped `$`, and (via a string/token component) an escaped
   `,`/`|`.
4. **Integration tests** — one end-to-end case per affected search parameter type (token, quantity,
   composite) using a real escaped value against Mongo Memory Server, confirming it now narrows
   correctly instead of mis-splitting.

## Out of Scope

- `_text`/`_content` full-text search — separate stacked PR.
- Any new query capability beyond correct escaping (no fuzzy matching, no relevance scoring).
- ClickHouse analytics query path — not touched by this design.
