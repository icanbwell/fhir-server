# SMART v2 Fine-Grained Scope Support (`.cruds`) — Design

## Background

Per the SMART App Launch "Scopes and Launch Context" spec
(https://build.fhir.org/ig/HL7/smart-app-launch/scopes-and-launch-context.html), v2 scopes replace
the coarse v1 `read`/`write`/`*` suffix with a combination of the letters `c` (create), `r` (read/
vread), `u` (update/patch), `d` (delete), and `s` (search-type/system-level history), e.g.
`patient/Observation.rs` or `user/*.cruds`. This server currently only understands v1 grammar.

The spec constrains the suffix to an **in-order** subsequence of the literal string `cruds` —
`.rs` is valid, `.sr` is not — and explicitly permits (without requiring) a server to reject
out-of-order or undefined interactions: *"Scope requests with undefined or out of order
interactions MAY be ignored, replaced with server default scopes, or rejected."* This design
rejects them (see Backward compatibility rule below) rather than silently reordering or ignoring
them, since a silent reorder risks granting more than the caller asked for.

Today's enforcement path is strictly binary:

- `src/operations/security/scopesManager.js`'s `parseScopes` just splits the scope string on
  spaces — a "parsed scope" is the raw string. `getAccessCodesFromScopes(action, ...)` (only
  inspects `access/` scopes), `getAdminScopes`/`hasAdminScopeForAction` (`admin/`), and
  `getPatientScopes`/`getUserScopes` (pure prefix filters, no suffix parsing) all reduce every
  check to `accessType === '*' || accessType === action` where `action` is always the literal
  `'read'` or `'write'`.
- `src/operations/security/scopesValidator.js`'s `isScopesValidAsync` types `accessRequested` as
  `"read"|"write"` only and delegates the actual match to `@asymmetrik/sof-scope-checker`, an
  external library that only understands v1 grammar and throws on any other action string.
- Every call site across `src/operations/**` (`create.js`, `update.js`, `patch.js`, `remove.js`,
  `searchById.js`, `searchByVersionId.js`, `history.js`, `searchBundle.js`, `everything.js`, etc.)
  already knows its specific FHIR interaction and threads it through as an `action` parameter to
  `verifyHasValidScopesAsync`/`hasValidScopesAsync` — but today that value is used **only for
  logging**, never for the scope decision. The binary `accessRequested` passed alongside it is
  hardcoded per call site.

This is the lever for v2 support: the granular interaction name already reaches the enforcement
layer, it's just discarded.

Throughout this document, "resource gate" means the `patient/` vs (`user/` ∪ `system/`) check for
whether a caller may touch a given resourceType + interaction at all; "access gate" means the
`access/<tag>` tenant-ownership existence check. Both live in `ScopesValidator.isScopesValidAsync`
today; they are independent and both must pass.

## Scope

Add v2 CRUDS granularity to `patient/`, `user/`, `access/`, and `system/` scope prefixes, all while
continuing to fully support v1 `read`/`write`/`*` grammar (mixed v1/v2 scopes in the same
token/request must both work, since SMART permits a client to hold either style and this server
has live v1-only clients today).

- `user/` — resource-type-level grant (SMART-standard semantics), gains CRUDS.
- `patient/` — resource-type-level grant scoped to the caller's own patient compartment
  (self-only, via `personIdFromJwtToken`), gains CRUDS.
- `access/` — this server's own per-record tenant/owner-tag convention (`meta.security` access
  tags), gains CRUDS. This grammar is not SMART-defined; the server has always owned it. **This
  gate is migrated in lockstep with the resource gate, operation by operation — see Phasing.**
- `system/` — resource-type-level grant for backend-service tokens (no end-user/patient in
  context), gains CRUDS. **Decision: `system/` is CRUDS-only and does not bypass tenant isolation**
  — a backend service presenting `system/Patient.rs` still has its visible resources filtered by
  the existing `access/<tag>`/owner-tag checks, exactly as `user/` and `patient/` scopes already
  are today. It is deliberately *not* treated like the existing `admin/` convention (unrestricted
  access to matching resource types); it also has no self-only restriction the way `patient/` does,
  since there is no `personIdFromJwtToken` for a backend-service token.

Explicitly out of scope:

