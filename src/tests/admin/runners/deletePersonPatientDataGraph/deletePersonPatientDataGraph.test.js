// test file
const person1Resource = require('./fixtures/Person/person1.json');
const person2Resource = require('./fixtures/Person/person2.json');
const patient1Resource = require('./fixtures/Patient/patient1.json');

// expected
const expectedPerson1 = require('./fixtures/expected/expectedPerson1.json');
const expectedPerson2 = require('./fixtures/expected/expectedPerson2BeforeRun.json');
const expectedPerson2AfterRun = require('./fixtures/expected/expectedPerson2AfterRun.json');
const expectedPatient1 = require('./fixtures/expected/expectedPatient1.json');

const {
    commonBeforeEach,
    commonAfterEach,
    createTestRequest,
    getTestContainer,
    getHeaders,
} = require('../../../common');
const { AdminLogger } = require('../../../../admin/adminLogger');
const {
    DeletePersonPatientDataGraphRunner,
} = require('../../../../admin/runners/deletePersonPatientDataGraphRunner');
const {describe, beforeEach, afterEach, test, expect} = require('@jest/globals');

describe('Person Tests', () => {
    beforeEach(async () => {
        const container = getTestContainer();
        if (container) {
            delete container.services.deletePersonPatientDataGraphRunner;
        }
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Person/Patient data graph deletion test', () => {
        test('Only person deletion works', async () => {
            // eslint-disable-next-line no-unused-vars
            const request = await createTestRequest();

            let resp = await request
                .post('/4_0_0/Person/$merge')
                .send(person1Resource)
                .set(getHeaders())
                .expect(200);

            resp = await request
                .get('/4_0_0/Person/1')
                .set(getHeaders())
                .expect(200);

            const person1 = resp.body;
            delete person1.meta.lastUpdated;
            expect(person1).toEqual(expectedPerson1);

            const container = getTestContainer();

            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;

            const fhirDb = await mongoDatabaseManager.getClientDbAsync();
            const personCollection = fhirDb.collection('Person_4_0_0');

            expect((await personCollection.find({}).toArray()).length).toEqual(1);

            const batchSize = 100;
            const concurrencyBatchSize = 10;
            container.register(
                'deletePersonPatientDataGraphRunner',
                (c) =>
                    new DeletePersonPatientDataGraphRunner({
                        mongoCollectionManager: c.mongoCollectionManager,
                        batchSize,
                        concurrencyBatchSize,
                        adminLogger: new AdminLogger(),
                        mongoDatabaseManager: c.mongoDatabaseManager,
                        personUuids: ['61abdd48-df46-5e98-ac6c-fde3cace4d07'],
                        patientUuids: [],
                        adminPersonPatientDataManager: c.adminPersonPatientDataManager
                    })
            );

            /**
             * @type {DeletePersonPatientDataGraphRunner}
             */
            const deletePersonPatientDataGraphRunner = container.deletePersonPatientDataGraphRunner;
            expect(deletePersonPatientDataGraphRunner).toBeInstanceOf(
                DeletePersonPatientDataGraphRunner
            );
            await deletePersonPatientDataGraphRunner.processAsync();

            expect((await personCollection.find({}).toArray()).length).toEqual(0);
        });

        test('Only patient deletion works', async () => {
            // eslint-disable-next-line no-unused-vars
            const request = await createTestRequest();

            let resp = await request
                .post('/4_0_0/Patient/$merge')
                .send(patient1Resource)
                .set(getHeaders())
                .expect(200);

            resp = await request
                .post('/4_0_0/Person/$merge')
                .send(person2Resource)
                .set(getHeaders())
                .expect(200);

            resp = await request
                .get('/4_0_0/Patient/1')
                .set(getHeaders())
                .expect(200);

            const patient1 = resp.body;
            delete patient1.meta.lastUpdated;
            expect(patient1).toEqual(expectedPatient1);

            resp = await request
                .get('/4_0_0/Person/2')
                .set(getHeaders())
                .expect(200);

            const person2 = resp.body;
            delete person2.meta.lastUpdated;
            expect(person2).toEqual(expectedPerson2);

            const container = getTestContainer();

            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;

            const fhirDb = await mongoDatabaseManager.getClientDbAsync();
            const patientCollection = fhirDb.collection('Patient_4_0_0');

            expect((await patientCollection.find({}).toArray()).length).toEqual(1);

            const batchSize = 100;
            const concurrencyBatchSize = 10;
            container.register(
                'deletePersonPatientDataGraphRunner',
                (c) =>
                    new DeletePersonPatientDataGraphRunner({
                        mongoCollectionManager: c.mongoCollectionManager,
                        batchSize,
                        concurrencyBatchSize,
                        adminLogger: new AdminLogger(),
                        mongoDatabaseManager: c.mongoDatabaseManager,
                        patientUuids: ['61abdd48-df46-5e98-ac6c-fde3cace4d07'],
                        personUuids: [],
                        adminPersonPatientDataManager: c.adminPersonPatientDataManager
                    })
            );

            /**
             * @type {DeletePersonPatientDataGraphRunner}
             */
            const deletePersonPatientDataGraphRunner = container.deletePersonPatientDataGraphRunner;
            expect(deletePersonPatientDataGraphRunner).toBeInstanceOf(
                DeletePersonPatientDataGraphRunner
            );
            await deletePersonPatientDataGraphRunner.processAsync();

            expect((await patientCollection.find({}).toArray()).length).toEqual(0);

            resp = await request
                .get('/4_0_0/Person/2')
                .set(getHeaders())
                .expect(200);

            const person2AfterRun = resp.body;
            delete person2AfterRun.meta.lastUpdated;
            expect(person2AfterRun).toEqual(expectedPerson2AfterRun);
        });

        test('Person and patient deletion works', async () => {
            // eslint-disable-next-line no-unused-vars
            const request = await createTestRequest();

            let resp = await request
                .post('/4_0_0/Patient/$merge')
                .send(patient1Resource)
                .set(getHeaders())
                .expect(200);

            resp = await request
                .post('/4_0_0/Person/$merge')
                .send(person1Resource)
                .set(getHeaders())
                .expect(200);

            resp = await request
                .get('/4_0_0/Patient/1')
                .set(getHeaders())
                .expect(200);

            const patient1 = resp.body;
            delete patient1.meta.lastUpdated;
            expect(patient1).toEqual(expectedPatient1);

            resp = await request
                .get('/4_0_0/Person/1')
                .set(getHeaders())
                .expect(200);

            const person1 = resp.body;
            delete person1.meta.lastUpdated;
            expect(person1).toEqual(expectedPerson1);

            const container = getTestContainer();

            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;

            const fhirDb = await mongoDatabaseManager.getClientDbAsync();
            const patientCollection = fhirDb.collection('Patient_4_0_0');

            expect((await patientCollection.find({}).toArray()).length).toEqual(1);

            const personCollection = fhirDb.collection('Person_4_0_0');

            expect((await personCollection.find({}).toArray()).length).toEqual(1);

            const batchSize = 100;
            const concurrencyBatchSize = 10;
            container.register(
                'deletePersonPatientDataGraphRunner',
                (c) =>
                    new DeletePersonPatientDataGraphRunner({
                        mongoCollectionManager: c.mongoCollectionManager,
                        batchSize,
                        concurrencyBatchSize,
                        adminLogger: new AdminLogger(),
                        mongoDatabaseManager: c.mongoDatabaseManager,
                        patientUuids: ['61abdd48-df46-5e98-ac6c-fde3cace4d07'],
                        personUuids: ['61abdd48-df46-5e98-ac6c-fde3cace4d07'],
                        adminPersonPatientDataManager: c.adminPersonPatientDataManager
                    })
            );

            /**
             * @type {DeletePersonPatientDataGraphRunner}
             */
            const deletePersonPatientDataGraphRunner = container.deletePersonPatientDataGraphRunner;
            expect(deletePersonPatientDataGraphRunner).toBeInstanceOf(
                DeletePersonPatientDataGraphRunner
            );
            await deletePersonPatientDataGraphRunner.processAsync();

            expect((await patientCollection.find({}).toArray()).length).toEqual(0);
            expect((await personCollection.find({}).toArray()).length).toEqual(0);
        });

        test('Multiple person deletion works', async () => {
            // eslint-disable-next-line no-unused-vars
            const request = await createTestRequest();

            let resp = await request
                .post('/4_0_0/Person/$merge')
                .send(person1Resource)
                .set(getHeaders())
                .expect(200);

            resp = await request
                .post('/4_0_0/Person/$merge')
                .send(person2Resource)
                .set(getHeaders())
                .expect(200);

            resp = await request
                .get('/4_0_0/Person/1')
                .set(getHeaders())
                .expect(200);

            const person1 = resp.body;
            delete person1.meta.lastUpdated;
            expect(person1).toEqual(expectedPerson1);

            resp = await request
                .get('/4_0_0/Person/2')
                .set(getHeaders())
                .expect(200);

            const person2 = resp.body;
            delete person2.meta.lastUpdated;
            expect(person2).toEqual(expectedPerson2);

            const container = getTestContainer();

            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;

            const fhirDb = await mongoDatabaseManager.getClientDbAsync();
            const personCollection = fhirDb.collection('Person_4_0_0');

            expect((await personCollection.find({}).toArray()).length).toEqual(2);

            const batchSize = 100;
            const concurrencyBatchSize = 10;
            container.register(
                'deletePersonPatientDataGraphRunner',
                (c) =>
                    new DeletePersonPatientDataGraphRunner({
                        mongoCollectionManager: c.mongoCollectionManager,
                        batchSize,
                        concurrencyBatchSize,
                        adminLogger: new AdminLogger(),
                        mongoDatabaseManager: c.mongoDatabaseManager,
                        personUuids: ['61abdd48-df46-5e98-ac6c-fde3cace4d07', '27153f78-54c7-5029-889b-1026a9580ebf'],
                        patientUuids: [],
                        adminPersonPatientDataManager: c.adminPersonPatientDataManager
                    })
            );

            /**
             * @type {DeletePersonPatientDataGraphRunner}
             */
            const deletePersonPatientDataGraphRunner = container.deletePersonPatientDataGraphRunner;
            expect(deletePersonPatientDataGraphRunner).toBeInstanceOf(
                DeletePersonPatientDataGraphRunner
            );
            await deletePersonPatientDataGraphRunner.processAsync();

            expect((await personCollection.find({}).toArray()).length).toEqual(0);
        });

        test('No resource with provided uuid works', async () => {
            // eslint-disable-next-line no-unused-vars
            const request = await createTestRequest();

            const container = getTestContainer();

            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;

            const fhirDb = await mongoDatabaseManager.getClientDbAsync();
            const personCollection = fhirDb.collection('Person_4_0_0');

            expect((await personCollection.find({}).toArray()).length).toEqual(0);

            const batchSize = 100;
            const concurrencyBatchSize = 10;
            container.register(
                'deletePersonPatientDataGraphRunner',
                (c) =>
                    new DeletePersonPatientDataGraphRunner({
                        mongoCollectionManager: c.mongoCollectionManager,
                        batchSize,
                        concurrencyBatchSize,
                        adminLogger: new AdminLogger(),
                        mongoDatabaseManager: c.mongoDatabaseManager,
                        personUuids: ['61abdd48-df46-5e98-ac6c-fde3cace4d07'],
                        patientUuids: [],
                        adminPersonPatientDataManager: c.adminPersonPatientDataManager
                    })
            );

            /**
             * @type {DeletePersonPatientDataGraphRunner}
             */
            const deletePersonPatientDataGraphRunner = container.deletePersonPatientDataGraphRunner;
            expect(deletePersonPatientDataGraphRunner).toBeInstanceOf(
                DeletePersonPatientDataGraphRunner
            );
            await deletePersonPatientDataGraphRunner.processAsync();

            expect((await personCollection.find({}).toArray()).length).toEqual(0);
        });

        test('dryRun works', async () => {
            // eslint-disable-next-line no-unused-vars
            const request = await createTestRequest();

            let resp = await request
                .post('/4_0_0/Person/$merge')
                .send(person1Resource)
                .set(getHeaders())
                .expect(200);

            resp = await request
                .get('/4_0_0/Person/1')
                .set(getHeaders())
                .expect(200);

            const person1 = resp.body;
            delete person1.meta.lastUpdated;
            expect(person1).toEqual(expectedPerson1);

            const container = getTestContainer();

            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;

            const fhirDb = await mongoDatabaseManager.getClientDbAsync();
            const personCollection = fhirDb.collection('Person_4_0_0');

            expect((await personCollection.find({}).toArray()).length).toEqual(1);

            const batchSize = 100;
            const concurrencyBatchSize = 10;
            container.register(
                'deletePersonPatientDataGraphRunner',
                (c) =>
                    new DeletePersonPatientDataGraphRunner({
                        mongoCollectionManager: c.mongoCollectionManager,
                        batchSize,
                        concurrencyBatchSize,
                        adminLogger: new AdminLogger(),
                        mongoDatabaseManager: c.mongoDatabaseManager,
                        personUuids: ['61abdd48-df46-5e98-ac6c-fde3cace4d07'],
                        patientUuids: [],
                        adminPersonPatientDataManager: c.adminPersonPatientDataManager,
                        dryRun: true
                    })
            );

            /**
             * @type {DeletePersonPatientDataGraphRunner}
             */
            const deletePersonPatientDataGraphRunner = container.deletePersonPatientDataGraphRunner;
            expect(deletePersonPatientDataGraphRunner).toBeInstanceOf(
                DeletePersonPatientDataGraphRunner
            );
            await deletePersonPatientDataGraphRunner.processAsync();

            expect((await personCollection.find({}).toArray()).length).toEqual(1);
        });
    });
});
