# `/fhir/r4` Base-Path Alias — Design

> **Status:** Proposed — design only, no implementation in this PR.
> **Pending:** Tech Design Review (EA project), required by `CLAUDE.md` for a public API surface
> change on the system-of-record for an external partner. An ADR in `docs/adr/` should follow once
> the approach is ratified.

## Context

An **external partner** needs to reach the FHIR Server using the `/fhir/r4` path prefix
(the Epic-style convention) alongside the existing `/4_0_0`. They call the FHIR Server **directly** —
at `fhir.icanbwell.com`, served by the **`fhir-server`** Helm slice — not through api-gateway.

External exposure of the `fhir-server` slice (`ingress.external.enabled: true`), audited across
every environment:

| Environment | External ingress | Host |
|---|---|---|
| `dev-use1-eks` | ✗ | *(in-cluster only)* |
| `staging-ue1` | ✓ | `fhir.staging.icanbwell.com` |
| `client-sandbox-ue1` | ✓ | `fhir.client-sandbox.icanbwell.com` |
| `prod-ue1` | ✓ | **`fhir.icanbwell.com`** |

Every other slice (`fhir-server-internal`, `-next`, `-merge`, `-everything`, `-graphql`,
`-pipeline`, `-worker`, `-orchestrator`) is out of scope for this design.

Two consequences that shape the rollout in §10:

- **`fhir-server` has no external ingress in dev** — `dev-use1-eks.values.yaml` sets
  `external.enabled: false`, so dev is reachable only from inside the cluster. The first
  externally-reachable environment for this slice is staging.
- **`fhir.icanbwell.com` shares a pod set with `fhir-next.*` and `fhir-bulk.*`** (all listed under the
  same `external.hosts` block in `fhir-server/prod-ue1.values.yaml:21-56`). Enabling the flag on this
  slice enables the alias on **all** of those hostnames at once. That is acceptable — the alias is
  additive — but it is not a per-hostname opt-in, and reviewers should know it.

The alias must be **native and bidirectional**: accepted on inbound requests *and* mirrored in
outbound response URLs, so the partner's client can follow `next` page links, `Location` headers
and Bundle `fullUrl`s without ever being handed a path it wasn't told to use.

### Hard constraints

1. **Both base URLs are first-class, simultaneously, on the same running server.**
   `/fhir/r4/Patient/123` and `/4_0_0/Patient/123` must both resolve to the same resource, in the
   same process, with no per-deployment either/or. Every existing `/4_0_0` client keeps working
   byte-for-byte — same status codes, same headers, same response bodies. This is purely additive.
   Mirroring is **per request**: a caller on `/fhir/r4` sees `/fhir/r4` in every response URL, a
   caller on `/4_0_0` sees `/4_0_0`, and neither is affected by the other.
2. **No database schema change.** No new collections, no new or renamed fields, no changes to
   persisted resource shapes, no migration, no backfill. Mongo collection names stay
   `\`${resourceType}_4_0_0\`` (`src/operations/common/resourceLocator.js:44/53/63`). The alias is a
   transport-layer concern only and never reaches persistence — see the edge-normalization design
   below, and §7 for how the one path that *could* have persisted an alias (`ExportStatus.request`)
   is neutralized without storing anything new.

### Why this isn't a one-line change

`/fhir/r4` **cannot** be added to the `VERSIONS` allowlist. All ~140 profiles in
`src/profiles.js` register routes as `/:base_version/:resource` (`src/middleware/fhir/route.config.js`),
and Express binds `:base_version` to a **single** path segment. `/fhir/r4/Patient` would bind
`base_version='fhir'`, `resource='r4'`, `id='Patient'`. So this is necessarily a rewrite.

And `base_version` does **two** unrelated jobs, only one of which may see the alias:

| Job | Examples | Alias allowed? |
|---|---|---|
| Module / schema / collection resolution | `require(\`.../fhir/classes/${v}/resources/bundle\`)` (`src/middleware/fhir/base/base.service.js:16`), `resolveSchema` switch (`src/middleware/fhir/utils/schema.utils.js:15`), Mongo collection names `\`${resourceType}_${v}\`` (`src/operations/common/resourceLocator.js:44`) | **Never** — `'fhir/r4'` here means `MODULE_NOT_FOUND` or a query against a nonexistent `Patient_fhir` collection |
| Response URL construction | `Location`, `Content-Location`, Bundle `fullUrl`, `link.self`/`link.next` | **Yes** — this is the requirement |

