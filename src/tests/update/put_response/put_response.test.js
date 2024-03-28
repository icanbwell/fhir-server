// test file
const activitydefinition1Resource = require('./fixtures/ActivityDefinition/activitydefinition1.json');
const activitydefinition2Resource = require('./fixtures/ActivityDefinition/activitydefinition2.json');

// expected
const expectedActivityDefinitionResources = require('./fixtures/expected/expected_ActivityDefinition.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getTestContainer,
    mockHttpContext
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('ActivityDefinition Tests', () => {
    let requestId;
    beforeEach(async () => {
        await commonBeforeEach();
        requestId = mockHttpContext();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('ActivityDefinition put_response Tests', () => {
        test('put_response works', async () => {
            const request = await createTestRequest();
            // Case when meta.source doesn't exist
            let resp = await request
                .post('/4_0_0/ActivityDefinition/')
                .send(activitydefinition1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(400);
            activitydefinition1Resource.meta.source = 'bwell';
            // ARRANGE
            // add the resources to FHIR server
            resp = await request
                .put('/4_0_0/ActivityDefinition/ab2d17e3-3996-487c-bf81-cbe31abde0be')
                .send(activitydefinition1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedActivityDefinitionResources);
        });
        test('put_response reference validation works', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            const resp = await request
                .put('/4_0_0/ActivityDefinition/ab2d17e3-3996-487c-bf81-cbe31abde0be')
                .send(activitydefinition2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(400);
            expect(
                resp.body.issue[0].details.text
            ).toStrictEqual(
                'location.reference: location is an invalid reference'
            );
        });

        test('put works when resource is without id and _validate is true', async () => {
            const request = await createTestRequest();

            activitydefinition1Resource.meta.source = 'bwell';
            let resp = await request
                .post('/4_0_0/ActivityDefinition/$merge')
                .send(activitydefinition1Resource)
                .set(getHeaders())
                .expect(200);

            delete activitydefinition1Resource.id;
            resp = await request
                .put('/4_0_0/ActivityDefinition/ab2d17e3-3996-487c-bf81-cbe31abde0be?_validate=true')
                .send(activitydefinition1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedActivityDefinitionResources);
        });

        test('No invalid collections should be made through update operation', async () => {
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

            // Update api hit with valid resource
            activitydefinition1Resource.meta.source = 'bwell';
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .put('/4_0_0/ActivityDefinition/ab2d17e3-3996-487c-bf81-cbe31abde0be')
                .send(activitydefinition1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedActivityDefinitionResources);

            // Update api hit with invalid resource
            resp = await request
                .put('/4_0_0/XYZ/1')
                .send(activitydefinition1Resource)
                .set(getHeaders());
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
