// test file
const activitydefinition1Resource = require('./fixtures/ActivityDefinition/activitydefinition1.json');
const activitydefinition2Resource = require('./fixtures/ActivityDefinition/activitydefinition2.json');
const activitydefinition3Resource = require('./fixtures/ActivityDefinition/activitydefinition3.json');
const activitydefinition4Resource = require('./fixtures/ActivityDefinition/activitydefinition4.json');
const activitydefinition5Resource = require('./fixtures/ActivityDefinition/activitydefinition5.json');
const activitydefinition6Resource = require('./fixtures/ActivityDefinition/activitydefinition6.json');
const activitydefinition7Resource = require('./fixtures/ActivityDefinition/activitydefinition7.json');
const activitydefinition8Resource = require('./fixtures/ActivityDefinition/activitydefinition8.json');
const activitydefinition9Resource = require('./fixtures/ActivityDefinition/activitydefinition9.json');
const activitydefinition10Resource = require('./fixtures/ActivityDefinition/activitydefinition10.json');

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

        test('merge validation for meta security elements', async () => {
            const request = await createTestRequest();
            // Creating resource with multiple owner tags
            let resp = await request
                .post('/4_0_0/ActivityDefinition/$merge')
                .send(activitydefinition3Resource)
                .set(getHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(
                resp.body.operationOutcome.issue[0].details.text
            ).toStrictEqual(
                'Resource ActivityDefinition/1 is having multiple security access tag with system: https://www.icanbwell.com/owner'
            );

            // Creating resource with no owner tag
            resp = await request
                .post('/4_0_0/ActivityDefinition/$merge')
                .send(activitydefinition4Resource)
                .set(getHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(
                resp.body.operationOutcome.issue[0].details.text
            ).toStrictEqual(
                'Resource ActivityDefinition/1 is missing a security access tag with system: https://www.icanbwell.com/owner'
            );

            // Case when empty string provided in 'system'.
            resp = await request
                .post('/4_0_0/ActivityDefinition/$merge')
                .send(activitydefinition6Resource)
                .set(getHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(
                resp.body.operationOutcome.issue[0].details.text
            ).toStrictEqual(
                'Resource ActivityDefinition/1 has null/empty value for \'system\' or \'code\' in security access tag.'
            );

            // Case when 'null' is provided in 'system'.
            resp = await request
                .post('/4_0_0/ActivityDefinition/$merge')
                .send(activitydefinition7Resource)
                .set(getHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(
                resp.body.operationOutcome.issue[0].details.text
            ).toStrictEqual(
                'Resource ActivityDefinition/1 has null/empty value for \'system\' or \'code\' in security access tag.'
            );

            // Case when 'null' is provided in 'code'.
            resp = await request
                .post('/4_0_0/ActivityDefinition/$merge')
                .send(activitydefinition8Resource)
                .set(getHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(
                resp.body.operationOutcome.issue[0].details.text
            ).toStrictEqual(
                'Resource ActivityDefinition/1 has null/empty value for \'system\' or \'code\' in security access tag.'
            );

            // Create valid resource
            resp = await request
                .post('/4_0_0/ActivityDefinition/$merge')
                .send(activitydefinition1Resource)
                .set(getHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            // Updating resource by providing empty string in 'system'
            resp = await request
                .post('/4_0_0/ActivityDefinition/$merge')
                .send(activitydefinition6Resource)
                .set(getHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(
                resp.body.operationOutcome.issue[0].details.text
            ).toStrictEqual(
                'Resource ActivityDefinition/1 has null/empty value for \'system\' or \'code\' in security access tag.'
            );

            // Updating resource by providing 'null' in 'system'
            resp = await request
                .post('/4_0_0/ActivityDefinition/$merge')
                .send(activitydefinition7Resource)
                .set(getHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(
                resp.body.operationOutcome.issue[0].details.text
            ).toStrictEqual(
                'Resource ActivityDefinition/1 has null/empty value for \'system\' or \'code\' in security access tag.'
            );

            // Updating resource by providing 'null' in 'code'
            resp = await request
                .post('/4_0_0/ActivityDefinition/$merge')
                .send(activitydefinition8Resource)
                .set(getHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(
                resp.body.operationOutcome.issue[0].details.text
            ).toStrictEqual(
                'Resource ActivityDefinition/1 has null/empty value for \'system\' or \'code\' in security access tag.'
            );

            // Updating resource with id by providing multiple owner tags
            resp = await request
                .post('/4_0_0/ActivityDefinition/$merge')
                .send(activitydefinition3Resource)
                .set(getHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: false, updated: false });

            // Updating resource with id by providing no owner tag
            resp = await request
                .post('/4_0_0/ActivityDefinition/$merge')
                .send(activitydefinition4Resource)
                .set(getHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: false, updated: false });

            // Create a resource with id as uuid
            resp = await request
                .post('/4_0_0/ActivityDefinition/$merge')
                .send(activitydefinition5Resource)
                .set(getHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            // Updating resource with uuid by providing multiple owner tags
            resp = await request
                .post('/4_0_0/ActivityDefinition/$merge')
                .send(activitydefinition9Resource)
                .set(getHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: false, updated: false });

            // Updating resource with uuid by providing no owner tag
            resp = await request
                .post('/4_0_0/ActivityDefinition/$merge')
                .send(activitydefinition10Resource)
                .set(getHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: false, updated: false });
        });
    });
});
