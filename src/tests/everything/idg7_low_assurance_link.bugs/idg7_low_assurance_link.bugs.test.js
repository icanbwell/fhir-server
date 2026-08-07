// ============================================================================
// KNOWN-BUG TEST (fails by design until fixed) — SEC-1580 D-IDG7 / spec IDG-7.
// Gap: no traversal/merge logic reads Person.link.assurance, so a LOW-assurance
// (best-guess) link is followed exactly like a confirmed one. A low-assurance link to
// another patient therefore merges that patient's data into an aggregate view.
//
// This asserts the SECURE behavior: data reachable only through a low-assurance link is
// NOT returned. Against current code it FAILS (the low-assurance patient's Observation
// comes back), which is the point — it documents the vulnerability and will turn green
// when assurance is honored. Named *.bugs.test.js and excluded from the default CI run,
// per the repo's existing convention for fail-by-design tests.
// ============================================================================
const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

const OWNER = 'tenanta';
function sec(){ return [
  { system: 'https://www.icanbwell.com/owner', code: OWNER },
  { system: 'https://www.icanbwell.com/access', code: OWNER },
]; }
const person = {
  resourceType:'Person', id:'idg7Person', meta:{source:OWNER,security:sec()},
  name:[{use:'official',family:'Kent',given:['Bob']}], gender:'male', birthDate:'1991-03-14',
  link:[
    { target:{reference:'Patient/idg7PatientHi',type:'Patient'}, assurance:'level4' }, // confirmed
    { target:{reference:'Patient/idg7PatientLo',type:'Patient'}, assurance:'level1' }, // low-confidence guess
  ],
};
const patHi = { resourceType:'Patient', id:'idg7PatientHi', meta:{source:OWNER,security:sec()}, birthDate:'1991-03-14', gender:'male' };
const patLo = { resourceType:'Patient', id:'idg7PatientLo', meta:{source:OWNER,security:sec()}, birthDate:'1991-03-14', gender:'male' };
const obsHi = { resourceType:'Observation', id:'idg7ObsHi', meta:{source:OWNER,security:sec()}, status:'final', code:{coding:[{system:'http://loinc.org',code:'1'}]}, subject:{reference:'Patient/idg7PatientHi'} };
const obsLo = { resourceType:'Observation', id:'idg7ObsLo', meta:{source:OWNER,security:sec()}, status:'final', code:{coding:[{system:'http://loinc.org',code:'1'}]}, subject:{reference:'Patient/idg7PatientLo'} };

const headers = { ...getHeaders('user/*.read access/tenanta.*'), prefer:'global_id=false' };
const ids = resp => (Array.isArray(resp.body)?resp.body:[]).map(r=>r&&r.id).filter(Boolean);

describe('D-IDG7 (known bug) — low-assurance Person.link must not be merged as certain', () => {
  beforeEach(async()=>{ await commonBeforeEach(); });
  afterEach(async()=>{ await commonAfterEach(); });

  test('control: data behind the HIGH-assurance link is returned', async () => {
    const request = await createTestRequest();
    await request.post('/4_0_0/Person/1/$merge').send([person,patHi,patLo,obsHi,obsLo]).set(getHeaders());
    const resp = await request.get('/4_0_0/Observation?patient=Patient/person.idg7Person').set(headers);
    expect(ids(resp)).toContain('idg7ObsHi');
  });

  test('SECURE (fails until IDG-7 fixed): data reachable ONLY via the low-assurance link is NOT returned', async () => {
    const request = await createTestRequest();
    await request.post('/4_0_0/Person/1/$merge').send([person,patHi,patLo,obsHi,obsLo]).set(getHeaders());
    const resp = await request.get('/4_0_0/Observation?patient=Patient/person.idg7Person').set(headers);
    expect(ids(resp)).not.toContain('idg7ObsLo');
  });
});
