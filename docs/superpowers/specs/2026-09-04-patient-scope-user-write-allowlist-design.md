# Allowlisted User-Scope Writes Alongside a Patient Scope — Design

**Date:** 2026-09-04
**Status:** Draft — awaiting review before `writing-plans`.

## Summary

Today, if a caller's JWT `scope` claim carries *any* `patient/...` scope, `scopesValidator.js`
refuses every write that isn't itself satisfied via that patient scope — even for resource types
(like `Binary`) that patient scopes can never cover, and even when the token also carries a much
broader `user/*.*` scope that would otherwise authorize the write. This is intentional,
long-standing anti-escalation behavior (see `src/operations/security/scopesValidator.js:107-112`,
authored 2024-03-08, refined 2025-05-21) and must not be weakened wholesale.

This design adds a narrow, explicit exception: an operator-configured allowlist of resource types
where a sufficient `user/...write` scope is still honored despite a patient scope being present —
gated by (a) an independent check that the token's user scope genuinely covers the write, not just
an allowlist bypass, and (b) if the target resource already exists, proof that it belongs to the
same patient the token's patient scope is anchored to. No existing behavior changes when the
allowlist is empty (the default).

**Motivating case:** `fhir-server-ui`'s admin "Upload Document" feature merges a `Binary` then a
`DocumentReference` via `$merge`. An operator whose SSO session token carries both `user/*.*` and
an unrelated `patient/...` scope (an account/Okta-group misconfiguration, tracked separately) gets
`403 Write not allowed using user scopes if patient scope is present` on the `Binary` write, and a
different but related rejection on the `DocumentReference` write. See "Current architecture" below
for why these are two different code paths.

## 1. Problem / Goal

**Goal:** let a configured set of resource types accept a write from a `user/...write`-scoped
caller even when that caller's token also carries a patient scope, without reopening the
scope-escalation class of issue `SEC-1580`/`SEC-1582`/`SEC-1583` closed.

**Non-goals:**
- Not changing behavior for any resource type not on the allowlist (default: allowlist is empty,
  zero behavior change).
- Not making `Binary` (or any other allowlisted type) a general patient-scope-compartment resource
  — i.e. not touching `patientFilterManager.patientFilterMapping`, which feeds search, `$everything`,
  `accessHistory`, `resourceValidator`, and `bulkDataExportRunner` far beyond this write check (see
  §3 "Rejected approach").
- Not fixing the root identity/token misconfiguration that puts a patient scope on an admin
  session in the first place — that's a separate, non-code fix.

## 2. Current architecture (relevant findings)

- `scopesValidator.isScopesValidAsync` (`src/operations/security/scopesValidator.js:72-140`) is the
  coarse, resourceType-level scope check called by:
  - `mergeManager.preMergeChecksAsync` (`src/operations/merge/mergeManager.js:814`) — the *only*
    scope check `$merge` runs; merge never calls the finer per-resource check below.
  - `verifyHasValidScopesAsync`, called at the top of `create.js:137` and `update.js:188`, before
    the existing resource (if any) has been loaded. Throws immediately on failure.
- A **second, finer-grained** check exists only for create/update:
  `isAccessToResourceAllowedByAccessAndPatientScopes` (`scopesValidator.js:340-359`), called later
  in `create.js:232`, `update.js:341`, `update.js:447`, *after* the resource is loaded/merged. It
  runs `isAccessToResourceAllowedByPatientScopes` →
  `patientScopeManager.canWriteResourceAsync` (`patientScopeManager.js:298-352`), which has the
  actual resource object.