---

## Design

**Normalize inbound at the very first middleware; re-project outbound through one builder.**

Canonical inside, client-facing only at the edges. The middleware rewrites **both** `req.url` and
`req.originalUrl` to `/4_0_0…`, stashes the client's spelling on `req.fhirBasePath`, and preserves
the raw string on `req.clientOriginalUrl`.

This is what satisfies constraint 1 with no route duplication: there is exactly **one** route table
(`/:base_version/…`, ~140 profiles), and both spellings feed it. `/fhir/r4` requests are converted to
`/4_0_0` before any route matching, so the two bases are not parallel implementations that can drift
— they are literally the same code path, differing only in the segment re-projected on the way out.
It also satisfies constraint 2 for free: because the rewrite happens before **anything** reads the
URL, `base_version` is always `'4_0_0'` by the time it reaches `resolveSchema`
(`src/middleware/fhir/utils/schema.utils.js:15`), the dynamic `require()`s in
`src/middleware/fhir/base/base.service.js:16-20`, and Mongo collection naming
(`src/operations/common/resourceLocator.js:44/53/63`). **No persistence layer ever sees the alias, so
no schema change is possible or needed.**

Rewriting `originalUrl` too is the load-bearing decision. Verified: `node_modules/router/index.js:184`
does `req.originalUrl = req.originalUrl || req.url`, so an explicit assignment made *before* the
router runs persists. The payoff is that **every positional URL parser in the codebase keeps working
with zero edits**, including four that would otherwise be silently wrong:

- `src/app.js:177` and `:231` — `reqPath.split('/')[2]` derives the AuditEvent `resourceType` from
  `req.originalUrl` (snapshotted at `:121`). Un-normalized this writes `resourceType: 'r4'` into
  401-failure and client-abort AuditEvents — a compliance-relevant defect in exactly the
  low-visibility cases nobody reviews until an audit.
- `src/operations/export/exportManager.js:109` persists `requestInfo.originalUrl` verbatim onto
  `ExportStatus.request`; `src/operations/export/script/bulkDataExportRunner.js:283` re-parses it as
  `searchParams.append('base_version', pathname.split('/')[1])`, which becomes a **Mongo collection
  suffix**. An aliased persisted URL yields a `completed` export containing **zero data, with no
  error**. Normalizing before anything reads it removes this outright — no change to `exportManager`,
  no change to the hardcoded `/4_0_0/` dispatch at `bulkDataExportRunner.js:292/311/328`.
- `src/routeHandlers/fhirServer.js:283-288` hard-404s any path whose first segment isn't a known
  version **and discards the real error**.
- `src/app.js:266-281` `redirectHtmlToUi` gates on `reqPath.startsWith('/4_0_0')`.

Trade-off accepted: logs and audits record the canonical URL. Mitigated by `req.clientOriginalUrl`
plus one added `clientBasePath` field in the `logRequestLifecycle` log context, so aliased traffic
stays identifiable in Groundcover.

Because `originalUrl` is canonical, Bundle `link.self`/`next` (built from `requestInfo.originalUrl`)
no longer mirror by accident — they mirror **explicitly** through the builder. That is the point:
one obvious place to look when a response URL is wrong.

### Precedence with the existing `externalReqUrlPrefix`

`externalReqUrlPrefix` (set from `EXTERNAL_SERVICES_WITH_REQ_LIMIT` keyed on the `origin-service`
header, `src/operations/fhirOperationsManager.js:276`) **wins absolutely**; when set, the version
segment is omitted entirely and the alias has no effect.

Rationale: that value asserts *the caller can only reach us through this other host* (e.g.
`api-gateway|https://api.icanbwell.com/v1`). Honouring an inbound alias instead would publish
`fhir.icanbwell.com/fhir/r4/…` URLs to a caller with only gateway connectivity. It also keeps today's
behaviour byte-identical, which is what protects the existing external-services tests.

The alias must **not** be routed through `limitReqForExternalServices` — that same method also
strips `_debug`/`_explain` and injects `prefer: global_id=true` (`src/constants.js:336`), so doing so
would silently change query semantics for every `/fhir/r4` caller. The two concerns meet only inside
`build()`.

---

## New files

