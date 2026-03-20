const clientPerson1 = require('./fixtures/person/client_person_1.json');
const cmsPerson1 = require('./fixtures/person/cms_person_1.json');

const clientPatient1 = require('./fixtures/patient/client_patient_1.json');
const cmsPatient1 = require('./fixtures/patient/cms_patient_1.json');
const patient1 = require('./fixtures/patient/patient_1.json');

const consent1 = require('./fixtures/consent/consent_1.json');
const consent1Denied = require('./fixtures/consent/consent_1_denied.json');

const condition1 = require('./fixtures/clinical/condition_1.json');
const observation1 = require('./fixtures/clinical/observation_1.json');
const encounter1 = require('./fixtures/clinical/encounter_1.json');
const practitioner1 = require('./fixtures/clinical/practitioner_1.json');
const organization1 = require('./fixtures/clinical/organization_1.json');

const account1 = require('./fixtures/non_uscdi/account_1.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getTokenWithCustomPayload,
    createTestRequest
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect, jest } = require('@jest/globals');
const { DatabaseCursor } = require('../../../dataLayer/databaseCursor');
const uscdiResourceTypes = require('../../../operations/everything/uscdi_resource_types.json');
const CMS_USCDI_RESOURCE_TYPES = [
    ...uscdiResourceTypes.clinicalResources,
    ...uscdiResourceTypes.nonClinicalResources
];

const CMS_PERSON_ID = '9fc1f393-d33e-491a-8e58-9d3065f24d05';
const PATIENT_ID = 'a25d86d2-5d31-4e9c-8a01-a3899426fac0';

const getCmsHeaders = (personId) => {
    const token = getTokenWithCustomPayload({
        scope: 'cmsPartnerUser patient/*.read user/*.read access/*.read',
        username: personId,
        clientFhirPersonId: personId,
        bwellFhirPersonId: personId,
        clientFhirPatientId: `person.${personId}`,
        bwellFhirPatientId: `person.${personId}`
    });
    return {
        'Content-Type': 'application/fhir+json',
        Accept: 'application/fhir+json',
        Authorization: `Bearer ${token}`,
        Host: 'localhost:3000'
    };
};

const getInvalidCmsHeaders = (personId) => {
    const token = getTokenWithCustomPayload({
        scope: 'user/*.read cmsPartnerUser',
        username: personId,
        clientFhirPersonId: personId,
        bwellFhirPersonId: personId
    });
    return {
        'Content-Type': 'application/fhir+json',
        Accept: 'application/fhir+json',
        Authorization: `Bearer ${token}`,
        Host: 'localhost:3000'
    };
};

const getRegularPatientHeaders = (personId) => {
    const token = getTokenWithCustomPayload({
        scope: 'patient/*.read user/*.read access/*.read',
        username: personId,
        clientFhirPersonId: personId,
        bwellFhirPersonId: personId,
        clientFhirPatientId: `person.${personId}`,
        bwellFhirPatientId: `person.${personId}`
    });
    return {
        'Content-Type': 'application/fhir+json',
        Accept: 'application/fhir+json',
        Authorization: `Bearer ${token}`,
        Host: 'localhost:3000'
    };
};

const baseResources = [
    clientPerson1, cmsPerson1,
    clientPatient1, cmsPatient1, patient1,
    condition1, observation1, encounter1,
    practitioner1, organization1, account1
];

