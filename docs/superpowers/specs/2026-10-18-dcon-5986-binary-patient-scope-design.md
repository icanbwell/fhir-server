# DCON-5986: Binary as a patient-scoped resource (Task parity) - Design

Fresh start; supersedes the design and implementation in #2635 and #2643.
Implementation steps: `docs/superpowers/plans/2026-10-18-dcon-5986-binary-patient-scope-plan.md`.

## Problem

A member (patient-scoped) token cannot create a `Binary`. `Binary` has no patient reference of its
own, so it is not in `patientFilterManager.js` and the patient-scope write checks reject it
(`scopesValidator.js` "Write not allowed using user scopes if patient scope is present",
`PatientScopeManager.canWriteResourceAsync`). Binary reads are gated only by the tenant access tag,
so a Binary is never tied to the member who owns it. Needed for the member-uploaded documents flow,
where the member's own token stores the file bytes.

## Approach

`Binary` joins `patientFilterMapping` as `Binary: 'securityContext.reference'`, exactly like
`Task: 'for.reference'` or `Observation: 'subject.reference'`. The existing patient-scope read/write
machinery then applies unchanged: no bespoke person tag, no unowned/owned read split, no extra
`ScopesManager` predicates.

## Decisions (2026-10-18)

- **Write parity with Task.** A patient-scoped token may create, update, patch and delete a Binary
  whose `securityContext` is one of its reachable patients (no create-only guard).
- **One default-off flag**, `ENABLE_PATIENT_SCOPED_BINARY`, gates the whole behavior (the mapping is
  active only when on). It is enabled only after the `securityContext` backfill is done, then
  removed (DCON-6075).
- **Tenant tags on patient-scoped create match Task as-is** (no extra `meta.security` validation).
- **`securityContext` format.** The caller supplies either a Patient reachable through the identity
  graph, or its own client person id from the access token (proxy patient
  `Patient/person.<clientPersonId>`). `PatientScopeManager.getPatientIdsFromScopeAsync` already
  returns exactly this set (`PERSON_PROXY_PREFIX` + linked patients), so no new resolution code.

## Behavior

### Reads
With the flag on, patient-scoped reads of Binary use the ordinary `getQueryWithPatientFilter`
(`securityContext._uuid` / `_sourceId`). A Binary without a `securityContext` is hidden from
patient-scoped tokens. Flag off equals `main`. This includes the DocumentReference -> Binary hop in
`$everything` and GraphQL.

### Writes
Create, PUT, PATCH, `$merge` and DELETE all reach `PatientScopeManager.canWriteResourceAsync`
through `scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes`. A create without
`securityContext`, or with one outside the caller's patients, gets a 403.

### Mixed tokens
Example: `patient/*.* user/*.* access/*.*`, the shape of a real member token. Once Binary is
patient-filterable, `isScopesValidAsync` evaluates only the `patient/` scopes for it
(`scopesValidator.js:158`); `user/` and `access/` are not consulted
(`isAccessToResourceAllowedBySecurityTags` returns true for patient-scoped types). Such a token can
write a Binary only when `securityContext` is one of its reachable patients, same as Task. Before
the mapping it could not write Binary at all. Tokens with no patient scope are unchanged.

### Tenant tags on create
`isAccessTagChangeAllowedByScopes` returns true on create for patient-scoped types, so the
`meta.security` tags a member supplies are not validated even when the token carries `access/*.*`.
This is the gap #2635's review flagged; this design accepts it by matching Task, and the PR
description must say so for the reviewer.

### GraphQL v1 CodeSystem -> Binary lookup
`src/graphql/resolvers/custom/codeSystemProperty1.js` expands `CodeSystem.concept.property.valueString`
when it starts with `Binary/` (GraphQL v2 has no such lookup). CodeSystem-owned Binary has no
patient, so the patient filter would hide it from patient-scoped callers. A Binary reached through
this path is returned only if its `securityContext` is absent or equals exactly
`CodeSystem/<parent CodeSystem's own id>`; any other value returns `null`. The read keeps the tenant
access-tag filter but skips the patient filter, and runs only after the parent CodeSystem was itself
read under the caller's authorization.

## Known risks (from reading the code; each needs a test to confirm)

- **Update checks run on the stored resource only.** For an existing resource, PUT (`update.js`),
  PATCH (`patch.js`) and `$merge` (`writeAllowedByScopesValidator.js`) authorize against the stored
  document, then re-check only access-tag changes on the result. A member could re-point their own
  Binary's `securityContext` at another patient. `Task.for` has the same gap today.
- **Bytes can be wiped by the owner.** `$merge?smartMerge=false` without `data` deletes the bytes and
  the S3 object; with write parity a member can do this to their own Binary. PUT writes a new S3
  object each time (`alwaysCreateNew`; the previous one is retained per DCON-6064).
- **`securityContext._uuid` must be populated.** `getValueOfPropertyFromResource` reads it, so preSave
  must set it for both `Patient/<uuid>` and the proxy `Patient/person.<id>` (non-uuid, matched in the
  non-uuid branch).
- DELETE removes the Binary and its blob via `removeHelper`.

## Rollout

Backfill complete -> enable `ENABLE_PATIENT_SCOPED_BINARY` in dev/staging -> prod -> remove the flag.
Until the backfill has run, existing Binary without `securityContext` would be invisible to
patient-scoped tokens, so the flag stays off.
