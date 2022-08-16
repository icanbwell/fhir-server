// provider file
const patientWithoutSecurityTagResource = require('./fixtures/patient/patient_without_security_tag.json');
const patientWithSecurityTagResource = require('./fixtures/patient/patient_with_security_tag.json');

// expected
const expectedSinglePatientResource = require('./fixtures/expected/expected_single_patient.json');

const {commonBeforeEach, commonAfterEach, getHeaders, createTestRequest} = require('../../common');
const env = require('var');
const request = createTestRequest();
const {describe, beforeEach, afterEach, expect} = require('@jest/globals');

describe('PractitionerUpdateSecurityTagTests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Patient UpdateSecurityTag Tests', () => {
        test('UpdateSecurityTag works', async () => {
            const oldValue = env['CHECK_ACCESS_TAG_ON_SAVE'];

            // env['SLACK_TOKEN'] = '';
            // env['SLACK_CHANNEL'] = '#helix_pipeline_notifications_dev';
            let resp = await request
                .get('/4_0_0/Patient')
                .set(getHeaders());

            expect(resp.body.length).toBe(0);
            console.log('------- response 1 ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response 1 ------------');

            env['CHECK_ACCESS_TAG_ON_SAVE'] = 0;
            try {
                resp = await request
                    .post('/4_0_0/Patient/1679033641/$merge?validate=true')
                    .send(patientWithoutSecurityTagResource)
                    .set(getHeaders());

                console.log('------- response patient1Resource ------------');
                console.log(JSON.stringify(resp.body, null, 2));
                console.log('------- end response  ------------');
                expect(resp.body['created']).toBe(true);
            } finally {
                env['CHECK_ACCESS_TAG_ON_SAVE'] = oldValue;
            }

            resp = await request
                .post('/4_0_0/Patient/00100000000/$merge?validate=true')
                .send(patientWithSecurityTagResource)
                .set(getHeaders());

            console.log('------- response patient1Resource ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response  ------------');
            expect(resp.body['created']).toBe(false);
            expect(resp.body['updated']).toBe(true);

            resp = await request
                .get('/4_0_0/Patient/00100000000')
                .set(getHeaders());

            console.log('------- response Patient sorted ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response sort ------------');
            // clear out the lastUpdated column since that changes
            let body = resp.body;
            delete body['meta']['lastUpdated'];

            let expected = expectedSinglePatientResource[0];
            delete expected['meta']['lastUpdated'];
            delete expected['$schema'];

            expect(body).toStrictEqual(expected);
        });
    });
});
