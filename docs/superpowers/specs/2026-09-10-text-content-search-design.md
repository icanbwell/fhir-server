# `_text` / `_content` Full-Text Search Parameters — Design

## Revision History

- **2026-09-06** — original design: build a new, fhir-server-owned Atlas Search index, generic
  across all resource types, with a Mongo regex fallback everywhere Atlas isn't configured.
- **2026-09-10 (a)** — superseded by revision (b) below. Discovered `~/git/fhir-notes-vector-store`
  — a sibling service already extracting, chunking, and Atlas-Search-indexing attachment text for
  `DocumentReference`/`DiagnosticReport`/`CarePlan`. Building a second, fhir-server-owned index for
  the same content types both duplicates that work and risks the two texts drifting (different
  extraction logic, different chunking, different update cadence). This revision replaces the
  "build our own index" plan with "delegate to the index that already exists," narrows scope to
  the three resource types that index actually covers, and adds two capabilities the original
  design didn't have: attaching derived plain text to a resource read (not just filtering search
  results by it), and a `Binary` reverse-lookup. `_text` (narrative search) is dropped from scope
  entirely — see [Scope](#scope). The chosen trigger for the read-time capability was an empty
  `_content=` value on a single-resource read, delivered as a sibling `content[]` attachment
  (`DocumentReference`/`DiagnosticReport`) or a top-level `extension` (`Binary`).
- **2026-09-10 (b)** — corrects two defects in (a) found during a final whole-branch review, both
  caught only by actually executing the real code rather than trusting hand-built test fixtures:
  (1) `r4ArgsParser.js` drops **every** empty-string query parameter value, for every parameter,
  before a `ParsedArgsItem` is ever created — so `_content=` (empty) never reached the enrichment
  trigger in production at all; every unit test for it had hand-built a `ParsedArgsItem` with
  `value: ''`, a shape the real parser can never produce. (2) `Binary` extends `Resource`, not
  `DomainResource`, in FHIR R4 — it has no `extension` element at all, so the top-level extension
  the read-enrichment design relied on for `Binary` was silently dropped by `toJSON()` on every
  response. This revision replaces the empty-`_content=`-triggered, resource-JSON-embedding
  approach entirely with `_format=text/plain` content negotiation: a plain-text HTTP response
  *instead of* `application/fhir+json`, handled in the response-writing layer rather than the
  enrichment pipeline. This sidesteps both defects at once — `_format=text/plain` is an ordinary
  non-empty value (no parser interaction needed), and nothing is ever embedded inside `Binary`'s
  JSON shape, since the response isn't JSON at all when this format is requested. See
  [Derived-text delivery via `_format=text/plain`](#derived-text-delivery-via-formattextplain).
- **2026-09-10 (c)** — two more corrections, both found by a scoped re-review of (b)'s fix, again by
  executing the real code:
  (1) `SearchManager.buildContentSearchIdFilterAsync` checked the resourceType allowlist and the
  `ENABLE_FULL_TEXT_SEARCH`-configured check in the wrong order and returned `BadRequestError`
  whenever the feature was unconfigured, regardless of resourceType — meaning `_content` on `main`'s
  pre-existing (silently-ignored) behavior became a 400 on deploy, before anyone had opted in to
  anything. Fixed to check the flag first: `_content` is silently ignored (not rejected) whenever
  `ENABLE_FULL_TEXT_SEARCH` is off, for every resourceType, matching prior behavior exactly; only
  once the flag is on does an unsupported resourceType become `BadRequestError`. See
  [`_content` search](#_content-search-documentreference--diagnosticreport--careplan), point 3.
  (2) The read-enrichment/`Binary`-reverse-lookup chunk lookup (introduced in (b)) keys on
  `` `${resource.id}-${index}` ``, and `resource.id` at that point is the resource's raw
  `_sourceId` — unique only per `(resourceType, sourceAssigningAuthority)`, not globally. Two
  different tenants' resources sharing the same raw sourceId could otherwise cross-serve derived
  clinical note text, matching this repo's `review.md` §E pattern exactly ("cross-tenant joins on a
  shared identifier... does the query also include a tenant/client discriminator in the join
  condition itself"). Fixed by extracting the `sourceAssigningAuthority` security tag from the
  already-authorized resource (mirroring `searchById.js`'s existing extraction pattern) and
  requiring it as a real discriminator inside the vector-store query itself
  (`debug.resource.meta.security` `$elemMatch`), failing closed (no lookup at all) if the tag can't
  be extracted. A related bug in the `Binary` reverse-lookup — matching *any* attachment on the
  owning resource rather than the exact one referencing the requested `Binary`, which could
  cross-serve one attachment's text when asking for a different attachment's `Binary` on the same
  resource — was fixed the same way: resolve the exact attachment index before deriving the chunk
  group id, rather than trusting the first Mongo match. See
  [Derived-text delivery via `_format=text/plain`](#derived-text-delivery-via-formattextplain).
- **2026-09-10 (d)** — a further adversarial review against `review.md` plus a general
  correctness/silent-failure pass, both by executing the real code, found and fixed:
  (1) `MongoQuerySimplifier.simplifyFilter` (unmodified, unmockable, run on every query) deletes
  `{_uuid:{$in:[]}}` and the now-empty parent clause around it, so an empty `_content` candidate
  list silently became "no filter, return everything" — the exact failure this design's point 4
  already warned against, shipped anyway because every existing test asserted on
  `buildContentSearchIdFilterAsync`'s isolated return value rather than `constructQueryAsync`'s
  actual output. Fixed with the `{_uuid:'__invalid__'}` sentinel (see `_content` search, point 4).
  (2) `meta.resource_type` is not a mapped field in the vector store's text-search index, so putting
  it in `$search.compound.filter` meant `_content` matched nothing in production; moved to a
  `$match` stage after `$search` (see `_content` search, point 2). (3) Candidate ids were returned
  as raw `debug.resource_reference` sourceIds with no tenant discriminator in the join itself,
  letting one tenant's `_content` search pick up a same-sourceId, different-SAA resource as a
  false-positive candidate probe (review.md §E); fixed by resolving each candidate to a `_uuid` via
  `sourceAssigningAuthority` before returning it. (4) The `Binary` reverse-lookup's chunk selection
  keyed on `chunk_group_id` alone, which two different resources under the same SAA could collide
  on; fixed by also requiring the resolved owning resource's identity to match, and failing closed
  (rather than picking arbitrarily) when the URL genuinely matches more than one distinct resource.
  (5) `MongoDatabaseManager.connectAsync()` opened the fhir-notes-vector-store connection as part of
  the *primary* connection sequence, so an outage there could fail fhir-server's primary request
  path, and a single failed attempt permanently disabled the feature for the process's lifetime
  (`clientConnection` was already set, so `connectAsync()` short-circuited on every later call).
  Decoupled into its own lazy, independently-retried connection path
  (`getFhirNotesDbAsync`/`connectFhirNotesAsync`) that never throws. (6) `_content` was reachable
  from `constructQueryAsync`'s write (`update`/`patch`/`remove`) and history query paths, where it
  either silently matched nothing (history documents nest under a `resource.` field prefix
  `FilterById` doesn't know about) or could gate a DELETE by a staleable external index; restricted
  to read operations, with history explicitly excluded. (7) `GET .../_history/{version}?_format=
  text/plain` returned the *current* indexed text for a request asking about a specific historical
  version; the plain-text branch now only applies to non-versioned reads. (8) Chunk reassembly had
  no completeness check against the stored `meta.total_chunks`, so a note read mid-reindex (some
  chunks written, others not yet) could silently return truncated clinical text with no indication
  a gap existed; now compared against `total_chunks` and fails closed (returns nothing) on mismatch
  rather than serving a partial document. See
  [`_content` search](#_content-search-documentreference--diagnosticreport--careplan) and
  [Derived-text delivery via `_format=text/plain`](#derived-text-delivery-via-formattextplain).

## Background

Per the FHIR search spec (https://hl7.org/fhir/R4B/search.html#content), `_text` and `_content` are
"special"-type search parameters available on every resource type:

- `_text` searches the resource's narrative (`Resource.text.div`).
- `_content` searches the entire content of the resource.
- The value is a text query supporting multiple words, logical `AND`/`OR`, and parentheses, e.g.
  `Condition?_text=(bone OR liver) and metastases`. A server "MAY" also do thesaurus/related-word
  expansion — explicitly optional.
- The spec explicitly suggests implementation via an external indexing service: *"Implementers
  could consider using the rules specified by the OData specification for the `$search` parameter.
  Typical implementations would use Lucene, Solr, an SQL-based full text search, or some similar
  indexing service."* Delegating to an existing Atlas Search index (below) is a direct reading of
  that guidance, not a workaround.

Both names are already listed in `SPECIFIED_QUERY_PARAMS` (`src/constants.js:181`), so they're
accepted rather than rejected under strict handling — but nothing resolves them to a
`SearchParameterDefinition`. `SearchParametersManager.getPropertyObject` returns `undefined` for
both, so `R4ArgsParser.parseArgs` creates a `ParsedArgsItem` with `propertyObj: undefined`, and
`R4SearchQueryCreator.buildR4SearchQuery`'s loop guard (`src/operations/query/r4.js:81`) skips it
entirely. Same silent-no-op failure mode #2483 fixed for composite params — a caller supplying
`_content=diabetes` gets no error and an unfiltered result set.

## Prior art

### ADR-0003 / `hybrid-full-text-search` (branch `atlas-search-tech-design`, PR #2563)

Unmerged, stacked on PR #2564. Routes Patient/Person/Practitioner name/identifier search through
MongoDB **Atlas Search** (`$search`/`compound`) against an index owned by
`person-matching-service`, for a different purpose (candidate blocking for `$match`). Not reusable
for `_content` — wrong owner, wrong field mapping — but confirms production MongoDB is real Atlas
(`$search`, `createSearchIndex`/`listSearchIndexes` are genuinely available), and establishes a
working convention this design's SearchManager hook still follows loosely: try the Atlas-backed
path, fall back safely on error, log it.

### `fhir-notes-vector-store` (sibling repo, `~/git/fhir-notes-vector-store`)

This is the discovery that reshapes this design. It's an existing service that:

1. Pulls `DocumentReference`, `DiagnosticReport`, and `CarePlan` resources per patient from the FHIR
   server (`fhirnotesvectorstore/fhir_client/fhir_notes_indexer.py:260-291` — exactly these three
   resource types; `Encounter` is also pulled but only for author/context metadata, never as a text
   source).
2. For `DocumentReference.content[].attachment` and `DiagnosticReport.presentedForm[]`, resolves
   `data` (inline base64) or `url` (a referenced `Binary`, batch-fetched separately) and runs
   content-type-driven text extraction (`extractors/extractor_factory.py` — `text/html`,
   `text/rtf`, `application/pdf`, `application/xml`, images via OCR, Office docs via `markitdown`).
   For `CarePlan.note[]`, there is no attachment/base64 layer at all — `Annotation.text` is already
   plain markdown text per the FHIR type, so it's chunked directly with no decode/extract step.
3. Chunks the extracted text (for embedding-size limits), embeds each chunk, and stores each chunk
   as a `ClinicalNote` document (`vectorsearch/models/clinical_note.py`) in a MongoDB Atlas
   collection, with the fields this design depends on:
   - `text` — the chunk's plain text.
   - `patient_id` — the owning patient.
   - `meta.chunk_group_id` — `"{resourceId}-{contentIndex}"` (the attachment's key within its
     parent resource; see `fhir_notes_reader.py:336` / `fhir_attachment_to_embedding_converter.py:102`).
   - `meta.chunk_index` / `meta.total_chunks` — order and count, for reassembly.
   - `meta.resource_type` — `"DocumentReference"` / `"DiagnosticReport"` / `"CarePlan"` (never
     `"Binary"` — see [Binary reverse lookup](#binary-reverse-lookup-content-on-binaryid)).
   - `debug.resource_reference` — `"DocumentReference/{id}"` etc.
   - `debug.resource` — the **entire original source resource**, persisted per chunk. This is what
     makes the `Binary` reverse lookup possible: it's the only place `content.attachment.url` /
     `presentedForm.url` survives in this collection.
4. Already has Atlas Search text-index infrastructure built and working:
   `MongoAtlasVectorStore.create_text_search_index` (`vectorsearch/store/mongo_atlas_vector_store.py:599`)
   creates an Atlas Search index mapping `text` (and `patient_id`, `key`) as `type: "string"`/`"token"`;
   `search_text_field` (same file, line 306) queries it via `$search.compound.must.text`.

None of this needs to change in `fhir-notes-vector-store` for this design — fhir-server becomes a
second, **read-only** consumer of a MongoDB Atlas Search index that already exists, using a
different query-time operator (`queryString` instead of `text` — see
[Lucene syntax via `queryString`](#lucene-syntax-via-querystring)). Atlas Search index mappings are
field-**type**-based (`text` is mapped `type: "string"`), and multiple query operators can run
against the same string-mapped field without re-mapping — `queryString` is a query-time choice, not
an index-time one.

## Scope

Three capabilities, all keyed off the same underlying data source:

1. **`_content` search**, restricted to `DocumentReference`, `DiagnosticReport`, `CarePlan` — the
   exact three resource types `fhir-notes-vector-store` covers. When the feature is configured
   (see [Config](#config)), `_content` on any other resource type is rejected with
   `BadRequestError` (not silently ignored, not silently unfiltered) — see
   [Error Handling](#error-handling) for why silent degradation is unacceptable once the feature is
   actually on. When the feature is *not* configured, `_content` is silently ignored regardless of
   resourceType, matching its pre-existing behavior.
2. **Derived-text delivery on resource read** — `GET DocumentReference/{id}?_format=text/plain` (or
   `DiagnosticReport`) returns the reassembled plain text as the entire HTTP response body, instead
   of the normal FHIR JSON (see
   [Derived-text delivery via `_format=text/plain`](#derived-text-delivery-via-formattextplain)).
   Not needed for `CarePlan`: its `note[].text` is already plain text in the base resource, nothing
   to derive.
3. **`Binary` reverse lookup** — `GET Binary/{id}?_format=text/plain` returns the derived text of
   whichever `DocumentReference`/`DiagnosticReport` attachment referenced that `Binary`, using the
   same `_format` mechanism, since a `Binary` is never an independently-indexed source in the
   vector store.

**Explicitly out of scope:**

- **`_text` (narrative search)** — the vector store never touches `Resource.text.div`; it indexes
  attachment/note content, which is a different field with different semantics. Implementing `_text`
  would mean building the original design's own regex-on-`text.div` path (or a separate index) —
  real, but independent work, not addressed here.
- **`_content` on resource types outside the three above** — e.g. `Condition`, `Observation`. The
  original design's generic regex-across-all-string-fields fallback could still be built later as
  genuinely separate work; this revision doesn't attempt it, to avoid two half-implementations of
  the same parameter with different semantics live at once.
- **`_format=text/plain` on search/bundle responses** — the derived-text delivery mechanism only
  applies to a single-resource read (`GET DocumentReference/{id}?_format=text/plain`, and the
  `Binary`/`DiagnosticReport` equivalents), never to search result sets — there's no coherent single
  plain-text body for a Bundle of many resources. A `_format=text/plain` search request behaves
  exactly as it does today (ignored, falls through to JSON), since the response-writer change is
  scoped specifically to the single-resource read path.

## Security model (read this before the architecture)

This repo's `review.md` (mandatory adversarial-review checklist for any PR touching resource
search/read) calls out exactly the failure mode this design would have if built carelessly:

> Does every new or modified query path build its filter through the shared tenant-scoping
> mechanism, rather than querying by a raw internal id/uuid/source-id first and checking access
> afterward?

`fhir-notes-vector-store`'s MongoDB is a **second cluster with its own access model**, entirely
outside fhir-server's tenant/access-tag enforcement. A candidate resource id coming back from an
Atlas Search hit against that cluster has had **zero** authorization applied to it. The one rule
every component below must satisfy:

> **A vector-store hit is a candidate, never a result.** Every id it returns must be re-proven
> through fhir-server's normal, fully tenant/access-scoped query path before anything derived from
> it (existence, content, or even just a count) reaches the caller.

Concretely, this is enforced structurally, not by convention: `_content`'s candidate ids are folded
into the request as an ordinary `_id ∈ [...]` constraint, merged with every other filter (patient
scoping, access tags, the caller's other search params) through the *exact same, unmodified*
query-building code every other search parameter already goes through — see
[`_content` search](#_content-search-documentreference--diagnosticreport--careplan). There is no
separate "vector store says yes, so allow it" code path anywhere in this design.

The derived-text delivery and `Binary`-reverse-lookup capabilities are lower-risk by construction:
they run *after* the resource's normal, already-authorized fetch has completed — `_format`-based
response handling happens in the response-writing layer, which by construction only ever sees the
resource `searchById`'s normal, fully tenant-scoped fetch already returned. By the time the
vector-store lookup runs, the caller is already proven authorized for that exact resource — the
vector store is used purely to fetch *more data about* a resource the caller can already see, never
to decide *whether* they can see it.

## Architecture & Components

### Cross-cluster connection

- **New config**: `FHIR_NOTES_MONGO_URL`, `FHIR_NOTES_MONGO_DB_NAME`,
  `FHIR_NOTES_MONGO_COLLECTION_NAME` (for the vector-store's MongoDB connection), plus
  `FHIR_NOTES_TEXT_SEARCH_INDEX_NAME` for the Atlas Search index name that repo already created.
  The index name is config, not a hardcoded string — it's a cross-repo contract, and if the owning
  team ever renames/recreates it, an env change should fix this side without a code deploy.
- **New connection**: a dedicated, **read-only**-credentialed Mongo client, registered in
  `createContainer.js` separately from the primary `mongoDatabaseManager`, with its own connection
  pool and a short timeout (this cluster is a dependency of a dependency — a slow/unavailable
  vector-store cluster must not stall fhir-server's primary request path). Credentials should be
  scoped to read-only on this one collection; fhir-server never writes to this database.

### `_content` search (`DocumentReference` / `DiagnosticReport` / `CarePlan`)

1. **`SearchParametersManager.getPropertyObject`** — special-case `_content` to return a synthetic
   `SearchParameterDefinition{ type: 'special' }` instead of `undefined`, so it's reachable at all
   instead of being silently dropped by `r4.js`'s loop guard (same root cause as the composite-params
   bug, #2483).
2. **`ClinicalNoteSearchClient`** (new) — given `{ resourceType, contentQuery }`, runs:
   ```json
   [
     {
       "$search": {
         "index": "<FHIR_NOTES_TEXT_SEARCH_INDEX_NAME>",
         "queryString": { "defaultPath": "text", "query": "<_content value, near-verbatim>" }
       }
     },
     { "$limit": 1000 },
     { "$match": { "meta.resource_type": "<resourceType>" } },
     { "$project": { "debug.resource_reference": 1, "debug.resource.meta.security": 1 } }
   ]
   ```
   against the vector-store collection, via the read-only connection above. `queryString` parses
   Lucene syntax natively (`AND`/`OR`/parens/field-scoped terms/wildcards) — see
   [Lucene syntax via `queryString`](#lucene-syntax-via-querystring) — so the FHIR `_content` value
   passes through close to verbatim; fhir-server does not need its own boolean-grammar parser for
   this path (contrast with the original design's `textQueryParser.js`, which is no longer needed
   for this scope).
   - `meta.resource_type` is **not** a mapped field in the vector store's text-search index (only
     `text`, `patient_id`, and `key` are, per `create_text_search_index` in that repo) — an earlier
     revision of this implementation put it inside `$search.compound.filter`, which Atlas Search
     either ignores or errors on for an unmapped field, so `_content` matched nothing at all in
     practice. It has to be a `$match` stage *after* `$search` instead, which is what's shown above.
     `$limit` runs before that `$match` (the standard Atlas Search pattern for bounding an
     aggregation pipeline with no other cap) — a query whose top 1000 hits are dominated by other
     resourceTypes can therefore under-return true matches for the requested resourceType; that's
     an accepted trade-off against unbounded memory/network use from an unmapped, un-indexed
     collection scan, not a correctness guarantee.
   - **Known gap, not yet implemented**: this pipeline has no `patient_id` pre-filter. An earlier
     revision of this design specified one, derived from the request's already-computed patient
     scope, specifically so the search couldn't itself be widened by a caller. As shipped, `_content`
     searches across every patient of every tenant in the vector store before results are
     re-authorized (see the security model above) — no direct disclosure results from this (every
     candidate is still re-proven through fhir-server's own tenant/access-tag filtering), but it
     does mean the `$limit` above is a much blunter instrument than intended, and a caller with
     access to only their own tenant's data can still cause the vector store to do this work for
     every tenant on every request. Restoring the `patient_id` filter is follow-up work.
   - Extracts each match's raw sourceId from `debug.resource_reference` (stripping the resourceType
     prefix) and its `sourceAssigningAuthority` from `debug.resource.meta.security`, then resolves
     the pair to a `_uuid` via `generateUUIDv5(\`${sourceId}|${sourceAssigningAuthority}\`)` — the
     same scheme `uuidColumnHandler.js` uses to populate `_uuid` in the first place — before
     returning the (deduped) candidate list. A raw `debug.resource_reference` sourceId is only
     unique per `(resourceType, sourceAssigningAuthority)`, not globally (see
     [Why raw ids aren't enough](#why-raw-ids-arent-enough) above); returning it directly would let
     `_content` pick up an unrelated same-sourceId resource under a *different* SAA as a
     false-positive candidate (review.md §E: a join on a tenant-independent identifier needs the
     tenant discriminator *in the join condition itself*). A candidate whose chunk carries no
     `sourceAssigningAuthority` tag is dropped rather than guessed at.
3. **`SearchManager` hook** — before the normal query-building path runs, if `_content` is present
   (a non-empty value — `_content` is search-only now, see below) and `resourceType` is one of the
   three supported: call `ClinicalNoteSearchClient`, get candidate ids, and inject
   `_id ∈ candidateIds` as an additional filter into the *normal, unmodified* `R4SearchQueryCreator`
   pipeline — the same mechanism any other `_id`-based filtering already uses.
   No new merge/precedence logic with the ADR-0003 Atlas feature is needed: that feature's `$search`
   runs against fhir-server's own primary cluster/collection in the same aggregation pipeline;
   this one is a separate round-trip to a different cluster entirely, resolved to a plain `_id`
   filter *before* the primary pipeline is built. No mutual-exclusion conflict, unlike the original
   design's Atlas-vs-Atlas concern.
   - **The resourceType-allowlist and configured-feature checks must run *only* when `_content` is
     actually present with a non-empty value** — checking the allowlist first and unconditionally
     would make an entirely unrelated `_content`-carrying request 400 even when the feature is
     fully disabled (`ENABLE_FULL_TEXT_SEARCH` off), which is not "revert to prior behavior," it's
     a regression: on `main` today, `_content` is a recognized-but-unresolved param that's silently
     ignored. When the feature flag is off, `_content` must behave exactly like that — ignored, not
     rejected — regardless of resourceType. Only once the flag is on does an unsupported
     resourceType or missing connection config become a `BadRequestError`.
4. **Empty candidate list is a real zero-result answer, not "no filter."** Per `review.md` §D's
   general warning about empty-filter-means-return-everything bugs: if `ClinicalNoteSearchClient`
   returns `[]`, the query must produce zero results, explicitly — not be treated as "no `_id`
   constraint, so don't filter." This cannot be a literal `_id ∈ []`/`_uuid ∈ []` constraint,
   though: `MongoQuerySimplifier.simplifyFilter` (which every query passes through, unconditionally,
   at the end of `constructQueryAsync`) deletes empty `$in` arrays and then the now-empty parent
   clauses around them — an earlier revision of this implementation shipped exactly that and it was
   silently erased, turning a zero-match `_content` search into "no filter, so return everything."
   The fix uses the same `{ _uuid: '__invalid__' }` sentinel this codebase already uses elsewhere
   (`patientQueryCreator.js`, `dataSharingManager.js`) for "match nothing" — a literal string value
   survives simplification because it isn't an array.
5. **An empty-string `_content` value never reaches this code at all.** `r4ArgsParser.js` drops
   every empty-string query parameter value, for every parameter, before constructing a
   `ParsedArgsItem` — this is generic parser behavior, not something `_content` opts into or out of.
   There is therefore no "empty `_content` means something different" branch to write or test here;
   `_content` is unconditionally a search filter, full stop. (Revision (a) of this design got this
   wrong — see [Revision History](#revision-history).)

### Lucene syntax via `queryString`

Example end-to-end, matching the spec's own grammar example:

**Client request:**
```
GET /4_0_0/DocumentReference?patient=Patient/123&_content=(bone OR liver) AND metastases
```

**Vector-store Atlas Search query** (step 2 above):
```json
[
  {
    "$search": {
      "index": "fhir-notes-text-search",
      "queryString": { "defaultPath": "text", "query": "(bone OR liver) AND metastases" }
    }
  },
  { "$limit": 1000 },
  { "$match": { "meta.resource_type": "DocumentReference" } },
  { "$project": { "debug.resource_reference": 1, "debug.resource.meta.security": 1 } }
]
```

**Resulting fhir-server query** (step 3 above, illustrative): the normal `patient=Patient/123`
tenant-scoped query, AND'd with `_uuid ∈ [<uuids resolved from the search above>]`. If the vector
store found zero matching chunks, the query is AND'd with the `{ _uuid: '__invalid__' }` sentinel
instead (see point 4 above) and the caller gets an empty Bundle — same as any other search with no
matches.

`queryString` also means field-scoped Lucene terms work for free against any other field mapped
into that index (e.g. `_content=meta.note_category:progress AND diabetes`), without fhir-server
writing any query-grammar parsing.

### Derived-text delivery via `_format=text/plain`

`_format` is an existing, ordinary FHIR search parameter already used by this codebase for content
negotiation (`src/utils/contentTypes.js`'s `hasCsvContentType`/`hasExcelContentType`, consumed by
`ResponseHandlerFactory` for the `$summary` operation). Unlike an empty `_content=` value, a value
like `text/plain` is a normal, non-empty query parameter value — it survives `r4ArgsParser.js`'s
parsing with zero special-casing, because there's nothing empty about it.

`GET DocumentReference/{id}?_format=text/plain` (or `DiagnosticReport`/`Binary`) returns the
reassembled derived text as the **entire HTTP response body**, `Content-Type: text/plain`, *instead
of* the normal `application/fhir+json` resource representation — not embedded inside the resource's
JSON. This is the key design difference from revision (a): nothing is ever appended to
`content[]`/`presentedForm[]`, and nothing is ever assigned to `Binary.extension` (which
[doesn't exist](#revision-history) in FHIR R4). The resource's JSON shape is completely unaffected
by this feature; `_format=text/plain` simply chooses a different *representation* of the same
underlying resource, which is exactly what `_format` is for.

**Where this lives, concretely:**

- `src/utils/contentTypes.js` — add `plainText: 'text/plain'` to `fhirContentTypes` and a
  `hasPlainTextContentType(text)` helper, mirroring `hasCsvContentType` exactly.
- Single-resource reads do **not** go through `ResponseHandlerFactory` (that's bundle-only, used
  solely by `$summary`) — they go through `FhirResponseWriter.readOne`
  (`src/middleware/fhir/fhirResponseWriter.js`), which today unconditionally does
  `res.status(200).json(resource)`, never consulting `_format` at all. This is the file that needs
  the new branch: if `hasPlainTextContentType(req.sanitized_args._format)` and `resource.resourceType`
  is `DocumentReference`/`DiagnosticReport`/`Binary`, resolve the derived text (see below) and
  respond `res.type('text/plain').status(200).send(text)` instead of the JSON path. No signature
  change to `GenericController`'s call site was needed — `req.sanitized_args._format` and
  `resource.resourceType` were both already reachable from `readOne`'s existing `{ req, res,
  resource }` parameters.
- **Text resolution reuses `ClinicalNoteTextRetriever` directly** (chunk-reassembly logic unchanged
  from revision (a); its query-side tenant/attachment discriminators were tightened in revision (c)
  — see [Revision History](#revision-history)):
  - `DocumentReference`/`DiagnosticReport`: extract `sourceAssigningAuthority` from the
    already-authorized `resource.meta.security` tags; for each `content[]`/`presentedForm[]` entry
    at index `i`, call `getReassembledTextAsync({ chunkGroupId: "{resource.id}-{i}", resourceType,
    sourceAssigningAuthority })` (both `resourceType` and `sourceAssigningAuthority` are real query
    discriminators, not just labels — see revision (c)); concatenate all attachments' text (joined
    with a blank line) into one body. If the tag can't be extracted, or none of the resource's
    attachments have indexed text yet, respond with an empty `text/plain` body (200, not 404 — the
    resource itself was found and is readable; it just has no derived text available).
  - `Binary`: call `getReassembledTextForBinaryAsync({ binaryReference: "Binary/{resource.id}",
    sourceAssigningAuthority })` — same reverse-lookup shape as revision (a), but now resolves the
    *exact* attachment index on the owning resource that references this specific `Binary` before
    deriving the chunk group id (rather than trusting the first Mongo match, which could otherwise
    return a different attachment's text off the same resource — see revision (c)), and no longer
    matches `#{id}` contained-resource-fragment references at all (structurally invalid for a
    top-level `Binary` read).
- This runs *after* `searchById`'s normal, fully tenant-scoped fetch has already returned the
  resource (`readOne` only ever receives an already-authorized resource) — same authorization
  guarantee as revision (a)'s enrichment providers, just enforced by a different code path. See
  [Security model](#security-model-read-this-before-the-architecture).
- **No enrichment providers.** `AttachmentTextEnrichmentProvider` and
  `BinaryDerivedTextEnrichmentProvider` (revision (a)) are removed entirely — there is no longer
  anything to attach to the resource, so there is no enrichment step. This also resolves revision
  (a)'s "Known Limitation" ($everything/$graph fan-out) as a side effect: that limitation existed
  specifically because `EnrichmentManager` shares one `parsedArgs` across every entry in a
  traversal-gathered bundle. `readOne` is called once, directly, for the single resource a plain
  `GET .../{id}` returns — there is no shared-`parsedArgs`-across-many-resources mechanism in this
  design at all, so the fan-out scenario cannot occur.

## Error Handling

- **`_content` on an unsupported resourceType, once the feature is configured** → `BadRequestError`.
  Silent no-op or silent full-scan-ignore-the-filter are both worse than a clear error, since either
  would look to a caller like their filter was honored when it wasn't. (When the feature is *not*
  configured, `_content` is silently ignored regardless of resourceType — see [Config](#config) —
  since there's no filter capability to have silently failed in the first place.)
- **Vector-store cluster unreachable, or the Atlas Search index missing/not-yet-queryable, during a
  `_content` search** → **fail the request** with a `503`-equivalent `OperationOutcome`, not a
  silent fallback. Unlike the original design's Atlas-vs-regex fallback (two independently-correct
  ways to run the *same* full search), there is no equivalent regex-based way to run this narrower,
  delegated search — falling back would mean silently returning every patient-scoped
  `DocumentReference`/`DiagnosticReport`/`CarePlan` as if `_content` had matched all of them, which
  is a correctness violation a caller has no way to detect from the response alone.
- **Vector-store cluster unreachable during `_format=text/plain` text resolution** → degrade
  gracefully: `ClinicalNoteTextRetriever`'s methods already catch and return `null`/skip on any
  Mongo error (unchanged from revision (a)); respond with an empty `text/plain` body (200) rather
  than failing the request. Unlike search, a missing-derived-text response doesn't misrepresent
  whether a filter matched — the underlying resource read already succeeded independently.
- **`_format=text/plain` on an unsupported resourceType, or when the feature isn't configured** →
  fall through to the normal JSON response, silently. This is a response-*format* choice, not a
  search filter — there's no correctness claim being made that a caller could be misled by, unlike
  `_content` search's `BadRequestError` posture above.
- **Malformed Lucene syntax in `_content`'s value** → Atlas Search's `queryString` operator returns
  its own parse error for malformed input; surface that as `BadRequestError` with the offending
  value, rather than a generic 500.
- **Empty candidate list from a successful `_content` search** → zero results, explicitly (see
  [`_content` search](#_content-search-documentreference--diagnosticreport--careplan) point 4).

## Config

| Env var | Purpose |
|---|---|
| `FHIR_NOTES_MONGO_URL` | Connection string for the (read-only) `fhir-notes-vector-store` Mongo cluster |
| `FHIR_NOTES_MONGO_DB_NAME` | Database name on that cluster |
| `FHIR_NOTES_MONGO_COLLECTION_NAME` | Collection name (the `ClinicalNote` collection) |
| `FHIR_NOTES_TEXT_SEARCH_INDEX_NAME` | Atlas Search index name already created by that service |
| `ENABLE_FULL_TEXT_SEARCH` | Explicit on/off flag for the whole feature, independent of the connection vars above |

The four connection vars are required together; `ENABLE_FULL_TEXT_SEARCH` is a separate, additional
gate on top of them — this lets an operator deploy the connection config ahead of a rollout and flip
one flag to enable/disable, or use it as an emergency kill switch without touching connection config.
The feature is "configured" only when all four connection vars are set **and** the flag is on; if
not, `_content` search is silently ignored (returns `null`/no filter — same behavior `_content` has
always had on `main`, before this feature existed), and `_format=text/plain` falls through to the
normal JSON response. Once the feature *is* configured, an unsupported resourceType (for `_content`
search) or a resource with no available derived text (for `_format=text/plain`) still get their own
distinct handling — `BadRequestError` for the former, an empty `text/plain` body for the latter —
see [Error Handling](#error-handling).

## Testing Plan

1. **`ClinicalNoteSearchClient` unit tests** — mock the read-only Mongo client; verify the
   `$search`/`$limit`/`$match` shape, `_uuid` resolution from
   `debug.resource_reference`+`debug.resource.meta.security` via
   `generateUUIDv5(sourceId|sourceAssigningAuthority)`, and that a candidate with no
   `sourceAssigningAuthority` tag is dropped rather than returned unscoped. (The `patientIds`
   pre-filter described earlier is a known, not-yet-implemented gap — see the note in `_content`
   search step 2 — so there is nothing to test for it yet.)
2. **`SearchManager` hook integration tests** — `_content` search end-to-end against a real
   `mongodb-atlas-local` instance (reusing ADR-0003's existing `jest.atlasSearch.config.js` /
   `atlasSearchGlobalSetup.js` infra): matches narrow correctly, empty-candidate-list yields zero
   results (not everything, and specifically survives `MongoQuerySimplifier` rather than being
   erased by it), a request for an unsupported resourceType is rejected, cluster-down simulation
   yields a `503`/`OperationOutcome` rather than an unfiltered result set. **Not yet done**: this
   still needs a real `mongodb-atlas-local` run — every existing `ClinicalNoteSearchClient` test
   mocks `collection.aggregate` rather than exercising a real Atlas Search index, which is exactly
   how the `meta.resource_type`-unmapped-field bug (see `_content` search step 2) shipped
   undetected. Tracked as follow-up work, not blocking this PR on its own given the fix has since
   landed and is covered by unit tests of the corrected pipeline shape.
3. **Cross-tenant regression tests** (required given `review.md`'s scope) — a service account
   scoped to tenant A must not see resources belonging to tenant B even when the vector store
   returns candidate ids for tenant B's documents (confirms the `_id ∈ [...]` re-authorization is
   real, not just present in code but bypassable).
4. **`_format=text/plain` response-writer unit/integration tests** — for each of
   `DocumentReference`/`DiagnosticReport`/`Binary`: build a real `ParsedArgs` via the actual
   `R4ArgsParser`/route path (not a hand-built `ParsedArgsItem` — this is precisely what revision
   (a)'s tests failed to do, and why the empty-`_content` defect survived ten task-level reviews),
   confirm the response is `text/plain` with the reassembled text, confirm an unrelated resourceType
   or an unconfigured environment falls through to normal JSON, confirm a resource with no indexed
   text yet returns an empty 200 body rather than an error, and confirm the JSON path (no `_format`)
   is completely unaffected — same resource, same fields, no stray `content[]`/`extension` entries.
5. **`Binary` reverse-lookup tests** — the `debug.resource.content.attachment.url` /
   `presentedForm.url` OR-query, multi-chunk reassembly (unchanged from revision (a),
   `ClinicalNoteTextRetriever` was already correct) — plus one test confirming a real
   `Binary.toJSON()` round-trip is unaffected by this feature (no attempted `extension` write).
6. **Config test** — all-four-required-together behavior; each individual missing var falls back
   to "feature not configured" behavior, not a partial/broken state.
7. **`ENABLE_FULL_TEXT_SEARCH=off` regression test** — confirm `_content=<value>` on any
   resourceType (including ones outside the three-type allowlist) is silently ignored, not
   `BadRequestError`, when the flag is off — this must match `_content`'s behavior on `main` today.

## Out of Scope

- `_text` (narrative search) — different data source entirely; not addressed here (see
  [Scope](#scope)).
- `_content` on resource types other than `DocumentReference`/`DiagnosticReport`/`CarePlan`.
- `_format=text/plain` on search/bundle responses — restricted to single-resource reads in this
  revision (see [Scope](#scope)); there's no coherent single plain-text body for a multi-resource
  Bundle.
- Thesaurus/stemming/relevance ranking beyond what Atlas Search's `queryString` gives by default —
  spec marks this "MAY", not required.
- Any change to `fhir-notes-vector-store` itself — this design consumes its existing Atlas Search
  index read-only and makes no changes to that repo.
- Write-back of derived text into the FHIR resource itself (materializing the sibling
  `content[]`/extension at write time instead of read time) — read-time enrichment was chosen
  specifically so this stays a pure consumer of `fhir-notes-vector-store`'s data, with no write path
  into either service's primary store from the other.
