// test file
const patient1Resource = require('./fixtures/Patient/patient1.json');

// expected
const expectedPatient1Resources = require('./fixtures/expected/expected_patient1.json');

const {commonBeforeEach, commonAfterEach, getHeaders, createTestRequest} = require('../../common');
const {describe, beforeEach, afterEach, test} = require('@jest/globals');
const {ConfigManager} = require('../../../utils/configManager');

class MockConfigManager extends ConfigManager {
    get enableGlobalIdSupport() {
        return true;
    }
}

describe('Patient Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Patient merge_with_references_global_id Tests', () => {
        test('merge_with_references_global_id works', async () => {
            const request = await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManager());
                return c;
            });

            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send(patient1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            // ACT & ASSERT
            // search by token system and code and make sure we get the right Patient back
            resp = await request
                .get('/4_0_0/Patient/?_bundle=1&id=1')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPatient1Resources);
        });
    });
});