**`src/utils/url/fhirBasePath.js`** — frozen value object, `{ canonicalVersion, clientSegment }`.
Exposes `isAlias`, `stripVersionSegment(pathOrUrl)`, `toClientPath(relative)`, and
`static canonical()` (both fields `'4_0_0'`, the default everywhere).

`stripVersionSegment` is the **single** home for the `/^\/\d+_\d+_\d+/` regex, today duplicated at
`src/operations/common/bundleManager.js:286` and `:502`. It must be anchored at `^/`, idempotent,
and handle four input shapes: version-relative (`Patient/1`), rooted canonical, rooted alias, and
absolute URL (needed for `exportById`). Detect absolute inputs by scheme; treat everything else as
an opaque string and **never re-encode the query** — see the existing warning at
`src/middleware/fhir/base/base.service.js:78-82` about `path.join` corrupting `?identifier=http://x|123`.

> **Anchoring is not a style preference here — it is a correctness requirement, and the target host
> makes it sharper.** `src/constants.js:254` defines
> `RESOURCE_HIDDEN_TAG.SYSTEM = 'https://fhir.icanbwell.com/4_0_0/CodeSystem/server-behavior'` —
> the **same host** as the alias target, carrying a `/4_0_0/` segment, and emitted into
> `meta.tag[].system` of live responses. `src/operations/summary/summary.js:355` has a comparable
> literal. These are *identifiers*, not locations: rewriting them would silently corrupt resource
> content and break any consumer matching on the system URI. An unanchored
> `.replace('4_0_0', …)`-style implementation would do exactly that. Every helper in this module must
> be anchored at `^/` and must only ever be handed request/response URL *paths* — never resource
> content.

**`src/utils/url/fhirResponseUrlBuilder.js`** — the one helper every response-URL site calls:

```
build(pathOrUrl, { form = 'absolute' })   // form: 'absolute' | 'path' | 'relative'
static fromRequest(req)                    // uses req.fhirBasePath, req.protocol, req.get('host')
static fromRequestInfo(requestInfo)
```

Four steps, the only branch in the feature: strip the version segment → if `externalUrlPrefix`,
return `${prefix}/${rel}` (byte-identical to `src/operations/common/resourceManager.js:83`) →
else re-prefix with `basePath.toClientPath(rel)` → format per `form`.

The three `form` values map exactly onto the three shapes emitted today, so no call site changes
shape: `absolute` (Bundle `fullUrl`/`link`, `Content-Location`), `path`
(`Content-Location: /4_0_0/Task/{id}`), `relative` (`Location: 4_0_0/Patient/{id}` — asserted
verbatim by `src/tests/unit/middleware/fhir/fhirResponseWriter.test.js:205-212`). `build('')`
returns the base with no trailing slash, for `implementation.url`.

Net effect on signatures: the four threaded params `{ protocol, host, base_version, externalReqUrlPrefix }`
collapse to one `{ responseUrls }`. That parameter reduction is the argument for accepting the churn.

**`src/middleware/normalizeFhirBasePath.js`** — factory middleware. Alias table is a fixed internal
constant (`{ 'fhir/r4': '4_0_0' }`), never operator-supplied — an arbitrary prefix could shadow
`/admin`, `/mcp`, `/health` or `/oauth`.

Matching: **case-insensitive** (`/fhir/R4` accepted — Epic publishes `/api/FHIR/R4`), always echoing
the canonical lowercase `fhir/r4`. Segment-boundary lookahead so `/fhir/r4x` and `/fhir/r4beta` don't
match, and bare `/fhir` doesn't either — that's a real exact-path OAuth route at `src/app.js:368`.
Trailing slash preserved (`/fhir/r4/` → `/4_0_0/`; both are routable per `route.config.js:72/76/80`).
Rewrite by splicing leading bytes only. First statement is an early return when the feature is off.

**Carrier decision**: a plain `req` property at the edge, promoted into `FhirRequestInfo` as a
**constructor** param. Not `express-http-context` — it isn't registered until `src/app.js:290`, well
after the rewrite must happen, and it's ambient global state. Not a DI-container registration —
`src/utils/simpleContainer.js:16-30` memoizes on first access with no request scope, so a
"request-scoped" service would serve request #1's base path to every later request in the pod.
`req.uniqueRequestId` (`app.js:117`), `req.container` (`:461`) and `req.isGraphQLRoute` (`:500`) are
the established precedent for exactly this reason.

---

## Changes by area

