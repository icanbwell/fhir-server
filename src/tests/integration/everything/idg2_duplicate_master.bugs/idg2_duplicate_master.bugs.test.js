// ============================================================================
// FAIL-BY-DESIGN security test — SEC-1580 D-IDG2 / spec IDG-2 (mongo-only; no ClickHouse).
// Rule: a Person.link hop where source and target share the SAME owner tag (a duplicate /
// erroneous "master" of the same human) must be a traversal DEAD END — the other master's
// patients must not be pulled into this person's aggregate view.
//
// Setup: masterA and masterB are both owner=bwell (a duplicate-master pair) and linked to
// each other; each master links down to its own client Person -> Patient (+Observation),
// both owned by tenant A. Querying from masterA must return masterA's own patient's data,
// NOT masterB's (that hop is same-owner and should be a dead end).
//
// Asserts the SECURE outcome; if the same-owner hop is followed, masterB's Observation
// is returned and this FAILS. *.bugs, excluded from default CI.
// ============================================================================
const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

const bwell = c => [{system:'https://www.icanbwell.com/owner',code:'bwell'}];
const ta = () => [
  {system:'https://www.icanbwell.com/owner',code:'tenanta'},
  {system:'https://www.icanbwell.com/access',code:'tenanta'}
];
const masterA = { resourceType:'Person', id:'idg2MasterA', meta:{source:'bwell',security:bwell()},
  link:[ {target:{reference:'Person/idg2ClientA|tenanta',type:'Person'},assurance:'level4'},
         {target:{reference:'Person/idg2MasterB|bwell',type:'Person'},assurance:'level4'} ] }; // same-owner dup hop
const masterB = { resourceType:'Person', id:'idg2MasterB', meta:{source:'bwell',security:bwell()},
  link:[ {target:{reference:'Person/idg2ClientB|tenanta',type:'Person'},assurance:'level4'} ] };
const clientA = { resourceType:'Person', id:'idg2ClientA', meta:{source:'tenanta',security:ta()},
  link:[ {target:{reference:'Patient/idg2PatA',type:'Patient'},assurance:'level4'} ] };
const clientB = { resourceType:'Person', id:'idg2ClientB', meta:{source:'tenanta',security:ta()},
  link:[ {target:{reference:'Patient/idg2PatB',type:'Patient'},assurance:'level4'} ] };
const patA = { resourceType:'Patient', id:'idg2PatA', meta:{source:'tenanta',security:ta()}, gender:'male', birthDate:'1991-03-14' };
const patB = { resourceType:'Patient', id:'idg2PatB', meta:{source:'tenanta',security:ta()}, gender:'male', birthDate:'1991-03-14' };
const obsA = { resourceType:'Observation', id:'idg2ObsA', meta:{source:'tenanta',security:ta()}, status:'final', code:{coding:[{system:'http://loinc.org',code:'1'}]}, subject:{reference:'Patient/idg2PatA'} };
const obsB = { resourceType:'Observation', id:'idg2ObsB', meta:{source:'tenanta',security:ta()}, status:'final', code:{coding:[{system:'http://loinc.org',code:'1'}]}, subject:{reference:'Patient/idg2PatB'} };

const headers = { ...getHeaders('user/*.read access/tenanta.*'), prefer:'global_id=false' };
const ids = r => {
  const b = r && r.body;
  if (!b) return [];
  if (Array.isArray(b)) return b.map(x=>x&&x.id).filter(Boolean);
  if (b.entry) return b.entry.map(e=>e.resource&&e.resource.id).filter(Boolean);
  if (b.id) return [b.id];
  return [];
};
const all = [masterA,masterB,clientA,clientB,patA,patB,obsA,obsB];

describe('D-IDG2 (fail-by-design) — same-owner duplicate-master link is a dead end', () => {
  beforeEach(async()=>{ await commonBeforeEach(); });
  afterEach(async()=>{ await commonAfterEach(); });

  test('control: ClientA reaches its own patient A data', async () => {
    const request = await createTestRequest();
    await request.post('/4_0_0/Person/1/$merge').send(all).set(getHeaders());
    const r = await request.get('/4_0_0/Observation?patient=Patient/person.idg2ClientA').set(headers);
    expect(ids(r)).toContain('idg2ObsA');
  });

  test('SECURE (fails until IDG-2 enforced): masterA must NOT reach masterB\'s patient via the same-owner hop', async () => {
    const request = await createTestRequest();
    await request.post('/4_0_0/Person/1/$merge').send(all).set(getHeaders());
    const r = await request.get('/4_0_0/Observation?patient=Patient/person.idg2MasterA').set(headers);
    expect(ids(r)).not.toContain('idg2ObsB');
  });

  test('masterA cannot be reached via ClientA (traversal must not go upward from client to master)', async () => {
    const request = await createTestRequest();
    await request.post('/4_0_0/Person/1/$merge').send(all).set(getHeaders());
    const r = await request.get(`/4_0_0/Person/${clientA.id}/$everything`).set(headers);
    const found = ids(r);
    expect(found).not.toContain('idg2MasterA');
    expect(found).not.toContain('idg2MasterB');
    expect(found).not.toContain('idg2ObsB');
  });
});
