// test file
const observation1Resource = require('./fixtures/Observation/observation1.json');
const observation2Resource = require('./fixtures/Observation/observation2.json');
const observation3Resource = require('./fixtures/Observation/observation3.json');
const observation4Resource = require('./fixtures/Observation/observation4.json');

// expected
const expectedObservation1BeforeRun = require('./fixtures/expected/expected_observation1_before_run.json');
const expectedObservation2BeforeRun = require('./fixtures/expected/expected_observation2_before_run.json');
const expectedObservation3BeforeRun = require('./fixtures/expected/expected_observation3_before_run.json');
const expectedObservation4BeforeRun = require('./fixtures/expected/expected_observation4_before_run.json');

const expectedObservation1AfterRun = require('./fixtures/expected/expected_observation1.json');
const expectedObservation2AfterRun = require('./fixtures/expected/expected_observation2.json');
const expectedObservation3AfterRun = require('./fixtures/expected/expected_observation3.json');
const expectedObservation4AfterRun = require('./fixtures/expected/expected_observation4.json');

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

describe('Observation Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Observation fixReferenceId Tests', () => {
        test('fixReferenceId works for normal observation', async () => {
            // eslint-disable-next-line no-unused-vars
            const request = await createTestRequest();

            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Observation/$merge')
                .send(observation1Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Observation/$merge')
                .send(observation4Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get(`/4_0_0/Observation/${observation1Resource.id}`)
                .set(getHeaders())
                .expect(200);

            const observation1BeforeRun = resp.body;
            delete observation1BeforeRun.meta.lastUpdated;
            expect(observation1BeforeRun).toEqual(expectedObservation1BeforeRun);

            resp = await request
                .get(`/4_0_0/Observation/${observation4Resource.id}`)
                .set(getHeaders())
                .expect(200);

            const observation4BeforeRun = resp.body;
            delete observation4BeforeRun.meta.lastUpdated;
            expect(observation4BeforeRun).toEqual(expectedObservation4BeforeRun);

            const container = getTestContainer();

            // run admin runner
            const collections = ['all'];
            const batchSize = 10000;

            container.register('fixReferenceIdHapiRunner', (c) => new FixReferenceIdHapiRunner(
                {
                    mongoCollectionManager: c.mongoCollectionManager,
                    collections,
                    batchSize,
                    useAuditDatabase: false,
                    adminLogger: new AdminLogger(),
                    proaCollections: ['Observation_4_0_0'],
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
                .get(`/4_0_0/Observation/${expectedObservation1AfterRun.id}`)
                .set(getHeaders())
                .expect(200);

            const observation1AfterRun = resp.body;
            delete observation1AfterRun.meta.lastUpdated;
            expect(observation1AfterRun).toEqual(expectedObservation1AfterRun);

            resp = await request
                .get(`/4_0_0/Observation/${expectedObservation4AfterRun.id}`)
                .set(getHeaders())
                .expect(200);

            const observation4AfterRun = resp.body;
            delete observation4AfterRun.meta.lastUpdated;
            expect(observation4AfterRun).toEqual(expectedObservation4AfterRun);

            await request
                .get(`/4_0_0/Observation/${expectedObservation1BeforeRun.id}`)
                .set(getHeaders())
                .expect(404);

            await request
                .get(`/4_0_0/Observation/${expectedObservation4BeforeRun.id}`)
                .set(getHeaders())
                .expect(404);
        });

        test('fixReferenceId works for observation with code.text as suffix', async () => {
            // eslint-disable-next-line no-unused-vars
            const request = await createTestRequest();

            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Observation/$merge')
                .send(observation2Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get(`/4_0_0/Observation/${observation2Resource.id}`)
                .set(getHeaders())
                .expect(200);

            const observationBeforeRun = resp.body;
            delete observationBeforeRun.meta.lastUpdated;
            expect(observationBeforeRun).toEqual(expectedObservation2BeforeRun);

            const container = getTestContainer();

            // run admin runner
            const collections = ['all'];
            const batchSize = 10000;

            container.register('fixReferenceIdHapiRunner', (c) => new FixReferenceIdHapiRunner(
                {
                    mongoCollectionManager: c.mongoCollectionManager,
                    collections,
                    batchSize,
                    useAuditDatabase: false,
                    adminLogger: new AdminLogger(),
                    proaCollections: ['Observation_4_0_0'],
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
                .get(`/4_0_0/Observation/${expectedObservation2AfterRun.id}`)
                .set(getHeaders())
                .expect(200);

            const observationAfterRun = resp.body;
            delete observationAfterRun.meta.lastUpdated;
            expect(observationAfterRun).toEqual(expectedObservation2AfterRun);

            await request
                .get(`/4_0_0/Observation/${expectedObservation2BeforeRun.id}`)
                .set(getHeaders())
                .expect(404);
        });

        test('fixReferenceId works for observation with code.coding.code as suffix', async () => {
            // eslint-disable-next-line no-unused-vars
            const request = await createTestRequest();

            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Observation/$merge')
                .send(observation3Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get(`/4_0_0/Observation/${observation3Resource.id}`)
                .set(getHeaders())
                .expect(200);

            const observationBeforeRun = resp.body;
            delete observationBeforeRun.meta.lastUpdated;
            expect(observationBeforeRun).toEqual(expectedObservation3BeforeRun);

            const container = getTestContainer();

            // run admin runner
            const collections = ['all'];
            const batchSize = 10000;

            container.register('fixReferenceIdHapiRunner', (c) => new FixReferenceIdHapiRunner(
                {
                    mongoCollectionManager: c.mongoCollectionManager,
                    collections,
                    batchSize,
                    useAuditDatabase: false,
                    adminLogger: new AdminLogger(),
                    proaCollections: ['Observation_4_0_0'],
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
                .get(`/4_0_0/Observation/${expectedObservation3AfterRun.id}`)
                .set(getHeaders())
                .expect(200);

            const observationAfterRun = resp.body;
            delete observationAfterRun.meta.lastUpdated;
            expect(observationAfterRun).toEqual(expectedObservation3AfterRun);

            await request
                .get(`/4_0_0/Observation/${expectedObservation3BeforeRun.id}`)
                .set(getHeaders())
                .expect(404);
        });

        test('fixReferenceId works for observation with hash as suffix', async () => {
            // eslint-disable-next-line no-unused-vars
            const request = await createTestRequest();

            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Observation/$merge')
                .send(observation4Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get(`/4_0_0/Observation/${observation4Resource.id}`)
                .set(getHeaders())
                .expect(200);

            const observationBeforeRun = resp.body;
            delete observationBeforeRun.meta.lastUpdated;
            expect(observationBeforeRun).toEqual(expectedObservation4BeforeRun);

            const container = getTestContainer();

            // run admin runner
            const collections = ['all'];
            const batchSize = 10000;

            container.register('fixReferenceIdHapiRunner', (c) => new FixReferenceIdHapiRunner(
                {
                    mongoCollectionManager: c.mongoCollectionManager,
                    collections,
                    batchSize,
                    useAuditDatabase: false,
                    adminLogger: new AdminLogger(),
                    proaCollections: ['Observation_4_0_0'],
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
                .get(`/4_0_0/Observation/${expectedObservation4AfterRun.id}`)
                .set(getHeaders())
                .expect(200);

            const observationAfterRun = resp.body;
            delete observationAfterRun.meta.lastUpdated;
            expect(observationAfterRun).toEqual(expectedObservation4AfterRun);

            await request
                .get(`/4_0_0/Observation/${expectedObservation4BeforeRun.id}`)
                .set(getHeaders())
                .expect(404);
        });
    });
});