### 1. Edge — `src/app.js`
Mount `normalizeFhirBasePath` as the **first** `app.use`, immediately before `logRequestLifecycle`
at line 114 (`container`/`configManager` already in scope from `:102`/`:106`). Read the flag once at
`createApp` time, matching `enableMcp` (`:436`) and `enableGraphQLV2` (`:482`).

Also: add `clientBasePath` to the log context near `:122`; add a comment at `:368` that `/fhir` and
`/fhir/r4` now share a namespace so a future `/fhir/<x>` route needs a collision check.

Ordering is load-bearing — the rewrite must precede `/api-docs` (`:339`), `/admin` (`:436`),
`/mcp` (`:476`), `/$graphql` (`:517`), `/4_0_0/$graphqlv2` (`:522`) and `FhirRouter` (`:524`/`:527`).
Note the last three register on a **later tick** inside `Promise.all().then()`, so anything
registered synchronously in `createApp` is strictly earlier. Guard this with the
`/fhir/r4/$graphqlv2` integration test rather than a brittle `app._router.stack` assertion.

### 2. Request context
- `src/utils/fhirRequestInfo.js` — add `basePath` to the destructured constructor params,
  defaulting to `FhirBasePath.canonical()`. A **constructor** param, unlike the post-construction-only
  `this.externalReqUrlPrefix = undefined` at `:171` — `build(overrides)` silently drops unknown keys
  today, which is a live trap for test authors.
- `src/utils/fhirRequestInfoBuilder.js:113-133` — pass `basePath: this.req.fhirBasePath ?? FhirBasePath.canonical()`.

### 3. Bundle construction — `src/operations/common/bundleManager.js`
Replace `{ protocol, host, base_version, externalReqUrlPrefix }` with `{ responseUrls }` on
`createBundle` (`:59`), `createRawBundle` (`:151`), `createRawBundleFromEntries` (`:240`),
`createBundleFromEntries`. **Delete both `buildLinkUrl` closures** (`:284-292`, `:497-504`) in favour
of `responseUrls.build(...)`. `createBundle` must now accept and forward the param — today `:91`/`:99`
omit it entirely, which is why the `:502-503` branch is dead code.

### 4. Resource `fullUrl` — `src/operations/common/resourceManager.js:82-87`
Both branches collapse into a single `responseUrls.build(\`${resource.resourceType}/${resource.id}\`)`.
Only three call sites (`bundleManager.js:91`, `:182`, `src/operations/history/history.js:391`), so
make a clean cut rather than keeping a compatibility shim.

### 5. Response headers — `src/middleware/fhir/fhirResponseWriter.js`
Obtain the builder via `FhirResponseUrlBuilder.fromRequest(req)` at each site:

| Line | Change |
|---|---|
| `:153-172` `create` | `Location` → `form: 'relative'`; `Content-Location` → absolute. The `fhirVersion === ''` special case at `:156-161` disappears. |
| `:191-204` `update` | Same. **Fixes a live bug** — `:193` has no `''` fallback, so a missing `base_version` emits `Location: undefined/Patient/1`. |
| `:258-261` `export` | Replace hardcoded `` `${baseUrl}/4_0_0/$export/${id}` ``. Also drops the bespoke `req.hostname.includes('localhost')` scheme sniff for `req.protocol`, which is trust-proxy aware — deliberate; add an export case to the trustProxy test family. |
| `:264` `exportById` | `request: build(result.request)` — re-projects the persisted canonical URL onto the **polling** request's spelling. |
| `:295` `import` | Replace hardcoded `` `/4_0_0/Task/${id}` `` → `form: 'path'`. |
| `:124`, `:242`, `:310` | Pass `basePath.canonicalVersion` to `getContentType`. Defence-in-depth only — it silently falls through to `application/json` for unknown values, and post-rewrite `base_version` is always `4_0_0`. Pin with a test. |

### 6. The six sites that currently drop the prefix
`src/operations/everything/everythingHelper.js:647`, `src/operations/graph/graphHelpers.js:1910`,
`src/operations/history/history.js:391` and `:433`, `src/operations/search/searchStreaming.js:420`
(empty-result branch), `src/operations/merge/merge.js:345`.

All six must accept the builder, or the alias is broken at `$everything`, `$graph`, `_history` and
`$merge`. **Per decision: construct the builder there with `basePath` only and NOT
`externalUrlPrefix`**, so api-gateway's response URLs stay byte-identical to today while the alias
works everywhere immediately.

