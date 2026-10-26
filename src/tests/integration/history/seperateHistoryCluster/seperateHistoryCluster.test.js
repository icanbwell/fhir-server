const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { TestMongoDatabaseManager } = require('../../testMongoDatabaseManager');
const { getMongoUrlAsync } = require('../../mongoTestRunner');

// test file
const person3Resource = require('./fixtures/Person/person3.json');
const personResource = require('./fixtures/Person/person.json');

// expected
const patch1 = require('./fixtures/patches/patch1.json');
const expectedPersonResources = require('./fixtures/expected/expectedPerson.json');
const expectedPersonAfterTest1 = require('./fixtures/expected/personAfterTest1.json');
const expectedTest1Result = require('./fixtures/expected/test1Result.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getHeadersJsonPatch,
    getTestContainer,
    mockHttpContext,
    getHeadersWithCustomToken
} = require('../../common');

class HistoryTestMongoDatabaseManager extends TestMongoDatabaseManager {
    async getResourceHistoryConfigAsync() {
        const mongoUrl = await getMongoUrlAsync();
        return {
            connection: mongoUrl, // set by https://github.com/shelfio/jest-mongodb
            db_name: 'resource-history',
            options: {}
        };
    }
}

describe('Seperate History Resource Database Cluster Tests', () => {
    let requestId;
    beforeEach(async () => {
        await commonBeforeEach();
        requestId = mockHttpContext();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('Patch request should create resource history document in seperate DB', async () => {
        const request = await createTestRequest((c) => {
            c.register(
                'mongoDatabaseManager',
                (c) =>
                    new HistoryTestMongoDatabaseManager({
                        configManager: c.configManager
                    })
            );
            return c;
        });
        const container = getTestContainer();

        /**
         * @type {HistoryTestMongoDatabaseManager}
         */
        const mongoDatabaseManager = container.mongoDatabaseManager;
        /**
         * mongo fhirDb connection
         * @type {import('mongodb').Db}
         */
        const db = await mongoDatabaseManager.getClientDbAsync();
        const resourceHistoryDb = await mongoDatabaseManager.getResourceHistoryDbAsync();
        let collections = await db.listCollections().toArray();
        let resourceHistoryCollections = await resourceHistoryDb.listCollections().toArray();
        // Check that initially there are no collections in db.
        expect(collections.length).toEqual(0);
        expect(resourceHistoryCollections.length).toEqual(0);

        // Create a valid resource
        let resp = await request
            .post('/4_0_0/Person/1/$merge?validate=true')
            .send(person3Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        // Patch hit with valid resource
        resp = await request
            .patch('/4_0_0/Person/7d744c63-fa81-45e9-bcb4-f312940e9300')
            .send(patch1)
            .set(getHeadersJsonPatch());

        // Patch hit with invalid resource
        resp = await request.patch('/4_0_0/XYZ/1').send(patch1).set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(404);

        const postRequestProcessor = container.postRequestProcessor;
        await postRequestProcessor.waitTillDoneAsync({ requestId });

        // Check that after the above requests, only valid collections are made in db.
        collections = await db.listCollections().toArray();
        resourceHistoryCollections = await resourceHistoryDb.listCollections().toArray();
        const collectionNames = collections.map((collection) => collection.name);
        const resourceHistoryCollectionNames = resourceHistoryCollections.map(
            (collection) => collection.name
        );
        expect(collectionNames).toEqual(expect.arrayContaining(['Person_4_0_0']));
        expect(resourceHistoryCollectionNames).toEqual(
            expect.arrayContaining(['Person_4_0_0_History'])
        );
    });

    test('admin endpoint, person to patient link is removed using id', async () => {
        const request = await createTestRequest((c) => {
            c.register(
                'mongoDatabaseManager',
                (c) =>
                    new HistoryTestMongoDatabaseManager({
                        configManager: c.configManager
                    })
            );
            return c;
        });
        // add the person resource to FHIR server
        let resp = await request
            .post('/4_0_0/Person/$merge?validate=true')
            .send(personResource)
            .set(getHeadersWithCustomToken('user/*.read user/*.write admin/*.*'))
            .expect(200);

        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .get(`/4_0_0/Person/${personResource.id}`)
            .set(getHeaders())
            .expect(200);

        // The link is removed from the person resource.
        expect(resp).toHaveResponse(expectedPersonResources);

        // Remove person to person link using admin panel
        resp = await request
            .post('/admin/removePersonToPatientLink')
            .send({
                personId: 'Person/1',
                patientId: 'Patient/1'
            })
            .set(getHeadersWithCustomToken('user/*.read user/*.write admin/*.*'))
            .expect(200);

        // Expect removed meesage to be returned
        expect(resp).toHaveResponse(expectedTest1Result);

        resp = await request
            .get(`/4_0_0/Person/${personResource.id}`)
            .set(getHeaders())
            .expect(200);

        // The link is removed from the person resource.
        expect(resp).toHaveResponse(expectedPersonAfterTest1);

        // Expect the history collection to be created
        resp = await request
            .get(`/4_0_0/Person/${personResource.id}/_history/2`)
            .set(getHeaders())
            .expect(200);

        // The history collection is created.
        expect(resp).toHaveResponse(expectedPersonAfterTest1);
    });
});
