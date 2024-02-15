// test file
const communicationResource = require('./fixtures/communication.json');

// expected
const expectedCommunicationResource = require('./fixtures/expected_communication.json');
const expectedResponse = require('./fixtures/expected_response.json');

const {
    commonBeforeEach,
    commonAfterEach,
    createTestRequest,
    getTestContainer,
    getGraphQLHeaders
} = require('../../common');

const fs = require('fs');
const path = require('path');

const communicationQuery = fs.readFileSync(path.resolve(__dirname, './fixtures/query.graphql'), 'utf8');

const {describe, beforeEach, afterEach, test, expect} = require('@jest/globals');

async function setupDatabaseAsync(
    mongoDatabaseManager,
    incomingResource,
    expectedResourceInDatabase
) {
    const fhirDb = await mongoDatabaseManager.getClientDbAsync();

    const collection = fhirDb.collection(`${incomingResource.resourceType}_4_0_0`);
    await collection.insertOne(incomingResource);

    // ACT & ASSERT
    // check that two entries were stored in the database
    /**
     * @type {import('mongodb').WithId<import('mongodb').Document> | null}
     */
    const resource = await collection.findOne({ _id: incomingResource._id });

    delete resource._id;

    expect(resource).toStrictEqual(expectedResourceInDatabase);
    return collection;
}

describe('Communication Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Graphql communication Tests', () => {
        test('Invalid reference doesn\'t throw error', async () => {
            // eslint-disable-next-line no-unused-vars
            const request = await createTestRequest();
            const graphqlQueryText = communicationQuery.replace(/\\n/g, '');
            const container = getTestContainer();
            // insert directly into database instead of going through merge() so we simulate old records
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;
            await setupDatabaseAsync(
                mongoDatabaseManager,
                communicationResource,
                expectedCommunicationResource
            );

            const resp = await request
                // .get('/graphql/?query=' + graphqlQueryText)
                // .set(getHeaders())
                .post('/graphql')
                .send({
                    operationName: null,
                    variables: {},
                    query: graphqlQueryText,
                })
                .set(getGraphQLHeaders());

            expect(resp).toHaveResponse(expectedResponse);
        });
    });
});