Add a comment at each site and file a follow-up ticket with the `fhir-server-internal` owners:
today a prefixed partner gets `http://example.com/Patient/1` from a search but the server's own
`https://fhir.icanbwell.com/4_0_0/Patient/1` from `$everything`. That inconsistency is the real
pre-existing bug; fixing it changes a surface another team owns and doesn't belong in this PR.

Note `everythingHelper.js:647` passes no `originalUrl` and `bundleManager.js:279` suppresses links
for `$everything`, so only `fullUrl` matters there.

The two sites that already thread it (`src/operations/search/searchBundle.js:143`→`:394`,
`searchStreaming.js:135`→`:366`) keep full prefix behaviour.

### 7. `$export` / async
No change to `exportManager.js` or `bulkDataExportRunner.js` dispatch — the edge rewrite makes the
persisted URL canonical by construction.

**No schema change here, deliberately.** `ExportStatus.request` keeps storing a canonical
`/4_0_0/$export…` URL exactly as it does today; the client's spelling is *not* persisted (no new
field, no extension, no migration). `exportById` re-projects the stored canonical URL onto whichever
base the **polling** request used, so kickoff-on-`/fhir/r4` then poll-on-`/fhir/r4` reads `/fhir/r4`,
and the cross-prefix cases stay self-consistent. Every pre-existing `ExportStatus` row keeps working
untouched.

**Do add one defensive guard** (~4 lines) at `bulkDataExportRunner.js:283`, before
`searchParams.append('base_version', ...)`: validate the extracted segment with `isValidVersion`
(`src/middleware/fhir/utils/schema.utils.js:32`) and **fail the job loudly** otherwise. This is the
only place in the system where an alias string could become a Mongo collection name, and it covers
two cases the edge fix can't: an `ExportStatus` written by a new pod and read by an old-image runner
mid-rolling-deploy, and hand-written/admin-created rows. It converts a silent empty export into a
visible failure.

**This is a hard launch blocker, not a theoretical one.** `ENABLE_BULK_EXPORT` gates export route
registration (`src/middleware/fhir/router.js:296`), and on the `fhir-server` slice it is set to `"1"`
in `.helm/fhir-server/common.values.yaml:86` — i.e. **enabled in every environment of the slice that
serves `fhir.icanbwell.com`, including prod**. So `$export` is fully reachable on the target
deployment, and the canonicalize-before-persist behaviour plus the runner guard **must be in place
before the alias flag is enabled anywhere**. Ordering is not optional here (see step 8 of the
implementation order, which precedes the flag flip in step 11).

`output[].url` entries are S3 URLs — out of scope.

### 8. Metadata — `src/middleware/fhir/metadata/`
`/fhir/r4/metadata` works with **no routing change** (normalizes to `/4_0_0/metadata`).

Set `implementation.url` in the **controller** (`metadata.controller.js:23-25`), after
`generateCapabilityStatement` resolves — not by threading a new param through
`metadata.service.js` → `capability.4_0_0.js:14`, whose `makeStatement(resources)` signature is
shared with `capability.template.js`. `capability.4_0_0.js:25-27` sets only `description` today, so
the server currently publishes no base URL at all; with two live spellings a client needs a
machine-readable answer to "which base am I on."

**Also fix the latent `VERSIONS` bug** as a separate commit in the same PR: `metadata.controller.js:1-3`
imports `{ VERSIONS }` from `'../../../constants'`, but `src/constants.js` **exports no `VERSIONS`**
(verified). So `VERSIONS['4_0_1']` at `:22` is `undefined['4_0_1']` → TypeError whenever
`base_version` is absent. Two lines, in the exact function this feature touches.

### 9. Observability — `src/otel_instrumentation.js:18`
Chain an alias replace onto `httpTarget.replace('4_0_0', ':base_version')`. `http.target` is captured
pre-Express at the socket, so it stays aliased and would otherwise create a new high-cardinality
`http.route` bucket. One line, low priority.

### 10. Config and Helm
`src/utils/configManager.js` — add `enableFhirR4PathAlias` (env `ENABLE_FHIR_R4_PATH_ALIAS`,
**default `false`**) and `fhirBasePathAliases` returning the table or `{}`. Naming follows
`enableMcp` / `enableGraphQLV2` / `enableStatsEndpoint`.

