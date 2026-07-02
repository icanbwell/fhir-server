# FHIR Merge Validation Specification

This document specifies every check that must pass before a FHIR resource is written to the database during a merge (create or update) operation. Checks are listed in pipeline order. A failure at any hard-error check aborts processing for that resource and returns an `OperationOutcome`.

> **Configuration baseline:** `requireMetaSourceTags` defaults to `true` in `configManager.js` and is not overridden in production. Remote FHIR validation (`FHIR_VALIDATION_URL`) is not configured in production, so that path is inactive. Auth enforcement is always active — there is no bypass flag. Delegated-access detection is disabled by default (`ENABLE_DELEGATED_ACCESS_DETECTION` defaults to `false`).

---

## 1. Middleware Pre-checks

These run before the merge operation is reached.

| Check | Error |
|-------|-------|
| `Content-Type` header is in the allowed list | 400 |
| Requesting user type is not blocked for this endpoint | 403 |

---

## 2. Input Unpacking

Applied when the top-level payload is a `Bundle` or `Parameters` resource.

| Check | Error | Applies when |
|-------|-------|--------------|
| `Bundle` entry array is present and non-empty | 400 | Payload `resourceType` is `Bundle` |
| `Parameters.parameter` array is present and non-empty | 400 | Payload `resourceType` is `Parameters` |
| At least one `parameter` entry has a `resource` part | 400 | Payload `resourceType` is `Parameters` |
| No nested `Parameters` resources inside `Parameters` | 400 | Payload `resourceType` is `Parameters` |

---

## 3. Core Field Requirements

Applied to every individual resource after unpacking.

| Check | Error |
|-------|-------|
| `resource.id` is present | 400 |
| `resource.resourceType` is present | 400 |
| `resource.id` does not contain a pipe character (`\|`) | 400 |
| If `resource.id` is not a UUID, at least one of the following must be present: an owner security tag (`https://www.icanbwell.com/owner`) or a sourceAssigningAuthority tag | 400 |

---

## 4. Security & Metadata Tags

These checks are always enforced (`requireMetaSourceTags=true` in production).

| Check | Error |
|-------|-------|
| `meta.source` is present | 400 |
| Exactly one owner tag (system `https://www.icanbwell.com/owner`) is present on new resources | 400 |
| No security tag has a null or empty `system` or `code` | 400 |

---

## 5. Resource Type vs Endpoint

| Check | Error |
|-------|-------|
| `resource.resourceType` matches the resource type in the request URL | 400 |

---

## 6. Reference Format

Applied recursively to every `reference` field in the resource.

| Check | Error |
|-------|-------|
| Each reference value is one of: a contained reference (`#...`), an absolute URL, or a relative reference in `ResourceType/id` format | 400 |

---

## 7. Write Scope & Access

Auth enforcement is always active. All checks in this section always apply.

| Check | Error | Applies when |
|-------|-------|--------------|
| The authenticated user holds a `write` scope for this resource type | 403 | Always |
| The resource's security tags include at least one code the user is permitted to access | 403 | Always |
| A user-scoped token may not write if a patient scope is also present in the same token | 403 | Token carries both user and patient scopes |
| A patient-scoped token must pass `canWriteResourceAsync()` | 403 | Token carries a patient scope |
| A resource carrying the `RESOURCE_RESTRICTION_TAG` cannot be written by a patient-scoped token | 403 | Token carries a patient scope |
| The requesting actor must have a valid delegation consent | 403 | `ENABLE_DELEGATED_ACCESS_DETECTION=true` (disabled by default) |
| Both the existing database version and the incoming resource must be accessible under the user's access/patient scopes | 403 | An existing resource is found in the database |

---

## 8. FHIR Schema Validation

| Check | Error | Applies when |
|-------|-------|--------------|
| Resource passes `fhirSchemaValidator.validate()` against the FHIR R4 JSON schema | 422 | Always |
| Required fields declared in the schema are present | 422 | `smartMerge=false` (full replace; this is a per-request query parameter, not a server config) |
| `oneOf` constraints declared in the schema are satisfied | 422 | `smartMerge=false` |

> **Note:** In `smartMerge=true` mode (partial update), required-field and oneOf schema errors are suppressed to allow partial payloads. All other schema errors still fail. Remote FHIR validation via HAPI and profile-level validation are inactive in production (`FHIR_VALIDATION_URL` is not configured).

---

## 9. Patient Reference Consistency (Updates Only)

| Check | Error | Applies when |
|-------|-------|--------------|
| The patient reference(s) in the incoming resource match the patient reference(s) in the existing database record | 400 | A previous version of the resource already exists |

---

## 10. Post-merge Re-validation

After the incoming resource is merged with the existing record, the result is re-validated:

| Check | Error |
|-------|-------|
| Merged result passes meta and security tag checks | 400 |
| Merged result passes FHIR schema validation | 422 |
| Patient reference in merged result is unchanged | 400 |

---

## Duplicate Handling (Non-blocking)

If a batch contains multiple entries that resolve to the same resource (matched by UUID, or by `id|sourceAssigningAuthority|resourceType`), they are merged together before validation. A warning is logged; no error is returned.

---

## Key Source Locations

| Area | Primary file(s) |
|------|----------------|
| Core field checks | `src/operations/merge/mergeManager.js` |
| Schema validation | `src/utils/validator.util.js`, `src/operations/common/resourceValidator.js` |
| Reference validation | `src/utils/referenceValidator.js` |
| Scope & access checks | `src/operations/security/scopesValidator.js`, `src/operations/merge/validators/writeAllowedByScopesValidator.js` |
| Bundle / Parameters unpacking | `src/operations/merge/validators/bundleResourceValidator.js`, `src/operations/merge/validators/parameterResourceValidator.js` |
| Pre-save enrichment | `src/preSaveHandlers/handlers/` |
| Middleware checks | `src/middleware/contentType-validation.middleware.js`, `src/middleware/forbidForUserTypes.middleware.js` |
| Configuration defaults | `src/utils/configManager.js` |
