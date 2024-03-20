// test file
const activitydefinition1Resource = require('./fixtures/ActivityDefinition/activitydefinition1.json');
const activitydefinition2Resource = require('./fixtures/ActivityDefinition/activitydefinition2.json');
const activitydefinition3Resource = require('./fixtures/ActivityDefinition/activitydefinition3.json');
const activitydefinition4Resource = require('./fixtures/ActivityDefinition/activitydefinition4.json');
const activitydefinition5Resource = require('./fixtures/ActivityDefinition/activitydefinition5.json');

// expected
const expectedActivityDefinitionResources = require('./fixtures/expected/expected_ActivityDefinition.json');

const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('Merge Meta Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Merge meta update Tests', () => {
        test('meta update doesn\'t work with different owner and sourceAssingingAuthority tags', async () => {
            const request = await createTestRequest();
            // create the resource
            let resp = await request
                .post('/4_0_0/ActivityDefinition/$merge')
                .send(activitydefinition1Resource)
                .set(getHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            // update the resource
            resp = await request
                .post('/4_0_0/ActivityDefinition/$merge')
                .send(activitydefinition2Resource)
                .set(getHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ updated: true });

            // check if the resource is updated as expected
            resp = await request
                .get('/4_0_0/ActivityDefinition/1')
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveResponse(expectedActivityDefinitionResources);
        });

        test('create validation for multiple or no owner tags works', async () => {
            const request = await createTestRequest();
            // Creating resource with multiple owner tags
            let resp = await request
                .post('/4_0_0/ActivityDefinition/$merge')
                .send(activitydefinition3Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(400);
            expect(
                resp.body.issue[0].details.text
            ).toStrictEqual(
                'Resource ActivityDefinition/2 is having multiple security access tag with system: https://www.icanbwell.com/owner'
            );

            // Creating resource with no owner tag
            resp = await request
                .post('/4_0_0/ActivityDefinition/$merge')
                .send(activitydefinition4Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(400);
            expect(
                resp.body.issue[0].details.text
            ).toStrictEqual(
                'Resource ActivityDefinition/2 is missing a security access tag with system: https://www.icanbwell.com/owner'
            );

            // Create valid resource
            resp = await request
                .post('/4_0_0/ActivityDefinition/$merge')
                .send(activitydefinition1Resource)
                .set(getHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            // Updating resource by providing multiple owner tags
            resp = await request
                .post('/4_0_0/ActivityDefinition/$merge')
                .send(activitydefinition5Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(400);
            expect(
                resp.body.issue[0].details.text
            ).toStrictEqual(
                'Resource ActivityDefinition/1 is having multiple security access tag with system: https://www.icanbwell.com/owner'
            );
        });
    });
});
