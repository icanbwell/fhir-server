# SMART v2 Fine-Grained Scope Support (`.cruds`) — Design

## Background

Per the SMART App Launch "Scopes and Launch Context" spec
(https://build.fhir.org/ig/HL7/smart-app-launch/scopes-and-launch-context.html), v2 scopes replace
the coarse v1 `read`/`write`/`*` suffix with a combination of the letters `c` (create), `r` (read/
vread), `u` (update/patch), `d` (delete), and `s` (search-type/system-level history), e.g.
`patient/Observation.rs` or `user/*.cruds`. This server currently only understands v1 grammar.

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

## Scope

Add v2 CRUDS granularity to `patient/`, `user/`, `access/`, and `system/` scope prefixes, all while
continuing to fully support v1 `read`/`write`/`*` grammar (mixed v1/v2 scopes in the same
token/request must both work, since SMART permits a client to hold either style and this server
has live v1-only clients today).

- `user/` — resource-type-level grant (SMART-standard semantics), gains CRUDS.
- `patient/` — resource-type-level grant scoped to the caller's own patient compartment
  (self-only, via `personIdFromJwtToken`), gains CRUDS.
- `access/` — this server's own per-record tenant/owner-tag convention (`meta.security` access
  tags), gains CRUDS. This grammar is not SMART-defined; the server has always owned it.
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
its required CRUDS letter(s):

| Interaction                                   | Required letter |
|------------------------------------------------|------------------|
| `create`                                       | `c`              |
| `update`, `patch`                              | `u`              |
| `remove`                                       | `d`              |
| `searchById` (instance read), vread            | `r`              |
| instance-level `_history`                      | `r`              |
| type/system-level `history`                    | `s`              |
| `searchBundle`, `searchStreaming`, `everything`, `summary`, `expand`, `graph` (search-type) | `s` |

`$access-history`'s existing hardcoded `'*'`-access-code requirement (SEC-1580 regression) is
**not** touched by this table — see Error Handling below.

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
  `'read'`/`'write'` literal it hardcodes today. Mechanical, one call site at a time.

## Backward compatibility rule

Classification is **per scope string, not per token/request** — a single request's scope set may
freely mix v1 and v2 style scopes (SMART v2 permits this, and this server has live v1-only
clients). A suffix is v1 iff it is exactly `read`, `write`, or `*`; v2 iff it is a non-empty
combination of letters drawn from `{c, r, u, d, s}` with no duplicates. Anything else is malformed.

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
   detection (valid combinations, duplicates, unknown letters, empty suffix), all four prefixes.
   `system/` cases specifically assert tenant isolation is preserved (a `system/Patient.rs` token
   without a matching `access/<tag>` scope still sees an empty/`ForbiddenError` result, same as
   `user/`/`patient/` today) and that it is *not* granted the `admin/`-style full-bypass behavior.
2. Characterization tests captured **before** any production code changes, run against the
   existing `scopesManager.test.js`, `scopesManager.crossTenant.test.js`,
   `scopesManager.writeBypass.test.js`, `scopesValidator.test.js`, and
   `resourceAuthorization/03_scopesAndAuditEventGate.test.js` (the one test that exercises the real,
   unmocked `@asymmetrik/sof-scope-checker`) — a fixed matrix of (scope, action) pairs, diffed after
   each phase to prove v1-only behavior is unchanged.
3. Phase 2 adds new per-call-site test cases exercising genuinely granular actions (e.g. a token
   with `user/Patient.r` but not `.s` must still pass `searchById` — instance read — but fail a
   type-level search).
4. Phase 3 (`securityTagManager` and its query-filter consumers) gets its own test pass, reviewed
   against `review.md`'s access/owner-tag checklist — this work is a named trigger in that
   document (OAuth scope/token parsing, cross-resource join on a shared identifier).

## Phasing / rollout

1. **Parser + v1 normalization.** Land `smartScopeParser.js`, wire it into `scopesManager.js`/
   `scopesValidator.js` internals with zero behavior change — every existing caller still passes
   `'read'`/`'write'` literals. Characterization tests prove no regression.
2. **Granular gate.** Thread the real per-interaction CRUDS requirement through
   `scopesValidator`'s gate only (not the security-tag/query-filter path). New v2 test coverage
   added here.
3. **Query-filter path.** Extend `securityTagManager.js` and its downstream consumers
   (`searchManager.js`, `exportManager.js`, `import.js`, `bulkDataExportRunner.js`,
   `personToPatientIdsExpander.js`) to use granular CRUDS instead of binary read/write for building
   the actual Mongo filter. Separate PR, explicit `review.md` pass given the tenant-isolation
   blast radius.

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