Default-off matters: the middleware mutates `req.url`/`req.originalUrl` for every request on the pod.
A kill switch that needs no image rollback is worth one Helm line.

Helm — in the `bwell-fhir-server` repo under `.helm/`, on the **`fhir-server`** slice (the one that
serves `fhir.icanbwell.com`). Add `ENABLE_FHIR_R4_PATH_ALIAS: "1"` to the slice's `env` list, one
environment at a time:

1. `fhir-server/dev-use1-eks.values.yaml` — validate **in-cluster** (this slice has no external
   ingress in dev), e.g. `curl` from a pod in the namespace against the service address.
2. `fhir-server/staging-ue1.values.yaml` — first externally-reachable environment,
   `fhir.staging.icanbwell.com`. Soak here; this is where the partner should integrate first.
3. `fhir-server/client-sandbox-ue1.values.yaml` — `fhir.client-sandbox.icanbwell.com`,
   partner-visible; coordinate before enabling.
4. `fhir-server/prod-ue1.values.yaml` — `fhir.icanbwell.com`. Note this simultaneously enables the
   alias on `fhir-next.*` and `fhir-bulk.*`, which share the slice (see Context).
5. Promote to `fhir-server/common.values.yaml` `commonEnv` only once every environment should carry
   it, so the per-environment kill switch is retained until then.

Leave unset on every other slice — `fhir-server-internal`, `-next`, `-merge`, `-everything`,
`-graphql`, `-pipeline`, `-worker`, `-orchestrator`. If another slice later needs the alias, that is
one added line on that slice and no code change. Do **not** enable globally in the test env — the
integration tests set the env var per permutation (see Verification).

---

## Out of scope

- Any api-gateway change — the partner calls the FHIR Server directly.
- Activating `externalReqUrlPrefix` at the six drop sites (§6 follow-up ticket).
- `redirectHtmlToUi` behaviour for alias paths beyond what normalization gives free.
- `src/middleware/fhir/base/base.service.js:85` echoing the internal loopback `destinationUrl`
  (`http://127.0.0.1:3000/4_0_0/…`) to clients as `BundleEntry.request.url`. Pre-existing
  information disclosure, not an alias regression — separate ticket.
- Wider `externalReqUrlPrefix` cleanup: `clone()`, the per-access `process.env` re-parse at
  `configManager.js:1576-1587`, separating "prefix without restrictions".
- GraphQL **response** URLs — there are none (zero `fullUrl`/`getFullUrlForResource` matches under
  `src/graphql/` or `src/graphqlv2/`). GraphQL is inbound-only here.
- Swagger `servers` (`src/app.js:336` hardcodes `HOST_SERVER + "/4_0_0"`). Note `ENABLE_SWAGGER_DOC`
  **is** `"1"` on the `fhir-server` slice in dev, staging and client-sandbox (unset in prod), so
  `/api-docs` is reachable there and will advertise only the canonical base. Acceptable — the
  CapabilityStatement's `implementation.url` (§8) is the machine-readable answer — but it is a
  reachable inconsistency, not an unreachable one.
- Additional aliases (`/r4`, `/baseR4`, bare `/fhir`). The resolver is table-driven, so adding one
  later is data plus a route-collision audit.
- Migrating existing `ExportStatus` rows — none needed.
- Any change to `src/profiles.js` `versions` or adding a `4_0_1` case to `controller.utils.js:23-27`.

---

## Implementation order

Commits 1–4 are pure additions with **zero runtime effect** — independently reviewable and mergeable.

1. `fhirBasePath.js` + unit test. No wiring.
2. `fhirResponseUrlBuilder.js` + unit test incl. the precedence matrix. No wiring.
3. `ConfigManager` getters; `normalizeFhirBasePath.js` + unit test. **Not yet mounted.**
4. Mount as first `app.use` before `src/app.js:114`; add the `clientBasePath` log field.
   **Run the full suite with the flag off — everything must be green and unchanged.**
5. `FhirRequestInfo.basePath` + builder hand-off.
6. `resourceManager.js`, then `bundleManager.js` (both `buildLinkUrl` closures deleted).
   **Highest regression risk — run the tripwires here.**
7. Thread the six drop sites (`basePath` only).
8. `fhirResponseWriter.js` + the `isValidVersion` guard in `bulkDataExportRunner.js:283`.
9. Metadata `implementation.url`; `VERSIONS` import fix (separate commit).
10. `otel_instrumentation.js`.
11. Integration tests, then flip the flag in `fhir-server/dev-use1-eks.values.yaml` and validate
    in-cluster, then walk the environment ladder in §10.