- Inside `isScopesValidAsync`, two structurally different things can happen for the same "patient
  scope present" condition, depending on whether the resource type is patient-compartment-eligible
  (`patientFilterManager.canAccessResourceWithPatientScope`, backed by
  `patientFilterMapping`, `src/fhir/patientFilterManager.js:6-77`):
  - **Not patient-compartment eligible (e.g. `Binary` — absent from `patientFilterMapping`
    entirely):** `isAccessAllowedByPatientScopes` is `false` → falls into the `else` branch
    (`scopesValidator.js:105-112`) → hard veto: `error = 'Write not allowed using user scopes if
    patient scope is present'`, regardless of what `user/*.*` would otherwise permit.
  - **Patient-compartment eligible (e.g. `DocumentReference` — `subject.reference`):**
    `isAccessAllowedByPatientScopes` is `true` → the check runs `scopeChecker` against *only* the
    patient-scope subset of the token (`scopesValidator.js:102-104`); the broader user scope is
    never consulted at all. A patient scope that doesn't itself grant
    `DocumentReference.write` fails here with a different message
    (`... failed access check to [DocumentReference.write]`).
- `patientScopeManager.canWriteResourceWithAllowedPatientIdsAsync`
  (`patientScopeManager.js:234-274`) is how ownership is proven for patient-compartment resources:
  it resolves the resource's patient-linkage property (`getPatientPropertyForResource`), reads the
  reference value via `getValueOfPropertyFromResource` (which normalizes a `Patient/<id>` or
  `Patient/<id>|<sourceAssigningAuthority>` reference into a UUID using the *same*
  `generateUUIDv5(id + '|' + sourceAssigningAuthority)` scheme `fhir-server-ui` replicates
  client-side in `src/utils/uid.utils.ts`), and checks it against the patient ids resolved from the
  token's own patient scope (`getPatientIdsFromScopeAsync`). It **throws** if the resource type
  isn't patient-filterable at all — callers must guard that.
- `ScopesValidator` has no database dependency; `MergeManager` (`databaseQueryFactory`,
  `mergeManager.js:12,56,74-75`) and `create.js`/`update.js` do.
- `fhir-server`'s security-tag vocabulary (`src/utils/securityTagSystem.js`) does not currently
  include a "source patient id" tag. `fhir-server-ui` already emits one client-side
  (`SecurityTagSystem.sourcePatientId = 'https://www.icanbwell.com/sourcePatientId'`,
  `src/pages/UploadDocumentPage.tsx`) but `fhir-server` never reads it today — it's inert metadata.
  (Note: `src/constants.js:280-281`'s `source_patient_id`/`client_person_id` is an unrelated,
  pre-existing mechanism — a different URI, used as a `Subscription`-family `extension`/`identifier`
  value for `$everything`/GraphQL subscription lookups, not a `meta.security` tag. Not reusable
  here.)

## 3. Approaches considered

**Rejected: add `Binary` (and similar) directly to `patientFilterManager.patientFilterMapping`.**
This mapping is consumed far beyond write authorization — `searchManager`, `patientQueryCreator`,
`accessHistory`, `resourceValidator`, `bulkDataExportRunner`, `scopesManager` all key off it. Adding
an entry here to satisfy one narrow write-time ownership check would silently make `Binary` a
patient-scope-searchable/exportable compartment resource platform-wide — a far bigger blast radius
than this feature needs or was asked for.

**Chosen: a dedicated, narrower ownership signal used only by this bypass check.** Recognize a new
`meta.security` tag, `https://www.icanbwell.com/sourcePatientId` (matching `fhir-server-ui`'s
existing constant exactly, so no cross-repo drift), as a patient-ownership signal *only* inside the
new bypass-eligibility check — not wired into `patientFilterMapping` or any of its other consumers.
For resource types that already have a `patientFilterMapping` entry (e.g. `DocumentReference`), that
existing reference-based signal is used as-is; the tag is the fallback for types that have no such
field (e.g. `Binary`).

## 4. Design

### 4.1 Config

New env var `PATIENT_SCOPE_USER_WRITE_ALLOWED_RESOURCES` (comma-separated resource type names),
exposed via `ConfigManager` using the existing `_parseCommaSeparatedList` helper
(`configManager.js:18-20`):

