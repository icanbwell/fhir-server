// practice
const practiceHealthcareServiceResource = require('./fixtures/practice/healthcare_service.json');
const practiceOrganizationResource = require('./fixtures/practice/practice_organization.json');
const practiceOrganization2Resource = require('./fixtures/practice/practice_organization2.json');
const practiceParentOrganizationResource = require('./fixtures/practice/parent_organization.json');
const practiceLocationResource = require('./fixtures/practice/location.json');

// expected
const expectedEverythingResource = require('./fixtures/expected/expected_everything.json');

const {commonBeforeEach, commonAfterEach, getHeaders, createTestRequest} = require('../../common');
const request = createTestRequest();
const {describe, beforeEach, afterEach, expect} = require('@jest/globals');

describe('Organization Multiple Everything Contained Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Everything Multiple Contained Tests', () => {
        test('Everything multiple contained works properly', async () => {
            let resp = await request
                .get('/4_0_0/Practitioner')
                .set(getHeaders())
                .expect(200);
            expect(resp.body.length).toBe(0);
            console.log('------- response 1 ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response 1 ------------');

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
                .post('/4_0_0/Organization/1234/$merge')
                .send(practiceOrganization2Resource)
                .set(getHeaders())
                .expect(200);
            console.log('------- response practiceOrganization2Resource ------------');
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
            resp = await request
                .get('/4_0_0/Organization/1/$everything?id=733797173,1234&contained=true')
                .set(getHeaders())
                .expect(200);
            console.log('------- response Organization 733797173 $everything ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response  ------------');
            let body = resp.body;
            delete body['timestamp'];
            body.entry.forEach(element => {
                delete element['fullUrl'];
                delete element['resource']['meta']['lastUpdated'];
                if (element['resource']['contained']) {
                    element['resource']['contained'].forEach(containedElement => {
                        delete containedElement['meta']['lastUpdated'];
                    });
                }
            });
            let expected = expectedEverythingResource;
            delete expected['timestamp'];
            expected.entry.forEach(element => {
                delete element['fullUrl'];
                if ('meta' in element['resource']) {
                    delete element['resource']['meta']['lastUpdated'];
                }
                element['resource']['meta']['versionId'] = '1';
                if ('$schema' in element) {
                    delete element['$schema'];
                }
                if (element['resource']['contained']) {
                    element['resource']['contained'].forEach(containedElement => {
                        delete containedElement['meta']['lastUpdated'];
                    });
                }
            });
            expect(body).toStrictEqual(expected);
        });
    });
});