---

## Verification

All tests must `require('@jest/globals')` — both configs set `injectGlobals: false`.

**Commands**
```bash
cd /Users/mintukumarsah/Projects/bwell/fhir-server && yarn lint && yarn test:unit
```
```bash
cd /Users/mintukumarsah/Projects/bwell/fhir-server && yarn test:jest
```
(`yarn test` = lint + unit + integration; `make tests` wraps it. Integration needs Docker —
MongoMemoryReplSet + a ClickHouse testcontainer.)

**New unit tests** (`src/tests/unit/**`): `utils/url/fhirBasePath.test.js` (all four input shapes,
idempotence, query byte-preservation incl. a token value containing `http://sys|code`, anchoring —
a mid-path `4_0_0` must be untouched); `utils/url/fhirResponseUrlBuilder.test.js` (3 `form` values ×
{alias, canonical} × {prefix set, unset}, plus the explicit alias+prefix precedence case);
`middleware/normalizeFhirBasePath.test.js` (plain-object `req`/`res` fakes in the style of
`src/tests/unit/middleware/contentTypeValidation.test.js`; asserts `req.url`, `req.originalUrl`,
`req.clientOriginalUrl`, `req.fhirBasePath`, one `next()`, and byte-identical pass-through when off;
`/fhir` must NOT match — OAuth-route collision guard).

**Extend existing unit tests**: `middleware/fhir/fhirResponseWriter.test.js` (keep the exact
`'4_0_0/Patient/123'` assertion at `:205-212`, add the `'fhir/r4/…'` twin, the `update()`
no-`base_version` case, `$export`/`import` `Content-Location`);
`operations/common/resourceManager.test.js:156-202` and `bundleManager.test.js:241-267` (pass a fake
`{ build }` to prove the collaborator contract, plus real-builder cases);
`operations/fhirOperationsManager.test.js:280-333` (assert `limitReqForExternalServices` is untouched
by a plain `/fhir/r4` request with no `origin-service`);
`middleware/fhir/metadata/metadata.controller.test.js`.

**New integration tests** — new dir `src/tests/integration/fhirBasePathAlias/`. Each sets
`process.env.ENABLE_FHIR_R4_PATH_ALIAS` then uses `supertest(createTestApp())` **per permutation**,
restoring in `afterEach`, following `src/tests/integration/trustProxy/trustProxy.test.js`.
Do **not** use `createTestRequest` — it memoizes the app module-wide and can't express a per-flag app.

- `aliasRouting.test.js` — `/fhir/r4/Patient` across GET/POST/PUT/DELETE, `_search`, `_history`,
  `$merge`, `$everything`, `$graph`; `/fhir/R4/Patient` → 200; `/fhir/r4x/Patient` → 404;
  **`/9_9_9/Patient` → 404** (closes a real coverage gap — nothing tests a bad version segment today);
  `Content-Type: application/fhir+json`.
- `aliasResponseUrls.test.js` — `fullUrl` and `link` self/next all under `/fhir/r4`;
  `Location`/`Content-Location` mirror; a `/4_0_0` request in the **same app** still yields `/4_0_0`
  (per-request mirroring, both directions); drop-site coverage for `_history`, `$everything`,
  `$graph`, `$merge`, and an empty-result search run both with `STREAM_RESPONSE='false'` and streaming.
- `aliasNextLink.test.js` — extract the `next` link and **re-issue it**, mirroring
  `src/tests/integration/searchParameters/search_by_next_link/search_by_next_link.test.js`.
  **The single most important test in the set** — the only one that catches a non-round-trippable link.
- `aliasMetadata.test.js` — `/fhir/r4/metadata` 200 with `implementation.url` ending `/fhir/r4`;
  `/4_0_0/metadata` ending `/4_0_0`.
- `aliasGraphql.test.js` — `/fhir/r4/$graphqlv2` reachable; proves the rewrite precedes the
  later-tick mount at `src/app.js:522`.
- `aliasExternalService.test.js` — alias + `origin-service` with
  `EXTERNAL_SERVICES_WITH_REQ_LIMIT='api-gateway|http://example.com'` → prefix wins, **no `/fhir/r4`
  leakage** (pins the generalized strip); with `'api-gateway'` (null prefix) → alias mirrors.
