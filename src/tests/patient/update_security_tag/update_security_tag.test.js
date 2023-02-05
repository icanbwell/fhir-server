// provider file
const patientWithoutSecurityTagResource = require('./fixtures/patient/patient_without_security_tag.json');
const patientWithSecurityTagResource = require('./fixtures/patient/patient_with_security_tag.json');

// expected
const expectedSinglePatientResource = require('./fixtures/expected/expected_single_patient.json');
const expectedSinglePatientSecondUpdateResource = require('./fixtures/expected/expected_single_patient_second_update.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
} = require('../../common');
const {describe, beforeEach, afterEach, expect, test} = require('@jest/globals');
const {ConfigManager} = require('../../../utils/configManager');

class MockConfigManagerWithoutAccessCheck extends ConfigManager {
    /**
     * whether to check access tags on save
     * @return {boolean}
     */
    get checkAccessTagsOnSave() {
        return false;
    }
}

describe('PractitionerUpdateSecurityTagTests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Patient UpdateSecurityTag Tests', () => {
        test('UpdateSecurityTag works', async () => {
            const request = await createTestRequest();
            let resp = await request.get('/4_0_0/Patient').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            resp = await request
                .post('/4_0_0/Patient/00100000000/$merge?validate=true')
                .send(patientWithSecurityTagResource)
                .set(getHeaders());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true, updated: false});

            resp = await request.get('/4_0_0/Patient/00100000000').set(getHeaders());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedSinglePatientResource);
        });
    });
});
describe('PractitionerUpdateSecurityTagTests with checkAccessTag false', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Patient UpdateSecurityTag Tests with checkAccessTag false', () => {
        test('UpdateSecurityTag works with invalid security tag if config is off', async () => {
            const request = await createTestRequest((container) => {
                container.register('configManager', () => new MockConfigManagerWithoutAccessCheck());
                return container;
            });
            let resp = await request.get('/4_0_0/Patient').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            resp = await request
                .post('/4_0_0/Patient/1679033641/$merge?validate=true')
                .send(patientWithoutSecurityTagResource)
                .set(getHeaders());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true, updated: false});


            resp = await request
                .post('/4_0_0/Patient/00100000000/$merge?validate=true')
                .send(patientWithSecurityTagResource)
                .set(getHeaders());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: false, updated: true});

            resp = await request.get('/4_0_0/Patient/00100000000').set(getHeaders());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedSinglePatientSecondUpdateResource);
        });
    });
});
