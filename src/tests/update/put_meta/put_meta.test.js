// test file
const activitydefinition1Resource = require('./fixtures/ActivityDefinition/activitydefinition1.json');
const activitydefinition2Resource = require('./fixtures/ActivityDefinition/activitydefinition2.json');
const activitydefinition3Resource = require('./fixtures/ActivityDefinition/activitydefinition3.json');
const activitydefinition4Resource = require('./fixtures/ActivityDefinition/activitydefinition4.json');
const activitydefinition5Resource = require('./fixtures/ActivityDefinition/activitydefinition5.json');
const activitydefinition6Resource = require('./fixtures/ActivityDefinition/activitydefinition6.json');
const activitydefinition7Resource = require('./fixtures/ActivityDefinition/activitydefinition7.json');

// expected
const expectedActivityDefinitionResources = require('./fixtures/expected/expected_ActivityDefinition.json');

const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('Put Meta Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Put meta update Tests', () => {
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
                .put('/4_0_0/ActivityDefinition/c87b8e53-b3db-53a0-aa92-05f4a3fb9d15')
                .send(activitydefinition2Resource)
                .set(getHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedActivityDefinitionResources);
        });
        test('put validation for meta security elements', async () => {
            const request = await createTestRequest();

            // Create the resource
            let resp = await request
                .post('/4_0_0/ActivityDefinition/$merge')
                .send(activitydefinition2Resource)
                .set(getHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            // Case when multiple owner tags provided.
            resp = await request
                .put('/4_0_0/ActivityDefinition/2')
                .send(activitydefinition3Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(400);
            expect(
                resp.body.issue[0].details.text
            ).toStrictEqual(
                'Resource ActivityDefinition/2 is having multiple security access tag with system: https://www.icanbwell.com/owner'
            );

            // Case when no owner tag provided.
            resp = await request
                .put('/4_0_0/ActivityDefinition/2')
                .send(activitydefinition4Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(400);
            expect(
                resp.body.issue[0].details.text
            ).toStrictEqual(
                'Resource ActivityDefinition/2 is missing a security access tag with system: https://www.icanbwell.com/owner'
            );

            // Case when empty string provided in 'system'.
            resp = await request
                .put('/4_0_0/ActivityDefinition/2')
                .send(activitydefinition5Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(400);
            expect(
                resp.body.issue[0].details.text
            ).toStrictEqual(
                'Resource ActivityDefinition/2 has null/empty value for \'system\' or \'code\' in security access tag.'
            );

            // Case when 'null' is provided in 'system'.
            resp = await request
                .put('/4_0_0/ActivityDefinition/2')
                .send(activitydefinition6Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(400);
            expect(
                resp.body.issue[0].details.text
            ).toStrictEqual(
                'Resource ActivityDefinition/2 has null/empty value for \'system\' or \'code\' in security access tag.'
            );

            // Case when 'null' is provided in 'code'.
            resp = await request
                .put('/4_0_0/ActivityDefinition/2')
                .send(activitydefinition7Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(400);
            expect(
                resp.body.issue[0].details.text
            ).toStrictEqual(
                'Resource ActivityDefinition/2 has null/empty value for \'system\' or \'code\' in security access tag.'
            );
        });
    });
});
