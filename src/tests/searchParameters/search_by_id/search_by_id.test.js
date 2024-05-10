// provider file
const activityDefinition1Resource = require('./fixtures/activityDefinition/activityDefinition1.json');

// expected
const expectedActivityDefinitionResource = require('./fixtures/expected/expected.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getTestContainer,
    mockHttpContext
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('ActivityDefinitionReturnIdTests', () => {
    let requestId;
    beforeEach(async () => {
        await commonBeforeEach();
        requestId = mockHttpContext();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('ActivityDefinition Search By Id Tests', () => {
        test('search by single id works', async () => {
            const request = await createTestRequest();
            const container = getTestContainer();
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;
            /**
             * mongo fhirDb connection
             * @type {import('mongodb').Db}
             */
            const db = await mongoDatabaseManager.getClientDbAsync();
            let collections = await db.listCollections().toArray();
            // Check that initially there are no collections in db.
            expect(collections.length).toEqual(0);

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
            expect(resp).toHaveMergeResponse({ created: true });

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

            resp = await request.get('/4_0_0/XYZ/').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(404);
            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = container.postRequestProcessor;
            await postRequestProcessor.waitTillDoneAsync({ requestId });

            // Check that after the above requests, only valid collections are made in db.
            collections = await db.listCollections().toArray();
            const collectionNames = collections.map(collection => collection.name);
            expect(collectionNames).toEqual(expect.arrayContaining([
                'ActivityDefinition_4_0_0', 'ActivityDefinition_4_0_0_History'
            ]));
        });
    });
});
