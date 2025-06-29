// provider file
const patient1Resource = require('./fixtures/patient/patient1.json');
const patient2Resource = require('./fixtures/patient/patient2.json');

// expected
const expectedSinglePatientResource = require('./fixtures/expected/expected_single_patient.json');
const expectedDeletedPatientHistory = require('./fixtures/expected/expected_deleted_patient_history.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { logInfo } = require('../../../operations/common/logging');

describe('Practitioner Delete Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Patient Delete by Id Tests', () => {
        test('search by delete by Id works', async () => {
            const request = await createTestRequest();
            let resp = await request.get('/4_0_0/Patient').set(getHeaders()).expect(200);

            expect(resp.body.length).toBe(0);
            logInfo('------- response 1 ------------');
            logInfo('', { resp: resp.body });
            logInfo('------- end response 1 ------------');

            resp = await request
                .post('/4_0_0/Patient/1679033641/$merge?validate=true')
                .send(patient1Resource)
                .set(getHeaders())
                .expect(200);

            logInfo('------- response patient1Resource ------------');
            logInfo('', { resp: resp.body });
            logInfo('------- end response  ------------');
            expect(resp.body.created).toBe(true);

            resp = await request
                .post('/4_0_0/Patient/2/$merge?validate=true')
                .send(patient2Resource)
                .set(getHeaders())
                .expect(200);

            logInfo('------- response patient2Resource ------------');
            logInfo('', { resp: resp.body });
            logInfo('------- end response  ------------');
            expect(resp.body.created).toBe(true);

            resp = await request.delete('/4_0_0/Patient/2').set(getHeaders());

            resp = await request.get('/4_0_0/Patient').set(getHeaders()).expect(200);

            expect(resp.body.length).toBe(1);
            logInfo('------- response 3 ------------');
            logInfo('', { resp: resp.body });
            logInfo('------- end response 3 ------------');

            resp = await request.get('/4_0_0/Patient/00100000000').set(getHeaders()).expect(200);

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedSinglePatientResource);

            resp = await request.get('/4_0_0/Patient/2/_history').set(getHeaders()).expect(200);
            expect(resp).toHaveResponse(expectedDeletedPatientHistory);
        });
    });
});