- Consolidating the three independent scope-parsing code paths that exist today
  (`authService.js`'s own space-split, the legacy `sof-scope.middleware.js` +
  `@asymmetrik/sof-scope-checker` no-op-unless-`auth.type === 'smart'` path, and
  `scopesManager.js`/`scopesValidator.js`, the real enforcement path). Only the real enforcement
  path gains v2 awareness; `authService.js` and `sof-scope.middleware.js` (and its other caller,
  `src/routeHandlers/admin.js`) are left untouched.
- Real SMART launch context (`fhirUser`, `launch/patient` claims replacing the bwell-proprietary
  `personIdFromJwtToken`/`masterPersonIdFromJwtToken` claims) — separate future effort.
- `.well-known/smart-configuration` capability-advertisement changes.
- The `?param=value` scope-constraint syntax the spec defines (e.g.
  `patient/Observation.rs?category=...`) — not parsed at all today; a scope string carrying one is
  currently treated as a malformed suffix and dropped. Tracked as an open item below, not designed
  here.

## Architecture

New pure module `src/operations/security/smartScopeParser.js`. Parses a `patient/`/`user/`/
`access/`/`system/` scope string into a structured shape:

```
{ prefix: 'patient'|'user'|'access'|'system', resourceType: string, cruds: Set<'c'|'r'|'u'|'d'|'s'> }
```

v1 suffixes are normalized into the same shape (spec-fixed mapping, not invented):

| v1 suffix | CRUDS set   |
|-----------|-------------|
| `read`    | `{r, s}`    |
| `write`   | `{c, u, d}` |
| `*`       | `{c, r, u, d, s}` |

A second lookup table maps every FHIR interaction name already flowing through call sites today to
its required CRUDS letter(s), extended here with the operations analyzed since the original pass:

| Interaction                                   | Required letter | Notes |
|------------------------------------------------|------------------|-------|
| `create`                                       | `c`              | type-level create, POST, server-assigned id |
| `update`, `patch`                              | `u`              | see "`u` covers update-as-create" below |
| `remove`                                       | `d` for a delete addressed only by `id`/`_id`; `d` **and** `s` when any other search parameter is present | see "DELETE behavior" below |
| `searchById` (instance read), vread            | `r`              | |
| instance-level `_history`                      | `r`              | |
| type/system-level `history`                    | `s`              | |
| `searchBundle`, `searchStreaming`, `everything`, `summary`, `expand` | `s` | |
| `graph` — each resolution step, including the root | `r` if the step resolves one instance by reference/id, `s` if it searches a type (forward reference vs. reverse/child search) | not a single fixed letter; evaluated per step, same rule for the root call as for every child link. For DELETE see the next row |
| `graph` (DELETE)                               | `d` on the root and on every resource deleted; forward-reference steps are satisfied by `d` (in place of `r`); reverse/child search steps still require `s` | see "DELETE behavior" below |
| `$merge`                                       | `u`              | see "`u` covers update-as-create" below |
| `$import`                                      | `c` on `Task`    | the request-time gate only covers creating the `Task`; per-resource authorization for what the import actually writes happens downstream, in the import processors, and is not enforced by this request-time gate |
| `$export`                                      | `c` on `Task` at the resource gate, plus at least one `access/` tenant code granting `c` and at least one granting `s` | creating the export job is gated like any other create; the tenant codes stamped on the ExportStatus are those granting `c`, and a caller with no tenant code granting `c`, or none granting `s`, is rejected. The runner's tenant filter for the exported data uses every tenant code granting `s`, including ones not stamped on the ExportStatus (see "`$export` behavior"); status polling (`$export/<id>`) is an instance read and uses `r` on the ExportStatus access tag; the runner includes a resource type only if a `user/`/`system/` scope grants `s` on it — types without it are dropped silently, as before |
| `$access-history`                              | unchanged for now (still the coarse `read` check, twice) | deferred — not part of this pass; tracked as a TODO to assign granular letters later |

`$access-history`'s existing hardcoded `'*'`-access-code requirement (a pre-existing regression
guard) is **not** touched by this table — see Error Handling below.

### `u` covers update-as-create — resolves the `$merge` / PUT inconsistency

The spec is explicit that the update interaction includes creation-with-a-known-id: *"u (update):
Instance level update... including update-as-create"* and *"Some servers allow for an update
operation to create a new instance, and this is allowed by the update scope."* `c` is reserved for
type-level create (POST, server assigns the id) only.

`update.js`'s insert-when-absent branch (client PUTs to an id that doesn't exist yet) is exactly
this update-as-create case, and it is already gated by the single letter `u` today (the action name
is `'update'` regardless of which branch runs at request time) — no code change needed there.

