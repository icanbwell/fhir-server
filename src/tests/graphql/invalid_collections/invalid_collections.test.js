const expectedResponse = require('./fixtures/expected/expected_response.json');

const patientResource = require('./fixtures/person/person.json');

const fs = require('fs');
const path = require('path');

const query = fs.readFileSync(
    path.resolve(__dirname, './fixtures/query/query_person.graphql'),
    'utf8'
);
const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getGraphQLHeaders,
    createTestRequest,
    getTestContainer,
    mockHttpContext
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('No invalid collections made through GraphQL Tests', () => {
    let requestId;
    beforeEach(async () => {
        await commonBeforeEach();
        requestId = mockHttpContext();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('No invalid collections should be made through GraphQL request', () => {
        test('Test on person resource', async () => {
            const request = await createTestRequest();
            const container = getTestContainer();
            const graphqlQueryText = query.replace(/\\n/g, '');
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
                .post('/4_0_0/Patient/1/$merge')
                .send(patientResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/graphql')
                .send({
                    operationName: null,
                    variables: {},
                    query: graphqlQueryText
                })
                .set(getGraphQLHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResponse);
            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = container.postRequestProcessor;
            await postRequestProcessor.waitTillDoneAsync({ requestId });

            // Check that after the above requests, only person & person history collection is made in db.
            collections = await db.listCollections().toArray();
            const collectionNames = collections.map(collection => collection.name);
            expect(collectionNames).toEqual(expect.arrayContaining([
                'Person_4_0_0', 'Person_4_0_0_History'
            ]));
        });
    });
});
