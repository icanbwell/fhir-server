# Use MongoDB Atlas Search for Patient/Person/Practitioner name & identifier lookup

## Status

Proposed

**Scope notes:**
- This ADR covers routing a *narrow, detectable subset* of Patient/Person/Practitioner searches
  (name, identifier, gender, birthDate, telecom) through the existing MongoDB Atlas `$search`
  index instead of the current regex-based path. It does not attempt to replace FHIR search
  generally — anything outside that field set keeps using the existing query path unchanged.
- Enablement is per resource type via three new env vars (`ATLAS_SEARCH_ENABLED_PATIENT`,
  `ATLAS_SEARCH_ENABLED_PERSON`, `ATLAS_SEARCH_ENABLED_PRACTITIONER`), default off, and applies
  transparently to all eligible queries once on — no request-level opt-in (see Decision Log #1).
- Index lifecycle (creation, schema, tuning) is **not** owned by this repo — accepted as-is, see
  "Cross-repo ownership" under Consequences (Decision Log #4).
- No formal EA Tech Design Review gate for this work (Decision Log #5).

## Context

### Current state: how Patient/Person/Practitioner search works today

FHIR search parameters flow: `SearchManager.constructQueryAsync` → `SearchQueryBuilder` →
`R4SearchQueryCreator` (`src/operations/query/r4.js`) → a plain Mongo filter document → tenant/
access-tag filtering is applied on top of that filter (`SecurityTagManager`,
`PatientQueryCreator`) → `DatabaseQueryManager.findAsync` → `collection.find(query, options)`.

Name search specifically goes through `nameQueryBuilder` (`src/utils/querybuilder.util.js`),
which splits the input on whitespace/punctuation and builds an `$or` of case-insensitive
`$regex` clauses across `name.text`/`name.family`/`name.given`/`name.suffix`/`name.prefix` for
each token. `customIndexes.js` has ordinary B-tree indexes on `name.family`/`name.given`
(e.g. lines 609-622), but a leading-wildcard/`contains`-style regex cannot use a B-tree index —
it forces a collection scan. There is no fuzzy/typo-tolerant matching today.

### What already exists: `person-matching-service`'s Atlas Search index

`~/git/person-matching-service` implements the FHIR `$match` operation. Its blocking pipeline
(`personmatching/service/blocking/atlas_strategy.py`) runs a MongoDB Atlas `$search` aggregation
stage — index name **`hybrid-full-text-search`** — directly against the same collections
fhir-server owns: `Patient_4_0_0`, `Person_4_0_0`, and (in progress, per this repo's user) 
`Practitioner_4_0_0`.

The index mapping (confirmed against `docs/hybrid-full-text-search.json` /
`docs/hybrid-full-text-search-practitioner.json` in that repo, and against the live index
definitions the user pasted for Patient and Person) is narrow and purpose-built for blocking:

| Field | Patient / Person mapping | Practitioner mapping (superset) |
|---|---|---|
| `name.family`, `name.given` | `autocomplete` (fuzzy, prefix) + `string` | same |
| `identifier.value` | `token` (exact) | same |
| `identifier.system` | *(not mapped)* | `token` — supports NPI-boost |
| `gender` | `token` | same |
| `birthDate` | `token` | same |
| `telecom.system`, `telecom.value` | `token` / `string` | same |
| `meta.security.system`, `.code` | *(not mapped)* | `embeddedDocuments` — supports owner scoping in that service's blocking use case only |

Everything else — `address`, most other identifier systems, `_id`, chained/reference searches,
`_include`/`_revinclude`, and every other FHIR search parameter — has **no** representation in
this index.

`person-matching-service`'s own ADR-0001 (`adrs/0001-remove-vector-search.md`) documents that
this Atlas path already sits behind a fallback chain (`$search` → basic `find()` → empty) and
degrades gracefully — the RUNBOOK notes the service falls back automatically if the index is
missing or in `INITIAL_SYNC`.

### Why now

The index is already provisioned and paid for; it's just not something fhir-server knows about
or uses. fhir-server's own name-based search on these three resource types has the same
performance/precision gap (unindexed `contains` regex, no fuzzy tolerance) that this index was
built to solve for the matching service. Reusing it lets fhir-server get indexed, relevance-
ranked, typo-tolerant search on the highest-value fields (name, identifier, gender, birthDate,
telecom) without provisioning new infrastructure.

## Decision Drivers

- The index already exists and is actively operated — but for a *different* consumer, on a
  *different* repo's release cadence. Depending on it creates a cross-repo coupling that
  fhir-server doesn't control.
- Current regex `contains` search on name fields can't use a standard index; this is a known,
  worsening-with-scale pain point.
- Per `review.md` §A (Search / read / query construction): any new or modified search/read query
  path must build its filter through the shared tenant-scoping mechanism, not an independent one
  — this applies directly here since Patient/Person/Practitioner search is explicitly named in
  CLAUDE.md's security-sensitive-changes list.
- Must degrade safely if the index is missing, in `INITIAL_SYNC`, or removed/changed by
  `person-matching-service`'s team without fhir-server's knowledge — fhir-server does not own
  this index's lifecycle.
- The user asked for independent per-resource-type enablement (Patient/Person/Practitioner), which
  matches the existing `ACCESS_TAGS_INDEXED_<RESOURCE_TYPE>` convention already in
  `customIndexes.js` / `configManager.js` (`accessTagsIndexed(resourceType)`).

## Considered Options

### Option 1: Unconditionally route all Patient/Person/Practitioner searches through `$search` ❌ Rejected

**How it works:** When the resource-type flag is on, every search request for that resource type
goes through Atlas `$search` instead of the regex path.

**Why rejected:** The index only maps name/identifier/gender/birthDate/telecom. A search on
`address`, most identifier systems, `_id`, or any chained/reference parameter has no equivalent
`$search` clause. Unconditional routing would either silently drop those filter conditions
(a correctness bug and a security-relevant one, since dropped filters can widen a result set) or
require reimplementing the *entire* existing query-building logic inside Atlas syntax — infeasible
given the index's narrow mapping.

### Option 2: Narrow, detectable subset routing ✅ Proposed

**How it works:** Before building the query, inspect `parsedArgs`. If every supplied search
parameter for this request is one the Atlas index maps for this resource type (`name`, `given`,
`family`, `identifier`, `gender`, `birthdate`, `telecom`/`email`/`phone`) — and no unsupported
modifier is present (see Open Questions) — build an Atlas `$search` pipeline. Otherwise, fall
back to the existing `R4SearchQueryCreator` path, completely unchanged.

**Tradeoffs:**
- ✅ Only changes behavior for a specific, easy-to-reason-about slice of traffic; every other
  query shape is provably untouched.
- ✅ Reuses the existing security/tenant filtering unmodified (see Proposed Solution) — no new
  authorization logic to get wrong.
- ❌ The "is this query representable in the index" check is itself new logic that needs its own
  test coverage, since a false positive would mean silently dropping a filter condition.
- ❌ Atlas `autocomplete`/`fuzzy` matching is *more permissive* than today's exact/regex matching
  — the same query can return a different (larger, differently-ranked) result set once routed
  through `$search`. This is a user-visible behavior change, not just a performance one (see
  Open Questions).

### Option 3: Shadow/dual-run for validation only ⚠️ Considered, as an optional pre-Phase-1 step

**How it works:** Run both the existing path and the new `$search` path for eligible queries,
serve results from the existing path, log/metric the diff between result sets.

**Tradeoffs:**
- ✅ Lets us validate result-set parity (or characterize the divergence from fuzzy matching)
  against real traffic before any user-visible change ships.
- ❌ Doubles query cost for every eligible request if left running; only justified as a bounded,
  temporary validation phase, not a permanent mode.

**Why not the primary proposal:** It's a rollout safeguard, not an end state. Recommended as an
optional Phase 0 (see Migration/Rollout) rather than a standalone option.

### Option 4: Do nothing — keep regex search — Do Nothing

**What happens:** Patient/Person/Practitioner name search keeps using unindexed `contains` regex.

**Why not viable as the long-term answer:** The performance gap is real and already documented
(no text/fuzzy index on `name.family`/`name.given`). But it remains the always-available fallback
within Option 2, and is the right choice if the cross-repo ownership risk below isn't acceptable.

## Decision Outcome

Chosen option: **Option 2 (narrow, detectable subset routing)**, gated per resource type behind
new env vars, with automatic fallback to the existing path on any Atlas error and on any query
shape the index can't represent.

### Proposed Solution

**New component — `AtlasSearchQueryBuilder`** (parallel to `person-matching-service`'s
`AtlasSearchStrategy`, but see the AND/OR semantics note below for why its compound structure
cannot be a direct port):

- Input: `resourceType`, `parsedArgs`.
- Returns `null` (signal to fall back) if:
  - `ConfigManager.isAtlasSearchEnabled(resourceType)` is false, or
  - any supplied search parameter isn't one of the index-mapped fields for that resource type, or
  - an unsupported modifier is present.
- Otherwise returns an Atlas `compound` query: one `must` clause per distinct search parameter
  (fuzzy `autocomplete`/`text` for `name.family`/`name.given`/`telecom`; exact `equals` for
  `identifier.value`/`gender`/`birthDate`) — see the AND/OR semantics note immediately below for
  why this is `must`-per-parameter, not the blocking service's `should`-for-everything shape.
- Deliberately does **not** port `person-matching-service`'s `PRACTITIONER_ALLOWED_OWNERS` /
  `meta.security` owner-scope clause. That clause exists there because blocking has no other
  authorization layer. fhir-server already has one — `SecurityTagManager` /
  `PatientQueryCreator` — and it must remain the single source of truth for authorization. Atlas
  `filter` clauses in this design are relevance/blocking keys only, never an authorization
  boundary.
- **Must preserve FHIR AND/OR search semantics — cannot port the blocking compound verbatim.**
  `AtlasSearchStrategy._build_search_compound` puts every name/telecom clause into `should`
  (compound semantics: "at least one should must match" only when there's no `must`/`filter`).
  That's correct for blocking, whose job is to over-generate candidates for a downstream scorer.
  It is **not** correct for FHIR search: `?family=Smith&given=John` must return patients matching
  *both*, not either. If the compound builder here reused `should`-for-everything, enabling this
  transparently for all traffic would silently degrade multi-parameter AND queries into OR
  queries — a correctness regression, not just "more fuzzy." The builder must instead:
  - Emit one `must` clause per *distinct* FHIR search parameter supplied (`family`, `given`,
    `identifier`, `gender`, `birthdate`, `telecom` each become a required clause when present),
    preserving AND-across-parameters.
  - Within a single parameter's `must` clause, use `autocomplete`/`fuzzy`/`text` for recall
    (typo tolerance, prefix matching) and wrap repeated values for the *same* parameter (FHIR's
    comma-separated-list-or-repeated-param OR convention) in a nested `should` with
    `minimumShouldMatch: 1`.
  - Only `identifier`/`gender`/`birthDate` — already exact/token fields — map directly to a
    non-scoring `filter` clause, same as today's exact matching.
  This is why enabling transparently for all eligible queries (rather than gating behind a
  request-level opt-in) is fine: the correctness risk is in the compound-builder implementation,
  not in the on/off decision itself. Fix it once here and there's no separate "fuzzy mode" needed.

**Hook point — `SearchManager`:** When `AtlasSearchQueryBuilder` returns a compound, build:

```
[
  { $search: { index: 'hybrid-full-text-search', compound } },
  { $match: <the exact query constructQueryAsync already produces today> },
  { $sort }, { $skip }, { $limit }, { $project }
]
```

and execute it via the **existing** `DatabaseQueryManager.findUsingAggregationAsync({ query:
pipeline, extraInfo: { matchQueryProvided: true } })` escape hatch (already used for
`matchQueryProvided`-style raw pipelines) — no new data-layer plumbing needed.

**`$match` is the full, unmodified query — search-parameter filters and tenant/access-tag
filters together, exactly as `constructQueryAsync` builds them today, in the same combined
object.** This is deliberate, not an oversight: `constructQueryAsync` has no seam that separates
"tenant/access-tag portion" from "search-param portion" — `securityTagManager` ANDs security tags
onto the same query object `searchQueryBuilder` already populated with the FHIR search filters.
Tenant/access-tag checks are mandatory on every FHIR server call, full stop, and this design never
weakens that: `$match` always runs **after** `$search` and **before** `$skip`/`$limit`, so paging
and counts are computed against the fully-filtered set, never against raw, unfiltered `$search`
hits. The direct consequence — Atlas hits are intersected with, not merged into, today's existing
filter — is discussed under Consequences below; it is an accepted tradeoff, not a bug to fix by
splitting `$match` later (see Decision Log #6).

> **Flag for adversarial review (`review.md` §A):** this reorders *where in the pipeline* security
> filtering happens relative to relevance ranking, compared to today's single-filter `find()`.
> It does not change *what* is authorized — the same `$match` document that constrains `find()`
> today constrains this pipeline too — but the execution-order change is exactly the kind of
> thing review.md asks reviewers to check explicitly rather than assume is fine.

**`_total=accurate` under the aggregation path:** `handleGetTotalsAsync` today runs a *separate*
query from the main cursor (`exactDocumentCountAsync` → `collection.countDocuments(query, options)`
— deliberately not reusing `options.limit`/`skip`). The aggregation path follows the same shape:
`SearchManager` retains the `$search`+`$match` prefix (before `$sort`/`$skip`/`$limit`/`$project`)
as its own value, and when `_total=accurate` is requested and that prefix exists,
`handleGetTotalsAsync` runs `[...prefix, { $count: 'total' }]` via the same
`findUsingAggregationAsync({ query: pipeline, extraInfo: { matchQueryProvided: true } })`
mechanism instead of `exactDocumentCountAsync`, reading `result[0]?.total ?? 0`. No new data-layer
method needed — just a branch in `handleGetTotalsAsync` on whether the Atlas path was used for
this request.

**Fallback / resilience:** wrap the `$search` aggregation call in try/catch. On any Mongo error
(index missing, `INITIAL_SYNC`, unsupported operator), fall back to the standard `find()` path for
that request and log it — mirroring `AtlasSearchStrategy`'s own graceful-degradation behavior in
`person-matching-service`. This means the flag can be safely enabled without a hard runtime
dependency on index health.

**Config — new per-resource-type env vars**, following the exact pattern of
`accessTagsIndexed(resourceType)` (`configManager.js`, switch on `resourceType`), read via the
existing `isTrue()` helper (`src/utils/isTrue.js`), default `false`:

| Variable | Resource | Default |
|---|---|---|
| `ATLAS_SEARCH_ENABLED_PATIENT` | Patient | `false` |
| `ATLAS_SEARCH_ENABLED_PERSON` | Person | `false` |
| `ATLAS_SEARCH_ENABLED_PRACTITIONER` | Practitioner | `false` |

### Implementation Details

| Component | Change |
|---|---|
| `src/utils/configManager.js` | Add `isAtlasSearchEnabled(resourceType)` getter, switch-style like `accessTagsIndexed` |
| `src/operations/search/` | New `atlasSearchQueryBuilder.js` — eligibility check + compound builder |
| `src/operations/search/searchManager.js` | In `constructQueryAsync`/`getCursorForQueryAsync`: branch to the aggregation pipeline when a compound is returned; fallback on error |
| `src/dataLayer/databaseQueryManager.js` | No change — reuse existing `findUsingAggregationAsync` + `matchQueryProvided` |
| `src/createContainer.js` | Register `AtlasSearchQueryBuilder`, wire into `SearchManager` |
| Helm / env config per environment | Add the three new env vars, default off |

### What This Doesn't Solve (Explicit Non-Goals)

- Not a general FHIR-search replacement — only the name/identifier/gender/birthDate/telecom
  subset the index maps.
- Not managing the Atlas Search index's lifecycle — creation, schema, and tuning stay wherever
  `person-matching-service`'s are owned today; fhir-server only reads.
- Not porting `PRACTITIONER_ALLOWED_OWNERS`/owner-scope logic — fhir-server's existing
  access-tag filtering is the authorization boundary.
- No GraphQL-specific handling needed: confirmed in code that both `src/graphql/dataSource.js`
  and `src/graphqlv2/dataSource.js` call `SearchBundleOperation.searchBundleAsync`
  (`src/operations/search/searchBundle.js`), which itself calls
  `SearchManager.constructQueryAsync`/`getCursorForQueryAsync` — the identical shared path REST
  uses. Neither GraphQL layer builds a Patient/Person/Practitioner query independently, so the
  `SearchManager` hook point covers both automatically with no special-casing.

## Consequences

- **This is a performance/precision optimization on a narrow exact-match field set, not a
  broader-recall feature.** Earlier drafts of this ADR claimed fuzzy `autocomplete`/`text`
  matching could return a "broader, differently-ranked result set than today's exact/regex
  matching." That claim doesn't hold given the design above: because `$match` always re-applies
  the full existing query (search-param filters *and* tenant/access tags, combined — see the
  Hook Point section), every result is `(Atlas $search hits) ∩ (today's exact filter) ∩
  (tenant/access tags)`. That intersection can only ever be a subset of what today's `find()`
  already returns for the same query — never broader, and no typo-tolerant recall actually
  reaches the caller. What this *does* deliver: indexed, relevance-scored candidate retrieval on
  `name`/`identifier`/`gender`/`birthDate`/`telecom` in place of the current unindexed `contains`
  regex, which is a real perf/precision win for exact-shaped queries at scale. **Decision:
  tenant/access-tag checks are mandatory on every FHIR server call and are never weakened or
  split out to let Atlas hits through un-narrowed — Atlas is accepted as a best-effort
  performance layer under that constraint, not a recall-expanding feature** (see Decision Log
  #6). Treat real fuzzy/typo-tolerant search as a separate, future initiative with its own design
  and security review, not something this change delivers.
- **Silent under-return on index lag (accepted):** because results are an intersection, an
  eventually-consistent or lagging Atlas index (owned by a different service, see below) can
  make a just-written resource briefly invisible to search — fewer results than today, with no
  error and no visible signal. **Decision: accepted silently as a best-effort tradeoff, no
  additional logging/metric added for this** (see Decision Log #7).
- **Cross-repo ownership risk (accepted):** fhir-server becomes a second, implicit consumer of an
  index it doesn't provision or version. If `person-matching-service` changes the index's field
  mapping, renames it, or drops it, fhir-server's Atlas path fails closed (falls back
  automatically per the resilience design above) — but *silently*, from fhir-server's
  perspective, until someone checks logs. **Decision: accepted as-is, no coordination mechanism
  being set up now** (see Decision Log #4) — the automatic fallback is judged sufficient
  mitigation on its own.
- Adds one more per-resource-type env var family to track (`ATLAS_SEARCH_ENABLED_*`), consistent
  with the existing `ACCESS_TAGS_INDEXED_*` pattern.

## Decision Log

Resolved during design review (2026-09-04):

| # | Question | Resolution |
|---|---|---|
| 1 | Is there harm in enabling transparently for all eligible queries, vs. a per-request opt-in? | Yes, but it's a fixable implementation risk, not a reason for an opt-in flag: naively porting the blocking service's `should`-only compound would collapse FHIR's AND-across-parameters semantics into OR. Fixed in the design above (`must` per distinct parameter, `filter` for exact fields, nested `should` only for same-parameter repeats). With that fix, transparent enablement is safe. |
| 2 | How does `_total=accurate` work under the aggregation path? | `handleGetTotalsAsync` runs `[...($search+$match prefix), { $count: 'total' }]` via the existing `findUsingAggregationAsync`/`matchQueryProvided` mechanism when the Atlas path was used for the request — see Implementation Details above. |
| 3 | Does GraphQL construct Patient/Person/Practitioner queries independently of `SearchManager`? | No — verified in code. Both `src/graphql/dataSource.js` and `src/graphqlv2/dataSource.js` delegate through `SearchBundleOperation.searchBundleAsync` to `SearchManager.constructQueryAsync`/`getCursorForQueryAsync`, the same shared path REST uses. No special-casing needed. |
| 4 | What's the coordination mechanism with `person-matching-service`'s owners for index changes? | None being set up now — accepted risk; automatic fallback on any Atlas error is the mitigation. |
| 5 | Does this need a formal EA Tech Design Review before implementation? | No. |

Resolved after implementation, during final review (2026-09-06):

| # | Question | Resolution |
|---|---|---|
| 6 | The implementation's `$match` re-applies the full query (search filters + tenant tags combined), so results are always a subset of today's — never the "broader, fuzzy-matched" results this ADR originally claimed. Accept as intersection-only, or redesign to split `$match` and actually deliver broader/fuzzy recall? | Accept as intersection-only. Tenant/access-tag checks are mandatory on every FHIR server call, full stop — splitting `$match` to let Atlas hits through un-narrowed would reopen exactly the "silently dropped filter" risk this ADR rejected Option 1 over, on a resource type explicitly flagged as security-sensitive in CLAUDE.md. This ADR's Consequences section is corrected accordingly. Real fuzzy/typo-tolerant search remains unsolved and is left as a candidate for a future, separately-reviewed initiative. |
| 7 | Given the intersection means an eventually-consistent/lagging Atlas index can silently under-return results, should that be observable (a log line or metric), or accepted silently? | Accepted silently — it's a best-effort performance optimization, and a brief staleness window on a newly-written resource is judged an acceptable tradeoff for the perf gain, consistent with how any other eventually-consistent dependency in this system is treated. No new logging/metric added for this specifically. |

## Success Criteria

- [ ] Eligible Patient/Person/Practitioner name searches (name/identifier/gender/birthDate/telecom
      only) route through `$search` when the resource type's flag is enabled, with no change in
      behavior for any other query shape.
- [ ] Any Atlas error or unready index falls back to the existing `find()` path transparently,
      with no user-visible error and a log line for observability.
- [ ] Tenant/access-tag filtering is provably unchanged — the `$match` stage is byte-for-byte the
      same query object `constructQueryAsync` produces today.
- [ ] Each resource type's flag can be flipped independently, per environment, with no code change.
- [ ] `review.md` §A adversarial review is run against the final diff before merge, given
      Patient/Person/Practitioner search is explicitly in CLAUDE.md's security-sensitive list.

## Appendix

### Related Work

- `person-matching-service`: `personmatching/service/blocking/atlas_strategy.py`,
  `adrs/0001-remove-vector-search.md`, `docs/hybrid-full-text-search.json`,
  `docs/hybrid-full-text-search-practitioner.json`, `docs/RUNBOOK.md` §3/§9.
- This repo's `review.md` — adversarial PR review checklist for search/read query construction.
- `src/indexes/customIndexes.js` — existing `ACCESS_TAGS_INDEXED_<RESOURCE_TYPE>` per-resource
  env var precedent.

### Glossary

- **Blocking** — in matching-service terminology, the candidate-narrowing step before scoring;
  the reason the Atlas index exists today.
- **`$search` / Atlas Search** — MongoDB Atlas's managed full-text search, used here as an
  aggregation pipeline stage (`$search`), distinct from a standard `find()` filter.
- **Compound query** — an Atlas `$search` clause combining `should` (scoring, optional) and
  `filter` (non-scoring, required) sub-clauses.
