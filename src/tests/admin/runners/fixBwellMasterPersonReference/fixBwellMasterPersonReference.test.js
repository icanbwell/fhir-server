// test file
const person1Resource = require('./fixtures/Person/person1.json');
const person2Resource = require('./fixtures/Person/person2.json');
const patient1Resource = require('./fixtures/Patient/patient1.json');
const patient2Resource = require('./fixtures/Patient/patient2.json');

// expected
const expectedPerson1BeforeRun = require('./fixtures/expected/expectedPerson1BeforeRun.json');
const expectedPerson1WithMultiplePatientLinks = require('./fixtures/expected/expectedPerson1WithMultiplePatientLinks.json');
const expectedPerson1WithPersonUpdate = require('./fixtures/expected/expectedPerson1WithPersonUpdate.json');
const expectedPerson1AfterRun = require('./fixtures/expected/expectedPerson1AfterRun.json');

const expectedPerson2 = require('./fixtures/expected/expectedPerson2.json');
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
                .get(`/4_0_0/Patient/${expectedPatient1.id}`)
                .set(getHeaders())
                .expect(200);

            const patient1BeforeRun = resp.body;
            delete patient1BeforeRun.meta.lastUpdated;
            expect(patient1BeforeRun).toEqual(expectedPatient1);

            const container = getTestContainer();

            // run admin runner
            const collections = ['all'];
            const batchSize = 10000;

            container.register('fixBwellMasterPersonReference', (c) => new FixBwellMasterPersonReferenceRunner(
                {
                    mongoCollectionManager: c.mongoCollectionManager,
                    collections,
                    batchSize,
                    useAuditDatabase: false,
                    adminLogger: new AdminLogger(),
                    mongoDatabaseManager: c.mongoDatabaseManager,
                    preSaveManager: c.preSaveManager,
                    databaseQueryFactory: c.databaseQueryFactory,
                    resourceLocatorFactory: c.resourceLocatorFactory,
                    resourceMerger: c.resourceMerger,
                    writeToFile: false
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

        test('fixBwellMasterPerson makes references unique', async () => {
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
                .get(`/4_0_0/Person/${expectedPerson1BeforeRun.id}`)
                .set(getHeaders())
                .expect(200);

            const person1BeforeRun = resp.body;
            delete person1BeforeRun.meta.lastUpdated;
            expect(person1BeforeRun).toEqual(expectedPerson1BeforeRun);

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
            const batchSize = 10000;

            container.register('fixBwellMasterPersonReference', (c) => new FixBwellMasterPersonReferenceRunner(
                {
                    mongoCollectionManager: c.mongoCollectionManager,
                    collections,
                    batchSize,
                    useAuditDatabase: false,
                    adminLogger: new AdminLogger(),
                    mongoDatabaseManager: c.mongoDatabaseManager,
                    preSaveManager: c.preSaveManager,
                    databaseQueryFactory: c.databaseQueryFactory,
                    resourceLocatorFactory: c.resourceLocatorFactory,
                    resourceMerger: c.resourceMerger,
                    writeToFile: false
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

            // to create multiple links with for same patient
            resp = await request
                .post('/4_0_0/Person/$merge')
                .send(person1Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ updated: true });

            resp = await request
                .get(`/4_0_0/Person/${expectedPerson1AfterRun.id}`)
                .set(getHeaders())
                .expect(200);

            const person1BeforeSecondRun = resp.body;
            delete person1BeforeSecondRun.meta.lastUpdated;
            expect(person1BeforeSecondRun).toEqual(expectedPerson1WithMultiplePatientLinks);

            await fixBwellMasterPersonReference.processAsync();

            // second link is removed
            resp = await request
                .get(`/4_0_0/Person/${expectedPerson1AfterRun.id}`)
                .set(getHeaders())
                .expect(200);

            const person1AfterSecondRun = resp.body;
            delete person1AfterSecondRun.meta.lastUpdated;
            expectedPerson1AfterRun.meta.versionId = '2';
            expect(person1AfterSecondRun).toEqual(expectedPerson1AfterRun);

            resp = await request
                .get(`/4_0_0/Patient/${expectedPatient1.id}`)
                .set(getHeaders())
                .expect(200);

            const patient1AfterSecondRun = resp.body;
            delete patient1AfterSecondRun.meta.lastUpdated;
            expect(patient1AfterSecondRun).toEqual(expectedPatient1);

            resp = await request
                .get(`/4_0_0/Person/_history?id=${expectedPerson1AfterRun.id}`)
                .set(getHeaders())
                .expect(200);

            const person1HistoryAfterSecondRun = resp.body;

            expect(person1HistoryAfterSecondRun.entry).toBeDefined();
            expect(person1HistoryAfterSecondRun.entry.length).toEqual(2);

            delete person1HistoryAfterSecondRun.entry[0].resource.meta.lastUpdated;
            expectedPerson1AfterRun.meta.versionId = '1';
            expect(person1HistoryAfterSecondRun.entry[0].resource).toEqual(expectedPerson1AfterRun);

            delete person1HistoryAfterSecondRun.entry[1].resource.meta.lastUpdated;
            expectedPerson1AfterRun.meta.versionId = '2';
            expect(person1HistoryAfterSecondRun.entry[1].resource).toEqual(expectedPerson1AfterRun);
        });

        test('fixBwellMasterPerson doesnot work for references with conflicting resources', async () => {
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
            const batchSize = 10000;

            container.register('fixBwellMasterPersonReference', (c) => new FixBwellMasterPersonReferenceRunner(
                {
                    mongoCollectionManager: c.mongoCollectionManager,
                    collections,
                    batchSize,
                    useAuditDatabase: false,
                    adminLogger: new AdminLogger(),
                    mongoDatabaseManager: c.mongoDatabaseManager,
                    preSaveManager: c.preSaveManager,
                    databaseQueryFactory: c.databaseQueryFactory,
                    resourceLocatorFactory: c.resourceLocatorFactory,
                    resourceMerger: c.resourceMerger,
                    writeToFile: false
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
    });
});
