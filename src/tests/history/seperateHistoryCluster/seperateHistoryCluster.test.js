const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { TestMongoDatabaseManager } = require('../../testMongoDatabaseManager');
const { getMongoUrlAsync } = require('../../mongoTestRunner');
const { AdminLogger } = require('../../../admin/adminLogger');
const { assertTypeEquals } = require('../../../utils/assertType');
const {
    ChangeSourceAssigningAuthorityRunner
} = require('../../../admin/runners/changeSourceAssigningAuthorityRunner');

// test file
const person1Resource = require('./fixtures/Person/person1.json');
const person2Resource = require('./fixtures/Person/person2.json');
const person3Resource = require('./fixtures/Person/person3.json');
const personResource = require('./fixtures/Person/person.json');

// expected
const patch1 = require('./fixtures/patches/patch1.json');
const expectedPersonResources = require('./fixtures/expected/expectedPerson.json');
const expectedPersonAfterTest1 = require('./fixtures/expected/personAfterTest1.json');
const expectedTest1Result = require('./fixtures/expected/test1Result.json');
const expectedPerson1BeforeRun = require('./fixtures/expected/expectedPerson1BeforeRun.json');
const expectedPerson1AfterRun = require('./fixtures/expected/expectedPerson1AfterRun.json');
const expectedPerson2 = require('./fixtures/expected/expectedPerson2.json');

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

describe('Person Tests', () => {
    let requestId;
    beforeEach(async () => {
        const container = getTestContainer();
        if (container) {
            delete container.services.changeSourceAssigningAuthorityRunner;
        }
        await commonBeforeEach();
        requestId = mockHttpContext();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Test scipt with seperate resource history DB', () => {
        test('changeSourceAssigningAuthority works for person with history', async () => {
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

            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/$merge')
                .send(person1Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            const postRequestProcessor = container.postRequestProcessor;
            await postRequestProcessor.waitTillDoneAsync({ requestId });

            resp = await request
                .post('/4_0_0/Person/$merge')
                .send(person2Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            await postRequestProcessor.waitTillDoneAsync({ requestId });

            resp = await request
                .get(`/4_0_0/Person/${expectedPerson1BeforeRun.id}`)
                .set(getHeaders())
                .expect(200);

            const person1BeforeRun = resp.body;
            delete person1BeforeRun.meta.lastUpdated;
            expect(person1BeforeRun).toEqual(expectedPerson1BeforeRun);

            resp = await request
                .get(`/4_0_0/Person/${expectedPerson2.id}`)
                .set(getHeaders())
                .expect(200);

            const person2BeforeRun = resp.body;
            delete person2BeforeRun.meta.lastUpdated;
            expect(person2BeforeRun).toEqual(expectedPerson2);

            // run admin runner
            const collections = ['all'];
            const batchSize = 10000;

            container.register(
                'changeSourceAssigningAuthorityRunner',
                (c) =>
                    new ChangeSourceAssigningAuthorityRunner({
                        collections,
                        batchSize,
                        useAuditDatabase: false,
                        adminLogger: new AdminLogger(),
                        mongoDatabaseManager: c.mongoDatabaseManager,
                        preSaveManager: c.preSaveManager,
                        databaseQueryFactory: c.databaseQueryFactory,
                        resourceLocatorFactory: c.resourceLocatorFactory,
                        resourceMerger: c.resourceMerger,
                        oldSourceAssigningAuthority: 'client-1',
                        newSourceAssigningAuthority: 'client',
                        searchParametersManager: c.searchParametersManager
                    })
            );

            /**
             * @type {ChangeSourceAssigningAuthorityRunner}
             */
            const changeSourceAssigningAuthorityRunner =
                container.changeSourceAssigningAuthorityRunner;
            assertTypeEquals(
                changeSourceAssigningAuthorityRunner,
                ChangeSourceAssigningAuthorityRunner
            );
            await changeSourceAssigningAuthorityRunner.processAsync();

            resp = await request
                .get(`/4_0_0/Person/${expectedPerson1AfterRun.id}`)
                .set(getHeaders())
                .expect(200);

            const person1AfterRun = resp.body;
            delete person1AfterRun.meta.lastUpdated;
            expect(person1AfterRun).toEqual(expectedPerson1AfterRun);

            resp = await request
                .get(`/4_0_0/Person/${expectedPerson2.id}`)
                .set(getHeaders())
                .expect(200);

            const person2AfterRun = resp.body;
            delete person2AfterRun.meta.lastUpdated;
            expect(person2AfterRun).toEqual(expectedPerson2);

            resp = await request
                .get(`/4_0_0/Person/_history?id=${expectedPerson1AfterRun.id}`)
                .set(getHeaders())
                .expect(200);

            const person1History = resp.body;

            expect(person1History.entry).toBeDefined();
            expect(person1History.entry.length).toEqual(1);

            delete person1History.entry[0].resource.meta.lastUpdated;
            expect(person1History.entry[0].resource).toEqual(expectedPerson1AfterRun);

            resp = await request
                .get(`/4_0_0/Person/_history?id=${expectedPerson2.id}`)
                .set(getHeaders())
                .expect(200);

            const person2History = resp.body;

            expect(person2History.entry).toBeDefined();
            expect(person2History.entry.length).toEqual(1);

            delete person2History.entry[0].resource.meta.lastUpdated;
            expect(person2History.entry[0].resource).toEqual(expectedPerson2);
        });
    });
});
