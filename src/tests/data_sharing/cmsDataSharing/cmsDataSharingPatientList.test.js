// CMS Data Sharing test for Patient list operation using patient-scoped access

const person1Resource = require('./fixtures/person/person_1.json');
const person2Resource = require('./fixtures/person/person_2.json');
const person3Resource = require('./fixtures/person/person_3.json');
const person4Resource = require('./fixtures/person/person_4.json');
const person5Resource = require('./fixtures/person/person_5.json');

const patient1Resource = require('./fixtures/patient/patient_1.json');
const patient2Resource = require('./fixtures/patient/patient_2.json');
const patient3Resource = require('./fixtures/patient/patient_3.json');
const patient4Resource = require('./fixtures/patient/patient_4.json');
const patient5Resource = require('./fixtures/patient/patient_5.json');

const consent2Resource = require('./fixtures/consent/consent_2.json');
const consent5Resource = require('./fixtures/consent/consent_5.json');
const consent2DeniedResource = require('./fixtures/consent/consent_2_denied.json');

const expectedPatientListNoConsentResponse = require('./fixtures/expected/expected_patient_list_no_consent.json');
const expectedPatientListConsent2Response = require('./fixtures/expected/expected_patient_list_consent_2.json');
const expectedPatientListConsent2And5Response = require('./fixtures/expected/expected_patient_list_consent_2_and_5.json');
const expectedPatientListConsent2And5ProxyResponse = require('./fixtures/expected/expected_proxy_patient_list_consent_2_and_5.json');
const expectedPatientListConsent2DeniedResponse = require('./fixtures/expected/expected_patient_list_consent_2_denied.json');
const expectedPatientListConsent2ResponseIdFilter = require('./fixtures/expected/expected_patient_list_consent_2_id_filter.json');
const expectedPatientListNoConsentResponseIdFilter = require('./fixtures/expected/expected_patient_list_no_consent_id_filter.json');

const organizationCms = require('./fixtures/organization/organization_cms.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getTokenWithCustomPayload,
    createTestRequest
} = require('../../common');
const { describe, beforeEach, afterEach, test, jest, expect } = require('@jest/globals');
const { DatabaseCursor } = require('../../../dataLayer/databaseCursor');

const PERSON_ID_1 = '08f1b73a-e27c-456d-8a61-277f164a9a57-1';
const PATIENT_ID_2 = '08f1b73a-e27c-456d-8a61-277f164a9a57-2';
const PATIENT_ID_3 = '08f1b73a-e27c-456d-8a61-277f164a9a57-3';

// Helper to create CMS partner user headers with patient scope
const getCmsHeaders = (personId) => {
    const token = getTokenWithCustomPayload({
        scope: 'patient/*.read user/*.read access/*.read',
        username: personId,
        clientFhirPersonId: personId,
        bwellFhirPersonId: personId,
        clientFhirPatientId: `person.${personId}`,
        bwellFhirPatientId: `person.${personId}`,
        managingOrganization: organizationCms.id
    });
    return {
        'Content-Type': 'application/fhir+json',
        Accept: 'application/fhir+json',
        Authorization: `Bearer ${token}`,
        Host: 'localhost:3000'
    };
};