`$merge`'s insert branch is architecturally the same operation: the caller supplies the resource's
identity (`_uuid`) and the server inserts if absent, updates if present, decided at runtime — never
a type-level, server-assigned-id create. Per this reading, `$merge` therefore requires **`u` only**,
not the `{c, u}` originally proposed (re-applying closed PR #2601's approach). Requiring `c` in
addition to `u` would make `$merge` *stricter* than the spec's own model for the identical
operation, and would leave `user/Patient.u` able to create a Patient via `PUT /Patient/{id}` but not
via `$merge` — same client-supplied-id upsert, inconsistent answer. This supersedes the `{c,u}`
target originally proposed for this operation.

This also means the "create" column in any per-operation verification table refers specifically to
type-level POST create (`c`); instance creation via PUT or `$merge` is a `u` grant, not a `c` grant.
This is worth stating explicitly wherever such a table appears, since the column header alone is
easy to misread as "any way a new resource comes into existence."

### DELETE behavior — `remove` and `$graph` DELETE

A delete is authorized by `d` alone wherever the target is identified rather than searched for.
Only a step that has to *search* for resources requires `s`. Both the resource gate
(`user/…`) and the access gate (`access/<tag>…`) apply the same letters, and the per-resource tag
check and the Mongo query filter use the same letter as the gates.

**`DELETE [base]/[type]/[id]` and `DELETE [base]/[type]?_id=…`** — `d`.

**`DELETE [base]/[type]?<any other search parameter>`** — `d` **and** `s`. A type-level conditional
delete enumerates resources by search, so it needs the search interaction in addition to the delete.

`remove` passes the whole requirement as one value (`d` or `ds`) to the resource gate, access gate,
query filter and per-resource check. A multi-letter requirement is evaluated per letter: each
letter may be granted by a different scope token (so `user/*.read user/*.write` satisfies `ds`),
and for the access gate a tenant code qualifies only if every letter is granted for it, directly
or through the `*` code.

**`DELETE [base]/[type]/[id]/$graph`**

| Step | Required |
|------|----------|
| root resource, fetched by id | `d` |
| forward-reference link (follows a reference held by a parent) | `d` (replaces `r`) |
| reverse / child link (searches a type for resources referencing a parent) | `s` |
| each resource actually deleted | `d` (resource type and tenant tags) |

A link whose gate fails is skipped silently, as before; a resource the caller lacks `d` on is
skipped silently, as before. `GET`/`POST` `$graph` is unchanged: `r` for forward links, `s` for
reverse links.

**What was allowed before, and what is allowed now**

Previously the `remove` access gate, query filter and per-resource check all required the coarse
`write` set (`c`, `u` and `d`), and `$graph` DELETE required `write` at the root and for each
deleted resource, with every link gate still requiring `read` (`r`). A v2 token carrying only
`d` was therefore rejected outright by both operations.

`$graph` DELETE:

| Grant (resource gate and access gate) | Before | Now |
|---|---|---|
| v1 `read` + `write`, or v1 `*` | whole graph | whole graph |
| v1 `write` only (`cud`) | root only; link gates need `r`, children skipped silently | root and forward-reference children; reverse children need `s` and are skipped |
| v2 `rds` | rejected (lacks `c`, `u`) | whole graph |
| v2 `ds` | rejected | whole graph |
| v2 `d` only | rejected | root and forward-reference children; reverse children skipped |
| v2 `rs` / read-only | rejected | rejected, nothing deleted |
| `d` on only one of the two gates | rejected | rejected |

`remove`:

| Grant | Request | Before | Now |
|---|---|---|---|
| v1 `write` (`cud`) | by id | allowed | allowed |
| v1 `write` (`cud`) | with search parameters | allowed | **rejected** — `write` carries no `s` |
| v1 `*` or v1 `read` + `write` | either | allowed | allowed |
| v2 `d` only | by id | rejected (needs `c`, `u`) | allowed |
| v2 `d` only | with search parameters | rejected | rejected (needs `s`) |
| v2 `ds` | either | rejected | allowed |
| v2 `rs` / read-only | either | rejected | rejected |

Two of these changes reach v1 clients, because v1
`write` normalizes to a fixed CRUDS set regardless of `ENABLE_SMART_V2_CRUDS_SCOPES`: a v1
`write`-only client that issues a conditional (search-based) delete is now rejected, and a v1
`write`-only client's `$graph` DELETE now also deletes forward-reference children.

### `$export` behavior

| Grant | Operation | Before | Now |
|---|---|---|---|
| v1 `user/*.read` + `user/*.write` with `access/<tag>.*`, or v1 `*` | `$export` | accepted | accepted |
| v1 read-only (`user/*.read` / `user/Patient.read`), no `user/` scope covering `Task` | `$export` | accepted | **rejected** — `c` on `Task` is now required |
| v2 `user/*.rs user/Task.c` + `access/<tag>.cs` | `$export` | rejected | accepted |
| v2 `user/*.rs user/Task.c` + `access/<tag>.s` | `$export` | rejected | rejected (no tenant code grants `c`) |
| v2 `user/*.rs user/Task.c` + `access/<tag>.c` | `$export` | rejected | rejected (no tenant code grants `s`) |
| v2 `user/*.rs user/Task.c` + `access/tenantA.c access/tenantB.s` | `$export` | rejected | accepted; only tenantA is stamped on the ExportStatus |
| v1 `access/<tag>.read` only | `$export` | accepted, tag stamped on the ExportStatus | **rejected** (no tenant code grants `c`) |
| v1 `access/<tag>.write` only | `$export` | rejected | rejected (no tenant code grants `s`) |
| v1 `access/<tag>.read access/<tag>.write` | `$export` | accepted, tag stamped | accepted, tag stamped |
| v2 `access/<tag>.cs` (no `r`) | polling the status (`$export/<id>`) | rejected | rejected, 403 (needs `r`) |
| v2 `access/<tag>.rs` | polling the status (`$export/<id>`) | rejected | accepted |
| v2 `user/*.rs` + `access/<tag>.s`, no `c` on `Task` | `$export` | rejected | rejected |
| v2 `access/<tag>.r` only | `$export` | rejected | rejected (needs `s`) |
| v1 `write` / v2 `cud` only | `$export` | rejected | rejected (tenant codes need `s`) |
| v2 `user/Patient.rs` | `$export` runner | zero rows, HTTP 200 (literal suffix comparison) | Patient exported |

`$export` requires `c` on `Task` at the resource gate, at least one tenant code granting `c`, and
at least one tenant code granting `s` at request time; only the codes granting `c` are stamped on
the ExportStatus. The runner then
narrows silently to the types the caller's scopes grant `s` on.

The two tenant checks are deliberately different. `c` decides which tenant codes are stamped on
the ExportStatus, since stamping a code on the job record is a create in that tenant. `s` decides
which tenants' data the runner exports: every tenant code granting `s`, not just the stamped ones.
The request-time `s` check only rejects a job that could never export any data. So a caller
holding `access/tenantA.c access/tenantB.s` can start the export, the ExportStatus is tagged with
tenantA only, and the exported data is tenantB's. A caller holding only `access/tenantB.s`, or only
`access/tenantA.c`, cannot start an export at all.

## Components & data flow

- **`scopesManager.js`** — `getAccessCodesFromScopes`, `getPatientScopes`, `getUserScopes` call
  into `smartScopeParser` instead of doing raw `.`-split / prefix-filtering inline. A new
  `getSystemScopes` function (mirroring `getUserScopes`) is added for the `system/` prefix, which
  has no existing equivalent today (no `system/` handling exists anywhere in `src/` currently).
  Public function signatures for the pre-existing functions are unchanged.
- **`scopesValidator.js`** — stops delegating to `@asymmetrik/sof-scope-checker` for
  `patient/`/`user/`/`access/` checks; the parser decides both v1 and v2 cases directly (the
  library hard-throws on any non-`read`/`write`/`*` action, so it cannot even pass through v2
  requests safely as a fallback). `isScopesValidAsync`'s `accessRequested` grows to accept a CRUDS
  letter or set, while still accepting `'read'`/`'write'` for backward compatibility.
  `scopesValidator.js`'s existing literal `accessRequested === 'read'` check (used to block writes
  via patient-scoped tokens) becomes "requested letters ⊆ `{r, s}`".
