// test file
const activitydefinition1Resource = require('./fixtures/ActivityDefinition/activitydefinition1.json');

// expected
const expectedActivityDefinitionResources = require('./fixtures/expected/expected_ActivityDefinition.json');

const {commonBeforeEach, commonAfterEach, getHeaders, createTestRequest} = require('../../common');
const {describe, beforeEach, afterEach, test} = require('@jest/globals');

describe('ActivityDefinition Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('ActivityDefinition put_response Tests', () => {
        test('put_response works', async () => {
            const request = await createTestRequest();
            // Case when meta.source doesn't exist
            let resp = await request
                .post('/4_0_0/Practitioner/')
                .send(activitydefinition1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(400);
            activitydefinition1Resource.meta.source = 'bwell';
            // ARRANGE
            // add the resources to FHIR server
            resp = await request
                .put('/4_0_0/ActivityDefinition/ab2d17e3-3996-487c-bf81-cbe31abde0be')
                .send(activitydefinition1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedActivityDefinitionResources);
        });
    });
});