- `aliasExport.test.js` (needs `ENABLE_BULK_EXPORT=1`) — kickoff `Content-Location` mirrors;
  the **persisted** `ExportStatus.request` is canonical `/4_0_0/` (assert on the DB document — this
  is the runner-safety invariant); cross-prefix kickoff/poll re-bases correctly.
- `aliasDisabled.test.js` — flag off: `/fhir/r4/Patient` → **404, not 500** (exercises the
  error-swallow path at `src/routeHandlers/fhirServer.js:283`); `/fhir?resource=x` still 302.
- `aliasAudit.test.js` — a GET on `/fhir/r4/Patient/{id}` produces an AuditEvent with
  `resourceType: 'Patient'`, not `'r4'` (requires `enableAccessAuditEvent`).
- A resource whose content contains
  `https://fhir.icanbwell.com/4_0_0/CodeSystem/server-behavior` (`src/constants.js:254`) must
  round-trip **unchanged** through an alias request — pins the anchoring rule.

**Regression tripwires — must stay green, unchanged. Do not "update the expected string."**
- `src/tests/integration/trustProxy/trustProxy.test.js` — asserts exact strings, e.g.
  `'http://localhost:3000/4_0_0/Observation?_bundle=1'`. `FhirBasePath.canonical()` producing
  byte-identical output is what protects these.
- `src/tests/integration/externalServices/searchList/patientSearchList.test.js` — exact `body.link`
  plus every `entry.fullUrl` starting `http://example.com/Patient/`.
- `src/tests/integration/searchParameters/search_by_next_link/search_by_next_link.test.js`
- `src/tests/unit/middleware/fhir/fhirResponseWriter.test.js:205-212`
- `src/tests/unit/middleware/fhir/version-validation.middleware.test.js` — unchanged by design.
- The whole `src/tests/integration/export/` directory.
- `src/tests/integration/metadata/metadata.get/` — its `expected_Meta.json` fixture asserts
  `implementation` contains **only** `description`, so it **will** need updating, as will
  `src/tests/unit/middleware/fhir/metadata/capability.4_0_0.test.js`.

**Manual check after enabling on an environment**

Target host, once the flag reaches prod:
```bash
curl -sS -H "Authorization: Bearer $TOKEN" "https://fhir.icanbwell.com/fhir/r4/Patient?_bundle=1" | jq '.link, (.entry[0].fullUrl)'
```

Earlier rungs of the ladder in §10 use the same path against the in-cluster service address (dev,
no external ingress) and `https://fhir.staging.icanbwell.com` (staging, the first
externally-reachable environment).

Expect `link[].url` and `entry[].fullUrl` under `/fhir/r4`. Then re-issue the returned `next` URL
verbatim and confirm it paginates. Also confirm the canonical base is untouched on the same host:
```bash
curl -sS -H "Authorization: Bearer $TOKEN" "https://fhir.icanbwell.com/4_0_0/Patient?_bundle=1" | jq '.link, (.entry[0].fullUrl)'
```
Expect `/4_0_0` in every URL — that is hard constraint 1 (both bases live, mirrored per request).

---

## Governance and pre-launch

- **Tech Design Review** in the EA project — required by `CLAUDE.md` for a public API surface change
  on the system-of-record for an external partner.
- **ADR** in `adrs/` (MADR format) recording the edge-normalization choice, the `originalUrl`
  rewrite, and the `externalReqUrlPrefix` precedence rule.
- **Before flipping the flag**: grep Groundcover dashboards, saved queries and alerts for
  `startsWith('/4_0_0')`-style path filters and hand the list to the observability owner. Alias
  traffic is normalized in logs, so most filters keep working — but any filter on
  `clientOriginalUrl`/`clientBasePath` semantics needs to be added deliberately.
- **Ranked residual risks**: (1) `originalUrl` rewrite has the widest blast radius in the codebase —
  reviewers should verify the early return is the literal first statement of the middleware;
  (2) response-URL regressions for existing `/4_0_0` clients from the four-params-to-one collapse —
  the three exact-string tests are the gate; (3) rollback skew — reverting the middleware while
  alias traffic is in flight 404s those requests, while queued export jobs keep working since their
  stored URLs are already canonical; (4) case-insensitive matching means `/FHIR/R4` and `/fhir/r4`
  are the same resource — document for partner-facing support.