- **`admin.js`, `sof-scope.middleware.js`** — untouched; keep using
  `@asymmetrik/sof-scope-checker` directly for their own (v1-only) purposes.
- **`securityTagManager.js`** (`getSecurityTagsFromScope`) — feeds the actual MongoDB security
  filter consumed by `searchManager.js`, `exportManager.js`, `import.js`,
  `bulkDataExportRunner.js`, and `personToPatientIdsExpander.js`, and throws `ForbiddenError` on an
  empty result. Because a wrong action→letter mapping here changes *which documents come back*
  (not just allow/deny), this component is deliberately deferred to its own phase (see Phasing)
  rather than changed in the same pass as the gate-only logic above.
- **Call sites** (`create.js`, `update.js`, `patch.js`, `remove.js`, `searchById.js`,
  `searchByVersionId.js`, `history.js`, `searchBundle.js`, etc.) — each changes to pass its true
  interaction-specific CRUDS requirement (via the lookup table) instead of the collapsed
  `'read'`/`'write'` literal it hardcodes today. Mechanical, one call site at a time. **As of this
  revision, each call site's migration also updates its own `getAccessCodesFromScopes` call to
  require the matching granular set in the same change — see Phasing.**

## Backward compatibility rule

Classification is **per scope string, not per token/request** — a single request's scope set may
freely mix v1 and v2 style scopes (SMART v2 permits this, and this server has live v1-only
clients). A suffix is v1 iff it is exactly `read`, `write`, or `*`; v2 iff it is a non-empty,
duplicate-free, **in-order** subsequence of the literal string `cruds` — i.e. its letters are drawn
from `{c, r, u, d, s}` and appear in that relative order (`rs` and `cud` are valid; `sr` and `duc`
are not). Requiring a subsequence subsumes the duplicate check for free, since `cruds` itself has
no repeated letters. Anything else is malformed.

