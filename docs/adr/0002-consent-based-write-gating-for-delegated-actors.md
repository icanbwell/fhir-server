# Consent-Based Write Gating for Delegated Actors

## Status

Proposed

## Context

A **delegated actor** is a patient-scoped token carrying an `act` claim naming a `RelatedPerson` who acts on behalf of the patient (see [readme/delegatedActorAccess.md](../../readme/delegatedActorAccess.md)). This ADR introduces **consent-gated writes**.

A grantor's `Consent` can deny sensitivity categories (e.g. `MENTAL_HEALTH`, `HIV_AIDS`) to the delegate. Reads already filter those out. The write-side mirror:

> A delegate must not **modify** a resource belonging to a denied sensitive category as per the Consent for delegated access.

### Problem

Enforce this across **all** write endpoints (`$merge`, `PUT`/update, `PATCH`, create, mutations).

### Requirements

1. Per-resource enforcement (a `$merge` bundle has many resources).
2. Partial success for bundles — one denied resource must not fail the whole `$merge`.
3. One reusable rule, easily extended with future checks.
4. Zero behavior change for non-delegated requests.

## Decision

We will add a `WriteAccessManager` with pluggable `WriteAccessCheck`s (first: `DelegatedAccessWriteCheck`), and invoke it at each write endpoint's existing resource-level access checkpoint.

### 1. Components to add

```js
// src/operations/security/writeAccessChecks/writeAccessCheck.js
class WriteAccessCheck {
    // Override to deny (throw a ForbiddenError); the base allows.
    async checkAsync({ requestInfo, resource, base_version }) {
        return true;
    }
}

// src/operations/security/writeAccessManager.js
class WriteAccessManager {
    constructor({ writeAccessChecks }) {
        this.writeAccessChecks = writeAccessChecks; // WriteAccessCheck[]
    }
    // Returns true if every check allows; the first check to deny throws ForbiddenError(403).
    async checkAsync({ requestInfo, resource, base_version }) {
        for (const check of this.writeAccessChecks) {
            await check.checkAsync({ requestInfo, resource, base_version });
        }
        return true;
    }
}

// src/operations/security/writeAccessChecks/delegatedAccessWriteCheck.js
class DelegatedAccessWriteCheck extends WriteAccessCheck {
    constructor({ delegatedAccessRulesManager }) {
        super();
        this.delegatedAccessRulesManager = delegatedAccessRulesManager;
    }

    async checkAsync({ requestInfo, resource, base_version }) {
        // Code here
    }
}
```

```js
// src/createContainer.js — register the manager with its checks
container.register('writeAccessManager', (c) => new WriteAccessManager({
    writeAccessChecks: [
        new DelegatedAccessWriteCheck({ delegatedAccessRulesManager: c.delegatedAccessRulesManager })
        // extendable
    ]
}));
```

### 2. Enforcement model

| # | Gate | Mechanism |
|---|------|-----------|
| 1 | **JWT Scope** | `patient/Resource.write`, Enforced via Scope Validator (already implemented). |
| 2 | **Operation allow-list** | `DELEGATED_ACCESS.ALLOWED_OPERATIONS`, enforced by `DelegatedAccessManager.verifyAccess`. (existing flow)|
| 3 | **Per-resource consent** | `writeAccessManager.checkAsync(...)` at each endpoint's resource-level checkpoint. (code change we intend to do) |

```js
// src/constants.js — gate 2 (add write ops; 'remove'/delete stays omitted → denied)
DELEGATED_ACCESS: {
    ALLOWED_OPERATIONS: [
        'search', 'searchById', 'everything', 'graph',
        'merge', 'update', 'patch'
    ]
}
```

`DELETE`/`remove` will stay denied **by omission**. (Not doing any change here)

### 3. Integration points

The rule plugs in **right after the existing `ScopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes` call, on the found resource only** (consent runs *after* access).

**1. `PUT` / update** — [src/operations/update/update.js](../../src/operations/update/update.js) (existing-resource path; **not** the upsert/insert path):

```js
const foundResource = data; // current stored version
// rest code
// before the insert
await this.writeAccessManager.checkAsync({ requestInfo, resource: foundResource, base_version });
```

