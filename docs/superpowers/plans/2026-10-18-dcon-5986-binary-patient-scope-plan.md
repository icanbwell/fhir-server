# DCON-5986: Binary as a patient-scoped resource (Task parity)

Fresh start; supersedes the design/implementation in #2635 and #2643.

## Approach

`Binary` joins `patientFilterMapping` as `Binary: 'securityContext.reference'`, exactly like
`Task: 'for.reference'` or `Observation: 'subject.reference'`. The existing patient-scope
read/write machinery then applies unchanged. No bespoke person-tag, no unowned/owned read
split, no extra `ScopesManager` predicates.

Decisions (2026-10-18):
- Write parity with Task: a patient-scoped token may create, update, patch and delete a Binary
  whose `securityContext` is one of its reachable patients (no create-only guard).
- One default-off flag, `ENABLE_PATIENT_SCOPED_BINARY`, gates the whole Binary patient-scope
  behavior (mapping active only when on). It is enabled only after the backfill is done, then
  removed (DCON-6075).
- Tenant tags on patient-scoped create: match Task as-is (no extra `meta.security` validation).
- `securityContext` supplied by the caller must be either a Patient reachable through the identity
  graph, or the caller's own client person id from the access token (proxy patient
  `Patient/person.<clientPersonId>`). `PatientScopeManager.getPatientIdsFromScopeAsync` already
  returns exactly this set (`PERSON_PROXY_PREFIX` + linked patients), so no new resolution code.

## Tasks

1. **Mapping behind flag.** `src/fhir/patientFilterManager.js` + `configManager.js`: add the
   Binary entry only when the flag is on. Verify `PatientQueryCreator.getQueryWithPatientFilter`
   yields `securityContext._uuid` / `_sourceId` filters for Binary.
2. **Read paths.** Confirm direct read/search, `$everything` (DocumentReference -> Binary hop),
   GraphQL DocumentReference.content.attachment Binary resolution, and the `$everything` cache key
   behave with the mapping on. Flag off must equal `main` behavior.
2b. **CodeSystem -> Binary lookup (GraphQL v1 only).** `src/graphql/resolvers/custom/codeSystemProperty1.js`
   expands `CodeSystem.concept.property.valueString` when it starts with `Binary/` (GraphQL v2 has no
   such lookup). CodeSystem-owned Binary has no patient, so the patient filter would hide it from
   patient-scoped callers. Rule: a Binary reached through this path is returned only if its
   `securityContext` is absent or equals exactly `CodeSystem/<parent CodeSystem's own id>`; any other
   value (another CodeSystem, `Patient/...`) returns `null`. The read keeps the tenant access-tag
   filter but skips the patient filter, and only runs after the parent CodeSystem was itself read
   under the caller's authorization. Like the rest of the feature it is active only after the
   backfill (flag on). The backfill stamps `CodeSystem/<id>` on Binary referenced by CodeSystems, so
   the "absent" case only covers unstamped stragglers. Open: confirm via Groundcover that the field
   is used at all (if not, consider removing the resolver instead).
3. **Write paths.** Confirm POST, PUT, PATCH, DELETE and `$merge` for Binary go through
   `PatientScopeManager.canWriteResourceAsync`, require `securityContext` patient in the caller's
   reachable ids, and that a mixed token (patient + user/system) still hits "Write not allowed using
   user scopes if patient scope is present". Check Binary data handling on update (smartMerge, S3
   object retention per DCON-6064).
4. **Tenant tags on patient-scoped create.** Match Task (no extra validation). Call out in the PR
   description that #2635's review flagged this gap, so the reviewer signs off knowingly.
5. **Tests.** Integration: create allowed; foreign/missing `securityContext` rejected; update,
   patch, delete allowed on own and forbidden on another member's Binary; cross-member read
   forbidden; untagged Binary hidden from patient scope with flag on, unchanged with flag off;
   mixed-scope token; system token; `$everything`/GraphQL hop. Unit: mapping + flag.
6. **Docs.** `docs/resource-authorization.md` (§5 patient-filterable list, write rules, flag).
7. **Backfill + stamping (rollout blocker).** DCON-6075; notebook in
   icanbwell/bwell-data-ops-notebooks#108. Owner from DocumentReference.subject; conflicts reported,
   not stamped; default `$merge` only (never `smartMerge=false`). HDS/pipelines stamp
   `securityContext` on write.
8. **Rollout.** Backfill complete -> enable `ENABLE_PATIENT_SCOPED_BINARY` in dev/staging -> prod -> remove flag.

## Open questions
- Who owns the backfill runner.
