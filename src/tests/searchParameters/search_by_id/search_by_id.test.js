// provider file
const activityDefinition1Resource = require('./fixtures/activityDefinition/activityDefinition1.json');

// expected
const expectedActivityDefinitionResource = require('./fixtures/expected/expected.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
} = require('../../common');
const {describe, beforeEach, afterEach, test} = require('@jest/globals');

describe('ActivityDefinitionReturnIdTests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('ActivityDefinition Search By Id Tests', () => {
        test('search by single id works', async () => {
            const request = await createTestRequest();
            let resp = await request
                .get('/4_0_0/ActivityDefinition')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);


            resp = await request
                .post('/4_0_0/ActivityDefinition/1/$merge?validate=true')
                .send(activityDefinition1Resource)
                .set(getHeaders());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});


            resp = await request.get('/4_0_0/ActivityDefinition').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(1);


            resp = await request.get('/4_0_0/ActivityDefinition/798521c5-844a-4ced-a011-030249b6a12b').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedActivityDefinitionResource);

            resp = await request.post('/4_0_0/ActivityDefinition/_search?id=798521c5-844a-4ced-a011-030249b6a12b').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedActivityDefinitionResource);

            resp = await request.get('/4_0_0/ActivityDefinition/_search').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(404);
        });
    });
});
