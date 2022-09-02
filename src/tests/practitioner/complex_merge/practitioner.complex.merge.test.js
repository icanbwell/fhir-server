// provider file
const practitionerResource = require('./fixtures/providers/practitioner.json');
const locationResource = require('./fixtures/providers/location.json');
const practitionerRoleResource = require('./fixtures/providers/practitioner_role.json');
const practitionerMedicalSchoolResource = require('./fixtures/providers/medical_school_organization.json');
const practitionerHealthcareServiceResource = require('./fixtures/providers/healthcare_service.json');
// insurance
const insurancePractitionerResource = require('./fixtures/insurance/practitioner.json');
const insuranceOrganizationResource = require('./fixtures/insurance/insurance_organization.json');
const insurancePlanLocationResource = require('./fixtures/insurance/insurance_plan_location.json');
const insurancePlanResource = require('./fixtures/insurance/insurance_plan.json');
const insurancePractitionerRoleResource = require('./fixtures/insurance/practitioner_role.json');
const insuranceProviderOrganizationResource = require('./fixtures/insurance/provider_organization.json');
// scheduler
const schedulerPractitionerRoleResource = require('./fixtures/scheduler/practitioner_role.json');
const schedulerHealthcareServiceResource = require('./fixtures/scheduler/healthcare_service.json');
// practice
const practiceHealthcareServiceResource = require('./fixtures/practice/healthcare_service.json');
const practiceOrganizationResource = require('./fixtures/practice/practice_organization.json');
const practiceParentOrganizationResource = require('./fixtures/practice/parent_organization.json');
const practiceLocationResource = require('./fixtures/practice/location.json');

// expected
const expectedPractitionerResource = require('./fixtures/expected/expected_practitioner.json');
const expectedPractitionerRoleResource = require('./fixtures/expected/expected_practitioner_role.json');
const expectedLocationResource = require('./fixtures/expected/expected_location.json');
const expectedOrganizationResource = require('./fixtures/expected/expected_organization.json');
const expectedInsurancePlanResource = require('./fixtures/expected/expected_insurance_plan.json');
const expectedHealthcareServiceResource = require('./fixtures/expected/expected_healthcare_service.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
} = require('../../common');
const {describe, beforeEach, afterEach} = require('@jest/globals');
const {
    expectMergeResponse,
    expectResourceCount,
    expectResponse
} = require('../../fhirAsserts');

describe('Practitioner Complex Merge Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Practitioner Merges', () => {
        test('Multiple calls to Practitioner merge properly', async () => {
            const request = await createTestRequest();
            let resp = await request.get('/4_0_0/Practitioner').set(getHeaders());
            expectResourceCount(resp, 0);

            resp = await request
                .post('/4_0_0/Practitioner/1679033641/$merge')
                .send(practitionerResource);
            expectMergeResponse(resp, {created: true});

            resp = await request
                .post('/4_0_0/Location/UF3-UADM/$merge')
                .send(locationResource)
                .set(getHeaders());
            expectMergeResponse(resp, {created: true});

            resp = await request
                .post('/4_0_0/PractitionerRole/4657-3437/$merge')
                .send(practitionerRoleResource)
                .set(getHeaders());
            expectMergeResponse(resp, {created: true});

            resp = await request
                .post('/4_0_0/Organization/StanfordMedicalSchool/$merge')
                .send(practitionerMedicalSchoolResource)
                .set(getHeaders());
            expectMergeResponse(resp, {created: true});

            resp = await request
                .post('/4_0_0/HealthcareService/$merge')
                .send(practitionerHealthcareServiceResource)
                .set(getHeaders());
            expectMergeResponse(resp, {created: true});

            resp = await request
                .post('/4_0_0/Organization/AETNA/$merge')
                .send(insuranceOrganizationResource)
                .set(getHeaders());
            expectMergeResponse(resp, {created: true});

            resp = await request
                .post('/4_0_0/Location/AetnaElectChoice/$merge')
                .send(insurancePlanLocationResource)
                .set(getHeaders());
            expectMergeResponse(resp, {created: true});

            resp = await request
                .post('/4_0_0/InsurancePlan/AETNA-AetnaElectChoice/$merge')
                .send(insurancePlanResource)
                .set(getHeaders());
            expectMergeResponse(resp, {created: true});

            resp = await request
                .post('/4_0_0/Practitioner/1679033641/$merge')
                .send(insurancePractitionerResource)
                .set(getHeaders());
            expectMergeResponse(resp, {updated: true});

            resp = await request
                .post('/4_0_0/PractitionerRole/1679033641-AETNA-AetnaElectChoiceEPO/$merge')
                .send(insurancePractitionerRoleResource)
                .set(getHeaders());
            expectMergeResponse(resp, {created: true});

            resp = await request
                .post('/4_0_0/Organization/MWHC/$merge')
                .send(insuranceProviderOrganizationResource)
                .set(getHeaders());
            expectMergeResponse(resp, {created: true});

            resp = await request
                .post('/4_0_0/PractitionerRole/1679033641/$merge')
                .send(schedulerPractitionerRoleResource)
                .set(getHeaders());
            expectMergeResponse(resp, {created: true});

            resp = await request
                .post('/4_0_0/HealthcareService/1679033641-MAX-MALX/$merge')
                .send(schedulerHealthcareServiceResource)
                .set(getHeaders());
            expectMergeResponse(resp, {created: true});

            resp = await request
                .post('/4_0_0/HealthcareService/MWHC_Department-207RE0101X/$merge')
                .send(practiceHealthcareServiceResource)
                .set(getHeaders());
            expectMergeResponse(resp, {created: true});

            resp = await request
                .post('/4_0_0/Organization/MWHC/$merge')
                .send(practiceOrganizationResource)
                .set(getHeaders());
            expectMergeResponse(resp, {created: true});

            resp = await request
                .post('/4_0_0/Organization/MedStarMedicalGroup/$merge')
                .send(practiceParentOrganizationResource)
                .set(getHeaders());
            expectMergeResponse(resp, {created: true});

            resp = await request
                .post('/4_0_0/Location/$merge')
                .send(practiceLocationResource)
                .set(getHeaders());
            expectMergeResponse(resp, {created: true});

            resp = await request.get('/4_0_0/Practitioner').set(getHeaders());
            expectResponse(resp, expectedPractitionerResource);

            resp = await request.get('/4_0_0/PractitionerRole').set(getHeaders());
            expectResponse(resp, expectedPractitionerRoleResource);

            resp = await request.get('/4_0_0/Location').set(getHeaders());
            expectResponse(resp, expectedLocationResource);

            resp = await request.get('/4_0_0/Organization').set(getHeaders());
            expectResponse(resp, expectedOrganizationResource);

            resp = await request.get('/4_0_0/InsurancePlan').set(getHeaders());
            expectResponse(resp, expectedInsurancePlanResource);

            resp = await request.get('/4_0_0/HealthcareService').set(getHeaders()).expect(200);
            expectResponse(resp, expectedHealthcareServiceResource);

        });
    });
});
