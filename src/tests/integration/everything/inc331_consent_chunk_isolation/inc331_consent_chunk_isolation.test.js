// ============================================================================
// INC-331 REGRESSION (mongo-only; NO ClickHouse) — spec IDG-6 / CACHE-2.
// The incident: $everything slices a person's linked patients into chunks of
// everythingBatchSize (default 10); the consent-allowed-patient set was cached by
// requestId and reused across chunks, so chunk 2+ lost patient scoping and returned ALL
// proa/ias patients. Fixed in DCON-4598 (per-chunk cache keying).
//
// This builds a client Person linked to 12 PROA patients (> batch size) under a valid
// consent, plus an unrelated PROA "trap" patient from a different source (not linked, not
// consented). Secure outcome: the client's own consented data returns, the trap NEVER
// does. If the INC-331 bug regressed, the trap would leak and the security test FAILS.
//
// Runs in the standard mongo harness by neutralizing the forced consent-index hint the
// same way the repo's own data_sharing/consented_data suites do:
//   jest.spyOn(DatabaseCursor.prototype, 'hint').mockReturnThis()
// ============================================================================
const deepcopy = require('deepcopy');
const masterPerson = require('../../consented_data/consented_data/fixtures/person/master_person.json');
const clientPerson = require('../../consented_data/consented_data/fixtures/person/client_person.json');
const masterPatient = require('../../consented_data/consented_data/fixtures/patient/master_patient.json');
const clientPatient = require('../../consented_data/consented_data/fixtures/patient/client_patient.json');
const proaPatient = require('../../consented_data/consented_data/fixtures/patient/proa_patient.json');
const proaObs = require('../../consented_data/consented_data/fixtures/observation/proa_observation.json');
const consentGiven = require('../../consented_data/consented_data/fixtures/consent/consent_given.json');

const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../../common');
const { describe, beforeEach, afterEach, test, jest, expect } = require('@jest/globals');
const { DatabaseCursor } = require('../../../../dataLayer/databaseCursor');

const CLIENT_PERSON_ID = 'c12345';
const EXTRA = 12; // > everythingBatchSize (10) -> forces multiple chunks

function build() {
    const cp = deepcopy(clientPerson);
    const patients = [], observations = [];
    for (let i = 0; i < EXTRA; i++) {
        const pid = `inc331proagen-${String(i).padStart(2, '0')}`;
        const p = deepcopy(proaPatient); p.id = pid;
        const o = deepcopy(proaObs); o.id = `inc331proaobs-${String(i).padStart(2, '0')}`; o.subject = { reference: `Patient/${pid}` };
        patients.push(p); observations.push(o);
        cp.link.push({ target: { reference: `Patient/${pid}|proa`, type: 'Patient' }, assurance: 'level4' });
    }
    // trap: a PROA patient from a DIFFERENT source, NOT linked to this person, NOT consented.
    const trapP = deepcopy(proaPatient); trapP.id = 'inc331trap-proa2';
    trapP.meta.security = [
        { system: 'https://www.icanbwell.com/owner', code: 'proa2' },
        { system: 'https://www.icanbwell.com/access', code: 'proa2' },
        { system: 'https://www.icanbwell.com/connectionType', code: 'proa' }
    ];
    const trapO = deepcopy(proaObs); trapO.id = 'inc331trap-obs'; trapO.subject = { reference: 'Patient/inc331trap-proa2' };
    trapO.meta.security = [...trapP.meta.security];
    return { cp, patients, observations, trapP, trapO };
}

const headers = { ...getHeaders('user/*.read access/client.*'), prefer: 'global_id=false' };
const idsIn = resp => ((resp.body && resp.body.entry) || []).map(e => e.resource && e.resource.id).filter(Boolean);

describe('INC-331 regression — consent set must be scoped per $everything chunk', () => {
    const spy = jest.spyOn(DatabaseCursor.prototype, 'hint');
    beforeEach(async () => { spy.mockReturnThis(); await commonBeforeEach(); });
    afterEach(async () => { await commonAfterEach(); });

    async function seedAndQuery() {
        const { cp, patients, observations, trapP, trapO } = build();
        const request = await createTestRequest();
        const merge = await request.post('/4_0_0/Person/1/$merge')
            .send([masterPerson, cp, masterPatient, clientPatient, proaPatient, proaObs, ...patients, ...observations, trapP, trapO, consentGiven])
            .set(getHeaders());
        expect(merge).toHaveMergeResponse({ created: true });
        const resp = await request.get(`/4_0_0/Person/${CLIENT_PERSON_ID}/$everything`).set(headers);
        return { resp, trapP, trapO };
    }

    test('positive control: the client\'s own consented PROA data is returned across the chunk boundary', async () => {
        const { resp } = await seedAndQuery();
        expect(resp.status).toBe(200);
        const ids = idsIn(resp);
        expect(ids.some(id => id.startsWith('inc331proaobs-'))).toBe(true);
    });

    test('SECURE: an unrelated PROA patient/observation from another source is NEVER returned', async () => {
        const { resp, trapP, trapO } = await seedAndQuery();
        const ids = idsIn(resp);
        expect(ids).not.toContain(trapP.id);
        expect(ids).not.toContain(trapO.id);
    });
});
