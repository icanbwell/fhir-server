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

const {commonBeforeEach, commonAfterEach, getHeaders, createTestRequest} = require('../../common');
const request = createTestRequest();
const {describe, beforeEach, afterEach, expect} = require('@jest/globals');

describe('Practitioner Complex Merge Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Practitioner Merges', () => {
        test('Multiple calls to Practitioner merge properly', async () => {
            let resp = await request
                .get('/4_0_0/Practitioner')
                .set(getHeaders());

            expect(resp.body.length).toBe(0);
            console.log('------- response 1 ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response 1 ------------');

            resp = await request
                .post('/4_0_0/Practitioner/1679033641/$merge')
                .send(practitionerResource)
                .set(getHeaders());

            console.log('------- response practitionerResource ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response  ------------');
            expect(resp.body['created']).toBe(true);

            resp = await request
                .post('/4_0_0/Location/UF3-UADM/$merge')
                .send(locationResource)
                .set(getHeaders());

            console.log('------- response 3 ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response 3  ------------');
            expect(resp.body['created']).toBe(true);

            resp = await request
                .post('/4_0_0/PractitionerRole/4657-3437/$merge')
                .send(practitionerRoleResource)
                .set(getHeaders());

            console.log('------- response locationResource ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response  ------------');
            expect(resp.body['created']).toBe(true);

            resp = await request
                .post('/4_0_0/Organization/StanfordMedicalSchool/$merge')
                .send(practitionerMedicalSchoolResource)
                .set(getHeaders());

            console.log('------- response practitionerMedicalSchoolResource ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response  ------------');
            expect(resp.body['created']).toBe(true);

            resp = await request
                .post('/4_0_0/HealthcareService/$merge')
                .send(practitionerHealthcareServiceResource)
                .set(getHeaders());
            console.log('------- response practitionerHealthcareServiceResource ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response  ------------');
            expect(resp.body['created']).toBe(true);

            resp = await request
                .post('/4_0_0/Organization/AETNA/$merge')
                .send(insuranceOrganizationResource)
                .set(getHeaders());

            console.log('------- response insuranceOrganizationResource ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response  ------------');
            expect(resp.body['created']).toBe(true);

            resp = await request
                .post('/4_0_0/Location/AetnaElectChoice/$merge')
                .send(insurancePlanLocationResource)
                .set(getHeaders());

            console.log('------- response insurancePlanLocationResource ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response  ------------');
            expect(resp.body['created']).toBe(true);

            resp = await request
                .post('/4_0_0/InsurancePlan/AETNA-AetnaElectChoice/$merge')
                .send(insurancePlanResource)
                .set(getHeaders());

            console.log('------- response insurancePlanResource ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response  ------------');
            expect(resp.body['created']).toBe(true);

            resp = await request
                .post('/4_0_0/Practitioner/1679033641/$merge')
                .send(insurancePractitionerResource)
                .set(getHeaders());
            console.log('------- response insurancePractitionerResource ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response  ------------');
            expect(resp.body['created']).toBe(false);

            resp = await request
                .post('/4_0_0/PractitionerRole/1679033641-AETNA-AetnaElectChoiceEPO/$merge')
                .send(insurancePractitionerRoleResource)
                .set(getHeaders());

            console.log('------- response insurancePractitionerRoleResource ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response  ------------');
            expect(resp.body['created']).toBe(true);

            resp = await request
                .post('/4_0_0/Organization/MWHC/$merge')
                .send(insuranceProviderOrganizationResource)
                .set(getHeaders());
            console.log('------- response insuranceProviderOrganizationResource ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response  ------------');
            expect(resp.body['created']).toBe(true);

            resp = await request
                .post('/4_0_0/PractitionerRole/1679033641/$merge')
                .send(schedulerPractitionerRoleResource)
                .set(getHeaders());

            console.log('------- response schedulerPractitionerRoleResource ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response  ------------');
            expect(resp.body['created']).toBe(true);

            resp = await request
                .post('/4_0_0/HealthcareService/1679033641-MAX-MALX/$merge')
                .send(schedulerHealthcareServiceResource)
                .set(getHeaders());

            console.log('------- response schedulerHealthcareServiceResource ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response  ------------');
            expect(resp.body['created']).toBe(true);

            resp = await request
                .post('/4_0_0/HealthcareService/MWHC_Department-207RE0101X/$merge')
                .send(practiceHealthcareServiceResource)
                .set(getHeaders());

            console.log('------- response practiceHealthcareServiceResource ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response  ------------');
            expect(resp.body['created']).toBe(true);

            resp = await request
                .post('/4_0_0/Organization/MWHC/$merge')
                .send(practiceOrganizationResource)
                .set(getHeaders());
            console.log('------- response practiceOrganizationResource ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response  ------------');
            expect(resp.body['created']).toBe(true);

            resp = await request
                .post('/4_0_0/Organization/MedStarMedicalGroup/$merge')
                .send(practiceParentOrganizationResource)
                .set(getHeaders());
            console.log('------- response practiceHealthcareServiceResource ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response  ------------');
            expect(resp.body['created']).toBe(true);

            resp = await request
                .post('/4_0_0/Location/$merge')
                .send(practiceLocationResource)
                .set(getHeaders());
            console.log('------- response practiceLocationResource ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response  ------------');
            expect(resp.body['created']).toBe(true);

            resp = await request
                .get('/4_0_0/Practitioner')
                .set(getHeaders());
            console.log('------- response Practitioner ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response  ------------');
            // clear out the lastUpdated column since that changes
            let body = resp.body;
            expect(body.length).toBe(1);
            delete body[0]['meta']['lastUpdated'];
            let expected = expectedPractitionerResource;
            delete expected[0]['meta']['lastUpdated'];
            delete expected[0]['$schema'];
            expected[0]['meta']['versionId'] = '2';
            expect(body).toStrictEqual(expected);

            resp = await request
                .get('/4_0_0/PractitionerRole')
                .set(getHeaders());
            console.log('------- response PractitionerRole ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response  ------------');
            // clear out the lastUpdated column since that changes
            body = resp.body;
            expect(body.length).toBe(3);
            delete body[0]['meta']['lastUpdated'];
            body.forEach(element => {
                delete element['meta']['lastUpdated'];
            });
            expected = expectedPractitionerRoleResource;
            expected.forEach(element => {
                if ('meta' in element) {
                    delete element['meta']['lastUpdated'];
                }
                element['meta']['versionId'] = '1';
                if ('$schema' in element) {
                    delete element['$schema'];
                }
            });

            expect(body).toStrictEqual(expected);

            resp = await request
                .get('/4_0_0/Location')
                .set(getHeaders());

            console.log('------- response Location ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response  ------------');
            // clear out the lastUpdated column since that changes
            body = resp.body;
            expect(body.length).toBe(3);
            delete body[0]['meta']['lastUpdated'];
            body.forEach(element => {
                delete element['meta']['lastUpdated'];
            });
            expected = expectedLocationResource;
            expected.forEach(element => {
                if ('meta' in element) {
                    delete element['meta']['lastUpdated'];
                }
                element['meta']['versionId'] = '1';
                if ('$schema' in element) {
                    delete element['$schema'];
                }
            });

            expect(body).toStrictEqual(expected);

            resp = await request
                .get('/4_0_0/Organization')
                .set(getHeaders());
            console.log('------- response Organization ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response  ------------');
            // clear out the lastUpdated column since that changes
            body = resp.body;
            expect(body.length).toBe(5);
            delete body[0]['meta']['lastUpdated'];
            body.forEach(element => {
                delete element['meta'];
            });
            expected = expectedOrganizationResource;
            expected.forEach(element => {
                if ('meta' in element) {
                    delete element['meta'];
                }
                if ('$schema' in element) {
                    delete element['$schema'];
                }
            });

            expect(body).toStrictEqual(expected);

            resp = await request
                .get('/4_0_0/InsurancePlan')
                .set(getHeaders());

            console.log('------- response InsurancePlan ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response  ------------');
            // clear out the lastUpdated column since that changes
            body = resp.body;
            expect(body.length).toBe(1);
            delete body[0]['meta']['lastUpdated'];
            body.forEach(element => {
                delete element['meta']['lastUpdated'];
            });
            expected = expectedInsurancePlanResource;
            expected.forEach(element => {
                if ('meta' in element) {
                    delete element['meta']['lastUpdated'];
                }
                element['meta']['versionId'] = '1';
                if ('$schema' in element) {
                    delete element['$schema'];
                }
            });

            expect(body).toStrictEqual(expected);

            resp = await request
                .get('/4_0_0/HealthcareService')
                .set(getHeaders())
                .expect(200);

            console.log('------- response HealthcareService ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response  ------------');
            // clear out the lastUpdated column since that changes
            body = resp.body;
            expect(body.length).toBe(3);
            delete body[0]['meta']['lastUpdated'];
            body.forEach(element => {
                delete element['meta']['lastUpdated'];
            });
            expected = expectedHealthcareServiceResource;
            expected.forEach(element => {
                if ('meta' in element) {
                    delete element['meta']['lastUpdated'];
                }
                element['meta']['versionId'] = '1';
                if ('$schema' in element) {
                    delete element['$schema'];
                }
            });

            expect(body).toStrictEqual(expected);
        });
    });
});