```js
get patientScopeUserWriteAllowedResourceTypes() {
    return this._parseCommaSeparatedList(env.PATIENT_SCOPE_USER_WRITE_ALLOWED_RESOURCES, []);
}
```

Default `[]` — zero behavior change unless explicitly configured (e.g. `Binary,DocumentReference`
for the Upload Document use case).

### 4.2 New ownership signal

Add the tag system constant to `src/utils/securityTagSystem.js`:
```js
sourcePatientId: 'https://www.icanbwell.com/sourcePatientId'
```

Add a helper (proposed home: `scopesManager.js`, alongside `getPatientScopes`/`getUserScopes`) that
extracts and normalizes patient ids from that tag, reusing the exact same reference-parsing /
`generateUUIDv5` normalization `getValueOfPropertyFromResource` already uses for reference fields —
so the two signal types produce directly comparable ids:

```js
getPatientIdsFromSourcePatientIdTag({ resource }) {
    const tags = resource.meta?.security?.filter(
        s => s.system === SecurityTagSystem.sourcePatientId
    ) ?? [];
    return tags.map(t => {
        const { id, sourceAssigningAuthority } = ReferenceParser.parseReference(t.code);
        return sourceAssigningAuthority && !isUuid(id)
            ? generateUUIDv5(`${id}|${sourceAssigningAuthority}`)
            : id;
    });
}
```

### 4.3 Bypass-eligibility check

New method on `PatientScopeManager` (co-located with the existing ownership logic it extends),
e.g. `canBypassPatientScopeForUserWriteAsync({ requestInfo, resourceType, existingResource })`:

1. `resourceType` must be in `configManager.patientScopeUserWriteAllowedResourceTypes` — else not
   eligible, existing behavior applies unchanged.
2. **The token's user scope must independently satisfy the write** — run the same `scopeChecker`
   used elsewhere against `scopesManager.getUserScopes({ scope })`. This is the "confirm the token
   actually has scope to write this resource" requirement — the allowlist alone never grants
   access; it only lifts the patient-scope veto so the *existing* user-scope check gets to run.
