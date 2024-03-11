// test file
const activitydefinition1Resource = require('./fixtures/ActivityDefinition/activitydefinition1.json');
const patch1 = require('./fixtures/patch/patch1.json');

// expected
const expectedActivityDefinitionResources = require('./fixtures/expected/expected_ActivityDefinition.json');

const { commonBeforeEach, commonAfterEach, getHeaders, getHeadersJsonPatch, createTestRequest } = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('Put Meta Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Patch meta update Tests', () => {
        test('meta update doesn\'t work with different owner and sourceAssingingAuthority tags', async () => {
            const request = await createTestRequest();
            // Create the resource
            let resp = await request
                .post('/4_0_0/ActivityDefinition/$merge')
                .send(activitydefinition1Resource)
                .set(getHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            // update the resources
            resp = await request
                .patch('/4_0_0/ActivityDefinition/c87b8e53-b3db-53a0-aa92-05f4a3fb9d15')
                .send(patch1)
                .set(getHeadersJsonPatch())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedActivityDefinitionResources);

            // update the resources
            resp = await request
                .patch('/4_0_0/ActivityDefinition/c87b8e53-b3db-53a0-aa92-05f4a3fb9d15')
                .send(patch1)
                .set(getHeadersJsonPatch())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedActivityDefinitionResources);
        });
    });
});
