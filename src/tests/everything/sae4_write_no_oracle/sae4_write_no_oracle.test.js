// ============================================================================
// REGRESSION TEST (passes today) — SEC-1580 D-SAE4 / spec SAE-4 & SAE-5.
// Gap: a write-by-identifier for a resource that exists but belongs to another tenant
// returns a DIFFERENT result than a write to a genuinely nonexistent id — an existence
// oracle. Combined with deterministic internal ids (SAE-5) this lets a caller probe
// whether a specific record exists without ever seeing its data.
//
// SECURE behavior: the two are indistinguishable (same status). Against current code the
// statuses differ. *.bugs.test.js, excluded from default CI.
// ============================================================================
const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

const foreignPatient = {
  resourceType:'Patient', id:'sae4ForeignB',
  meta:{ source:'tenantb', security:[
    {system:'https://www.icanbwell.com/owner',code:'tenantb'},
    {system:'https://www.icanbwell.com/access',code:'tenantb'},
  ]},
  birthDate:'1990-01-01', gender:'female',
};
function bodyFor(id, accessCode){
  return { resourceType:'Patient', id, meta:{ source:accessCode, security:[
    {system:'https://www.icanbwell.com/owner',code:accessCode},
    {system:'https://www.icanbwell.com/access',code:accessCode},
  ]}, birthDate:'1990-01-01', gender:'female' };
}
const tenantAWrite = getHeaders('user/*.read user/*.write access/tenanta.*');

describe('D-SAE4 (known bug) — write-by-id must not leak exists-vs-not-found', () => {
  beforeEach(async()=>{ await commonBeforeEach(); });
  afterEach(async()=>{ await commonAfterEach(); });

  test('SECURE (fails until SAE-4 fixed): updating a foreign-tenant id is indistinguishable from updating a nonexistent id', async () => {
    const request = await createTestRequest();
    // seed a tenant-B-owned patient (admin merge)
    await request.post('/4_0_0/Patient/$merge').send(foreignPatient).set(getHeaders());

    // tenant A attempts a PUT by id against the EXISTING foreign resource...
    const foreign = await request.put('/4_0_0/Patient/sae4ForeignB').send(bodyFor('sae4ForeignB','tenanta')).set(tenantAWrite);
    // ...and against a genuinely NONEXISTENT id.
    const missing = await request.put('/4_0_0/Patient/sae4NoSuchIdXYZ').send(bodyFor('sae4NoSuchIdXYZ','tenanta')).set(tenantAWrite);

    // A caller must not be able to tell the two apart from the response.
    expect(foreign.status).toBe(missing.status);
  });
});
