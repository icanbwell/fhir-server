// test file
const person1Resource = require('./fixtures/Person/person1.json');
const person2Resource = require('./fixtures/Person/person2.json');

// expected
const expectedPersonResources = require('./fixtures/expected/expected_Person.json');
const expectedMissingAccessScope = require('./fixtures/expected/expectedMissingAccessScope.json');
const expectedWrongAccessScope = require('./fixtures/expected/expectedWrongAccessScope.json');
const expectedWrongReferenceValues = require('./fixtures/expected/expectedWrongReferenceValues.json');
const expectedWrongReferenceValuesCreate = require('./fixtures/expected/expectedWrongReferenceValuesCreate.json');
const expectedIdValidationError = require("./fixtures/expected/expected_id_validation_error.json")

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest, getTestContainer, mockHttpContext
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const deepcopy = require('deepcopy');

describe('Person Tests', () => {
    let requestId;
    beforeEach(async () => {
        await commonBeforeEach();
        requestId = mockHttpContext();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Person mergeWith_id Tests', () => {
        test('mergeWith_id works with access/*.* (create)', async () => {
            const request = await createTestRequest();
            // Case when meta.source doesn't exist
            let resp = await request
                .post('/4_0_0/Practitioner/')
                .send(person1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(400);
            person1Resource[0].meta.source = 'bwell';
            // ARRANGE
            // add the resources to FHIR server
            resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send(person1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            // ACT & ASSERT
            // search by token system and code and make sure we get the right Person back
            resp = await request
                .get('/4_0_0/Person/?_bundle=1')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPersonResources);
        });

        test('mergeWith_id gives error for id containing pipe', async () => {
            const request = await createTestRequest();
            const personResource = deepcopy(person1Resource)
            personResource[0].meta.source = 'bwell';
            personResource[0].id = 'person1|bwell';

            // ARRANGE
            // add the resources to FHIR server
            const resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send(personResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedIdValidationError);
        });

        test('mergeWith_id works with access/*.* (update)', async () => {
            const request = await createTestRequest();
            // Case when meta.source doesn't exist
            let resp = await request
                .post('/4_0_0/Practitioner/')
                .send(person1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(400);
            person1Resource[0].meta.source = 'bwell';
            // ARRANGE
            // add the resources to FHIR server
            resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send(person1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            const container = getTestContainer();
            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = container.postRequestProcessor;
            await postRequestProcessor.waitTillDoneAsync({ requestId });

            resp = await request
                .get('/4_0_0/Person/?_bundle=1')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPersonResources);

            resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send(person1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: false, updated: false });

            // ACT & ASSERT
            // search by token system and code and make sure we get the right Person back
            resp = await request
                .get('/4_0_0/Person/?_bundle=1')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPersonResources);
        });
        test('mergeWith_id works with access/*.* (update with change)', async () => {
            const request = await createTestRequest();
            // Case when meta.source doesn't exist
            let resp = await request
                .post('/4_0_0/Practitioner/')
                .send(person1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(400);
            person1Resource[0].meta.source = 'bwell';
            // ARRANGE
            // add the resources to FHIR server
            resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send(person1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            const container = getTestContainer();
            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = container.postRequestProcessor;
            await postRequestProcessor.waitTillDoneAsync({ requestId });

            resp = await request
                .get('/4_0_0/Person/?_bundle=1')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPersonResources);

            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;

            /**
             * @type {string}
             */
            const mongoCollectionName = 'Person_4_0_0';
            /**
             * mongo fhirDb connection
             * @type {import('mongodb').Db}
             */
            const fhirDb = await mongoDatabaseManager.getClientDbAsync();
            /**
             * mongo collection
             * @type {import('mongodb').Collection}
             */
            const personCollection = fhirDb.collection(mongoCollectionName);
            const person = await personCollection.findOne({ id: 'aba5bcf41cf64435839cf0568c121843' });
            const initialPersonUuid = person._uuid;

            const person1ResourceWithChange = deepcopy(person1Resource);
            person1ResourceWithChange[0].gender = 'female';
            resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send(person1ResourceWithChange)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: false, updated: true });

            // check that the uuid has not changed
            const finalPersonUuid = (await personCollection.findOne({ id: 'aba5bcf41cf64435839cf0568c121843' }))._uuid;
            expect(finalPersonUuid).toBe(initialPersonUuid);
        });
        test('mergeWith_id fails with missing permissions (create)', async () => {
            const request = await createTestRequest();
            // Case when meta.source doesn't exist
            let resp = await request
                .post('/4_0_0/Practitioner/')
                .send(person1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(400);
            person1Resource[0].meta.source = 'bwell';
            // ARRANGE

            // ACT & ASSERT
            resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send(person1Resource)
                .set(getHeaders('user/*.read user/*.write'));
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(200);
            // noinspection JSUnresolvedFunction
            expect(resp.body[0].operationOutcome).toEqual(expectedMissingAccessScope);
        });
        test('mergeWith_id fails with missing permissions (update)', async () => {
            const request = await createTestRequest();
            // Case when meta.source doesn't exist
            let resp = await request
                .post('/4_0_0/Practitioner/')
                .send(person1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(400);
            person1Resource[0].meta.source = 'bwell';
            // ARRANGE
            resp = await request
                .get('/4_0_0/Person/?_bundle=1')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            const container = getTestContainer();
            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = container.postRequestProcessor;
            await postRequestProcessor.waitTillDoneAsync({ requestId });

            // ACT & ASSERT
            // add the resources to FHIR server
            resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send(person1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            // search by token system and code and make sure we get the right Person back
            resp = await request
                .get('/4_0_0/Person/?_bundle=1')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPersonResources);

            resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send(person1Resource)
                .set(getHeaders('user/*.read user/*.write'));
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(200);
            // noinspection JSUnresolvedFunction
            expect(resp.body[0].operationOutcome).toEqual(expectedMissingAccessScope);
        });
        test('mergeWith_id fails with wrong access scope (create)', async () => {
            const request = await createTestRequest();
            // Case when meta.source doesn't exist
            let resp = await request
                .post('/4_0_0/Practitioner/')
                .send(person1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(400);
            person1Resource[0].meta.source = 'bwell';
            // ARRANGE
            // ACT & ASSERT
            resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send(person1Resource)
                .set(getHeaders('user/*.read user/*.write access/foo.*'));
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedWrongAccessScope);
        });
        test('mergeWith_id fails with wrong access scope (update)', async () => {
            const request = await createTestRequest();
            // Case when meta.source doesn't exist
            let resp = await request
                .post('/4_0_0/Practitioner/')
                .send(person1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(400);
            person1Resource[0].meta.source = 'bwell';
            // ARRANGE
            // add the resources to FHIR server
            resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send(person1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            const container = getTestContainer();
            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = container.postRequestProcessor;
            await postRequestProcessor.waitTillDoneAsync({ requestId });

            resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send(person1Resource)
                .set(getHeaders('user/*.read user/*.write access/foo.*'));
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedWrongAccessScope);

            // ACT & ASSERT
            // search by token system and code and make sure we get the right Person back
            resp = await request
                .get('/4_0_0/Person/?_bundle=1')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPersonResources);
        });
        test('mergeWith_id fails with wrong reference values (create)', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // ACT & ASSERT
            const resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send(person2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedWrongReferenceValuesCreate, r => {
                delete r.id;
            });
        });
        test('mergeWith_id fails with wrong reference values (update)', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send(person1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            const container = getTestContainer();
            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = container.postRequestProcessor;
            await postRequestProcessor.waitTillDoneAsync({ requestId });

            resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send(person2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedWrongReferenceValues, r => {
                delete r.id;
            });
        });
        test('No invalid collections should be made through merge operation', async () => {
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

            // Create a valid resource with merge
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send(person1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            // Create invalid resource with merge
            resp = await request
                .post('/4_0_0/XYZ/1/$merge')
                .send(person1Resource)
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
                'Person_4_0_0', 'Person_4_0_0_History'
            ]));
        });
    });
});
