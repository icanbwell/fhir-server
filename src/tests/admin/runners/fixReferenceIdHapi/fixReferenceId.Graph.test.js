// test file
const person1Resource = require('./fixtures/Person/person.json');
const patient1Resource = require('./fixtures/Patient/patient1.json');
const patient2Resource = require('./fixtures/Patient/patient2.json');

const graphDefinition1 = require('./fixtures/GraphDefinition/graph1.json');
const graphDefinition2 = require('./fixtures/GraphDefinition/graph2.json');

// expected
const expectedPersonBeforeRun = require('./fixtures/expected/expected_person_before_run.json');
const expectedPatient1BeforeRun = require('./fixtures/expected/expected_patient1_before_run.json');
const expectedPatient2BeforeRun = require('./fixtures/expected/expected_patient2_before_run.json');

const expectedPersonAfterRun = require('./fixtures/expected/expected_person.json');
const expectedPatient1AfterRun = require('./fixtures/expected/expected_patient1.json');

const {
    commonBeforeEach,
    commonAfterEach,
    createTestRequest,
    getTestContainer,
    getHeaders
} = require('../../../common');
const { AdminLogger } = require('../../../../admin/adminLogger');
const { FixReferenceIdHapiRunner } = require('../../../../admin/runners/fixReferenceIdHapiRunner');
const { assertTypeEquals } = require('../../../../utils/assertType');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('Person Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Person fixReferenceId graph Tests', () => {
        test('fixReferenceId works for person with forward reference', async () => {

            const request = await createTestRequest();

            // add the resources to FHIR server
            let resp = await request
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
                .post('/4_0_0/Person/$merge')
                .send(person1Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get(`/4_0_0/Person/${expectedPersonBeforeRun.id}`)
                .set(getHeaders())
                .expect(200);

            const personBeforeRun = resp.body;
            delete personBeforeRun.meta.lastUpdated;
            expect(personBeforeRun).toEqual(expectedPersonBeforeRun);

            resp = await request
                .get(`/4_0_0/Patient/${expectedPatient1BeforeRun.id}`)
                .set(getHeaders())
                .expect(200);

            const patient1BeforeRun = resp.body;
            delete patient1BeforeRun.meta.lastUpdated;
            expect(patient1BeforeRun).toEqual(expectedPatient1BeforeRun);

            resp = await request
                .get(`/4_0_0/Patient/${expectedPatient2BeforeRun.id}`)
                .set(getHeaders())
                .expect(200);

            const patient2BeforeRun = resp.body;
            delete patient2BeforeRun.meta.lastUpdated;
            expect(patient2BeforeRun).toEqual(expectedPatient2BeforeRun);

            // getting the patient along with person resource referencing it
            resp = await request
                .post(`/4_0_0/Person/${expectedPersonBeforeRun.id}/$graph`)
                .send(graphDefinition1)
                .set(getHeaders())
                .expect(200);

            expect(resp.body.entry.length).toEqual(2);

            let [person, patient] = resp.body.entry;

            delete patient.resource.meta.lastUpdated;
            expect(patient.resource).toEqual(expectedPatient1BeforeRun);

            delete person.resource.meta.lastUpdated;
            expect(person.resource).toEqual(expectedPersonBeforeRun);

            const container = getTestContainer();

            // run admin runner
            const collections = ['all'];
            const batchSize = 10000;

            container.register('fixReferenceIdHapiRunner', (c) => new FixReferenceIdHapiRunner(
                {
                    collections,
                    batchSize,
                    useAuditDatabase: false,
                    adminLogger: new AdminLogger(),
                    proaCollections: ['Patient_4_0_0'],
                    mongoDatabaseManager: c.mongoDatabaseManager,
                    preSaveManager: c.preSaveManager,
                    databaseQueryFactory: c.databaseQueryFactory,
                    resourceLocatorFactory: c.resourceLocatorFactory,
                    resourceMerger: c.resourceMerger,
                    searchParametersManager: c.searchParametersManager
                }
            ));

            /**
             * @type {FixReferenceIdHapiRunner}
             */
            const fixReferenceIdHapiRunner = container.fixReferenceIdHapiRunner;
            assertTypeEquals(fixReferenceIdHapiRunner, FixReferenceIdHapiRunner);
            await fixReferenceIdHapiRunner.processAsync();

            resp = await request
                .get(`/4_0_0/Person/${expectedPersonAfterRun.id}`)
                .set(getHeaders())
                .expect(200);

            const personAfterRun = resp.body;
            delete personAfterRun.meta.lastUpdated;
            expect(personAfterRun).toEqual(expectedPersonAfterRun);

            resp = await request
                .get(`/4_0_0/Patient/${expectedPatient1AfterRun.id}`)
                .set(getHeaders())
                .expect(200);

            const patient1AfterRun = resp.body;
            delete patient1AfterRun.meta.lastUpdated;
            expect(patient1AfterRun).toEqual(expectedPatient1AfterRun);

            resp = await request
                .get(`/4_0_0/Patient/${expectedPatient2BeforeRun.id}`)
                .set(getHeaders())
                .expect(200);

            const patient2AfterRun = resp.body;
            delete patient2AfterRun.meta.lastUpdated;
            expect(patient2AfterRun).toEqual(expectedPatient2BeforeRun);

            await request
                .get(`/4_0_0/Patient/${expectedPatient1BeforeRun.id}`)
                .set(getHeaders())
                .expect(404);

            // getting the person along with patient resources it is referencing
            resp = await request
                .post(`/4_0_0/Person/${expectedPersonAfterRun.id}/$graph`)
                .send(graphDefinition1)
                .set(getHeaders())
                .expect(200);

            expect(resp.body.entry.length).toEqual(2);

            [person, patient] = resp.body.entry;

            delete patient.resource.meta.lastUpdated;
            expect(patient.resource).toEqual(expectedPatient1AfterRun);

            delete person.resource.meta.lastUpdated;
            expect(person.resource).toEqual(expectedPersonAfterRun);
        });

        test('fixReferenceId works for patient with backward reference', async () => {

            const request = await createTestRequest();

            // add the resources to FHIR server
            let resp = await request
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
                .post('/4_0_0/Person/$merge')
                .send(person1Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get(`/4_0_0/Person/${expectedPersonBeforeRun.id}`)
                .set(getHeaders())
                .expect(200);

            const personBeforeRun = resp.body;
            delete personBeforeRun.meta.lastUpdated;
            expect(personBeforeRun).toEqual(expectedPersonBeforeRun);

            resp = await request
                .get(`/4_0_0/Patient/${expectedPatient1BeforeRun.id}`)
                .set(getHeaders())
                .expect(200);

            const patient1BeforeRun = resp.body;
            delete patient1BeforeRun.meta.lastUpdated;
            expect(patient1BeforeRun).toEqual(expectedPatient1BeforeRun);

            resp = await request
                .get(`/4_0_0/Patient/${expectedPatient2BeforeRun.id}`)
                .set(getHeaders())
                .expect(200);

            const patient2BeforeRun = resp.body;
            delete patient2BeforeRun.meta.lastUpdated;
            expect(patient2BeforeRun).toEqual(expectedPatient2BeforeRun);

            // getting the patient along with person resource referencing it
            resp = await request
                .post(`/4_0_0/Patient/${expectedPatient1BeforeRun.id}/$graph`)
                .send(graphDefinition2)
                .set(getHeaders())
                .expect(200);

            expect(resp.body.entry.length).toEqual(2);

            let [patient, person] = resp.body.entry;

            delete patient.resource.meta.lastUpdated;
            expect(patient.resource).toEqual(expectedPatient1BeforeRun);

            delete person.resource.meta.lastUpdated;
            expect(person.resource).toEqual(expectedPersonBeforeRun);

            const container = getTestContainer();

            // run admin runner
            const collections = ['all'];
            const batchSize = 10000;

            container.register('fixReferenceIdHapiRunner', (c) => new FixReferenceIdHapiRunner(
                {
                    collections,
                    batchSize,
                    useAuditDatabase: false,
                    adminLogger: new AdminLogger(),
                    proaCollections: ['Patient_4_0_0'],
                    mongoDatabaseManager: c.mongoDatabaseManager,
                    preSaveManager: c.preSaveManager,
                    databaseQueryFactory: c.databaseQueryFactory,
                    resourceLocatorFactory: c.resourceLocatorFactory,
                    resourceMerger: c.resourceMerger,
                    searchParametersManager: c.searchParametersManager
                }
            ));

            /**
             * @type {FixReferenceIdHapiRunner}
             */
            const fixReferenceIdHapiRunner = container.fixReferenceIdHapiRunner;
            assertTypeEquals(fixReferenceIdHapiRunner, FixReferenceIdHapiRunner);
            await fixReferenceIdHapiRunner.processAsync();

            resp = await request
                .get(`/4_0_0/Person/${expectedPersonAfterRun.id}`)
                .set(getHeaders())
                .expect(200);

            const personAfterRun = resp.body;
            delete personAfterRun.meta.lastUpdated;
            expect(personAfterRun).toEqual(expectedPersonAfterRun);

            resp = await request
                .get(`/4_0_0/Patient/${expectedPatient1AfterRun.id}`)
                .set(getHeaders())
                .expect(200);

            const patient1AfterRun = resp.body;
            delete patient1AfterRun.meta.lastUpdated;
            expect(patient1AfterRun).toEqual(expectedPatient1AfterRun);

            resp = await request
                .get(`/4_0_0/Patient/${expectedPatient2BeforeRun.id}`)
                .set(getHeaders())
                .expect(200);

            const patient2AfterRun = resp.body;
            delete patient2AfterRun.meta.lastUpdated;
            expect(patient2AfterRun).toEqual(expectedPatient2BeforeRun);

            await request
                .get(`/4_0_0/Patient/${expectedPatient1BeforeRun.id}`)
                .set(getHeaders())
                .expect(404);

            // getting the patient along with person resource referencing it
            resp = await request
                .post(`/4_0_0/Patient/${expectedPatient1AfterRun.id}/$graph`)
                .send(graphDefinition2)
                .set(getHeaders())
                .expect(200);

            expect(resp.body.entry.length).toEqual(2);

            [patient, person] = resp.body.entry;

            delete patient.resource.meta.lastUpdated;
            expect(patient.resource).toEqual(expectedPatient1AfterRun);

            delete person.resource.meta.lastUpdated;
            expect(person.resource).toEqual(expectedPersonAfterRun);

            // backward reference with old patient id
            resp = await request
                .post(`/4_0_0/Patient/${expectedPatient1BeforeRun.id}/$graph`)
                .send(graphDefinition2)
                .set(getHeaders())
                .expect(200);

            expect(resp.body.entry.length).toEqual(0);
        });
    });
});
