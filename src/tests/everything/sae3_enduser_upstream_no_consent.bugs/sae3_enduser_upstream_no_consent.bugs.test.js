// ============================================================================
// FAIL-BY-DESIGN security test — SEC-1580 SAE-3 (mongo-only; no ClickHouse).
// Gap: an end-user token carries a wildcard access scope (`access/*.*`), so no
// tenant filter applies to it, and patient-scope expansion walks the person's
// links into PROA/IAS upstream records with no Consent present at all.
//
// NOTE (product decision needed, same caveat as the source finding this was
// extracted from): the user may be entitled to their own upstream data, in
// which case consent should govern client access only and this test should be
// deleted rather than fixed. Until that's decided it stays here as the strict
// reading: no Consent, no upstream data, for any caller type including the
// person's own end-user token.
//
// Setup: personA links to its own patient plus a PROA patient and an IAS
// patient (upstream sources), each with its own Observation. A service-account
// caller with no Consent correctly gets none of the upstream data (control).
// An end-user token scoped to personA itself must be held to the same rule.
//
// Asserts the SECURE outcome; if the end user reaches the upstream data, this
// FAILS. *.bugs, excluded from default CI.
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
const endUserHeaders = {
    ...getHeadersWithCustomPayload({
        scope: 'access/*.* user/*.* patient/*.*',
        username: 'sae3-end-user@example.com',
        clientFhirPersonId: 'sae3PersonA',
        clientFhirPatientId: 'sae3ClientPatient',
        bwellFhirPersonId: 'sae3PersonA',
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

describe('D-SAE3 (fail-by-design) — an end user reaches linked upstream data with no Consent', () => {
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

    test('SECURE (fails until SAE-3 enforced): an end user gets no upstream records without a Consent', async () => {
        const request = await createTestRequest();
        await request.post('/4_0_0/Person/1/$merge').send(all).set(getHeaders());
        const resp = await request.get('/4_0_0/Observation?patient=Patient/person.sae3PersonA').set(endUserHeaders);
        expect(resp.status).toBe(200);
        const got = ids(resp);
        expect(got).not.toContain('sae3ObsProa');
        expect(got).not.toContain('sae3ObsIas');
    });

    test('SECURE (fails until SAE-3 enforced): the same holds on $everything for an end user', async () => {
        const request = await createTestRequest();
        await request.post('/4_0_0/Person/1/$merge').send(all).set(getHeaders());
        const resp = await request.get('/4_0_0/Person/sae3PersonA/$everything').set(endUserHeaders);
        const got = ids(resp);
        expect(got).not.toContain('sae3Proa');
        expect(got).not.toContain('sae3Ias');
    });
});