**Follow-up needed on already-merged code:** Phase 1 (`smartScopeParser.js`'s `isV2Suffix`) is
live behind the flag today but currently checks only letter uniqueness and set-membership, not
ordering — `.sr`, `.duc`, `.usc` all currently parse as valid. This must be tightened to the
subsequence rule above before the flag is enabled; see Open items.

## Error handling

- A malformed v2 suffix causes that single scope string to be dropped from the granted-scope set;
  it is not fatal to the rest of the token's other (valid) scopes.
- `hasHistoryAccess`'s literal requirement that the resolved access-code list contain `'*'` is
  preserved exactly as-is — CRUDS granularity must not change this function's behavior. A
  regression test pins that e.g. `access/tenantA.rs` does **not** satisfy `hasHistoryAccess` merely
  because `r`/`s` are present; only the wildcard access code does.
- An empty resulting CRUDS set after all filtering produces the same `ForbiddenError` behavior as
  today's empty-access-code case.

## Testing strategy

1. New isolated unit tests for `smartScopeParser.js`: v1→CRUDS normalization table, v2 grammar
   detection (valid combinations, duplicates, unknown letters, empty suffix, **out-of-order
   letters**), all four prefixes.
   `system/` cases specifically assert tenant isolation is preserved (a `system/Patient.rs` token
   without a matching `access/<tag>` scope still sees an empty/`ForbiddenError` result, same as
   `user/`/`patient/` today) and that it is *not* granted the `admin/`-style full-bypass behavior.
2. Characterization tests captured **before** any production code changes, run against the
   existing `scopesManager.test.js`, `scopesManager.crossTenant.test.js`,
   `scopesManager.writeBypass.test.js`, `scopesValidator.test.js`, and
   `resourceAuthorization/03_scopesAndAuditEventGate.test.js` (the one test that exercises the real,
   unmocked `@asymmetrik/sof-scope-checker`) — a fixed matrix of (scope, action) pairs, diffed after
   each phase to prove v1-only behavior is unchanged.
3. Per-operation migration adds new test cases exercising genuinely granular actions on **both**
   gates together (e.g. a token with `user/Patient.r` but not `.s` must still pass `searchById` —
   instance read — but fail a type-level search; and `access/tenantA.r` must pass a read but fail a
   write for that same operation, once that operation's access gate is migrated).
4. `$merge` specifically needs a regression proving `user/Patient.u access/<tag>.u` (or `.cud` on
   the access side, until that operation's access gate is migrated) can both create-via-absent-id
   and update, and that `user/Patient.c` alone (no `u`) cannot do either.
5. Phase 3 (`securityTagManager` and its query-filter consumers) gets its own test pass, reviewed
   against `review.md`'s access/owner-tag checklist — this work is a named trigger in that
   document (OAuth scope/token parsing, cross-resource join on a shared identifier).

## Phasing / rollout

1. **Parser + v1 normalization.** Land `smartScopeParser.js`, wire it into `scopesManager.js`/
   `scopesValidator.js` internals with zero behavior change — every existing caller still passes
   `'read'`/`'write'` literals. Characterization tests prove no regression. **Status: complete and
   merged behind the flag, except the ordering-enforcement gap noted above.**
2. **Per-operation gate migration (resource gate + access gate together).** For each operation,
   thread its real per-interaction CRUDS requirement through `scopesValidator`'s resource gate
   **and** update that same operation's `getAccessCodesFromScopes` call site to require the
   matching granular set, in the same change. This replaces the earlier plan of doing all resource
   gates first and all access gates in one later big-bang pass: migrating only the resource-gate
   half leaves that operation in a broken state where no newly-issued narrow scope combination
   actually works (a narrow `access/<tag>` scope is rejected by the still-coarse access gate even
   though the resource gate would allow it) — see the worked example under Open items. The 13
   interactions already given a granular resource-gate letter under the original plan predate this
   policy and currently sit in exactly that broken state; they need a follow-up pass to close their
   own access-gate half before they can be considered done under this revised policy.
3. **Query-filter path.** Extend `securityTagManager.js` and its downstream consumers
   (`searchManager.js`, `exportManager.js`, `import.js`, `bulkDataExportRunner.js`,
   `personToPatientIdsExpander.js`) to use granular CRUDS instead of binary read/write for building
   the actual Mongo filter. Deliberately kept as its own separate, later, individually-reviewed
   phase — unlike step 2's access-gate existence check, this changes *which documents* are
   returned or writable, not just allow/deny, so it gets its own PR and explicit `review.md` pass
   given the tenant-isolation blast radius.

## Open items / verify during implementation

- Audit live IdP (Keycloak, and any production identity provider) client scope configurations for
  any string that would newly parse as "valid v2 grammar" under this design — enabling v2 parsing
  is a one-way loosening for any such string, since today it is inert (grants nothing) under the
  binary checker.
- Confirm whether any backend-service (client-credentials) client currently authenticates against
  this server at all today — `system/` scopes are meaningless without a token flow that issues
  them, and `authService.js`'s token/claims parsing is explicitly untouched by this design (see
  Out of scope). If no such flow exists yet, `system/` support lands inert until one does, which is
  acceptable but should be called out to reviewers.
- **Ordering enforcement.** `isV2Suffix` needs the in-order-subsequence fix described under
  Backward compatibility rule before the flag can be enabled — today `.sr`/`.duc`/`.usc` parse as
  valid, contrary to this design.
- **Worked example of why per-operation migration must include the access gate:** a token with
  `user/Patient.c` (resource gate: pass, `c` satisfies `c`) paired with `access/tenantA.c` would,
  under a resource-gate-only migration, still fail — the access gate, unmigrated, would demand the
  full coarse `{c,u,d}` composite regardless of what the resource gate just decided. Under this
  revision's combined-phase policy, once `create` is migrated, both sides ask for `c` and this
  succeeds.
- **`bulkDataExportRunner.getRequestedResourceAsync`** (fixed: it now resolves types through
  `ScopesManager.getResourceTypesWithAccess` and requires `s`; the note below describes the
  behavior before the fix) decided which resource types a bulk export
  may include by splitting the scope string and comparing the suffix literally
  (`accessType === '*' || accessType === 'read'`) instead of calling `parseScopeToken`. Found
  during the 2026-09-25 documentation review; not yet folded into a fix plan, and deliberately kept
  out of the wiki's polished narrative since `$export`'s request-time gate is being redesigned
  anyway (see the Architecture table above — `c` on `Task` plus `s` per requested type). Whoever
  picks up the `$export` migration must either fix this literal comparison as part
  of that work, or confirm the redesign replaces this code path outright. Until fixed, a valid v2
  read grant (e.g. `user/Patient.rs`) matches neither literal once the flag is on, and that caller's
  export silently returns **zero rows with HTTP 200** instead of the expected data or a 403 — a
  silent data-loss failure, not a denial, and the only place in the whole design where this failure
  mode occurs.
- Decide `$access-history`'s eventual granular letters (likely `s` on both the target type and
  `AuditEvent`, since both are bulk queries rather than single-instance reads — not decided) and
  whether `admin/` ever gains CRUDS or stays v1-only (`hasAdminScopeForAction` compares the suffix
  literally today, so it fails closed on a v2 suffix either way). Both deferred out of the current
  per-operation target table into a later pass.
