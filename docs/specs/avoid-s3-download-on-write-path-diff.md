# Avoid S3 Download During Write-Path Diffing — Design

**Date:** 2026-07-16
**Branch:** SG-DCON-3870 (continuation of the binary/S3 externalization work)
**Status:** Draft for review

## Resolved decisions

- **`resourceMerger.mergeResourceAsync`/`fastMergeResourceAsync`:** per configured base64 leaf, skip
  the S3 download when the incoming `resourceToMerge` provides a literal value for that leaf —
  compare its locally-computed hash against `currentResource._blobMeta.hash` (already resident on
  the Mongo document, no I/O) instead of downloading `currentResource`'s bytes to diff against.
  Download is retained **only** as a fallback for the one case that can't be resolved by hash: the
  incoming write omits the leaf entirely (§3.1).
- **`patch.js`:** skip the pre-patch-apply RETRIEVE entirely unless an incoming JSON-Patch operation's
  `path` or `from` (for `move`/`copy`) intersects a configured base64 path — root, ancestor, or
  descendant all count as intersecting (§4).
- **Upload behavior is unchanged.** `alwaysCreateNew`'s blind re-upload on every PUT/PATCH (the
  `// TODO: remove alwaysCreateNew...` in `update.js`) is explicitly **out of scope** — this design
  only removes the download, not the redundant upload.
- **The generic diff engine is not modified.** `compare()`/`compareObjects` run exactly as today;
  only what `currentResource` looks like *going into* the diff changes. Persisted patches, history
  diagnostics, and response shapes stay byte-identical to current behavior.

## 1. Problem

Two write-path call sites unconditionally download the full externalized base64 payload from the
live S3 bucket before it's known whether that payload even changed:

