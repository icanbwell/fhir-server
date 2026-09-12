# Add SMART on FHIR v2 `system/` scope support alongside `user/`

**Ticket:** [DCON-5551](https://icanbwell.atlassian.net/browse/DCON-5551) (epic: [DCON-5401](https://icanbwell.atlassian.net/browse/DCON-5401))

This document is the implementation plan for adding `system/` scope support. It is being shared
for review before any code is written — no implementation has landed yet.

## Context

**How `user/` works today.** Every FHIR operation calls
`ScopesValidator.verifyHasValidScopesAsync` before any Mongo query is built. Inside
`isScopesValidAsync` (`src/operations/security/scopesValidator.js:72-140`) **two independent
gates must both pass**:

1. **Resource-type/action gate** — `getUserScopes({scope})`
   (`src/operations/security/scopesManager.js:419`) filters the caller's scopes to those starting
   with `user/`, then `@asymmetrik/sof-scope-checker` matches
   `user/<Resource|*>.<read|write|*>` against the requested type + action.
2. **Tenant gate** — `getAccessCodesFromScopes` (`scopesManager.js:49`) requires at least one
   `access/<tag>.<read|write|*>` scope. `user/*.*` on its own is a 403. Only `access/*` collapses
   to "no `meta.security` filter at all" — that is the real wildcard bypass, not `admin/`.

`user/` is **already** this server's service-account namespace: `isUser` is derived solely from
`scopes.some(s => s.toLowerCase().startsWith('patient/'))` (`src/strategies/authService.js:474`),
so a `user/*.read access/tenanta.*` client-credentials token is `isUser === false` and gets no
patient narrowing.

**Why `system/` doesn't work today, and why the fix is one line.** The vendored
`@asymmetrik/sof-scope-checker` **already** emits `system/*.*`, `system/*.<action>`,
`system/<name>.*`, `system/<name>.<action>` candidates. The matcher needs no change. `system/`
fails only because the pre-filter at `scopesValidator.js:106` discards it. Verified:
`getUserScopes` has **exactly one** production caller — that line.

**Intended outcome.** A SMART v2 backend-services client presenting
`system/Observation.read access/tenanta.*` is authorized exactly as
`user/Observation.read access/tenanta.*` is today — same tenant filtering, same patient-scope
write restriction, same history gate. Nothing becomes reachable that a `user/` token could not
already reach.

**Decisions taken** (from the adversarial review, `review.md` §2/§3D):

- **Semantics: alias, not a new namespace.** The resource-type gate evaluates the **union** of
  `user/` and `system/` **in the same branch**. `access/` stays mandatory.
- **Rollout: kill switch, default off** (`ENABLE_SMART_V2_SYSTEM_SCOPES`). `system/` strings are
  inert today, so any client already provisioned with `system/*.*` gains access the moment this
  goes live.
- **Three adjacent fixes ride along** (§4) — each is a path the union activates.

**Not in scope:** `src/middleware/fhir/sof-scope.middleware.js`. Verified dead in every
environment — `config.auth` (`src/config.js:286-296`) sets `resourceServer` and `strategy` but
never `type`, so line 78's `auth.type !== 'smart'` always returns `noOpMiddleware`. File a
separate dead-code ticket.

---

## 1. The security constraint that shapes every other decision

**The union MUST live inside the existing `else` branch at `scopesValidator.js:105-113`. Never as
a sibling `else if`.**

```js
// DO NOT DO THIS — bypasses the :108 write guard entirely
} else if (this.scopesManager.hasSystemScope({scope})) {
    scopes = this.scopesManager.getSystemScopes({scope});
    ({error, success} = scopeChecker(resourceType, accessRequested, scopes));
} else { /* existing user branch, with the write restriction */ }
```

A `patient/*.* system/*.* access/tenanta.*` token would then gain **write** to `Organization`,
`Practitioner`, `ValueSet`, `Consent` — non-patient-filterable types an end-user token must never
write. That is review.md §2's named bug shape ("one scope type's caller bypassing the other scope
type's filtering because the two checks live in an if/else").

Why the single-branch shape is safe: the guard at `:108` is
`!hasPatientScope({scope}) || accessRequested === 'read'` — evaluated on the **whole scope
string**, independent of which namespace supplied the matching scope, and it sits **before**
`scopeChecker` inside the same `else`. Swapping the accessor at `:106` changes *which strings are
candidates*, not *which branch you are in*.

**Three things must not change.** Each has a tripwire test in §5:

| Must not change | Why |
|---|---|
| `getAccessCodesFromScopes` (`scopesManager.js:49`) stays keyed **solely** on `access/` | Making `system/*.*` emit `'*'` cascades to six gates at once: `doesResourceHaveAnyAccessCodeFromThisList`, `isAccessTagChangeAllowedByScopes`, `hasHistoryAccess`, `getSecurityTagsFromScope`, the export `hasFullAccess`, and `resourceValidator`'s `Person.link` check. Total tenant-isolation bypass. |
| `getSecurityTagsFromScope` (`src/operations/common/securityTagManager.js:55-73`) keeps throwing `ForbiddenError` on zero access codes | If `system/` were added as a bypass it returns `[]` with `accessViaPatientScopes === false`, and `searchManager.js:323`'s `else if (securityTags.length > 0)` is then false — **no `meta.security` clause ANDed at all**. Verbatim review.md §3D fail-open. |
| `isUser` (`authService.js:474`) stays `patient/`-derived | Widening it would 401 every backend-service token lacking the four `requiredJWTFields`, and make every service-account AuditEvent attribute to a person id (`authService.js:307`). |

---

## 2. `patient/` + `system/` must behave identically to `patient/` + `user/`

| Request | `patient/*.* user/*.* access/x.*` (today) | `patient/*.* system/*.* access/x.*` (required) |
|---|---|---|
| Read patient-filterable type | patient branch (`:102-104`); other namespace ignored | identical |
| Write patient-filterable type | patient branch → `canWriteResourceAsync` identity-graph gate | identical |
| Read non-patient-filterable type | else branch; needs ≥1 access code | passes via `system/`; needs ≥1 access code |
| **Write non-patient-filterable type** | **403 `Write not allowed using user scopes if patient scope is present`** | **403, byte-identical message** |

**Do not reword that error string.** It is asserted verbatim across integration files under
`src/tests/integration/patientScope/` (`update_without_patient_scope`,
`create_without_patient_scope`, `delete_without_patient_scope`, `merge_without_patient_scope`,
`merge_with_patient_scope`). It is effectively a response-body contract. Put the clarification in
a code comment instead.

Defence in depth holds independently even if the gate were wrong:
`patientScopeManager.canWriteResourceAsync:315-324` returns `false` for any patient-scope-bearing
token writing a non-patient-filterable type (its comment already says "regardless of any other
scope also present on the token"), and
`scopesValidator.isAccessToResourceRestrictedForPatientScope:313` keys off `requestInfo.isUser`.

---

## 3. Core change

### 3.1 `src/constants.js`

Add beside `AUTH_USER_TYPES` (~line 332):

```js
    SCOPE_NAMESPACE: {
        patient: 'patient/',
        user: 'user/',
        system: 'system/',
        admin: 'admin/',
        access: 'access/'
    },
    /**
     * Namespaces the resource-type/action gate evaluates for a caller NOT on the patient-scope
     * branch. SMART v2 `system/` is the backend-services equivalent of this server's
     * pre-existing `user/` service-account namespace (see authService.js's isUser derivation:
     * `user/` never implied a human user), so both are evaluated together in ONE branch rather
     * than as separate authorization paths. See docs/resource-authorization.md §3.
     */
    RESOURCE_TYPE_SCOPE_NAMESPACES: ['user/', 'system/'],
```

### 3.2 `src/operations/security/scopesManager.js`

Add two methods. A namespace is *data in a list*, not a new `else if` — satisfies AGENTS.md's
"no growing conditional chains".

```js
    /**
     * Returns the scopes belonging to any of the given namespace prefixes.
     *
     * Matching is deliberately case-SENSITIVE, unlike hasPatientScope/isUser. Those two only ask
     * "is a patient scope present at all"; these strings go straight to
     * @asymmetrik/sof-scope-checker, which compares by exact string. Case-folding here would
     * produce candidates that can never match while widening what we claim to have parsed.
     */
    getScopesForNamespaces ({ scope, namespaces }) {
        return this.parseScopes(scope).filter(s => namespaces.some(ns => s.startsWith(ns)));
    }

    /**
     * The scopes the resource-type/action gate evaluates for a non-patient-scoped caller:
     * `user/` plus, when enabled, SMART v2 `system/`.
     *
     * This does NOT relax any tenant check. A caller authorized here still has to clear
     * getAccessCodesFromScopes() (>= 1 access/<tag> code) in ScopesValidator, and still has to
     * clear getSecurityTagsFromScope() before any Mongo query is built.
     */
    getResourceTypeScopes ({ scope }) {
        return this.getScopesForNamespaces({
            scope,
            namespaces: this.configManager.enableSmartV2SystemScopes
                ? RESOURCE_TYPE_SCOPE_NAMESPACES
                : [SCOPE_NAMESPACE.user]
        });
    }
```

- **Keep `getUserScopes` (`:419`) as-is.** It becomes production-dead but is the documented §3
  parser with its own doc-anchored test
  (`src/tests/unit/resourceAuthorization/03_scopesAndAuditEventGate.test.js:88-101`). Add a JSDoc
  note saying so, so a future cleanup doesn't take the doc contract with it.
- **Do not** add `getSystemScopes()` / `hasSystemScope()` — nothing would call them, and a
  standalone `hasSystemScope` is the raw material for the §1 anti-pattern.
- **Do not** reroute `getPatientScopes` / `getAdminScopes` through the new helper in this PR.

### 3.3 `src/utils/configManager.js`

```js
    /**
     * Whether SMART v2 `system/` scopes are honored by the resource-type/action gate alongside
     * `user/`. Kill switch for rollout: `system/` strings were previously inert (ScopesValidator
     * discarded them), so any OAuth client or IdP group already carrying one gains access the
     * moment this flips. Default off until scope provisioning is audited.
     */
    get enableSmartV2SystemScopes() {
        return isTrue(env.ENABLE_SMART_V2_SYSTEM_SCOPES);
    }
```

`isTrue` is already imported at `configManager.js:1`. Document the var in `.env.example` /
`docker-compose.yml` if other feature flags are listed there.

### 3.4 `src/operations/security/scopesValidator.js` — **only line 106 changes**

```js
                } else {
                    // `user/` and SMART v2 `system/` are evaluated TOGETHER here, deliberately in
                    // the same branch rather than as a sibling `else if (hasSystemScope)`. The
                    // patient-scope write restriction below and the access/ tenant gate that
                    // follows must apply identically to both, otherwise a
                    // `patient/*.* system/*.*` token would be a write path that the equivalent
                    // `patient/*.* user/*.*` token is not. See review.md §2.
                    scopes = this.scopesManager.getResourceTypeScopes({scope});
                    // if patient scopes are present then only read is allowed to non patient resources
                    if (!this.scopesManager.hasPatientScope({scope}) || accessRequested === 'read') {
```

Leave `:108`, `:111`, `:117-121` untouched. `accessCodes.length > 0 || accessViaPatientScopes` at
`:119` is the single line keeping a `system/*.*`-only token at 403 rather than at full access.

---

## 4. Adjacent fixes (all three approved for this PR)

### 4.1 `src/routeHandlers/admin.js` — unify the scope gate

`admin.js:694-698` and `:763-767` build `scopesManager.parseScopes(scope)` **unfiltered** and hand
it straight to `scopeChecker`. Because the library already lists `system/`,
`system/Patient.write` satisfies that gate **today**. It is currently unreachable only because
`deletePatientDataGraphAsync` → `everythingAsync` re-runs `verifyHasValidScopesAsync`, which 403s
a `system/`-only token at `:106`. **The union turns that dead acceptance live.**

Replace both raw `scopeChecker` calls with the real validator, so the patient-write rule, the
`access/` requirement, and the delegated-actor consent gate all apply:

```js
const requestInfo = FhirRequestInfoBuilder.fromRequest(req);   // already used at admin.js:218, :283
const success = await container.scopesValidator.hasValidScopesAsync({
    requestInfo, resourceType: 'Patient', accessRequested: 'write',
    action: 'deletePatientDataGraph', parsedArgs: null, startTime: null
});
```

`container.scopesValidator` is registered (`src/createContainer.js:277`) and
`hasValidScopesAsync` only reads `parsedArgs?.base_version` (`scopesValidator.js:194-208`), so
`null` is safe. Keep the existing 403 `OperationOutcome` body shape.

**Intended side effect:** `admin/*.write patient/*.*` currently satisfies these gates — a
*patient*-scoped token authorizing a destructive admin operation, which `:110-112` forbids on
every FHIR path. After unification it 403s. Call this out in the PR description; test G7 in §5.4
pins it.

### 4.2 `src/operations/export/script/bulkDataExportRunner.js:445-470`

`allowedResourcesByScopes = []` is **truthy**, and only `startsWith('user')` (no slash) fills it.
A caller authorized purely via `system/*.read` clears the gate, reaches `:465` with `[]` still
truthy, and gets a **200 export job that returns zero rows** — not a 403.

```js
            for (const scope1 of this.scopesManager.getResourceTypeScopes({ scope })) {
                // ex: user/Patient.* or system/Patient.*
                const [, inner_scope] = scope1.split('/');
                const [resource, accessType] = inner_scope.split('.');
                if (accessType === '*' || accessType === 'read') {
                    if (resource === '*') {
                        allowedResourcesByScopes = null;   // null = "no restriction"
                        break;
                    }
                    allowedResourcesByScopes.push(resource);
                }
            }
```

Preserve the `null` ("no restriction") vs `[]` ("nothing") distinction — that asymmetry is
load-bearing per review.md §3D. This also removes the slashless `startsWith('user')` (which
matches `userfoo/*.read`) and the `replace('user/','')` that no-ops on a non-`user/` string.

**Wiring:** the runner has no injected `scopesManager` — `:698` reaches through
`this.searchManager.scopesManager`. Inject properly:
- `bulkDataExportRunner.js:96-117` constructor — add the param, `assertTypeEquals`, JSDoc.
- `src/operations/export/script/bulkDataExport.js:53-77` — add `scopesManager: c.scopesManager`.
- `assertTypeEquals` throws on a missing dep, so **all four** runner unit-test mock bags must add
  it: `bulkDataExportRunner.test.js`, `.nullSafety.test.js`, `.crossTenant.test.js`,
  `.headerRequirement.test.js`. Use a **real** `ScopesManager` (it is a pure parser).
  `bulkDataExport.test.js` uses `expect.objectContaining`, so it is unaffected.

### 4.3 `src/strategies/authService.js:420-451` — IdP group namespace allowlist

Verified: `getFieldsFromToken` concatenates `AUTH_CUSTOM_GROUP` values into the scope string
**verbatim** (`:426-428`) with no validation, then `AUTH_REMOVE_SCOPE_PREFIX` blind-`substring`s
them (`:440-450`) with no re-validation. Two consequences:

- A directory group literally named `system/*.*` becomes a real scope token. This is not a new
  risk *class* — a group named `access/*.*` is already a full tenant bypass — but `system/*.*` is
  the most likely name an IdP admin creates by accident, since it is what an OAuth console shows
  as a client's granted scope.
- The blind substring can **synthesize** a privileged namespace: `AUTH_REMOVE_SCOPE_PREFIX=x` plus
  a group named `xsystem/*.*` yields `system/*.*`.

Add a post-strip allowlist at the end of the prefix-strip block (after `:450`, before `:453`),
keeping only well-formed scopes in the five known namespaces and `logWarn`ing drops:

```js
const SCOPE_PATTERN = /^(user|patient|access|admin|system)\/[^ ]+\.(read|write|\*)$/;
```

Per AGENTS.md ("tolerate unrecognized fields; no exhaustive enum switches without a default"),
drop-and-log — never throw. Note this narrows what reaches the gate, so run the full auth suite:
if any environment relies on a non-conforming scope string today, this surfaces it.

---

## 5. Test plan

Follow the repo's existing patterns. `test.each` for anything with >2 input variations
(AGENTS.md). Mock only external boundaries — the `src/tests/unit/resourceAuthorization/` suite's
rule is "never a stand-in class" for the code under test.

### 5.1 Unit — parsing (`src/tests/unit/operations/security/scopesManager.test.js`)

New `describe('getResourceTypeScopes')` after the `getUserScopes` block (`:440-449`). The existing
`beforeEach` builds `createMockInstance(ConfigManager)`, so add
`Object.defineProperty(mockConfigManager, 'enableSmartV2SystemScopes', { get: () => true, configurable: true })`
(the pattern at `scopesValidator.test.js:40-43`), plus a flag-off variant.

`test.each` rows: undefined scope → `[]`; user only; system only; union with order preserved;
excludes `access/`; excludes `patient/`; excludes `admin/`; `System/Patient.read` ignored
(case-sensitive); `systemfoo` not matched (guards against the §4.2 slashless bug); flag off drops
`system/`.

**Tripwires** (§1): `getAccessCodesFromScopes('read','u','system/*.*')` and `('write',…)` both
`toEqual([])`; `hasHistoryAccess({resourceType:'Patient', scope:'system/*.*'})` is `false`;
`hasPatientScope({scope:'system/*.*'})` is `false`;
`isAccessAllowedByPatientScopes({scope:'system/*.*', resourceType:'Observation'})` is `false`.

### 5.2 Unit — the gate (`src/tests/unit/operations/security/scopesValidator.test.js`)

**Mock-shape caveat:** `createMockInstance` is `Object.create(prototype)`, so unmocked prototype
methods run for real. Replace the `mockScopesManager.getUserScopes = …` stub in `beforeEach`
(`:27-62`) and at `:207` with `getResourceTypeScopes`, otherwise the real implementation runs
against an undefined config getter and the existing tests pass *by accident*.

Add a nested `describe` using a **real** `ScopesManager` and **unmocked** `sof-scope-checker`
(the `03_` file's pattern). `test.each` grid: `system/` read granted with an access code;
`system/*` wildcard; `system/` write; wrong resource type denied; read scope does not grant write;
**`system/*.*` with no `access/` code denied**; union where `user/` covers the type; union where
`system/` covers the type. Plus a parity loop asserting `user/X` and `system/X` produce identical
verdicts across a small type × action grid — that is the alias claim under test.

Two named regressions carry the security weight:

```js
// §1 — the sibling-branch escalation. Named so a future refactor trips on it.
test('patient/ + system/ cannot WRITE a non-patient-filterable type (same as patient/ + user/)', …)
//   → 403, message contains 'Write not allowed using user scopes if patient scope is present'
test('patient/ + system/ CAN read a non-patient-filterable type, same as patient/ + user/', …)
```

Also: `getSecurityTagsFromScope({user:'u', scope:'system/*.*', accessViaPatientScopes:false, accessRequested:'read'})`
**throws** `ForbiddenError` — must never return `[]`.

### 5.3 Unit — doc-anchored (`src/tests/unit/resourceAuthorization/03_scopesAndAuditEventGate.test.js`)

Update the header comment from "four scope namespaces" to five. Mirror the existing `getUserScopes`
block for `getResourceTypeScopes`, and add `system/` twins of all four
`verifyHasValidScopesAsync` cases — **especially** "rejects when the scope is sufficient but no
`access/` code is granted at all". That is the §1/§7 tenant-gate invariant and the single most
important regression to pin. `:190`'s `canAccessResourceWithPatientScope → false` stays valid.

Also add to `src/tests/unit/utils/personToPatientIdsExpander.crossTenant.test.js`: with
`requestInfo.scope = 'system/*.* access/tenanta.*'` a `meta.security` clause must be present at
**every** recursion level; with `'system/*.*'` the call must **throw**, not query unfiltered.
(`ENFORCE_PERSON_LINK_ASSURANCE_MINIMUM` defaults false, so there is no second line of defence.)

### 5.4 Integration — caller matrix (`src/tests/integration/security/matrix/`)

`getHeaders(scope)` (`src/tests/integration/common.js:181`) mints a real signed JWT, so these run
true end-to-end. Reuse the **exact-set** assertions — they fail on over- *and* under-sharing.

`read_matrix.test.js` — add to `CALLER` (`:24-30`):

```js
tenantASystem:  { label: 'backend service, tenanta, read-only (system/)',
                  headers: () => sysHeaders('system/*.read access/tenanta.*'), expects: 'tenantA' },
wildcardSystem: { label: 'backend service, wildcard access (system/)',
                  headers: () => sysHeaders('system/*.read access/*.*'), expects: 'wildcard' },
```

`F.EXPECTED_PATIENTS` / `EXPECTED_OBSERVATIONS` (`matrixFixtures.js:130-145`) are keyed by caller
name, so add an `expects` field defaulting to the caller key and dereference via
`F.EXPECTED_PATIENTS[CALLER[c].expects || c]` in the loops. **The row that matters most:**
`tenantASystem` returns exactly `EXPECTED_PATIENTS.tenantA` — proving `system/` is not a
tenant-filter bypass. Keep the `wildcard` ground-truth row as the backstop.

`write_matrix.test.js` — add `A_RW_SYS` / `A_RO_SYS` beside `A_RW`/`A_RO` (`:26-29`) and mirror
(a) the baseline pair: `A_RW_SYS` can create in its own tenant, `A_RO_SYS` cannot
create/POST/PATCH/DELETE/`$merge`; (b) at least one **SAE-2 tag-forgery** case: `A_RW_SYS`
PUTting `[T_A, T_B]` still 403s — proving `isAccessTagChangeAllowedByScopes` is namespace-blind.

**New `system_scope_matrix.test.js`** for the cross-cutting negatives. Every negative is paired
with a wildcard ground-truth row (`read_matrix.test.js:12-21`):

| Group | Caller scope | Request | Expect |
|---|---|---|---|
| A. `system/` ≠ `access/` | `system/*.*` (no access) | `GET /4_0_0/Patient?_count=100` | 403; never any of `mtxOwnA/B`, `mtxProa`, `mtxIas` |
| | `system/Patient.read` | `GET /4_0_0/Patient?_count=100` | 403 |
| B. tenant boundary | `system/*.* access/tenanta.*` | `GET /4_0_0/Patient/mtxOwnB` | 403/404, never 200 |
| | same | `GET /4_0_0/Patient?_count=100` | has `mtxOwnA`, `mtxSharedAB`; not `mtxOwnB`/`mtxProa`/`mtxIas` |
| | same | `PUT /4_0_0/Patient/mtxNewX` with access `[tenanta, tenantb]` | 403 |
| | same | `PATCH /4_0_0/Patient/mtxOwnA` adding access `tenantb` | 403 |
| C. patient+system write | `patient/Observation.read system/*.*` + mtxPersonA claims | `POST /4_0_0/Observation` subject `Patient/mtxOwnA` | **403** |
| | `patient/*.read system/*.*` | `PUT /4_0_0/Organization/mtxOrgA` | 403 |
| | `patient/*.read system/*.* access/tenanta.*` | `POST /4_0_0/Observation` with `security=[owner tenantb, access tenantb]` + `x-suppress-unclassified-tag` | **403** (create-path tag forgery) |
| D. identity binding | `system/*.* access/tenanta.*` + `clientFhirPersonId=<mtxPersonB>` | `GET /4_0_0/Patient/mtxOwnB` | 403/404 — claim inert |
| | `system/*.* access/tenanta.*`, **no** person claims | `GET /4_0_0/Patient/mtxOwnA` | **200** — guards against `isUser` widening and 401-ing every backend service |
| E. history | `system/*.* access/tenanta.*` | `GET /4_0_0/Patient/mtxOwnA/_history` | 403 (needs `access/*`) |
| F. traversal | `system/*.* access/tenanta.*` | `GET /4_0_0/Person/mtxPersonA/$everything` | excludes `mtxOwnB`, `mtxObsOwnB` |
| G. admin (§4.1) | `admin/*.write system/Patient.write` | `POST /admin/deletePatientDataGraph?id=mtxOwnB` | 403; `mtxOwnB` still present after |
| | `admin/*.write patient/*.*` | same | 403 — **fails until §4.1 lands; that is the point** |
| H. export (§4.2) | `system/*.read` (no access) | `POST /4_0_0/$export` | 403, never a job that runs unrestricted |
| I. cache keys | warm `$everything` as `system/*.* access/tenanta.*`, repeat as `…tenantb.*` | | must not return the cached `tenanta` body |
| J. malformed | `System/Patient.read`, `SYSTEM/*.*`, `system/`, `system/*`, `system`, `systemfoo/*.*`, `system/*.` | `GET /4_0_0/Patient/mtxOwnB`; `PUT` same | never 200 with that id; never 2xx |

Plus one row under `src/tests/integration/patientScope/` mirroring an existing
`*_without_patient_scope.test.js` with a `patient/… system/…` token, asserting the **same**
`Write not allowed using user scopes if patient scope is present` body.

### 5.5 Unit — export + auth

`bulkDataExportRunner.test.js` `describe('getRequestedResourceAsync')` — `test.each(['user','system'])`
twins of the existing cases, plus the named R3 regression: a `system/*.read access/tenanta.*`
caller must **not** get a silently empty resource list.

`src/tests/unit/strategies/authService.test.js` `describe('getFieldsFromToken')` (`:353`) —
`isUser === false` for `'system/*.* access/tenanta.*'` (tripwire); the §4.3 allowlist drops a
group named `not-a-scope`; `AUTH_REMOVE_SCOPE_PREFIX='x'` + group `xsystem/*.*` is rejected by the
allowlist (prefix stripping must never synthesize a privileged namespace); existing
`authCustomGroup` / `authRemoveScopePrefixes` cases (`:426-495`) still pass.

### 5.6 Existing `system/*` fixtures — assessed, none break

~12 unit files already use `system/*` as **opaque** scope strings
(`fhirRequestInfoBuilder.test.js`, `securityTagManager.test.js`, `searchManager.test.js`,
`resourceValidator.test.js`, the export tests, `baseCacheKeyGenerator.test.js`,
`bundleResourceValidator.test.js`, `operationAccessManager.test.js`). All safe: they either mock
`ScopesManager` or exercise code that never consults the user/system namespace. Two notes:

- `baseCacheKeyGenerator.test.js:61-64` asserts the exact join
  `'patient/*.read,system/*.*,user/*.write'` — stays green **iff** `normalizeScopesForCaching` is
  left alone. **Do not canonicalize `system/`→`user/` for cache-hit rate**, and do not implement
  `system/` by *rewriting* scopes in `getFieldsFromToken`. Either merges two caller families into
  one cache entry (review.md §3D). Today the two strings hash differently — a miss, never a
  cross-scope hit.
- No integration test uses a `system/` SMART scope today (only StructureDefinition `system/@value`
  XPaths), so §5.4 is all new.

### 5.7 Commands

```bash
node node_modules/.bin/jest --config jest.unit.config.js --runInBand --forceExit src/tests/unit/operations/security src/tests/unit/resourceAuthorization src/tests/unit/strategies src/tests/unit/operations/export src/tests/unit/utils
```

```bash
node node_modules/.bin/jest --runInBand --forceExit src/tests/integration/security src/tests/integration/patientScope src/tests/integration/export
```

```bash
JEST_MAX_OLD_SPACE_SIZE=6144 make tests && make lint
```

---

## 6. Docs

1. `docs/resource-authorization.md:151-179` (§3) — "Four scope namespaces" → five; add the row:
   `system` | `system/<resourceType|*>.<read|write|*>` | SMART v2 backend-services equivalent of
   `user/`; evaluated together with `user/` by the resource-type gate. **Not** a tenant-filter
   bypass — an `access/` code is still required (§1). Extend the `ScopesManager` method list at
   `:162-164`; note the kill switch.
2. `docs/resource-authorization.md:186-190` (§4) — the "both get `user`/`access`/`admin` scopes"
   bullet becomes `user`/`system`/`access`/`admin`. State explicitly: **`system/` does not set
   `isUser`**, which stays `patient/`-derived at `authService.js:474`.
3. `docs/resource-authorization.md` §5 — a `patient/` + `system/` token behaves identically to
   `patient/` + `user/`, including the write restriction.
4. `readme/security.md:222-226` (§5.1) — "scopes that start with `user/`" → "`user/` or `system/`";
   note they are interchangeable at this gate.
5. `readme/security.md:296-335` (§5.5) — Example 4: `system/*.* access/*.*` ≡ Example 2's
   `user/*.* access/*.*`.
6. `readme/export.md` — update if it documents the `user/`-scope resource filter.
7. **ADR** `docs/adr/NNNN-smart-v2-system-scope-as-user-scope-alias.md` (MADR, per AGENTS.md) —
   record alias-vs-distinct-namespace, the single-branch constraint (§1), and the kill switch.
8. **PR description** — per CLAUDE.md's "Security-Sensitive Changes", include the `review.md`
   report: findings table **plus** an explicit "Checked, no issues found" list naming the
   untouched functions (`getAccessCodesFromScopes`, `getSecurityTagsFromScope`, `hasHistoryAccess`,
   `isAccessTagChangeAllowedByScopes`, `canWriteResourceAsync`, `isUser`,
   `normalizeScopesForCaching`, `isAdminScope`). **No real client IDs or pool IDs — this repo is
   public** (review.md §0).

---

## 7. Build sequence

| # | Step | Gate |
|---|---|---|
| 0 | Audit OAuth client + `AUTH_CUSTOM_GROUP` provisioning for pre-existing `system/` strings. Blocking for *enabling the flag*, not for merging. | — |
| 1 | `constants.js` + `configManager.js` | `make lint` |
| 2 | `scopesManager.js` — the two new methods | §5.1 green; **full existing suite still green** (nothing calls them yet) |
| 3 | §5.1 unit tests, both flag states | green |
| 4 | `scopesValidator.js:106` swap + fix `scopesValidator.test.js` mocks | **full unit suite green with the flag OFF** — the "zero behavior change when off" checkpoint. Run this before writing any positive `system/` test. |
| 5 | §5.2 tests incl. the two `patient/` + `system/` regressions | green |
| 6 | §5.3 doc-anchored + expander additions | green |
| 7 | §4.2 export fix + `scopesManager` injection + all four runner mock bags | §5.5 + existing export suites green |
| 8 | §4.1 admin.js unification | §5.4 group G green, incl. the `patient/*.*` tightening |
| 9 | §4.3 authService allowlist | §5.5 auth tests + **full** auth suite green |
| 10 | §5.4 integration matrix + `patientScope` row | integration suites green |
| 11 | Docs §6 + ADR | — |
| 12 | Full `make tests` **in both flag states** | green |
| 13 | PR with the review.md adversarial report | — |
| 14 | Enable `ENABLE_SMART_V2_SYSTEM_SCOPES=true` per env after step 0 clears: dev → staging → prod | — |

**Conventions** (AGENTS.md): branch `{initials}-{PROJ}-{ticket}` (this PR uses `MKS-DCON-5551`),
commits prefixed with the JIRA key, no `feat:`/`fix:` prefixes, no AI attribution /
`Co-Authored-By`.

---

## 8. Verification

**The decisive checkpoint is step 4:** the full unit suite must pass with
`ENABLE_SMART_V2_SYSTEM_SCOPES` unset. That proves the change is inert until deliberately enabled.

Then, with the flag on:

1. `node node_modules/.bin/jest --config jest.unit.config.js --runInBand --forceExit src/tests/unit/operations/security src/tests/unit/resourceAuthorization` — parity, tripwires, the two escalation regressions.
2. `node node_modules/.bin/jest --runInBand --forceExit src/tests/integration/security/matrix` — `tenantASystem` returns **exactly** `EXPECTED_PATIENTS.tenantA`; the `wildcard` row proves each withheld resource is visible to somebody.
3. Manual end-to-end against the local stack (`make up`, Keycloak per `readme/security.md:401`):
   mint `system/*.read access/*.*`, confirm `GET /4_0_0/Patient` returns data; mint `system/*.*`
   with no `access/` scope, confirm 403; mint `patient/*.read system/*.*`, confirm
   `PUT /4_0_0/Organization/x` returns 403 with the unchanged message.
4. `JEST_MAX_OLD_SPACE_SIZE=6144 make tests && make lint`.
5. Run `review.md` adversarially against the final diff and write the report into the PR.
