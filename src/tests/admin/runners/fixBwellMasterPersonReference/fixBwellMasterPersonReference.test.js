// test file
const person1Resource = require('./fixtures/Person/person1.json');
const person2Resource = require('./fixtures/Person/person2.json');
const person3Resource = require('./fixtures/Person/person3.json');
const person4Resource = require('./fixtures/Person/person4.json');
const person5Resource = require('./fixtures/Person/person5.json');
const person6Resource = require('./fixtures/Person/person6.json');
const patient1Resource = require('./fixtures/Patient/patient1.json');
const patient2Resource = require('./fixtures/Patient/patient2.json');

// expected
const expectedPerson1BeforeRun = require('./fixtures/expected/expectedPerson1BeforeRun.json');
const expectedPerson1WithPersonUpdate = require('./fixtures/expected/expectedPerson1WithPersonUpdate.json');
const expectedPerson1AfterRun = require('./fixtures/expected/expectedPerson1AfterRun.json');

const expectedPerson4BeforeRun = require('./fixtures/expected/expectedPerson4BeforeRun.json');
const expectedPerson4AfterRun = require('./fixtures/expected/expectedPerson4AfterRun.json');

const expectedPerson5BeforeRun = require('./fixtures/expected/expectedPerson5BeforeRun.json');
const expectedPerson5AfterRun = require('./fixtures/expected/expectedPerson5AfterRun.json');

const expectedPerson2 = require('./fixtures/expected/expectedPerson2.json');
const expectedPerson3 = require('./fixtures/expected/expectedPerson3.json');
const expectedPerson6 = require('./fixtures/expected/expectedPerson6.json');
const expectedPatient1 = require('./fixtures/expected/expectedPatient1.json');
const expectedPatient2 = require('./fixtures/expected/expectedPatient2.json');

const {
    commonBeforeEach,
    commonAfterEach,
    createTestRequest,
    getTestContainer,
    getHeaders
} = require('../../../common');
const { AdminLogger } = require('../../../../admin/adminLogger');
const { assertTypeEquals } = require('../../../../utils/assertType');
const { FixBwellMasterPersonReferenceRunner } = require('../../../../admin/runners/fixBwellMasterPersonReferenceRunner');

async function setupDatabaseAsync(mongoDatabaseManager, incomingResource, expectedResourceInDatabase) {
    const fhirDb = await mongoDatabaseManager.getClientDbAsync();

    const collection = fhirDb.collection(`${incomingResource.resourceType}_4_0_0`);
    await collection.insertOne(incomingResource);

    // ACT & ASSERT
    // check that two entries were stored in the database
    /**
     * @type {import('mongodb').WithId<import('mongodb').Document> | null}
     */
    const resource = await collection.findOne({id: incomingResource.id});

    delete resource._id;

    incomingResource.meta.lastUpdated = resource.meta.lastUpdated;

    expect(resource).toStrictEqual(expectedResourceInDatabase);
    return collection;
}

async function setupHistoryDatabaseAsync(mongoDatabaseManager, incomingResource, expectedResourceInDatabase) {
    const fhirDb = await mongoDatabaseManager.getClientDbAsync();

    const collection = fhirDb.collection(`${incomingResource.resourceType}_4_0_0_History`);
    await collection.insertOne({ resource: incomingResource});

    // ACT & ASSERT
    // check that two entries were stored in the database
    /**
     * @type {import('mongodb').WithId<import('mongodb').Document> | null}
     */
    const resource = await collection.findOne({'resource.id': incomingResource.id});

    delete resource.resource._id;

    expect(resource.resource).toStrictEqual(expectedResourceInDatabase);
    return collection;
}