1. **`resourceMerger.mergeResourceAsync`/`fastMergeResourceAsync`** (`src/operations/common/resourceMerger.js:413,541`)
   — call `base64DataManager.transformAsync(currentResource, BLOB_OP.RETRIEVE, requestInfo)`
   unconditionally, before the "is the incoming resource identical" fast-path check and before the
   real diff runs. Hit on every PUT against an existing resource (`update.js:351-364`) and every
   `$merge` update leg (`mergeManager.js`'s `mergeExistingAsync`). Neither call site checks whether
   the write even touches the configured data path.
2. **`patch.js:365-367`** — RETRIEVEs `foundResource.data` unconditionally before validating/applying
   the incoming JSON-Patch, even when none of the patch operations target the data path (e.g. a
   patch that only changes `Binary.contentType`).

The July 10 design (`2026-07-10-binary-s3-content-addressed-storage-design.md`, §7) explicitly left
call site (1) as-is, reasoning that the diff can't see a real change without real bytes on both
sides, and that its output is persisted (history diagnostics) and part of the public response shape.
That reasoning is correct for the diff engine itself — this design doesn't change it — but the
premise that *seeing the bytes* requires *downloading* them turns out to be false in the common case.

## 2. Approach: hash comparison in place of download

Two facts make this possible without touching the diff engine:

- `currentResource._blobMeta.hash` is metadata on the Mongo document itself — reading it costs
  nothing.
- Whenever the incoming write actually provides a literal value for a configured leaf, that value is
  already in process memory. Hashing it is a local, in-process computation (`computeContentHashAsync`,
  already used elsewhere) — no network round trip.

So "did this leaf change" is answerable by comparing two hashes we already have, **except** when the
incoming write omits the leaf — there's nothing to hash on that side. That single case keeps the
existing RETRIEVE behavior; every other case is resolved by hash.

### 2.1 Per-leaf decision (resourceMerger)

For each configured base64 leaf, before the diff runs:

- **Incoming omits the leaf** (client didn't send `data`) → fall back to today's RETRIEVE for that
  leaf. This preserves an existing safety property: without real bytes, a `data`-omitting write that
  changes some other field would otherwise make the leaf look "absent" to the diff, and the INSERT
  step (`_processEntry`) would incorrectly treat a still-valid `_blobMeta` as stale and clear it. That
  failure mode is a real correctness/data-loss risk, so this case is intentionally not optimized here.
- **Incoming provides a literal value** → no download:
  - Compute its hash locally (this hash is needed again later, at INSERT time, to decide upload vs.
    skip — see §3.3 for reuse).
  - Compare against `currentResource._blobMeta.hash`.
    - **Match** → the two sides are proven byte-identical. Set `currentResource`'s leaf directly to
      the incoming literal value (this is *not* a lossy substitution — it genuinely is the same
      content, just proven by hash instead of by downloading and comparing bytes). The generic diff
      then naturally sees no difference on this leaf and emits no patch op for it.
    - **Mismatch** → leave `currentResource`'s leaf stripped/absent. `compare()` emits a change op
      whose value is drawn from the *merged/target* object — which was always `resourceToMerge`'s
      real value, download or not — so the emitted patch is identical to what a download-based diff
      would have produced. (One cosmetic difference: the op type may come out as `add` rather than
      `replace`, since `currentResource`'s side of the diff view has no key at all rather than a
      stale one. This doesn't affect correctness — RFC 6902 `add` on an existing member overwrites,
      `applyPatch` handles it identically, and base64-path values are placeholder-sanitized in
      history regardless of op type, per §5.)

This means `resourceMerger.js` itself is untouched — the diff still runs on real content, in the
mismatch case, and on content proven identical, in the match case. What changes is only *how*
`currentResource` arrives at that diff.

## 3. `resourceMerger` implementation

### 3.1 New `Base64DataManager` method

A new method, e.g. `reconcileForDiffAsync(currentResource, resourceToMerge, requestInfo)`, replaces
the unconditional `transformAsync(currentResource, BLOB_OP.RETRIEVE, requestInfo)` call at both
`resourceMerger.js:413` (class-based, `mergeResourceAsync`) and `:541` (plain-object,
`fastMergeResourceAsync`) — mirroring the existing split between those two methods. For each
configured entry (`dataPath`/`blobMetaPath`) on the resource type:

1. Walk `resourceToMerge` at `dataPath` (reusing the existing path-walking helpers,
   `_processPaths`/`_processPathsSync`, so nested/array paths are supported for free when a future
   entry beyond `Binary.data` is onboarded).
2. If no literal value is present at that leaf on `resourceToMerge` → RETRIEVE that leaf only, via
   the existing `_processRetrieveEntry` logic (§2.1's fallback case).
3. If a literal value is present → hash it, compare to `currentResource`'s `_blobMeta.hash` at the
   corresponding leaf, and either mirror the value onto `currentResource` (match) or leave it
   stripped (mismatch), per §2.1.

This keeps the "merger-agnostic" boundary already established by `resolveWriteForExternalizedDataChange`
— `Base64DataManager` owns all hash-comparison logic; `resourceMerger` only ever sees a
`currentResource` that's already in the right shape to diff.

### 3.2 Call sites

- `update.js:351-364` (PUT against an existing resource) and `mergeManager.js`'s `mergeExistingAsync`
  (`$merge` update leg) pass `base64DataManager` into `mergeResourceAsync`/`fastMergeResourceAsync`
  exactly as today — only the internal RETRIEVE call is replaced.
- The initial fast-path check (`deepEqual(currentResource.toJSON(), resourceToMerge.toJSON())`,
  `resourceMerger.js:419,547`) is left as-is. In the match case it now correctly returns the no-op
  result immediately (since the leaf was mirrored to be identical); in the mismatch/omitted cases it
  may fall through to the full diff slightly more often than an ideal implementation would, but the
  second no-op check after the full diff (`patchContent.length === 0`) still catches any true no-op
  correctly. This is an acceptable, minor trade-off — no correctness impact, and avoids restructuring
  the fast-path check itself.

### 3.3 Reusing the hash at INSERT time

The hash computed during §2.1's comparison is the same hash `_processEntry` (INSERT) computes moments
later when deciding whether to upload. Stashing it in the existing request-scoped cache (keyed by
`` `${uuid}|${resolved-path}` ``, same convention as `ORIGINAL_DATA_CACHE_NAME`/`CURRENT_DATA_CACHE_NAME`)
avoids hashing the same payload twice within one request. This is a small efficiency gain, not
required for correctness — call out as a nice-to-have during implementation, not a hard requirement.

## 4. `patch.js` implementation

Before the existing RETRIEVE at `patch.js:365-367`, inspect `effectivePatchContent` (the parsed RFC
6902 operations, which may include `move`/`copy` ops carrying a `from` path in addition to `path`,
confirmed via `fast-json-patch`'s `validate`/`applyPatch`). For each op, check whether `op.path` and
(when present) `op.from` **intersect** any configured base64 `dataPath`:

- Parse both the op's path and the configured `dataPath` into JSON-Pointer segments (reusing
  `_parseJsonPointer`'s convention, where the config's `[]` matches any concrete array index).
- Two paths intersect if one's segments are a prefix of the other's, comparing pairwise up to the
  shorter length (with `[]` treated as a wildcard against a literal index). This covers:
  - **Exact match** — op targets the leaf directly.
  - **Ancestor match** — op targets a container that includes the leaf (e.g. root `""` replacing the
    whole resource, or, for a future nested/array entry, an op targeting the containing array
    element).
  - **Descendant match** — op targets something inside the leaf (not expected for a string leaf
    today, but handled generically).
- Root path (`""`) trivially intersects everything (a zero-length prefix).

If **no** op's `path` or `from` intersects any configured path → skip RETRIEVE entirely. If **any**
op does → RETRIEVE runs exactly as today, for the whole resource (no attempt to retrieve only the
touched leaf — this matches the simpler, more conservative approach already chosen: any touching op,
not just `test`, triggers the existing full RETRIEVE).

## 5. Correctness / equivalence guarantee

The emitted patch's value for a changed leaf is always `resourceToMerge`'s real (in-memory) content —
never a hash, never anything downloaded — so no caller of `mergeResourceAsync`/`fastMergeResourceAsync`
can observe a difference in patches, responses, or history diagnostics. History diagnostics were
already placeholder-sanitized for configured base64 paths regardless of op type
(`transformHistoryAsync`'s `_sanitizeHistoryPatches`), so the `add`-vs-`replace` cosmetic difference
noted in §2.1 has no observable effect there either.

## 6. Risks & open issues

1. **Omitted-leaf fallback is unoptimized by design.** A PUT/`$merge` that changes some other field
   while omitting the base64 leaf entirely still downloads, exactly as today. Accepted — this is the
   one case where hash comparison has nothing to compare against, and the alternative (treating
   "omitted" as "unchanged" without verification) risks silently stripping a valid `_blobMeta`.
2. **`add` vs `replace` op-type divergence in the mismatch case (§2.1).** Verified as inconsequential
   for both `applyPatch` (RFC 6902 semantics) and history diagnostics (always placeholder-sanitized).
   Worth a targeted test (§7) rather than a code change.
3. **Multiple configured leaves on one resource type.** Today only `Binary.data` is configured, so
   this doesn't arise in practice, but the per-leaf design (§2.1, §3.1) generalizes correctly if a
   second entry is onboarded later — each leaf is independently resolved as omitted/match/mismatch.
4. **No change to `alwaysCreateNew`.** Explicitly deferred (see Resolved decisions) — this design
   does not reduce the number of uploads, only downloads.

## 7. Testing

Reuse the download-count-assertion pattern already established in DCON-3868/3870
(`src/tests/binary/blobStorage/blobStorage.test.js`, `jest.spyOn(liveClient, 'downloadAsync')`):

- **PUT with unchanged `data`, other field changed:** assert zero downloads during merge; assert the
  produced patch/history diagnostics are identical to today's (placeholder-sanitized) output.
- **PUT with changed `data`:** assert zero downloads during merge; assert the persisted document and
  the history diagnostics reflect the real new content (not a hash).
- **PUT omitting `data`, other field changed:** assert the fallback RETRIEVE still occurs (no
  regression on the existing safety net) and `_blobMeta` is preserved correctly.
- **`$merge` update leg:** same three cases via `mergeManager.js`'s path.
- **PATCH not touching the data path:** assert zero downloads.
- **PATCH touching the data path via `replace`/`add`/`remove`:** assert RETRIEVE still occurs.
- **PATCH touching the data path via `move`/`copy` (`from`) only, not `path`:** assert RETRIEVE still
  occurs (regression guard for the `from`-field check specifically).
- **PATCH with a root-level (`""`) or ancestor-path op:** assert RETRIEVE still occurs even though no
  op's path exactly equals the configured `dataPath`.
- Existing contract/parity suites (feature enabled vs. disabled) continue to pass unchanged.

## 8. Out of scope

- Removing `alwaysCreateNew`'s redundant re-upload on unchanged PUT/PATCH data (deferred; see
  Resolved decisions).
- Any change to `resolveWriteForExternalizedDataChange` or the version-conflict retry path — those
  already avoid the download via a different, pre-existing mechanism and are unaffected by this work.
- Onboarding any base64 field beyond `Binary.data` — out of scope, though the per-leaf/path-aware
  design here doesn't foreclose it.
