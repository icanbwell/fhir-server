const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getTokenWithCustomPayload,
    createTestRequest
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

const cmsPatient1 = require('./fixtures/patient/cms_patient_1.json');
const cmsPerson1 = require('./fixtures/person/cms_person_1.json');

const CMS_PERSON_ID = cmsPerson1.id;
const CMS_PATIENT_ID = cmsPatient1.id;

const buildCmsHeaders = ({ purposeOfUse } = {}) => {
    const payload = {
        scope: 'patient/*.read user/*.read access/*.read',
        user_type: 'cms-partner',
        username: CMS_PERSON_ID,
        clientFhirPersonId: CMS_PERSON_ID,
        bwellFhirPersonId: CMS_PERSON_ID,
        clientFhirPatientId: `person.${CMS_PERSON_ID}`,
        bwellFhirPatientId: `person.${CMS_PERSON_ID}`,
        managingOrganization: 'bwell'
    };
    if (purposeOfUse !== undefined) {
        payload.entitlements = purposeOfUse;
    }
    return {
        'Content-Type': 'application/fhir+json',
        Accept: 'application/fhir+json',
        Authorization: `Bearer ${getTokenWithCustomPayload(payload)}`,
        Host: 'localhost:3000'
    };
};

describe('CMS partner user — purposeOfUse allowlist enforcement', () => {
    const originalEnv = process.env.CMS_ALLOWED_PURPOSE_OF_USE;

    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        if (originalEnv === undefined) {
            delete process.env.CMS_ALLOWED_PURPOSE_OF_USE;
        } else {
            process.env.CMS_ALLOWED_PURPOSE_OF_USE = originalEnv;
        }
        await commonAfterEach();
    });

    const seed = async (request) => {
        const resp = await request
            .post('/4_0_0/Person/1/$merge')
            .send([cmsPerson1, cmsPatient1])
            .set(getHeaders());
        expect(resp).toHaveStatusCode(200);
    };

    test('allows CMS request when all purposeOfUse codes are in the allowlist', async () => {
        process.env.CMS_ALLOWED_PURPOSE_OF_USE = 'TREAT,HPAYMT';
        const request = await createTestRequest();
        await seed(request);

        const resp = await request
            .get(`/4_0_0/Patient/${CMS_PATIENT_ID}/$everything`)
            .set(buildCmsHeaders({ purposeOfUse: ['TREAT'] }));
        expect(resp).toHaveStatusCode(200);
    });

    test('allows CMS request when purposeOfUse matches the allowlist exactly', async () => {
        process.env.CMS_ALLOWED_PURPOSE_OF_USE = 'TREAT,HPAYMT';
        const request = await createTestRequest();
        await seed(request);

        const resp = await request
            .get(`/4_0_0/Patient/${CMS_PATIENT_ID}/$everything`)
            .set(buildCmsHeaders({ purposeOfUse: ['TREAT', 'HPAYMT'] }));
        expect(resp).toHaveStatusCode(200);
    });

    test('rejects CMS request with 403 when any purposeOfUse code is outside the allowlist', async () => {
        process.env.CMS_ALLOWED_PURPOSE_OF_USE = 'TREAT';
        const request = await createTestRequest();
        await seed(request);

        const resp = await request
            .get(`/4_0_0/Patient/${CMS_PATIENT_ID}/$everything`)
            .set(buildCmsHeaders({ purposeOfUse: ['TREAT', 'HRESCH'] }));
        expect(resp).toHaveStatusCode(403);
    });

    test('rejects CMS request with 403 when purposeOfUse claim is absent', async () => {
        process.env.CMS_ALLOWED_PURPOSE_OF_USE = 'TREAT';
        const request = await createTestRequest();
        await seed(request);

        const resp = await request
            .get(`/4_0_0/Patient/${CMS_PATIENT_ID}/$everything`)
            .set(buildCmsHeaders({}));
        expect(resp).toHaveStatusCode(403);
    });

    test('rejects CMS request with 403 when purposeOfUse claim is an empty array', async () => {
        process.env.CMS_ALLOWED_PURPOSE_OF_USE = 'TREAT';
        const request = await createTestRequest();
        await seed(request);

        const resp = await request
            .get(`/4_0_0/Patient/${CMS_PATIENT_ID}/$everything`)
            .set(buildCmsHeaders({ purposeOfUse: [] }));
        expect(resp).toHaveStatusCode(403);
    });

    test('rejects CMS request with 403 when CMS_ALLOWED_PURPOSE_OF_USE env var is unset', async () => {
        delete process.env.CMS_ALLOWED_PURPOSE_OF_USE;
        const request = await createTestRequest();
        await seed(request);

        const resp = await request
            .get(`/4_0_0/Patient/${CMS_PATIENT_ID}/$everything`)
            .set(buildCmsHeaders({ purposeOfUse: ['TREAT'] }));
        expect(resp).toHaveStatusCode(403);
    });

    test('rejects CMS request with 403 when CMS_ALLOWED_PURPOSE_OF_USE env var is empty string', async () => {
        process.env.CMS_ALLOWED_PURPOSE_OF_USE = '';
        const request = await createTestRequest();
        await seed(request);

        const resp = await request
            .get(`/4_0_0/Patient/${CMS_PATIENT_ID}/$everything`)
            .set(buildCmsHeaders({ purposeOfUse: ['TREAT'] }));
        expect(resp).toHaveStatusCode(403);
    });

    test('does not affect non-CMS users when purposeOfUse check fails', async () => {
        delete process.env.CMS_ALLOWED_PURPOSE_OF_USE;
        const request = await createTestRequest();
        await seed(request);

        const resp = await request
            .get(`/4_0_0/Patient/${CMS_PATIENT_ID}/$everything`)
            .set(getHeaders());
        expect(resp).toHaveStatusCode(200);
    });

    test('returns generic "User does not have valid permission" message for all purposeOfUse rejections', async () => {
        process.env.CMS_ALLOWED_PURPOSE_OF_USE = 'TREAT';
        const request = await createTestRequest();
        await seed(request);

        const resp = await request
            .get(`/4_0_0/Patient/${CMS_PATIENT_ID}/$everything`)
            .set(buildCmsHeaders({ purposeOfUse: ['HRESCH'] }));
        expect(resp).toHaveStatusCode(403);
        const bodyString = JSON.stringify(resp.body);
        expect(bodyString).not.toContain('HRESCH');
        expect(bodyString).toContain('User does not have valid permission');
    });
});
