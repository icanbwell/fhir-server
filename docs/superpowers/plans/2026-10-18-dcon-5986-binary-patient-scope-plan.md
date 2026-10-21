# DCON-5986: Binary patient scope - Implementation Plan

Design, decisions and rationale: `docs/superpowers/specs/2026-10-18-dcon-5986-binary-patient-scope-design.md`.
Supersedes the implementation in #2635 and #2643.

## Tasks

1. **Mapping behind flag.** `src/fhir/patientFilterManager.js` + `src/utils/configManager.js`: add
   `Binary: 'securityContext.reference'` only when `ENABLE_PATIENT_SCOPED_BINARY` is on. Verify
   `PatientQueryCreator.getQueryWithPatientFilter` yields `securityContext._uuid` / `_sourceId`
   filters for Binary.
2. **Read paths.** Confirm direct read/search, `$everything` (DocumentReference -> Binary hop),
   GraphQL DocumentReference.content.attachment Binary resolution, and the `$everything` cache key
   with the mapping on. Flag off must equal `main`.
3. **CodeSystem -> Binary lookup (GraphQL v1).** Done: `FhirDataSource.findBinaryForCodeSystemAsync`
   evaluates that one read without the token's `patient/` scopes (tenant filter from `access/`, refused
   if the token has none), and `isBinaryReadableViaCodeSystem` returns the Binary only when its
   `securityContext` is absent or exactly the parent CodeSystem. `CodeSystem.concept` marks each
   property with its owner. Active only with the flag on.
4. **Write paths.** Confirm POST, PUT, PATCH, `$merge` and DELETE go through
   `PatientScopeManager.canWriteResourceAsync`; confirm preSave populates `securityContext._uuid` for
   `Patient/<uuid>` and `Patient/person.<id>`. Verify the update, byte-wipe and mixed-token behaviors
   listed under Known risks in the design.
5. **Tests.** Integration: create allowed; foreign/missing `securityContext` rejected; update,
   patch, delete allowed on own and forbidden on another member's Binary; cross-member read
   forbidden; untagged Binary hidden from patient scope with flag on, unchanged with flag off;
   mixed-scope token (`patient/*.* user/*.* access/*.*`); system token; `$everything`/GraphQL hop;
   CodeSystem lookup (absent, own id, other CodeSystem, `Patient/...`). Unit: mapping + flag.
6. **Docs.** `docs/resource-authorization.md` (§5 patient-filterable list, write rules, flag).
7. **Rollout.** Backfill complete -> enable `ENABLE_PATIENT_SCOPED_BINARY` in dev/staging -> prod ->
   remove flag.
