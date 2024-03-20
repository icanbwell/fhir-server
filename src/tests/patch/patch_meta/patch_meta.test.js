// test file
const activitydefinition1Resource = require('./fixtures/ActivityDefinition/activitydefinition1.json');
const activitydefinition2Resource = require('./fixtures/ActivityDefinition/activitydefinition2.json');
const activitydefinition3Resource = require('./fixtures/ActivityDefinition/activitydefinition3.json');
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
        test('create validation for multiple or no owner tags works', async () => {
            const request = await createTestRequest();

            // Create the resource
            let resp = await request
                .post('/4_0_0/ActivityDefinition/$merge')
                .send(activitydefinition1Resource)
                .set(getHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            // Case when multiple owner tags provided.
            resp = await request
                .put('/4_0_0/ActivityDefinition/1')
                .send(activitydefinition2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(400);
            expect(
                resp.body.issue[0].details.text
            ).toStrictEqual(
                'Resource ActivityDefinition/1 is having multiple security access tag with system: https://www.icanbwell.com/owner'
            );

            // Case when no owner tag provided.
            resp = await request
                .put('/4_0_0/ActivityDefinition/1')
                .send(activitydefinition3Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(400);
            expect(
                resp.body.issue[0].details.text
            ).toStrictEqual(
                'Resource ActivityDefinition/1 is missing a security access tag with system: https://www.icanbwell.com/owner'
            );
        });
    });
});
