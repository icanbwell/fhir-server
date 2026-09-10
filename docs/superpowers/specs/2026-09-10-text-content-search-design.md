# `_text` / `_content` Full-Text Search Parameters — Design

## Revision History

- **2026-09-06** — original design: build a new, fhir-server-owned Atlas Search index, generic
  across all resource types, with a Mongo regex fallback everywhere Atlas isn't configured.
- **2026-09-10** — superseded by this revision. Discovered `~/git/fhir-notes-vector-store` — a
  sibling service already extracting, chunking, and Atlas-Search-indexing attachment text for
  `DocumentReference`/`DiagnosticReport`/`CarePlan`. Building a second, fhir-server-owned index for
  the same content types both duplicates that work and risks the two texts drifting (different
  extraction logic, different chunking, different update cadence). This revision replaces the
  "build our own index" plan with "delegate to the index that already exists," narrows scope to
  the three resource types that index actually covers, and adds two capabilities the original
  design didn't have: attaching derived plain text to a resource read (not just filtering search
  results by it), and a `Binary` reverse-lookup. `_text` (narrative search) is dropped from scope
  entirely — see [Scope](#scope).

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
   exact three resource types `fhir-notes-vector-store` covers. `_content` on any other resource
   type is rejected with `BadRequestError` (not silently ignored, not silently unfiltered) — see
   [Error Handling](#error-handling) for why silent degradation is unacceptable here.
2. **Derived-text enrichment on resource read** — attach the reassembled plain text as an
   additional attachment/extension when a `DocumentReference` or `DiagnosticReport` is read directly
   (see [Derived-text read enrichment](#derived-text-read-enrichment)). Not needed for `CarePlan`:
   its `note[].text` is already plain text in the base resource, nothing to derive.
3. **`Binary` reverse lookup** — `GET Binary/{id}` with the same empty-`_content` trigger returns
   the derived text of whichever `DocumentReference`/`DiagnosticReport` attachment referenced that
   `Binary`, since a `Binary` is never an independently-indexed source in the vector store.

**Explicitly out of scope:**

- **`_text` (narrative search)** — the vector store never touches `Resource.text.div`; it indexes
  attachment/note content, which is a different field with different semantics. Implementing `_text`
  would mean building the original design's own regex-on-`text.div` path (or a separate index) —
  real, but independent work, not addressed here.
- **`_content` on resource types outside the three above** — e.g. `Condition`, `Observation`. The
  original design's generic regex-across-all-string-fields fallback could still be built later as
  genuinely separate work; this revision doesn't attempt it, to avoid two half-implementations of
  the same parameter with different semantics live at once.
- **Broad-search derived-text enrichment** — the empty-`_content` "attach full text" trigger is
  scoped to single-resource reads only (by `_id`), not search result sets. See
  [Derived-text read enrichment](#derived-text-read-enrichment) for why.

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

The read-enrichment and Binary-reverse-lookup capabilities are lower-risk by construction: they run
*after* the resource's normal, already-authorized fetch has completed (enrichment providers execute
post-fetch in this codebase's pipeline), so by the time the vector-store lookup runs, the caller is
already proven authorized for that exact resource — the vector store is used purely to fetch
*more data about* a resource the caller can already see, never to decide *whether* they can see it.

## Architecture & Components

### Cross-cluster connection

- **New config**: `FHIR_NOTES_MONGO_URI`, `FHIR_NOTES_MONGO_DATABASE`,
  `FHIR_NOTES_MONGO_COLLECTION` (mirrors `fhir-notes-vector-store`'s own
  `mongo_vector_uri`/`mongo_vector_database`/`mongo_vector_embeddings_collection` naming, prefixed
  to avoid confusion since this is a *different* service's env), plus
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
2. **`ClinicalNoteSearchClient`** (new) — given `{ resourceType, patientIds, query }`, runs:
   ```json
   {
     "$search": {
       "index": "<FHIR_NOTES_TEXT_SEARCH_INDEX_NAME>",
       "compound": {
         "must": [
           { "queryString": { "defaultPath": "text", "query": "<_content value, near-verbatim>" } }
         ],
         "filter": [
           { "equals": { "path": "meta.resource_type", "value": "<resourceType>" } },
           { "in": { "path": "patient_id", "value": ["<patientIds>"] } }
         ]
       }
     }
   }
   ```
   against the vector-store collection, via the read-only connection above. `queryString` parses
   Lucene syntax natively (`AND`/`OR`/parens/field-scoped terms/wildcards) — see
   [Lucene syntax via `queryString`](#lucene-syntax-via-querystring) — so the FHIR `_content` value
   passes through close to verbatim; fhir-server does not need its own boolean-grammar parser for
   this path (contrast with the original design's `textQueryParser.js`, which is no longer needed
   for this scope). Extracts distinct ids from `debug.resource_reference`, strips the resourceType
   prefix, returns the id list (deduped — multiple chunks of the same document may all match).
   - `patientIds` is derived from the request's *already-computed* patient scope (whatever the
     request's own patient/access-tag filtering already resolved to) — never from the raw request
     params directly, so this pre-filter can't itself be widened by a caller.
3. **`SearchManager` hook** — before the normal query-building path runs, if `_content` is present
   and `resourceType` is one of the three supported: call `ClinicalNoteSearchClient`, get candidate
   ids, and inject `_id ∈ candidateIds` as an additional filter into the *normal, unmodified*
   `R4SearchQueryCreator` pipeline — the same mechanism any other `_id`-based filtering already uses.
   No new merge/precedence logic with the ADR-0003 Atlas feature is needed: that feature's `$search`
   runs against fhir-server's own primary cluster/collection in the same aggregation pipeline;
   this one is a separate round-trip to a different cluster entirely, resolved to a plain `_id`
   filter *before* the primary pipeline is built. No mutual-exclusion conflict, unlike the original
   design's Atlas-vs-Atlas concern.
4. **Empty candidate list is a real zero-result answer, not "no filter."** Per `review.md` §D's
   general warning about empty-filter-means-return-everything bugs: if `ClinicalNoteSearchClient`
   returns `[]`, the resulting `_id ∈ []` constraint must produce zero results, explicitly — not be
   treated as "no `_id` constraint, so don't filter."

### Lucene syntax via `queryString`

Example end-to-end, matching the spec's own grammar example:

**Client request:**
```
GET /4_0_0/DocumentReference?patient=Patient/123&_content=(bone OR liver) AND metastases
```

**Vector-store Atlas Search query** (step 2 above):
```json
{
  "$search": {
    "index": "fhir-notes-text-search",
    "compound": {
      "must": [{ "queryString": { "defaultPath": "text", "query": "(bone OR liver) AND metastases" } }],
      "filter": [
        { "equals": { "path": "meta.resource_type", "value": "DocumentReference" } },
        { "in": { "path": "patient_id", "value": ["123"] } }
      ]
    }
  }
}
```

**Resulting fhir-server query** (step 3 above, illustrative): the normal `patient=Patient/123`
tenant-scoped query, AND'd with `_id ∈ [<ids from the search above>]`. If the vector store found
zero matching chunks, the caller gets an empty Bundle — same as any other search with no matches.

`queryString` also means field-scoped Lucene terms work for free against any other field mapped
into that index (e.g. `_content=meta.note_category:progress AND diabetes`), without fhir-server
writing any query-grammar parsing.

### Derived-text read enrichment

New `AttachmentTextEnrichmentProvider`, registered in `createContainer.js`'s
`enrichmentManager` provider list, gated to run only when: resourceType is `DocumentReference` or
`DiagnosticReport`, **and** the request is a single-resource read/vread (by `_id`), **and**
`parsedArgs` has `_content` present with an **empty** value. (Restricting to single-resource reads
is a deliberate v1 boundary — see [Error Handling](#error-handling) for why an accidentally-blank
`_content` on a broad search is a real risk worth avoiding rather than a hypothetical one; extending
this to search result sets, behind an explicit result-count cap, is future work.)

For each `content[].attachment` (`DocumentReference`) or `presentedForm[]` entry
(`DiagnosticReport`) on the fetched resource:

1. Query the vector-store collection for `meta.chunk_group_id == "{id}-{index}"`, sorted by
   `meta.chunk_index`.
2. Concatenate `text` across all chunks in order.
3. Append a sibling attachment: `{ attachment: { contentType: "text/plain", data: <base64(text)>,
   extension: [{ url: "https://www.icanbwell.com/attachment-derived-text", valueBoolean: true }] } }`.
   The extension marker is required, not decorative — `text/plain` can legitimately be the
   *original* format for some documents, and a consumer must be able to tell "this is the source"
   from "this is a server-generated derivation" without guessing from position in the array.
4. If no `ClinicalNote` exists yet for that `chunk_group_id` (not yet indexed, or indexing failed —
   `debug.error` set), skip that attachment silently — no sibling is added for it. This is a
   coverage gap, not an error: the vector store's indexing is asynchronous relative to
   fhir-server's writes, so a just-created `DocumentReference` legitimately has no derived text yet.

This runs *after* the resource's normal authorized fetch (enrichment providers are a post-fetch
pipeline stage in this codebase), so it inherits that read's authorization for free — see
[Security model](#security-model-read-this-before-the-architecture).

### `Binary` reverse lookup (`_content` on `Binary/{id}`)

`Binary` is never an independently-indexed `meta.resource_type` in the vector store — only
`DocumentReference`/`DiagnosticReport`/`CarePlan` are. A `Binary`'s content only appears in the
index indirectly, as bytes resolved from another resource's attachment `url`. So `GET
Binary/{id}?_content=` (empty value, same trigger as above) requires a different query:

```json
{ "debug.resource.content.attachment.url": { "$in": ["Binary/{id}", "#{id}"] } }
```
OR'd with the `DiagnosticReport` equivalent path (`debug.resource.presentedForm.url`), against the
vector-store collection directly (a plain `find`, not `$search` — this is an exact-match lookup on
`debug.resource`, the full persisted source resource, not a text search). Take all matching chunks,
group by `meta.chunk_group_id` (there should be exactly one group — the specific attachment that
referenced this `Binary`), sort by `meta.chunk_index`, concatenate.

**Response shape differs from the `content[]` sibling-attachment approach above**: `Binary`'s core
fields (`contentType`, `data`) describe the resource's *actual* stored bytes and must not be
repurposed to lie about that. Instead, add a top-level extension directly on the `Binary` resource:
`{ url: "https://www.icanbwell.com/attachment-derived-text", valueString: "<plain text,
un-encoded>" }` — no base64 layer needed here, since `Binary`'s extensions aren't constrained to
`Attachment`'s `base64Binary`-typed `data` field the way `content[].attachment.data` is.

As with the enrichment provider above, this runs after `Binary/{id}`'s own normal authorized fetch,
never before it — the reverse-lookup query only executes once the caller is already proven
authorized to read that specific `Binary`.

## Error Handling

- **`_content` on an unsupported resourceType** → `BadRequestError`. Silent no-op (the current
  behavior) or silent full-scan-ignore-the-filter are both worse than a clear error, since either
  would look to a caller like their filter was honored when it wasn't.
- **Vector-store cluster unreachable, or the Atlas Search index missing/not-yet-queryable, during a
  `_content` search** → **fail the request** with a `503`-equivalent `OperationOutcome`, not a
  silent fallback. Unlike the original design's Atlas-vs-regex fallback (two independently-correct
  ways to run the *same* full search), there is no equivalent regex-based way to run this narrower,
  delegated search — falling back would mean silently returning every patient-scoped
  `DocumentReference`/`DiagnosticReport`/`CarePlan` as if `_content` had matched all of them, which
  is a correctness violation a caller has no way to detect from the response alone.
- **Vector-store cluster unreachable during derived-text enrichment or the `Binary` reverse
  lookup** → degrade gracefully: skip the enrichment (return the resource without the derived
  text/extension), log it. Unlike search, an enrichment failure doesn't misrepresent whether a
  filter matched — the base resource is still correct and complete, just missing an optional
  addition.
- **Malformed Lucene syntax in `_content`'s value** → Atlas Search's `queryString` operator returns
  its own parse error for malformed input; surface that as `BadRequestError` with the offending
  value, rather than a generic 500.
- **Empty candidate list from a successful `_content` search** → zero results, explicitly (see
  [`_content` search](#_content-search-documentreference--diagnosticreport--careplan) point 4).

## Config

| Env var | Purpose |
|---|---|
| `FHIR_NOTES_MONGO_URI` | Connection string for the (read-only) `fhir-notes-vector-store` Mongo cluster |
| `FHIR_NOTES_MONGO_DATABASE` | Database name on that cluster |
| `FHIR_NOTES_MONGO_COLLECTION` | Collection name (the `ClinicalNote` collection) |
| `FHIR_NOTES_TEXT_SEARCH_INDEX_NAME` | Atlas Search index name already created by that service |
| `ENABLE_FULL_TEXT_SEARCH` | Explicit on/off flag for the whole feature, independent of the connection vars above |

The four connection vars are required together; `ENABLE_FULL_TEXT_SEARCH` is a separate, additional
gate on top of them — this lets an operator deploy the connection config ahead of a rollout and flip
one flag to enable/disable, or use it as an emergency kill switch without touching connection config.
The feature is "configured" only when all four connection vars are set **and** the flag is on; if
not, `_content` search returns `BadRequestError` (feature not configured in this environment — same
posture as an unsupported resourceType) and the enrichment/reverse-lookup triggers are simply no-ops
(resource returned without derived text).

## Testing Plan

1. **`ClinicalNoteSearchClient` unit tests** — mock the read-only Mongo client; verify the
   `$search` shape (compound/queryString/filter), id extraction/dedup from `debug.resource_reference`,
   and that `patientIds` only ever comes from the already-scoped patient filter, never raw request
   params.
2. **`SearchManager` hook integration tests** — `_content` search end-to-end against a real
   `mongodb-atlas-local` instance (reusing ADR-0003's existing `jest.atlasSearch.config.js` /
   `atlasSearchGlobalSetup.js` infra): matches narrow correctly, empty-candidate-list yields zero
   results (not everything), a request for an unsupported resourceType is rejected, cluster-down
   simulation yields a `503`/`OperationOutcome` rather than an unfiltered result set.
3. **Cross-tenant regression tests** (required given `review.md`'s scope) — a service account
   scoped to tenant A must not see resources belonging to tenant B even when the vector store
   returns candidate ids for tenant B's documents (confirms the `_id ∈ [...]` re-authorization is
   real, not just present in code but bypassable).
4. **`AttachmentTextEnrichmentProvider` unit tests** — chunk reassembly ordering, missing-note
   (not-yet-indexed) skip behavior, the derived-text extension marker, and that it never runs on
   search result sets (only single-resource reads).
5. **`Binary` reverse-lookup unit tests** — the `debug.resource.content.attachment.url` /
   `presentedForm.url` OR-query, multi-chunk reassembly, and the `valueString` (not base64)
   extension shape.
6. **Config test** — all-four-required-together behavior; each individual missing var falls back
   to "feature not configured" behavior, not a partial/broken state.

## Out of Scope

- `_text` (narrative search) — different data source entirely; not addressed here (see
  [Scope](#scope)).
- `_content` on resource types other than `DocumentReference`/`DiagnosticReport`/`CarePlan`.
- Broad-search derived-text enrichment (empty `_content` on a multi-result search) — deliberately
  restricted to single-resource reads in this revision; extending it would need an explicit
  result-count safeguard first.
- Thesaurus/stemming/relevance ranking beyond what Atlas Search's `queryString` gives by default —
  spec marks this "MAY", not required.
- Any change to `fhir-notes-vector-store` itself — this design consumes its existing Atlas Search
  index read-only and makes no changes to that repo.
- Write-back of derived text into the FHIR resource itself (materializing the sibling
  `content[]`/extension at write time instead of read time) — read-time enrichment was chosen
  specifically so this stays a pure consumer of `fhir-notes-vector-store`'s data, with no write path
  into either service's primary store from the other.
