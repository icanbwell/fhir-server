// test file
const practitioner1Resource = require('./fixtures/Practitioner/practitioner1.json');
const practitioner2Resource = require('./fixtures/Practitioner/practitioner2.json');

// expected
const expectedPractitionerByIdResources = require('./fixtures/expected/expected_practitioner_by_id.json');
const expectedPractitionerByUuidResources = require('./fixtures/expected/expected_practitioner_by_uuid.json');
const expectedPractitionerMultipleResources = require('./fixtures/expected/expected_practitioner_multiple.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
} = require('../../common');
const {describe, beforeEach, afterEach, test} = require('@jest/globals');
const {IdentifierSystem} = require('../../../utils/identifierSystem');
const {ConfigManager} = require('../../../utils/configManager');

class MockConfigManager extends ConfigManager {
    get enableGlobalIdSupport() {
        return true;
    }
}

describe('Practitioner Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Practitioner search by uuid Tests', () => {
        test('search by uuid works for single resource', async () => {
            const request = await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManager());
                return c;
            });
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Practitioner/1/$merge?validate=true')
                .send(practitioner1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            // ACT & ASSERT
            // search by token system and code and make sure we get the right Practitioner back
            resp = await request
                .get('/4_0_0/Practitioner/?_bundle=1&id=1679033641&_debug=1')
                .set(getHeaders());
            // read the uuid for the resource
            const uuid = resp.body.entry[0].resource.identifier.filter(i => i.system === IdentifierSystem.uuid)[0].value;
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPractitionerByIdResources);

            resp = await request
                .get(`/4_0_0/Practitioner/?_bundle=1&id=${uuid}&_debug=1`)
                .set(getHeaders());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPractitionerByUuidResources);
        });
        test('search by uuid works for multiple resources', async () => {
            const request = await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManager());
                return c;
            });
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Practitioner/1/$merge?validate=true')
                .send(practitioner1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            await request
                .post('/4_0_0/Practitioner/1/$merge?validate=true')
                .send(practitioner2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            // ACT & ASSERT
            // search by token system and code and make sure we get the right Practitioner back
            resp = await request
                .get('/4_0_0/Practitioner/?_bundle=1&id=1679033641&_debug=1')
                .set(getHeaders());
            // read the uuid for the resource
            const uuid = resp.body.entry[0].resource.identifier.filter(i => i.system === IdentifierSystem.uuid)[0].value;
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPractitionerByIdResources);

            resp = await request
                .get(`/4_0_0/Practitioner/?_bundle=1&id=${uuid}&_debug=1`)
                .set(getHeaders());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPractitionerByUuidResources);

            resp = await request
                .get(`/4_0_0/Practitioner/?_bundle=1&id=${uuid},2&_debug=1`)
                .set(getHeaders());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPractitionerMultipleResources);
        });
    });
});