3. **Ownership, only if the resource already exists:**
   - `existingResource == null` (brand-new id) → allowed; nothing to protect yet.
   - Otherwise, resolve patient ids for the existing resource from *either* signal (OR, since
     either one being a match is sufficient proof of ownership — this is a existence-of-match check,
     not a completeness check, so OR is correct per `review.md` §C's quantifier guidance):
     - `patientFilterManager.getPatientPropertyForResource` reference, if the type has one, **or**
     - the `sourcePatientId` tag helper above.
   - If neither signal is present on the existing resource, **fail closed** — deny. (This is the
     honest answer to "we can't verify ownership," not "assume it's fine.")
   - If a signal is present, it must intersect `patientScopeManager.getPatientIdsFromScopeAsync(...)`
     for the requesting token — same comparison `canWriteResourceWithAllowedPatientIdsAsync` already
     does for compartment resources.

All three conditions must hold. This directly follows `review.md` §2's warning about a new
authorization branch being accidentally mutually-exclusive with (rather than additive to) the
scope type it doesn't handle: step 2 keeps the *user*-scope check mandatory rather than skipping
authorization entirely once the patient-scope veto is lifted.

### 4.4 Wiring per call site

- **`mergeManager.preMergeChecksAsync`** (single-phase today — only the coarse check runs): when
  `scopesValidator.isScopesValidAsync` returns a forbidden error, and `resourceToMerge.resourceType`
  is on the allowlist, fetch the existing resource via the `databaseQueryFactory` this method
  already has access to (mirroring the lookup `mergeResourceAsync` performs later at
  `mergeManager.js:347-357`, including running it through `preSaveManager.preSaveAsync` first so
  `_uuid` is populated, as `canWriteResourceWithAllowedPatientIdsAsync` requires), then call the new
  bypass check. Clear the forbidden error only if it returns `true`.
- **`create.js` / `update.js`** (already two-phase): `verifyHasValidScopesAsync` throws before the
  resource is loaded, so it cannot itself run the ownership half of the check. Instead: make the
  *coarse* check tolerant — when the veto would fire for an allowlisted resource type, defer instead
  of throwing (letting the request proceed to where the resource is actually loaded), and extend
  `canWriteResourceAsync` (`patientScopeManager.js:298-352`) — which already has the real resource by
  the time `isAccessToResourceAllowedByAccessAndPatientScopes` calls it — to consult the same new
  bypass method (with the loaded resource as `existingResource`) instead of unconditionally returning
  `false` at line 323 for a non-patient-filterable, allowlisted type.

This reuses each call site's existing two-phase vs. one-phase structure rather than forcing merge
and create/update into an identical shape.

## 5. Security considerations (per `review.md`)

- **§2 (mutual exclusivity):** addressed directly in §4.3 step 2 — the bypass never substitutes for
  a real scope check, it only changes *which* scope set (`user/...` instead of being vetoed
  outright) gets checked.
- **§C (write-path quantifiers):** the OR across ownership signals (§4.3) is deliberately an
  existence-of-a-matching-signal check, not a require-all check; documented above so a future editor
  doesn't "fix" it into an AND by mistake.
- **Trust model for the new tag:** `sourcePatientId` is caller-supplied at write time, same as the
  existing `owner`/`access` tags this server already treats as authoritative once persisted. This
  is consistent with the existing trust boundary, not a new one — but it means a *subsequent* write
  to an allowlisted resource must not be allowed to silently change an existing `sourcePatientId` tag
  to a different patient (that would be a re-assignment/spoofing vector). Proposed rule: once set,
  `sourcePatientId` is treated as a protected field for allowlisted resource types — same posture
  `SEC-1583` recommends for `access`/`owner` tags — an update that changes it must go through the
  normal ownership check against the *pre-update* value, not the caller-supplied new value.
- **§0 (no sensitive values):** this doc uses placeholder ids only; no real user/resource ids from
  the motivating incident are included.
- **Blast radius containment:** explicitly does not touch `patientFilterMapping` (§3), so search,
  `$everything`, `accessHistory`, `resourceValidator`, and bulk export behavior for `Binary` (or any
  other allowlisted type) are unaffected by this change.
- **Default-safe:** empty allowlist by default; the new tag constant and helper are inert until a
  resource type is actually configured.

## 6. Testing plan

- Unit tests for `ScopesManager.getPatientIdsFromSourcePatientIdTag` (parses reference-shaped and
  bare-id tag codes; empty when tag absent).
- Unit tests for `PatientScopeManager.canBypassPatientScopeForUserWriteAsync` covering: type not
  allowlisted; allowlisted but user scope insufficient; allowlisted + sufficient scope + no existing
  resource (create, allowed); existing resource with matching reference-based ownership; existing
  resource with matching tag-based ownership; existing resource with neither signal (denied);
  existing resource owned by a *different* patient (denied).
- New integration tests under `src/tests/integration/patientScope/`, following the existing
  `merge_with_patient_scope` / `merge_without_patient_scope` naming convention, plus equivalents for
  create and update, exercising a token with both `user/*.*` and an unrelated `patient/...` scope
  against an allowlisted type (`Binary`) and a compartment type (`DocumentReference`).
- Regression: existing `patientScope` integration suite must pass unchanged with the allowlist at
  its default empty value.

## 7. Open questions

- Exact list of resource types to configure for the `fhir-server-ui` Upload Document use case in
  each environment (dev/staging/prod) — `Binary,DocumentReference` covers the motivating case; final
  list is an ops/config decision, not a code decision.
- Whether the "protect `sourcePatientId` once set" rule (§5) should be enforced now or tracked as a
  fast-follow — recommend now, since it's a small addition to the existing protected-field-list
  pattern `SEC-1583` already established, and shipping the read-side check without the write-side
  protection leaves a known gap open from day one.
