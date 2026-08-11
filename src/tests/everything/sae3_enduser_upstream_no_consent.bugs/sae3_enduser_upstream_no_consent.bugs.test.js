// ============================================================================
// SEC-1580 SAE-3 (mongo-only; no ClickHouse) — resolved by product decision.
//
// Finding: an end-user token carries a wildcard access scope (`access/*.*`),
// so no tenant filter applies to it, and both patient-scope resource search
// (e.g. Observation?patient=Patient/person.<id>) and $everything expansion
// walk the person's links into PROA/IAS upstream records with no Consent
// present at all.
//
// Product decision: a person's own end-user token IS entitled to its own
// upstream (PROA/IAS) data without a Consent record -- Consent governs
// third-party client access, not the person's own access to their own linked
// records. This file asserts that confirmed behavior rather than documenting
// a gap.
//
// Setup: personA links to its own patient plus a PROA patient and an IAS
// patient (upstream sources), each with its own Observation. A client
// service-account caller with no Consent still correctly gets none of the
// upstream data (control) -- the relevant distinction is end-user vs.
// service-account, not presence/absence of a Consent for the end user.
// ============================================================================
const { commonBeforeEach, commonAfterEach, getHeaders, getHeadersWithCustomPayload, createTestRequest } = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

const OWNER = 'https://www.icanbwell.com/owner';
const ACCESS = 'https://www.icanbwell.com/access';
const CONNTYPE = 'https://www.icanbwell.com/connectionType';

function sec (owner, accessCodes, connectionType) {
    const tags = [{ system: OWNER, code: owner }];
    for (const a of accessCodes) tags.push({ system: ACCESS, code: a });
    if (connectionType) tags.push({ system: CONNTYPE, code: connectionType });
    return tags;
}

const ownA = { resourceType: 'Patient', id: 'sae3OwnA', meta: { source: 'tenanta', security: sec('tenanta', ['tenanta']) }, gender: 'female', birthDate: '1985-06-15' };
const proaPatient = { resourceType: 'Patient', id: 'sae3Proa', meta: { source: 'proasrc', security: sec('proasrc', ['proasrc'], 'proa') }, gender: 'female', birthDate: '1985-06-15' };
const iasPatient = { resourceType: 'Patient', id: 'sae3Ias', meta: { source: 'iassrc', security: sec('iassrc', ['iassrc'], 'ias') }, gender: 'female', birthDate: '1985-06-15' };

const obsOwnA = { resourceType: 'Observation', id: 'sae3ObsOwnA', meta: { source: 'tenanta', security: sec('tenanta', ['tenanta']) }, status: 'final', code: { coding: [{ system: 'http://loinc.org', code: '29463-7' }] }, subject: { reference: 'Patient/sae3OwnA' } };
const obsProa = { resourceType: 'Observation', id: 'sae3ObsProa', meta: { source: 'proasrc', security: sec('proasrc', ['proasrc'], 'proa') }, status: 'final', code: { coding: [{ system: 'http://loinc.org', code: '29463-7' }] }, subject: { reference: 'Patient/sae3Proa' } };
const obsIas = { resourceType: 'Observation', id: 'sae3ObsIas', meta: { source: 'iassrc', security: sec('iassrc', ['iassrc'], 'ias') }, status: 'final', code: { coding: [{ system: 'http://loinc.org', code: '29463-7' }] }, subject: { reference: 'Patient/sae3Ias' } };

const personA = {
    resourceType: 'Person', id: 'sae3PersonA', meta: { source: 'tenanta', security: sec('tenanta', ['tenanta']) },
    link: [
        { target: { reference: 'Patient/sae3OwnA|tenanta', type: 'Patient' }, assurance: 'level4' },
        { target: { reference: 'Patient/sae3Proa|proasrc', type: 'Patient' }, assurance: 'level4' },
        { target: { reference: 'Patient/sae3Ias|iassrc', type: 'Patient' }, assurance: 'level4' }
    ]
};

