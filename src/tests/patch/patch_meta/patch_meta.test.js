// test file
const activitydefinition1Resource = require('./fixtures/ActivityDefinition/activitydefinition1.json');
const activitydefinition2Resource = require('./fixtures/ActivityDefinition/activitydefinition2.json');
const patch1 = require('./fixtures/patch/patch1.json');
const patch2 = require('./fixtures/patch/patch2.json');
const patch3 = require('./fixtures/patch/patch3.json');
const patch4 = require('./fixtures/patch/patch4.json');
const patch5 = require('./fixtures/patch/patch5.json');
const patch6 = require('./fixtures/patch/patch6.json');

// expected
const expectedActivityDefinitionResources = require('./fixtures/expected/expected_ActivityDefinition.json');
const expectedActivityDefinition2Resources = require('./fixtures/expected/expected_ActivityDefinition2.json');

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
        test('patch validation for meta secuirty elements', async () => {
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
                .patch('/4_0_0/ActivityDefinition/1')
                .send(patch2)
                .set(getHeadersJsonPatch());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(400);
            expect(
                resp.body.issue[0].details.text
            ).toStrictEqual(
                'Resource ActivityDefinition/1 is having multiple security access tag with system: https://www.icanbwell.com/owner'
            );

            // Create the resource with multiple access tags
            resp = await request
                .post('/4_0_0/ActivityDefinition/$merge')
                .send(activitydefinition2Resource)
                .set(getHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            // Remove meta.security in patch, only access tags will be removed
            resp = await request
                .patch('/4_0_0/ActivityDefinition/2')
                .send(patch3)
                .set(getHeadersJsonPatch())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedActivityDefinition2Resources);

            // Patch operation with 'null' in system
            resp = await request
                .patch('/4_0_0/ActivityDefinition/2')
                .send(patch4)
                .set(getHeadersJsonPatch());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(400);
            expect(
                resp.body.issue[0].details.text
            ).toStrictEqual(
                'Resource ActivityDefinition/2 has null/empty value for \'system\' or \'code\' in security access tag.'
            );

            // Patch operation with empty string in system
            resp = await request
                .patch('/4_0_0/ActivityDefinition/2')
                .send(patch5)
                .set(getHeadersJsonPatch());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(400);
            expect(
                resp.body.issue[0].details.text
            ).toStrictEqual(
                'Resource ActivityDefinition/2 has null/empty value for \'system\' or \'code\' in security access tag.'
            );

            // Patch operation with 'null' in code
            resp = await request
                .patch('/4_0_0/ActivityDefinition/2')
                .send(patch6)
                .set(getHeadersJsonPatch());
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
