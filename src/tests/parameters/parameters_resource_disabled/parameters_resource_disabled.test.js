// test file
const parametersDefinition1Resource = require('./fixtures/parameters/parametersResource1.json');
const parametersDefinition2Resource = require('./fixtures/parameters/parametersResource2.json');
const parametersDefinition3Resource = require('./fixtures/parameters/parametersResource3.json');
const parametersDefinition4Resource = require('./fixtures/parameters/parametersResource4.json');
const parametersDefinition5Resource = require('./fixtures/parameters/parametersResource5.json');

// expected
const expectedParametersResource1 = require('./fixtures/expected/expectedResponse1.json');
const expectedParametersResource2 = require('./fixtures/expected/expectedResponse2.json');
const expectedParametersResource3 = require('./fixtures/expected/expectedResponse3.json');
const expectedParametersResource4 = require('./fixtures/expected/expectedResponse4.json');

const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest, getTestContainer, getGraphQLHeaders } = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const fs = require('fs');
const path = require('path');
const { MongoDatabaseManager } = require('../../../utils/mongoDatabaseManager');

const guidanceResponseQuery = fs.readFileSync(
    path.resolve(__dirname, './fixtures/guidanceResponseQuery.graphql'),
    'utf8'
);
const guidanceResponseQueryV2 = fs.readFileSync(
    path.resolve(__dirname, './fixtures/guidanceResponseQueryV2.graphql'),
    'utf8'
);
const parametersQuery = fs.readFileSync(
    path.resolve(__dirname, './fixtures/parametersQuery.graphql'),
    'utf8'
);

describe('Parameters resource Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Parameters resource fetching Tests', () => {
        test('No operation is possible on Parameters resource', async () => {
            const request = await createTestRequest();
            await request
                .post('/4_0_0/Parameters/$merge')
                .send(parametersDefinition1Resource)
                .set(getHeaders())
                .expect(404);

            await request
                .get('/4_0_0/Parameters/1')
                .set(getHeaders())
                .expect(404);

            await request
                .get('/4_0_0/Parameters')
                .set(getHeaders())
                .expect(404);

            await request
                .put('/4_0_0/Parameters')
                .send(parametersDefinition1Resource)
                .set(getHeaders())
                .expect(404);

            await request
                .delete('/4_0_0/Parameters')
                .set(getHeaders())
                .expect(404);
        });

        test('Parameters resource not created using merge operation & graphql', async () => {
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

            // Testing merge endpoint with multiple ways parameter resource can be sent
            let resp = await request
                .post('/4_0_0/ActivityDefinition/$merge')
                .send(parametersDefinition1Resource)
                .set(getHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp.body).toStrictEqual(expectedParametersResource1);

            resp = await request
                .post('/4_0_0/ActivityDefinition/$merge')
                .send(parametersDefinition2Resource)
                .set(getHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp.body).toStrictEqual(expectedParametersResource2);

            resp = await request
                .post('/4_0_0/ActivityDefinition/$merge')
                .send(parametersDefinition3Resource)
                .set(getHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp.body).toStrictEqual(expectedParametersResource4);

            resp = await request
                .post('/4_0_0/ActivityDefinition/$merge')
                .send(parametersDefinition4Resource)
                .set(getHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp.body).toStrictEqual(expectedParametersResource4);

            resp = await request
                .post('/4_0_0/ActivityDefinition/$merge')
                .send(parametersDefinition5Resource)
                .set(getHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp.body).toStrictEqual(expectedParametersResource4);

            await request
                .post('/4_0_0/Parameters/$merge')
                .send(parametersDefinition1Resource)
                .set(getHeaders())
                .expect(404);

            // Testing parameter resource in graphql & graphqlv2
            const parametersQueryText = parametersQuery.replace(/\\n/g, '');
            const guidanceResponseQueryText = guidanceResponseQuery.replace(/\\n/g, '');
            const guidanceResponseQueryV2Text = guidanceResponseQueryV2.replace(/\\n/g, '');

            // Graphql
            resp = await request
                .post('/$graphql')
                .send({
                    operationName: null,
                    variables: {},
                    query: parametersQueryText
                })
                .set(getGraphQLHeaders());
            expect(resp).toHaveResponse(expectedParametersResource3);

            resp = await request
                .post('/$graphql')
                .send({
                    operationName: null,
                    variables: {},
                    query: guidanceResponseQueryText
                })
                .set(getGraphQLHeaders());
            expect(resp).toHaveResponse(expectedParametersResource3);

            // Graphqlv2
            resp = await request
                .post('/4_0_0/$graphqlv2')
                .send({
                    operationName: null,
                    variables: {},
                    query: parametersQueryText
                })
                .set(getGraphQLHeaders());
            expect(resp).toHaveResponse(expectedParametersResource3);

            resp = await request
                .post('/4_0_0/$graphqlv2')
                .send({
                    operationName: null,
                    variables: {},
                    query: guidanceResponseQueryV2Text
                })
                .set(getGraphQLHeaders());
            expect(resp).toHaveResponse(expectedParametersResource3);

            // Checking if no new collection is made for Parameters after all the above requests
            collections = await db.listCollections().toArray();
            const collectionsNames = collections.map(collection => collection.name).sort();

            expect(collectionsNames).toEqual(
                ['Person_4_0_0', 'Person_4_0_0_History']
            );
        });
    });
});
