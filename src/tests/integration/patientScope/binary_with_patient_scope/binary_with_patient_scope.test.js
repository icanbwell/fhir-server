// Test skeleton for patient-scoped Binary create and person-scoped Binary access.
//
// Design (awaiting review/approval, not yet implemented):
//   docs/superpowers/specs/2026-10-08-binary-patient-scoped-write-design.md  (section 14, test matrix)
//
// Every case below is a `test.todo` so it is tracked without asserting behavior that does not exist
// yet. When the design is approved and implemented, replace each todo with a real test following
// src/tests/integration/patientScope/create_with_patient_scope/create_with_patient_scope.test.js.
const { describe, test } = require('@jest/globals');

describe('Binary with patient scope', () => {
    test.todo('T1: Member creates Binary, no tag supplied [token: P, flag on] expects 201 with a clientPersonId tag for person A stamped in meta.security');
    test.todo('T2: Member supplies matching tag [token: P] expects 201; exactly one tag');
    test.todo('T3: Member supplies other person\'s tag [token: P] expects 403; nothing persisted');
    test.todo('T3b: Two clientPersonId tags [token: P] expects 400');
    test.todo('T4: Patient scope but no/empty person id [token: P w/o clientFhirPersonId] expects 401 at auth (and unit test: op-layer 403)');
    test.todo('T5: PUT/update Binary [token: P] expects 403');
    test.todo('T6: PATCH Binary [token: P] expects 403');
    test.todo('T7: DELETE Binary [token: P] expects 403');
    test.todo('T8: $merge Binary [token: P] expects 403');
    test.todo('T9: Member A reads own tagged Binary by id [token: Pr(A)] expects 200');
    test.todo('T10: Member B reads A\'s tagged Binary by id [token: Pr(B)] expects 404 / not found (same as missing)');
    test.todo('T11: Member B searches Binary?_id= and Binary search [token: Pr(B)] expects empty bundle; A\'s does not leak');
    test.todo('T12: _history and _history/{vid} [token: P/Pr] expects 403 (unchanged: history rejects patient scope)');
    test.todo('T13: Patient/$everything / Person/$everything as B with A\'s DocumentReference pointing to A\'s Binary (and B\'s own DR pointing at A\'s Binary) [token: Pr(B)] expects A\'s Binary absent from bundle; B\'s own present');
    test.todo('T14: $graph DocumentReference → Binary [token: Pr(A)/Pr(B)] expects A sees it; B does not');
    test.todo('T15: GraphQL DocumentReference → attachment.resource for owner [token: Pr(A)] expects Binary returned');
    test.todo('T16: GraphQL same, other member [token: Pr(B)] expects resource: null');
    test.todo('T17: Untagged Binary (existing fixtures) [token: Pr] expects readable exactly as today (regression against graphql.documentReference.test.js expectations)');
    test.todo('T18: System token writes Binary without tag [token: S] expects 201; no tag added');
    test.todo('T19: System token writes Binary with tag A [token: S] expects 201; tag preserved; readable by Pr(A), not Pr(B)');
    test.todo('T20: System token reads tagged Binary [token: S] expects 200 (no person filter without patient scope)');
    test.todo('T21: Cross-tenant: S-other reads/creates [token: S-other] expects access-tag filter still denies');
    test.todo('T22: Mixed-scope create [token: M] expects treated as patient-scoped: requires patient create grant, stamped; system/* alone does not bypass; patient/Condition.write system/*.* → 403');
    test.todo('T23: Patient token lacking create grant (patient/Binary.read only) [token: P-read] expects 403 on create');
    test.todo('T24: Patient token with only access/* + user/* (no patient) [token: S-like] expects unchanged');
    test.todo('T25: Binary read with format=text/plain path (fhirResponseWriter) as B [token: Pr(B)] expects not returned (OQ-2)');
    test.todo('T26: Cache short-circuit paths in $everything/$graph [token: Pr(B)] expects not returned (OQ-2)');
    test.todo('T30: Cloud-storage offload on (BASE64_FIELD_CLOUD_STORAGE_ENABLED) with member Binary > threshold [token: P] expects 201; tag present on stored doc and in history entry');
    test.todo('T31: Flag off [token: P] expects 403 with today\'s message Write not allowed using user scopes if patient scope is present');
    test.todo('T32: Flag off, tagged Binary exists [token: Pr(B)] expects no person filter (today\'s behavior), documents rollback note in §7');
    test.todo('T33: Person id claim empty on read [token: Pr] expects filter fails closed (_uuid: \'__invalid__\') — unit test of query construction');
    test.todo('T34: Query shape [token: Pr] expects toHaveMongoQuery shows $or clause ANDed with access-tag filter, using resource.meta.security for history');
    test.todo('T36: Audit entry written; stamping logged [token: P] expects audit logger invoked once with resource uuid');
    test.todo('T37: Pure patient token (patient/Binary.read, no user/system scope, no access code) reads own tagged Binary by id [token: P-read(A)] expects 200');
    test.todo('T38: Pure patient token reads another member\'s tagged Binary by id and by search [token: P-read(B)] expects 404 / empty bundle');
    test.todo('T39: Pure patient token reads an untagged Binary (any tenant) [token: P-read] expects 404 / not returned: untagged Binary are never exposed through a patient-only read');
    test.todo('T40: Pure patient token without patient/Binary.read [token: patient/Condition.read only] expects 403 reading Binary');
    test.todo('T41: Mixed token (patient/Binary.read + user/*.read + access code) reads untagged Binary [token: Pr] expects readable as today (clinical viewers unchanged)');
    test.todo('T42: Create with a clientPersonId tag for another person, with reason [token: P] expects 403 whose OperationOutcome names the mismatch (without echoing the other person id)');
});