// Helper to create invalid scope headers (cmsPartnerUser without patient scope)
const getInvalidCmsHeaders = (personId) => {
    const token = getTokenWithCustomPayload({
        scope: 'user/*.read',
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

describe('CMS Data Sharing - Patient List with cmsPartnerUser', () => {
    const cursorSpy = jest.spyOn(DatabaseCursor.prototype, 'hint');

    beforeEach(async () => {
        cursorSpy.mockReturnThis();
        process.env.ENABLE_USER_TYPE_RESOLUTION_FROM_ORGANIZATION = 'true';
        await commonBeforeEach();
    });

    afterEach(async () => {
        delete process.env.ENABLE_USER_TYPE_RESOLUTION_FROM_ORGANIZATION;
        await commonAfterEach();
    });

    test('Without patient scope: treated as regular user, not CMS', async () => {
        const request = await createTestRequest();

        // Add all persons and patients
        let resp = await request
            .post('/4_0_0/Person/1/$merge')
            .send([
                person1Resource,
                person2Resource,
                person3Resource,
                person4Resource,
                person5Resource,
                patient1Resource,
                patient2Resource,
                patient3Resource,
                patient4Resource,
                patient5Resource,
                organizationCms
            ])
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        // Query with non-patient scope and no access scope - should be forbidden
        resp = await request.get('/4_0_0/Patient?_bundle=1&_count=100').set(getInvalidCmsHeaders(PERSON_ID_1));

        expect(resp).toHaveStatusCode(403);
    });

    test('Patient list without consent: Should return 0 patients', async () => {
        const request = await createTestRequest();

        // Add persons and patients without consent
        let resp = await request
            .post('/4_0_0/Person/1/$merge')
            .send([
                person1Resource,
                person2Resource,
                person3Resource,
                person4Resource,
                person5Resource,
                patient1Resource,
                patient2Resource,
                patient3Resource,
                patient4Resource,
                patient5Resource,
                organizationCms
            ])
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        // Query as person-1 without any consent
        resp = await request.get('/4_0_0/Patient?_bundle=1&_count=100&_debug=1').set(getCmsHeaders(PERSON_ID_1));

        // Should return empty results (CMS returns { id: '__invalid__' } when no consent)
        expect(resp).toHaveStatusCode(200);
        expect(resp).toHaveResponse(expectedPatientListNoConsentResponse);
    });

    test('Patient list with consent 2: Should return 1 patient (person-2)', async () => {
        const request = await createTestRequest();

        // Add persons, patients, and consent for person-2
        let resp = await request
            .post('/4_0_0/Person/1/$merge')
            .send([
                person1Resource,
                person2Resource,
                person3Resource,
                person4Resource,
                person5Resource,
                patient1Resource,
                patient2Resource,
                patient3Resource,
                patient4Resource,
                patient5Resource,
                consent2Resource,
                organizationCms
            ])
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        // Query as person-1 with consent to person-2
        resp = await request.get('/4_0_0/Patient?_bundle=1&_count=100').set(getCmsHeaders(PERSON_ID_1));

        // Should return only patient-2 (via consent)
        expect(resp).toHaveStatusCode(200);
        expect(resp).toHaveResponse(expectedPatientListConsent2Response);
    });

    test('Patient list with consents 2 & 5: Should return 2 patients', async () => {
        const request = await createTestRequest((c) => {
            return c;
        });

        // Add persons, patients, and consents for person-2 and person-5
        let resp = await request
            .post('/4_0_0/Person/1/$merge')
            .send([
                person1Resource,
                person2Resource,
                person3Resource,
                person4Resource,
                person5Resource,
                patient1Resource,
                patient2Resource,
                patient3Resource,
                patient4Resource,
                patient5Resource,
                consent2Resource,
                consent5Resource,
                organizationCms
            ])
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        // Query as person-1 with consent to person-2 and person-5
        resp = await request.get('/4_0_0/Patient?_bundle=1&_count=100&_debug=1').set(getCmsHeaders(PERSON_ID_1));

        // Should return patient-2 and patient-5 (via consents)
        expect(resp).toHaveStatusCode(200);
        expect(resp).toHaveResponse(expectedPatientListConsent2And5Response);

        // Query as person-1 with consent to person-2 and person-5 with proxy patient id
        resp = await request.get(`/4_0_0/Patient?_bundle=1&_count=100&_debug=1&id=person.${PERSON_ID_1}`).set(getCmsHeaders(PERSON_ID_1));

        // Should return patient-2 and patient-5 (via consents)
        expect(resp).toHaveStatusCode(200);
        expect(resp).toHaveResponse(expectedPatientListConsent2And5ProxyResponse);
    });

    test('Patient list with consent denied: Should return 0 patients', async () => {
        const request = await createTestRequest((c) => {
            return c;
        });

        // Add persons, patients, and denied consent
        let resp = await request
            .post('/4_0_0/Person/1/$merge')
            .send([
                person1Resource,
                person2Resource,
                person3Resource,
                person4Resource,
                person5Resource,
                patient1Resource,
                patient2Resource,
                patient3Resource,
                patient4Resource,
                patient5Resource,
                consent2DeniedResource,
                organizationCms
            ])
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        // Query as person-1 with denied consent
        resp = await request.get('/4_0_0/Patient?_bundle=1&_count=100&_debug=1').set(getCmsHeaders(PERSON_ID_1));

        // Should return 0 patients (consent denied for person-2)
        expect(resp).toHaveStatusCode(200);
        expect(resp).toHaveResponse(expectedPatientListConsent2DeniedResponse);
    });

    test('Patient list with id filter and consent: Should return filtered patient', async () => {
        const request = await createTestRequest((c) => {
            return c;
        });

        // Add resources with consents
        let resp = await request
            .post('/4_0_0/Person/1/$merge')
            .send([
                person1Resource,
                person2Resource,
                person3Resource,
                person4Resource,
                person5Resource,
                patient1Resource,
                patient2Resource,
                patient3Resource,
                patient4Resource,
                patient5Resource,
                consent2Resource,
                consent5Resource,
                organizationCms
            ])
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        // Query with id filter for patient-2
        resp = await request
            .get(`/4_0_0/Patient?_bundle=1&_count=100&id=${PATIENT_ID_2}&_debug=1`)
            .set(getCmsHeaders(PERSON_ID_1));

        // Should return only patient-2
        expect(resp).toHaveStatusCode(200);
        expect(resp).toHaveResponse(expectedPatientListConsent2ResponseIdFilter);
    });

    test('Patient list with id filter without consent: Should return 0 patients', async () => {
        const request = await createTestRequest((c) => {
            return c;
        });

        // Add resources with consent for person-2 only
        let resp = await request
            .post('/4_0_0/Person/1/$merge')
            .send([
                person1Resource,
                person2Resource,
                person3Resource,
                person4Resource,
                person5Resource,
                patient1Resource,
                patient2Resource,
                patient3Resource,
                patient4Resource,
                patient5Resource,
                consent2Resource,
                organizationCms
            ])
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        // Query with id filter for patient-3 (no consent)
        resp = await request
            .get(`/4_0_0/Patient?_bundle=1&_count=100&id=${PATIENT_ID_3}&_debug=1`)
            .set(getCmsHeaders(PERSON_ID_1));

        // Should return 0 patients (no consent for person-3)
        expect(resp).toHaveStatusCode(200);
        expect(resp).toHaveResponse(expectedPatientListNoConsentResponseIdFilter);
    });
});