**2. `$merge`** — in the **Merge Validator** ([src/operations/merge/validators/writeAllowedByScopesValidator.js](../../src/operations/merge/validators/writeAllowedByScopesValidator.js)), inside the per-resource loop:

```js
const foundResource = this.databaseBulkLoader.getResourceFromExistingList({
    requestId: requestInfo.requestId, resourceType: resource.resourceType, uuid: resource._uuid
});
if (foundResource) {
    await this.scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes({
        resource: foundResource, requestInfo, base_version
    });
    // + consent gate (found-only)
    await this.writeAccessManager.checkAsync({ requestInfo, resource: foundResource, base_version });
}
// The existing try/catch turns a 403 into a MergeResultEntry → partial success (bundle continues).
```

**3. `PATCH`** — [src/operations/patch/patch.js](../../src/operations/patch/patch.js) (a found resource is always present — `NotFound` is thrown otherwise, so found-only is automatic):

```js
await this.scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes({
    requestInfo, resource: foundResource, base_version
});
// + write access check
await this.writeAccessManager.checkAsync({ requestInfo, resource: foundResource, base_version });
```

**4. create** — Allowed
**5. mutations** - Covered via merge/put

### 4. Rollout (PR sequence)

1. **PR 1** — this ADR.
2. **PR 2** — `WriteAccessManager` + `WriteAccessCheck` + `DelegatedAccessWriteCheck` + container registration + unit tests (no endpoint wired yet → no behavior change).
3. Subsequent PRs for each integration.

### 5. Consent is already fetched per request (no extra cost)

For **every** delegated request, scope validation fetches the Consent and caches the filtering rules on `actor._filteringRules` (request-scoped):

```
verifyHasValidScopesAsync → isScopesValidAsync → DelegatedAccessScopeManager.isAccessAllowedAsync
    → hasValidConsentAsync → getFilteringRulesAsync   // caches actor._filteringRules
```

This runs **before** the resource-level write check. `DelegatedAccessWriteCheck` calls the same `getFilteringRulesAsync`, which returns the cached value — so the consent gate adds **no additional database round-trip**.

## Consequences

### Positive

1. **One rule, one seam** — the same one-line call at the same logical checkpoint per endpoint.
2. **Extensible** — future checks (Composition sections, etc.) drop into the manager.
3. **Non-delegated traffic untouched** — `checkAsync` short-circuits to allow.
4. **Partial success for bundles** reuses existing `MergeResultEntry` handling.
5. **No extra DB cost** — reuses the consent already fetched + cached during scope validation (§5).

## Options Considered

The placement of the per-resource consent check drove the design. Two alternatives were rejected before the selected approach:

### Option A: Persistence-layer chokepoint (`DatabaseBulkInserter`) ❌ Rejected
Call `checkAsync` inside `insertOne`/`replaceOne`/`mergeOne` after `preSave`.
- ❌ Access Validations in the persistence layer; merge per-entry errors awkward from the data layer.
- **Rejected:** authz must not live in persistence.

### Option B: Fold into `ScopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes` ❌ Rejected
Put consent inside the shared access *method*.
- ❌ Semantically wrong
- ❌ Can't cover all cases
- **Rejected:** incompatible

## References

- Delegated actor read-side behavior: [readme/delegatedActorAccess.md](../../readme/delegatedActorAccess.md)
- Consent fetch + caching: `src/utils/delegatedAccessRulesManager.js` (`getFilteringRulesAsync`, caches `actor._filteringRules`); `src/operations/security/scopesValidator.js` (`verifyHasValidScopesAsync` → `isScopesValidAsync`)
- Integration seam: `src/operations/merge/validators/writeAllowedByScopesValidator.js`, `src/operations/update/update.js`, `src/operations/patch/patch.js`
- Operation allow-list: `src/constants.js` (`DELEGATED_ACCESS.ALLOWED_OPERATIONS`)
- Jira: PAY-2047 (epic PAY-2112)

---

**Date**: 2026-06-16
**Authors**: Nirbhay Kumar Nachiketa
**Status**: Proposed