describe('Person Tests', () => {
    beforeEach(async () => {
        const container = getTestContainer();
        if (container) {
            delete container.services.fixBwellMasterPersonReference;
        }
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Bwell Master Person Tests', () => {
        test('fixBwellMasterPerson works for person with history', async () => {
            // eslint-disable-next-line no-unused-vars
            const request = await createTestRequest();

            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/$merge')
                .send(person1Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Person/$merge')
                .send(person2Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Person/$merge')
                .send(person6Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Patient/$merge')
                .send(patient1Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

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

            resp = await request
                .get(`/4_0_0/Person/${expectedPerson6.id}`)
                .set(getHeaders())
                .expect(200);

            const person6BeforeRun = resp.body;
            delete person6BeforeRun.meta.lastUpdated;
            expect(person6BeforeRun).toEqual(expectedPerson6);

            resp = await request
                .get(`/4_0_0/Patient/${expectedPatient1.id}`)
                .set(getHeaders())
                .expect(200);

            const patient1BeforeRun = resp.body;
            delete patient1BeforeRun.meta.lastUpdated;
            expect(patient1BeforeRun).toEqual(expectedPatient1);

            const container = getTestContainer();

            // run admin runner
            const collections = ['all'];
            const preLoadCollections = ['all'];
            const batchSize = 10000;

            container.register('fixBwellMasterPersonReference', (c) => new FixBwellMasterPersonReferenceRunner(
                {
                    mongoCollectionManager: c.mongoCollectionManager,
                    collections,
                    preLoadCollections,
                    batchSize,
                    useAuditDatabase: false,
                    adminLogger: new AdminLogger(),
                    mongoDatabaseManager: c.mongoDatabaseManager,
                    preSaveManager: c.preSaveManager,
                    databaseQueryFactory: c.databaseQueryFactory,
                    resourceLocatorFactory: c.resourceLocatorFactory,
                    resourceMerger: c.resourceMerger,
                }
            )
            );

            /**
             * @type {FixBwellMasterPersonReferenceRunner}
             */
            const fixBwellMasterPersonReference = container.fixBwellMasterPersonReference;
            assertTypeEquals(fixBwellMasterPersonReference, FixBwellMasterPersonReferenceRunner);
            await fixBwellMasterPersonReference.processAsync();

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
                .get(`/4_0_0/Person/${expectedPerson6.id}`)
                .set(getHeaders())
                .expect(200);

            const person6AfterRun = resp.body;
            delete person6AfterRun.meta.lastUpdated;
            expect(person6AfterRun).toEqual(expectedPerson6);

            resp = await request
                .get(`/4_0_0/Patient/${expectedPatient1.id}`)
                .set(getHeaders())
                .expect(200);

            const patient1AfterRun = resp.body;
            delete patient1AfterRun.meta.lastUpdated;
            expect(patient1AfterRun).toEqual(expectedPatient1);

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

            resp = await request
                .get(`/4_0_0/Patient/_history?id=${expectedPatient1.id}`)
                .set(getHeaders())
                .expect(200);

            const patient1History = resp.body;

            expect(patient1History.entry).toBeDefined();
            expect(patient1History.entry.length).toEqual(1);

            delete patient1History.entry[0].resource.meta.lastUpdated;
            expect(patient1History.entry[0].resource).toEqual(expectedPatient1);
        });

        test('fixBwellMasterPerson to remove duplicate links', async () => {
            // eslint-disable-next-line no-unused-vars
            const request = await createTestRequest();

            const container = getTestContainer();
            // insert directly into database instead of going through merge() so we simulate old records
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;

            await setupDatabaseAsync(
                mongoDatabaseManager, person5Resource, expectedPerson5BeforeRun
            );

            await setupHistoryDatabaseAsync(
                mongoDatabaseManager, person5Resource, expectedPerson5BeforeRun
            );

            let resp = await request
                .post('/4_0_0/Patient/$merge')
                .send(patient1Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get(`/4_0_0/Patient/${expectedPatient1.id}`)
                .set(getHeaders())
                .expect(200);

            const patient1BeforeRun = resp.body;
            delete patient1BeforeRun.meta.lastUpdated;
            expect(patient1BeforeRun).toEqual(expectedPatient1);

            // run admin runner
            const collections = ['all'];
            const preLoadCollections = ['all'];
            const batchSize = 10000;

            container.register('fixBwellMasterPersonReference', (c) => new FixBwellMasterPersonReferenceRunner(
                {
                    mongoCollectionManager: c.mongoCollectionManager,
                    collections,
                    preLoadCollections,
                    batchSize,
                    useAuditDatabase: false,
                    adminLogger: new AdminLogger(),
                    mongoDatabaseManager: c.mongoDatabaseManager,
                    preSaveManager: c.preSaveManager,
                    databaseQueryFactory: c.databaseQueryFactory,
                    resourceLocatorFactory: c.resourceLocatorFactory,
                    resourceMerger: c.resourceMerger,
                }
            )
            );

            /**
             * @type {FixBwellMasterPersonReferenceRunner}
             */
            const fixBwellMasterPersonReference = container.fixBwellMasterPersonReference;
            assertTypeEquals(fixBwellMasterPersonReference, FixBwellMasterPersonReferenceRunner);
            await fixBwellMasterPersonReference.processAsync();

            resp = await request
                .get(`/4_0_0/Person/${expectedPerson5AfterRun.id}`)
                .set(getHeaders())
                .expect(200);

            const person5AfterRun = resp.body;
            delete person5AfterRun.meta.lastUpdated;
            expect(person5AfterRun).toEqual(expectedPerson5AfterRun);

            resp = await request
                .get(`/4_0_0/Person/_history?id=${expectedPerson5AfterRun.id}`)
                .set(getHeaders())
                .expect(200);

            const person5History = resp.body;

            expect(person5History.entry).toBeDefined();
            expect(person5History.entry.length).toEqual(1);

            delete person5History.entry[0].resource.meta.lastUpdated;
            expect(person5History.entry[0].resource).toEqual(expectedPerson5AfterRun);

            resp = await request
                .get(`/4_0_0/Patient/${expectedPatient1.id}`)
                .set(getHeaders())
                .expect(200);

            const patient1AfterRun = resp.body;
            delete patient1AfterRun.meta.lastUpdated;
            expect(patient1AfterRun).toEqual(expectedPatient1);
        });

        test('fixBwellMasterPerson doesnot work for references with conflicting resources and works for non conflicting resources', async () => {
            // eslint-disable-next-line no-unused-vars
            const request = await createTestRequest();

            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/$merge')
                .send(person1Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Person/$merge')
                .send(person2Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Patient/$merge')
                .send(patient1Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Patient/$merge')
                .send(patient2Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get(`/4_0_0/Person/${expectedPerson1BeforeRun.id}`)
                .set(getHeaders())
                .expect(200);

            const person1BeforeRun = resp.body;
            delete person1BeforeRun.meta.lastUpdated;
            expect(person1BeforeRun).toEqual(expectedPerson1BeforeRun);

            resp = await request
                .get(`/4_0_0/Patient/${expectedPatient1.id}|thedacare`)
                .set(getHeaders())
                .expect(200);

            const patient1BeforeRun = resp.body;
            delete patient1BeforeRun.meta.lastUpdated;
            expect(patient1BeforeRun).toEqual(expectedPatient1);

            resp = await request
                .get(`/4_0_0/Patient/${expectedPatient2.id}|humanApi`)
                .set(getHeaders())
                .expect(200);

            const patient2BeforeRun = resp.body;
            delete patient2BeforeRun.meta.lastUpdated;
            expect(patient2BeforeRun).toEqual(expectedPatient2);

            const container = getTestContainer();

            // run admin runner
            const collections = ['all'];
            const preLoadCollections = ['all'];
            const batchSize = 10000;

            container.register('fixBwellMasterPersonReference', (c) => new FixBwellMasterPersonReferenceRunner(
                {
                    mongoCollectionManager: c.mongoCollectionManager,
                    collections,
                    preLoadCollections,
                    batchSize,
                    useAuditDatabase: false,
                    adminLogger: new AdminLogger(),
                    mongoDatabaseManager: c.mongoDatabaseManager,
                    preSaveManager: c.preSaveManager,
                    databaseQueryFactory: c.databaseQueryFactory,
                    resourceLocatorFactory: c.resourceLocatorFactory,
                    resourceMerger: c.resourceMerger,
                }
            )
            );

            /**
             * @type {FixBwellMasterPersonReferenceRunner}
             */
            const fixBwellMasterPersonReference = container.fixBwellMasterPersonReference;
            assertTypeEquals(fixBwellMasterPersonReference, FixBwellMasterPersonReferenceRunner);
            await fixBwellMasterPersonReference.processAsync();

            resp = await request
                .get(`/4_0_0/Person/${expectedPerson1AfterRun.id}`)
                .set(getHeaders())
                .expect(200);

            const person1AfterRun = resp.body;
            delete person1AfterRun.meta.lastUpdated;
            expect(person1AfterRun).toEqual(expectedPerson1WithPersonUpdate);

            resp = await request
                .get(`/4_0_0/Patient/${expectedPatient1.id}|thedacare`)
                .set(getHeaders())
                .expect(200);

            const patient1AfterRun = resp.body;
            delete patient1AfterRun.meta.lastUpdated;
            expect(patient1AfterRun).toEqual(expectedPatient1);

            resp = await request
                .get(`/4_0_0/Patient/${expectedPatient2.id}|humanApi`)
                .set(getHeaders())
                .expect(200);

            const patient2AfterRun = resp.body;
            delete patient2AfterRun.meta.lastUpdated;
            expect(patient2AfterRun).toEqual(expectedPatient2);

            resp = await request
                .get(`/4_0_0/Person/_history?id=${expectedPerson1AfterRun.id}`)
                .set(getHeaders())
                .expect(200);

            const person1History = resp.body;

            expect(person1History.entry).toBeDefined();
            expect(person1History.entry.length).toEqual(1);

            delete person1History.entry[0].resource.meta.lastUpdated;
            expect(person1History.entry[0].resource).toEqual(expectedPerson1WithPersonUpdate);
        });

        test('fixBwellMasterPerson doesnot work for references that do not need change', async () => {
            // eslint-disable-next-line no-unused-vars
            const request = await createTestRequest();

            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/$merge')
                .send(person2Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Person/$merge')
                .send(person3Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get(`/4_0_0/Person/${expectedPerson2.id}`)
                .set(getHeaders())
                .expect(200);

            const person2BeforeRun = resp.body;
            delete person2BeforeRun.meta.lastUpdated;
            expect(person2BeforeRun).toEqual(expectedPerson2);

            resp = await request
                .get(`/4_0_0/Person/${expectedPerson3.id}`)
                .set(getHeaders())
                .expect(200);

            const person3BeforeRun = resp.body;
            delete person3BeforeRun.meta.lastUpdated;
            expect(person3BeforeRun).toEqual(expectedPerson3);

            const container = getTestContainer();

            // run admin runner
            const collections = ['all'];
            const preLoadCollections = ['all'];
            const batchSize = 10000;

            container.register('fixBwellMasterPersonReference', (c) => new FixBwellMasterPersonReferenceRunner(
                {
                    mongoCollectionManager: c.mongoCollectionManager,
                    collections,
                    preLoadCollections,
                    batchSize,
                    useAuditDatabase: false,
                    adminLogger: new AdminLogger(),
                    mongoDatabaseManager: c.mongoDatabaseManager,
                    preSaveManager: c.preSaveManager,
                    databaseQueryFactory: c.databaseQueryFactory,
                    resourceLocatorFactory: c.resourceLocatorFactory,
                    resourceMerger: c.resourceMerger,
                }
            )
            );

            /**
             * @type {FixBwellMasterPersonReferenceRunner}
             */
            const fixBwellMasterPersonReference = container.fixBwellMasterPersonReference;
            assertTypeEquals(fixBwellMasterPersonReference, FixBwellMasterPersonReferenceRunner);
            await fixBwellMasterPersonReference.processAsync();

            resp = await request
                .get(`/4_0_0/Person/${expectedPerson2.id}`)
                .set(getHeaders())
                .expect(200);

            const person2AfterRun = resp.body;
            delete person2AfterRun.meta.lastUpdated;
            expect(person2AfterRun).toEqual(expectedPerson2);

            resp = await request
                .get(`/4_0_0/Person/${expectedPerson3.id}`)
                .set(getHeaders())
                .expect(200);

            const person3AfterRun = resp.body;
            delete person3AfterRun.meta.lastUpdated;
            expect(person3AfterRun).toEqual(expectedPerson3);
        });

        test('fixBwellMasterPerson works for references with sourceAssigningAuthority as slug', async () => {
            // eslint-disable-next-line no-unused-vars
            const request = await createTestRequest();

            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/$merge')
                .send(person4Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Patient/$merge')
                .send(patient1Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get(`/4_0_0/Person/${expectedPerson4BeforeRun.id}`)
                .set(getHeaders())
                .expect(200);

            const person4BeforeRun = resp.body;
            delete person4BeforeRun.meta.lastUpdated;
            expect(person4BeforeRun).toEqual(expectedPerson4BeforeRun);

            resp = await request
                .get(`/4_0_0/Patient/${expectedPatient1.id}`)
                .set(getHeaders())
                .expect(200);

            const patient1BeforeRun = resp.body;
            delete patient1BeforeRun.meta.lastUpdated;
            expect(patient1BeforeRun).toEqual(expectedPatient1);

            const container = getTestContainer();

            // run admin runner
            const collections = ['all'];
            const preLoadCollections = ['all'];
            const batchSize = 10000;

            container.register('fixBwellMasterPersonReference', (c) => new FixBwellMasterPersonReferenceRunner(
                {
                    mongoCollectionManager: c.mongoCollectionManager,
                    collections,
                    preLoadCollections,
                    batchSize,
                    useAuditDatabase: false,
                    adminLogger: new AdminLogger(),
                    mongoDatabaseManager: c.mongoDatabaseManager,
                    preSaveManager: c.preSaveManager,
                    databaseQueryFactory: c.databaseQueryFactory,
                    resourceLocatorFactory: c.resourceLocatorFactory,
                    resourceMerger: c.resourceMerger,
                }
            )
            );

            /**
             * @type {FixBwellMasterPersonReferenceRunner}
             */
            const fixBwellMasterPersonReference = container.fixBwellMasterPersonReference;
            assertTypeEquals(fixBwellMasterPersonReference, FixBwellMasterPersonReferenceRunner);
            await fixBwellMasterPersonReference.processAsync();

            resp = await request
                .get(`/4_0_0/Person/${expectedPerson4AfterRun.id}`)
                .set(getHeaders())
                .expect(200);

            const person4AfterRun = resp.body;
            delete person4AfterRun.meta.lastUpdated;
            expect(person4AfterRun).toEqual(expectedPerson4AfterRun);

            resp = await request
                .get(`/4_0_0/Patient/${expectedPatient1.id}`)
                .set(getHeaders())
                .expect(200);

            const patient1AfterRun = resp.body;
            delete patient1AfterRun.meta.lastUpdated;
            expect(patient1AfterRun).toEqual(expectedPatient1);

            resp = await request
                .get(`/4_0_0/Person/_history?id=${expectedPerson4AfterRun.id}`)
                .set(getHeaders())
                .expect(200);

            const person4History = resp.body;

            expect(person4History.entry).toBeDefined();
            expect(person4History.entry.length).toEqual(1);

            delete person4History.entry[0].resource.meta.lastUpdated;
            expect(person4History.entry[0].resource).toEqual(expectedPerson4AfterRun);
        });
    });
});