const all = [ownA, proaPatient, iasPatient, obsOwnA, obsProa, obsIas, personA];

const serviceHeadersA = { ...getHeaders('user/*.read access/tenanta.*'), prefer: 'global_id=false' };
const wildcardHeaders = { ...getHeaders('user/*.read access/*.*'), prefer: 'global_id=false' };
// Patient-scoped self-lookup (personToPatientIdsExpander.js) now resolves a caller's own Person
// strictly by _uuid, not by the plain source id clientFhirPersonId/bwellFhirPersonId would carry
// here otherwise -- use personA's real _uuid (uuidv5('sae3PersonA|tenanta'), since its
// sourceAssigningAuthority falls back to its owner tag), mirroring a real client-issued identity
// token.
const SAE3_PERSON_A_UUID = '70c03606-e670-5000-9250-6b35420367ec';
const endUserHeaders = {
    ...getHeadersWithCustomPayload({
        scope: 'access/*.* user/*.* patient/*.*',
        username: 'sae3-end-user@example.com',
        clientFhirPersonId: SAE3_PERSON_A_UUID,
        clientFhirPatientId: 'sae3ClientPatient',
        bwellFhirPersonId: SAE3_PERSON_A_UUID,
        bwellFhirPatientId: 'sae3BwellPatient',
        managingOrganization: 'tenanta',
        token_use: 'access'
    }),
    prefer: 'global_id=false'
};

const ids = (resp) => {
    const b = resp && resp.body;
    if (!b) return [];
    if (Array.isArray(b)) return b.map((x) => x && x.id).filter(Boolean);
    if (b.entry) return b.entry.map((e) => e.resource && e.resource.id).filter(Boolean);
    if (b.id) return [b.id];
    return [];
};

describe('D-SAE3 — a person\'s own end-user token reaches linked upstream data without a Consent, by design', () => {
    beforeEach(async () => { await commonBeforeEach(); });
    afterEach(async () => { await commonAfterEach(); });

    test('control: the upstream records exist and are linked to this person', async () => {
        const request = await createTestRequest();
        await request.post('/4_0_0/Person/1/$merge').send(all).set(getHeaders());
        const resp = await request.get('/4_0_0/Person/sae3PersonA/$everything').set(wildcardHeaders);
        expect(resp.status).toBe(200);
        expect(ids(resp)).toContain('sae3Proa');
        expect(ids(resp)).toContain('sae3Ias');
    });

    test('control: a client service account with no consent does NOT get the upstream data', async () => {
        const request = await createTestRequest();
        await request.post('/4_0_0/Person/1/$merge').send(all).set(getHeaders());
        const resp = await request.get('/4_0_0/Person/sae3PersonA/$everything').set(serviceHeadersA);
        expect(ids(resp)).not.toContain('sae3Proa');
    });

    test('EXPECTED: a patient-scope end user gets all linked Observations, including upstream PROA/IAS, without a Consent', async () => {
        const request = await createTestRequest();
        await request.post('/4_0_0/Person/1/$merge').send(all).set(getHeaders());
        const resp = await request.get('/4_0_0/Observation?patient=Patient/person.sae3PersonA').set(endUserHeaders);
        expect(resp.status).toBe(200);
        const got = ids(resp);
        expect(got).toContain('sae3ObsOwnA');
        expect(got).toContain('sae3ObsProa');
        expect(got).toContain('sae3ObsIas');
    });

    test('EXPECTED: a patient-scope end user gets all linked resources, including upstream PROA/IAS, on $everything without a Consent', async () => {
        const request = await createTestRequest();
        await request.post('/4_0_0/Person/1/$merge').send(all).set(getHeaders());
        const resp = await request.get('/4_0_0/Person/sae3PersonA/$everything').set(endUserHeaders);
        expect(resp.status).toBe(200);
        const got = ids(resp);
        expect(got).toContain('sae3OwnA');
        expect(got).toContain('sae3Proa');
        expect(got).toContain('sae3Ias');
    });
});
