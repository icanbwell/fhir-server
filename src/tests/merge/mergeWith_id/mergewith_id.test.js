// test file
const person1Resource = require('./fixtures/Person/person1.json');

// expected
const expectedPersonResources = require('./fixtures/expected/expected_Person.json');
const expectedMissingAccessScope = require('./fixtures/expected/expectedMissingAccessScope.json');
const expectedWrongAccessScope = require('./fixtures/expected/expectedWrongAccessScope.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest, getTestContainer,
} = require('../../common');
const {describe, beforeEach, afterEach, test} = require('@jest/globals');
const deepcopy = require('deepcopy');

describe('Person Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Person mergeWith_id Tests', () => {
        test('mergeWith_id works with access/*.* (create)', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send(person1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            // ACT & ASSERT
            // search by token system and code and make sure we get the right Person back
            resp = await request
                .get('/4_0_0/Person/?_bundle=1')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPersonResources);
        });
        test('mergeWith_id works with access/*.* (update)', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send(person1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            const container = getTestContainer();
            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = container.postRequestProcessor;
            await postRequestProcessor.waitTillDoneAsync();

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
            expect(resp).toHaveMergeResponse({created: false, updated: false});

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
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send(person1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            const container = getTestContainer();
            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = container.postRequestProcessor;
            await postRequestProcessor.waitTillDoneAsync();

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
            const person = await personCollection.findOne({'id': 'aba5bcf41cf64435839cf0568c121843'});
            const initialPersonUuid = person._uuid;

            const person1ResourceWithChange = deepcopy(person1Resource);
            person1ResourceWithChange[0].gender = 'female';
            resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send(person1ResourceWithChange)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: false, updated: true});

            // check that the uuid has not changed
            const finalPersonUuid = (await personCollection.findOne({'id': 'aba5bcf41cf64435839cf0568c121843'}))._uuid;
            expect(finalPersonUuid).toBe(initialPersonUuid);
        });
        test('mergeWith_id fails with missing permissions (create)', async () => {
            const request = await createTestRequest();
            // ARRANGE

            // ACT & ASSERT
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send(person1Resource)
                .set(getHeaders('user/*.read user/*.write'));
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(403);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedMissingAccessScope, r => {
                delete r['diagnostics'];
            });
        });
        test('mergeWith_id fails with missing permissions (update)', async () => {
            const request = await createTestRequest();
            // ARRANGE
            let resp = await request
                .get('/4_0_0/Person/?_bundle=1')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            const container = getTestContainer();
            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = container.postRequestProcessor;
            await postRequestProcessor.waitTillDoneAsync();

            // ACT & ASSERT
            // add the resources to FHIR server
            resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send(person1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

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
            expect(resp).toHaveStatusCode(403);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedMissingAccessScope, r => {
                delete r['diagnostics'];
            });

        });
        test('mergeWith_id fails with wrong access scope (create)', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // ACT & ASSERT
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send(person1Resource)
                .set(getHeaders('user/*.read user/*.write access/foo.*'));
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(403);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedWrongAccessScope, r => {
                delete r['diagnostics'];
            });
        });
        test('mergeWith_id fails with wrong access scope (update)', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send(person1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            const container = getTestContainer();
            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = container.postRequestProcessor;
            await postRequestProcessor.waitTillDoneAsync();

            resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send(person1Resource)
                .set(getHeaders('user/*.read user/*.write access/foo.*'));
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(403);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedWrongAccessScope, r => {
                delete r['diagnostics'];
            });

            // ACT & ASSERT
            // search by token system and code and make sure we get the right Person back
            resp = await request
                .get('/4_0_0/Person/?_bundle=1')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPersonResources);
        });
    });
});
