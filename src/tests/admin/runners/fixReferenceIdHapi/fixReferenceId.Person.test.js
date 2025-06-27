// test file
const person1Resource = require('./fixtures/Person/person.json');
const patient1Resource = require('./fixtures/Patient/patient1.json');
const patient2Resource = require('./fixtures/Patient/patient2.json');
const patient3Resource = require('./fixtures/Patient/patient3.json');

// expected
const expectedPersonBeforeRun = require('./fixtures/expected/expected_person_before_run.json');
const expectedPatient1BeforeRun = require('./fixtures/expected/expected_patient1_before_run.json');
const expectedPatient2BeforeRun = require('./fixtures/expected/expected_patient2_before_run.json');
const expectedPatient3BeforeRun = require('./fixtures/expected/expected_patient3_before_run.json');

const expectedPersonAfterRun = require('./fixtures/expected/expected_person.json');
const expectedPatient1AfterRun = require('./fixtures/expected/expected_patient1.json');
const expectedPatient3AfterRun = require('./fixtures/expected/expected_patient3.json');

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
        const container = getTestContainer();
        if (container) {
            delete container.services.fixReferenceIdHapiRunner;
        }
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Person fixReferenceId Tests', () => {
        test('fixReferenceId works for patient with history', async () => {

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
                    proaCollections: ['Patient_4_0_0', 'Patient_4_0_0_History'],
                    mongoDatabaseManager: c.mongoDatabaseManager,
                    preSaveManager: c.preSaveManager,
                    databaseQueryFactory: c.databaseQueryFactory,
                    resourceLocatorFactory: c.resourceLocatorFactory,
                    resourceMerger: c.resourceMerger,
                    searchParametersManager: c.searchParametersManager
                }
            )
            );

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

            resp = await request
                .get(`/4_0_0/Person/_history?id=${expectedPersonAfterRun.id}`)
                .set(getHeaders())
                .expect(200);

            const personHistory = resp.body;

            expect(personHistory.entry).toBeDefined();
            expect(personHistory.entry.length).toEqual(1);

            delete personHistory.entry[0].resource.meta.lastUpdated;
            expect(personHistory.entry[0].resource).toEqual(expectedPersonAfterRun);

            resp = await request
                .get(`/4_0_0/Patient/_history?id=${expectedPatient1AfterRun.id}`)
                .set(getHeaders())
                .expect(200);

            const patientHistory = resp.body;

            expect(patientHistory.entry).toBeDefined();
            expect(patientHistory.entry.length).toEqual(1);

            delete patientHistory.entry[0].resource.meta.lastUpdated;
            expect(patientHistory.entry[0].resource).toEqual(expectedPatient1AfterRun);

            expect(patientHistory.entry[0].request.url).toContain(expectedPatient1AfterRun.id);
            expect(patientHistory.entry[0].request.url.includes(expectedPatient1BeforeRun.id)).toBeFalse();
        });

        test('fixReferenceId works for patient with sanitization of sourceAssigningAuthority', async () => {

            const request = await createTestRequest();

            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Patient/$merge')
                .send(patient3Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get(`/4_0_0/Patient/${expectedPatient3BeforeRun.id}`)
                .set(getHeaders())
                .expect(200);

            const patient3BeforeRun = resp.body;
            delete patient3BeforeRun.meta.lastUpdated;
            expect(patient3BeforeRun).toEqual(expectedPatient3BeforeRun);

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
            )
            );

            /**
             * @type {FixReferenceIdHapiRunner}
             */
            const fixReferenceIdHapiRunner = container.fixReferenceIdHapiRunner;
            assertTypeEquals(fixReferenceIdHapiRunner, FixReferenceIdHapiRunner);
            await fixReferenceIdHapiRunner.processAsync();

            resp = await request
                .get(`/4_0_0/Patient/${expectedPatient3AfterRun.id}`)
                .set(getHeaders())
                .expect(200);

            const patient3AfterRun = resp.body;
            delete patient3AfterRun.meta.lastUpdated;
            expect(patient3AfterRun).toEqual(expectedPatient3AfterRun);

            await request
                .get(`/4_0_0/Patient/${expectedPatient3BeforeRun.id}`)
                .set(getHeaders())
                .expect(404);
        });

        test('fixReferenceId works in batches', async () => {

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
                .send(patient3Resource)
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
                .get(`/4_0_0/Patient/${expectedPatient3BeforeRun.id}`)
                .set(getHeaders())
                .expect(200);

            const patient3BeforeRun = resp.body;
            delete patient3BeforeRun.meta.lastUpdated;
            expect(patient3BeforeRun).toEqual(expectedPatient3BeforeRun);

            const container = getTestContainer();

            // run admin runner
            const collections = ['all'];
            const batchSize = 1;

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
            )
            );

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
                .get(`/4_0_0/Patient/${expectedPatient3AfterRun.id}`)
                .set(getHeaders())
                .expect(200);

            const patient3AfterRun = resp.body;
            delete patient3AfterRun.meta.lastUpdated;
            expect(patient3AfterRun).toEqual(expectedPatient3AfterRun);

            await request
                .get(`/4_0_0/Patient/${expectedPatient1BeforeRun.id}`)
                .set(getHeaders())
                .expect(404);

            await request
                .get(`/4_0_0/Patient/${expectedPatient3BeforeRun.id}`)
                .set(getHeaders())
                .expect(404);
        });
    });
});
