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
const expectedEverythingResource = require('./fixtures/expected/expected_everything.json');

/**
 * @type {Test}
 */
const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
} = require('../../common');
const {describe, beforeEach, afterEach, expect} = require('@jest/globals');
const {findDuplicateResources} = require('../../../utils/list.util');

describe('Practitioner Everything Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Everything Tests', () => {
        test('Everything works properly', async () => {
            const request = await createTestRequest();
            let resp = await request.get('/4_0_0/Practitioner').set(getHeaders()).expect(200);
            expect(resp.body.length).toBe(0);
            console.log('------- response 1 ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response 1 ------------');

            resp = await request
                .post('/4_0_0/Practitioner/1679033641/$merge')
                .send(practitionerResource)
                .set(getHeaders())
                .expect(200);
            console.log('------- response practitionerResource ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response  ------------');
            expect(resp.body['created']).toBe(true);

            resp = await request
                .post('/4_0_0/Location/UF3-UADM/$merge')
                .send(locationResource)
                .set(getHeaders())
                .expect(200);

            console.log('------- response 3 ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response 3  ------------');
            expect(resp.body['created']).toBe(true);

            resp = await request
                .post('/4_0_0/PractitionerRole/4657-3437/$merge')
                .send(practitionerRoleResource)
                .set(getHeaders())
                .expect(200);

            console.log('------- response locationResource ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response  ------------');
            expect(resp.body['created']).toBe(true);

            resp = await request
                .post('/4_0_0/Organization/StanfordMedicalSchool/$merge')
                .send(practitionerMedicalSchoolResource)
                .set(getHeaders())
                .expect(200);
            console.log('------- response practitionerMedicalSchoolResource ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response  ------------');
            expect(resp.body['created']).toBe(true);

            resp = await request
                .post('/4_0_0/HealthcareService/$merge')
                .send(practitionerHealthcareServiceResource)
                .set(getHeaders())
                .expect(200);
            console.log('------- response practitionerHealthcareServiceResource ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response  ------------');
            expect(resp.body['created']).toBe(true);

            resp = await request
                .post('/4_0_0/Organization/AETNA/$merge')
                .send(insuranceOrganizationResource)
                .set(getHeaders())
                .expect(200);

            console.log('------- response insuranceOrganizationResource ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response  ------------');
            expect(resp.body['created']).toBe(true);

            resp = await request
                .post('/4_0_0/Location/AetnaElectChoice/$merge')
                .send(insurancePlanLocationResource)
                .set(getHeaders())
                .expect(200);

            console.log('------- response insurancePlanLocationResource ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response  ------------');
            expect(resp.body['created']).toBe(true);

            resp = await request
                .post(
                    '/4_0_0/InsurancePlan/AETNA-Aetna-Elect-Choice--EPO--Aetna-Health-Fund--Innovation-He/$merge'
                )
                .send(insurancePlanResource)
                .set(getHeaders())
                .expect(200);

            console.log('------- response insurancePlanResource ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response  ------------');
            expect(resp.body['created']).toBe(true);

            resp = await request
                .post('/4_0_0/Practitioner/1679033641/$merge')
                .send(insurancePractitionerResource)
                .set(getHeaders())
                .expect(200);

            console.log('------- response insurancePractitionerResource ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response  ------------');
            expect(resp.body['created']).toBe(false);

            resp = await request
                .post('/4_0_0/PractitionerRole/1679033641-AETNA-AetnaElectChoiceEPO/$merge')
                .send(insurancePractitionerRoleResource)
                .set(getHeaders())
                .expect(200);
            console.log('------- response insurancePractitionerRoleResource ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response  ------------');
            expect(resp.body['created']).toBe(true);

            resp = await request
                .post('/4_0_0/Organization/MWHC/$merge')
                .send(insuranceProviderOrganizationResource)
                .set(getHeaders())
                .expect(200);

            console.log('------- response insuranceProviderOrganizationResource ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response  ------------');
            expect(resp.body['created']).toBe(true);

            resp = await request
                .post('/4_0_0/PractitionerRole/1679033641/$merge')
                .send(schedulerPractitionerRoleResource)
                .set(getHeaders())
                .expect(200);

            console.log('------- response schedulerPractitionerRoleResource ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response  ------------');
            expect(resp.body['created']).toBe(true);

            resp = await request
                .post('/4_0_0/HealthcareService/1679033641-MAX-MALX/$merge')
                .send(schedulerHealthcareServiceResource)
                .set(getHeaders())
                .expect(200);

            console.log('------- response schedulerHealthcareServiceResource ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response  ------------');
            expect(resp.body['created']).toBe(true);

            resp = await request
                .post('/4_0_0/HealthcareService/MWHC_Department-207RE0101X/$merge')
                .send(practiceHealthcareServiceResource)
                .set(getHeaders())
                .expect(200);

            console.log('------- response practiceHealthcareServiceResource ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response  ------------');
            expect(resp.body['created']).toBe(true);

            resp = await request
                .post('/4_0_0/Organization/MWHC/$merge')
                .send(practiceOrganizationResource)
                .set(getHeaders())
                .expect(200);

            console.log('------- response practiceOrganizationResource ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response  ------------');
            expect(resp.body['created']).toBe(true);

            resp = await request
                .post('/4_0_0/Organization/MedStarMedicalGroup/$merge')
                .send(practiceParentOrganizationResource)
                .set(getHeaders())
                .expect(200);

            console.log('------- response practiceHealthcareServiceResource ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response  ------------');
            expect(resp.body['created']).toBe(true);

            resp = await request
                .post('/4_0_0/Location/$merge')
                .send(practiceLocationResource)
                .set(getHeaders())
                .expect(200);

            console.log('------- response practiceLocationResource ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response  ------------');
            expect(resp.body['created']).toBe(true);

            resp = await request.get('/4_0_0/Practitioner').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPractitionerResource);

            resp = await request
                .get('/4_0_0/Practitioner/1679033641/$everything')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedEverythingResource);

            // verify there are no duplicate ids
            const duplicates = findDuplicateResources(resp.body.entry.map((e) => e.resource));
            expect(duplicates.map((a) => `${a.resourceType}/${a.id}`)).toStrictEqual([]);
        });
    });
});