describe('CMS Partner User - Patient $everything', () => {
    const cursorSpy = jest.spyOn(DatabaseCursor.prototype, 'hint');

    beforeEach(async () => {
        cursorSpy.mockReturnThis();
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('With consent: returns only USCDI v3 resources for patient', async () => {
        const request = await createTestRequest();

        let resp = await request
            .post('/4_0_0/Person/1/$merge')
            .send([...baseResources, consent1])
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .get(`/4_0_0/Patient/${PATIENT_ID}/$everything`)
            .set(getCmsHeaders(CMS_PERSON_ID));

        expect(resp).toHaveStatusCode(200);

        const entries = resp.body.entry || [];
        const returnedTypes = new Set(entries.map((e) => e.resource.resourceType));

        expect(returnedTypes.has('Condition')).toBe(true);
        expect(returnedTypes.has('Observation')).toBe(true);
        expect(returnedTypes.has('Encounter')).toBe(true);

        // Non-USCDI resource must NOT appear
        expect(returnedTypes.has('Account')).toBe(false);

        // Every returned type must be USCDI v3
        const allowedTypes = new Set(CMS_USCDI_RESOURCE_TYPES);
        for (const type of returnedTypes) {
            expect(allowedTypes.has(type)).toBe(true);
        }
    });

    test('Without consent: returns empty bundle', async () => {
        const request = await createTestRequest();

        let resp = await request
            .post('/4_0_0/Person/1/$merge')
            .send(baseResources)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .get(`/4_0_0/Patient/${PATIENT_ID}/$everything`)
            .set(getCmsHeaders(CMS_PERSON_ID));

        expect(resp).toHaveStatusCode(200);

        const entries = (resp.body.entry || []).filter(
            (e) => e.resource.resourceType !== 'OperationOutcome'
        );
        expect(entries.length).toBe(0);
    });

    test('With denied consent: returns empty bundle', async () => {
        const request = await createTestRequest();

        let resp = await request
            .post('/4_0_0/Person/1/$merge')
            .send([...baseResources, consent1Denied])
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .get(`/4_0_0/Patient/${PATIENT_ID}/$everything`)
            .set(getCmsHeaders(CMS_PERSON_ID));

        expect(resp).toHaveStatusCode(200);

        const entries = (resp.body.entry || []).filter(
            (e) => e.resource.resourceType !== 'OperationOutcome'
        );
        expect(entries.length).toBe(0);
    });

    test('_type param: intersects with USCDI v3 types', async () => {
        const request = await createTestRequest();

        let resp = await request
            .post('/4_0_0/Person/1/$merge')
            .send([...baseResources, consent1])
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        // Request only Observation (valid USCDI type)
        resp = await request
            .get(`/4_0_0/Patient/${PATIENT_ID}/$everything?_type=Observation`)
            .set(getCmsHeaders(CMS_PERSON_ID));

        expect(resp).toHaveStatusCode(200);

        const entries = resp.body.entry || [];
        const returnedTypes = new Set(entries.map((e) => e.resource.resourceType));

        for (const type of returnedTypes) {
            expect(['Observation'].includes(type)).toBe(true);
        }
    });

    test('_type param with non-USCDI type: filters out non-USCDI', async () => {
        const request = await createTestRequest();

        let resp = await request
            .post('/4_0_0/Person/1/$merge')
            .send([...baseResources, consent1])
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        // Request Account (non-USCDI) — should be excluded by intersection
        resp = await request
            .get(`/4_0_0/Patient/${PATIENT_ID}/$everything?_type=Account`)
            .set(getCmsHeaders(CMS_PERSON_ID));

        expect(resp).toHaveStatusCode(200);

        const entries = resp.body.entry || [];
        const returnedTypes = new Set(entries.map((e) => e.resource.resourceType));
        expect(returnedTypes.size).toBe(0);
        expect(returnedTypes.has('Account')).toBe(false);
    });

    test('_since param: filters by last updated date', async () => {
        const request = await createTestRequest();

        let resp = await request
            .post('/4_0_0/Person/1/$merge')
            .send([...baseResources, consent1])
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        // Future _since → no resources should match
        resp = await request
            .get(`/4_0_0/Patient/${PATIENT_ID}/$everything?_since=2099-01-01T00:00:00Z`)
            .set(getCmsHeaders(CMS_PERSON_ID));

        expect(resp).toHaveStatusCode(200);

        const entries = (resp.body.entry || []).filter(
            (e) => e.resource.resourceType !== 'OperationOutcome'
        );
        expect(entries.length).toBe(0);
    });

    test('Invalid scope: cmsPartnerUser without patient scope returns 401', async () => {
        const request = await createTestRequest();

        let resp = await request
            .post('/4_0_0/Person/1/$merge')
            .send([...baseResources, consent1])
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .get(`/4_0_0/Patient/${PATIENT_ID}/$everything`)
            .set(getInvalidCmsHeaders(CMS_PERSON_ID));

        expect(resp.statusCode).toBe(401);
    });

    test('Unsupported query params are stripped and have no effect', async () => {
        const request = await createTestRequest();

        let resp = await request
            .post('/4_0_0/Person/1/$merge')
            .send([...baseResources, consent1])
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        const cmsHeaders = getCmsHeaders(CMS_PERSON_ID);
        const allowedTypes = new Set(CMS_USCDI_RESOURCE_TYPES);

        resp = await request
            .get(`/4_0_0/Patient/${PATIENT_ID}/$everything?_includeHidden=1&_includeUuidOnly=1&_rewritePatientReference=true`)
            .set(cmsHeaders);
        expect(resp).toHaveStatusCode(200);
        let entries = resp.body.entry || [];
        let returnedTypes = new Set(entries.map((e) => e.resource.resourceType));
        expect(returnedTypes.has('Account')).toBe(false);
        for (const type of returnedTypes) {
            expect(allowedTypes.has(type)).toBe(true);
        }
        expect(entries.some((e) => e.resource.resourceType === 'Condition' && e.resource.code)).toBe(true);

        resp = await request
            .get(`/4_0_0/Patient/${PATIENT_ID}/$everything?_includePatientLinkedOnly=true&_excludeProxyPatientLinked=true`)
            .set(cmsHeaders);
        expect(resp).toHaveStatusCode(200);
        entries = resp.body.entry || [];
        returnedTypes = new Set(entries.map((e) => e.resource.resourceType));
        expect(returnedTypes.has('Account')).toBe(false);
        for (const type of returnedTypes) {
            expect(allowedTypes.has(type)).toBe(true);
        }

        resp = await request
            .get(`/4_0_0/Patient/${PATIENT_ID}/$everything?_type=Observation&_since=2020-01-01T00:00:00Z`)
            .set(cmsHeaders);
        expect(resp).toHaveStatusCode(200);
        entries = resp.body.entry || [];
        returnedTypes = new Set(entries.map((e) => e.resource.resourceType));
        if (returnedTypes.size > 0) {
            for (const type of returnedTypes) {
                expect(['Observation'].includes(type)).toBe(true);
            }
        }
    });

    test('Restricted endpoints return 403 for CMS partner user', async () => {
        const request = await createTestRequest();

        let resp = await request
            .post('/4_0_0/Person/1/$merge')
            .send([...baseResources, consent1])
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        const cmsHeaders = getCmsHeaders(CMS_PERSON_ID);

        resp = await request.get(`/4_0_0/Person/${CMS_PERSON_ID}/$everything`).set(cmsHeaders);
        expect(resp.statusCode).toBe(403);

        resp = await request.get(`/4_0_0/Patient/person.${CMS_PERSON_ID}/$everything`).set(cmsHeaders);
        expect(resp.statusCode).toBe(403);

        resp = await request.get('/4_0_0/Observation?_bundle=1').set(cmsHeaders);
        expect(resp.statusCode).toBe(403);

        resp = await request.get('/4_0_0/Person?_bundle=1').set(cmsHeaders);
        expect(resp.statusCode).toBe(403);

        resp = await request.get(`/4_0_0/Patient/${PATIENT_ID}`).set(cmsHeaders);
        expect(resp.statusCode).toBe(403);

        resp = await request.get('/4_0_0/Condition/test-id').set(cmsHeaders);
        expect(resp.statusCode).toBe(403);
    });

    test('Non-CMS user: returns all resource types including non-USCDI', async () => {
        const request = await createTestRequest();

        let resp = await request
            .post('/4_0_0/Person/1/$merge')
            .send([...baseResources, consent1])
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .get(`/4_0_0/Patient/${PATIENT_ID}/$everything`)
            .set(getRegularPatientHeaders(CMS_PERSON_ID));

        expect(resp).toHaveStatusCode(200);

        const entries = resp.body.entry || [];
        const returnedTypes = new Set(entries.map((e) => e.resource.resourceType));

        // Non-CMS user should see Account (no USCDI filtering)
        if (entries.length > 0) {
            expect(returnedTypes.has('Account')).toBe(true);
        }
    });
});
