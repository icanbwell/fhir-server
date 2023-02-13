// provider file
const patientWithoutSecurityTagResource = require('./fixtures/patient/patient_without_security_tag.json');

// expected
const expectedSinglePatientWithoutSecurityTagsResource = require('./fixtures/expected/expected_single_patient_without_security_tags.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
} = require('../../common');
const {describe, beforeEach, afterEach, expect, test} = require('@jest/globals');
const {ConfigManager} = require('../../../utils/configManager');

class MockConfigManagerWithoutCheckAccessTagsOnSave extends ConfigManager {
    /**
     * whether to check access tags on save
     * @return {boolean}
     */
    get checkAccessTagsOnSave() {
        return false;
    }
}

describe('PractitionerUpdateSecurityTagTests without checkAccessTag config', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Patient UpdateSecurityTag Tests', () => {
        test('UpdateSecurityTag works with checkAccessTag config', async () => {
            const request = await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManagerWithoutCheckAccessTagsOnSave());
                return c;
            });
            let resp = await request.get('/4_0_0/Patient').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            expect(resp.body.length).toBe(0);

            resp = await request
                .post('/4_0_0/Patient/1679033641/$merge?validate=true')
                .send(patientWithoutSecurityTagResource)
                .set(getHeaders());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true, updated: false});

            resp = await request.get('/4_0_0/Patient/00100000000').set(getHeaders());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedSinglePatientWithoutSecurityTagsResource);
        });
    });
});
