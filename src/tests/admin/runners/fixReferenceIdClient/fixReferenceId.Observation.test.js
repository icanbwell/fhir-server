// test file
const observation1Resource = require('./fixtures/Observation/observation1.json');
const observation2Resource = require('./fixtures/Observation/observation2.json');

// expected
const expectedObservation1BeforeRun = require('./fixtures/expected/expected_observation1_before_run.json');
const expectedObservation2BeforeRun = require('./fixtures/expected/expected_observation2_before_run.json');

const expectedObservation1AfterRun = require('./fixtures/expected/expected_observation1.json');
const expectedObservation2AfterRun = require('./fixtures/expected/expected_observation2.json');

const {
    commonBeforeEach,
    commonAfterEach,
    createTestRequest,
    getTestContainer,
    getHeaders
} = require('../../../common');
const { AdminLogger } = require('../../../../admin/adminLogger');
const { FixReferenceIdClientRunner } = require('../../../../admin/runners/fixReferenceIdClientRunner');
const { assertTypeEquals } = require('../../../../utils/assertType');
const fs = require('fs');
const {describe, beforeEach, afterEach, test, expect} = require('@jest/globals');

class MockFixReferenceIdClientRunner extends FixReferenceIdClientRunner {
    async getDataFromS3 () {
        this.idCache.set('Observation', new Map());

        this.idCache.get('Observation').set(
            'client123-12345678901234567890123-Actin--Smooth-Muscle--Antibody',
            'client123-12345678901234567890123-Actin--Smooth-Muscle--Antibody-1'
        );

        this.idCache.get('Observation').set(
            'client123-1234567890123456789abcd-Actin--Smooth-Muscle--Antibody',
            'client123-1234567890123456789abcd-Actin--Smooth-Muscle--Antibody-2'
        );
    }
}

describe('Observation Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        // to remove the cache file stored after running the script
        if (fs.existsSync('./cachedResourceIds.json')) {
            fs.unlinkSync('./cachedResourceIds.json');
        }

        await commonAfterEach();
    });

    describe('Observation fixReferenceId Tests', () => {
        test('fixReferenceId works for observation with history', async () => {
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
                .send(observation2Resource)
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
                .get(`/4_0_0/Observation/_history?id=${observation1Resource.id}`)
                .set(getHeaders())
                .expect(200);

            expect(resp.body.entry).toBeDefined();
            expect(resp.body.entry.length).toEqual(1);
            expect(resp.body.entry[0].request.url).toInclude(expectedObservation1BeforeRun.id);
            const observation1HistoryBeforeRun = resp.body.entry[0].resource;
            delete observation1HistoryBeforeRun.meta.lastUpdated;
            expect(observation1HistoryBeforeRun).toEqual(expectedObservation1BeforeRun);

            resp = await request
                .get(`/4_0_0/Observation/${observation2Resource.id}`)
                .set(getHeaders())
                .expect(200);

            const observation2BeforeRun = resp.body;
            delete observation2BeforeRun.meta.lastUpdated;
            expect(observation2BeforeRun).toEqual(expectedObservation2BeforeRun);

            resp = await request
                .get(`/4_0_0/Observation/_history?id=${observation2Resource.id}`)
                .set(getHeaders())
                .expect(200);

            expect(resp.body.entry).toBeDefined();
            expect(resp.body.entry.length).toEqual(1);
            expect(resp.body.entry[0].request.url).toInclude(expectedObservation2BeforeRun.id);
            const observation2HistoryBeforeRun = resp.body.entry[0].resource;
            delete observation2HistoryBeforeRun.meta.lastUpdated;
            expect(observation2HistoryBeforeRun).toEqual(expectedObservation2BeforeRun);

            const container = getTestContainer();

            // run admin runner
            const collections = ['all'];
            const batchSize = 10000;

            container.register('fixReferenceIdClientRunner', (c) => new MockFixReferenceIdClientRunner(
                {
                    mongoCollectionManager: c.mongoCollectionManager,
                    collections,
                    batchSize,
                    useAuditDatabase: false,
                    adminLogger: new AdminLogger(),
                    proaCollections: ['Observation_4_0_0', 'Observation_4_0_0_History'],
                    mongoDatabaseManager: c.mongoDatabaseManager,
                    preSaveManager: c.preSaveManager,
                    databaseQueryFactory: c.databaseQueryFactory,
                    resourceLocatorFactory: c.resourceLocatorFactory,
                    resourceMerger: c.resourceMerger,
                    client: 'client123'
                }
            ));

            /**
             * @type {FixReferenceIdClientRunner}
             */
            const fixReferenceIdClientRunner = container.fixReferenceIdClientRunner;
            assertTypeEquals(fixReferenceIdClientRunner, FixReferenceIdClientRunner);
            await fixReferenceIdClientRunner.processAsync();

            resp = await request
                .get(`/4_0_0/Observation/${expectedObservation1AfterRun.id}`)
                .set(getHeaders())
                .expect(200);

            const observation1AfterRun = resp.body;
            delete observation1AfterRun.meta.lastUpdated;
            expect(observation1AfterRun).toEqual(expectedObservation1AfterRun);

            resp = await request
                .get(`/4_0_0/Observation/_history?id=${expectedObservation1AfterRun.id}`)
                .set(getHeaders())
                .expect(200);

            expect(resp.body.entry).toBeDefined();
            expect(resp.body.entry.length).toEqual(1);
            expect(resp.body.entry[0].request.url).toInclude(expectedObservation1AfterRun.id);
            const observation1HistoryAfterRun = resp.body.entry[0].resource;
            delete observation1HistoryAfterRun.meta.lastUpdated;
            expect(observation1HistoryAfterRun).toEqual(expectedObservation1AfterRun);

            resp = await request
                .get(`/4_0_0/Observation/${expectedObservation2AfterRun.id}`)
                .set(getHeaders())
                .expect(200);

            const observation2AfterRun = resp.body;
            delete observation2AfterRun.meta.lastUpdated;
            expect(observation2AfterRun).toEqual(expectedObservation2AfterRun);

            resp = await request
                .get(`/4_0_0/Observation/_history?id=${expectedObservation2AfterRun.id}`)
                .set(getHeaders())
                .expect(200);

            expect(resp.body.entry).toBeDefined();
            expect(resp.body.entry.length).toEqual(1);
            expect(resp.body.entry[0].request.url).toInclude(expectedObservation2AfterRun.id);
            const observation2HistoryAfterRun = resp.body.entry[0].resource;
            delete observation2HistoryAfterRun.meta.lastUpdated;
            expect(observation2HistoryAfterRun).toEqual(expectedObservation2AfterRun);

            await request
                .get(`/4_0_0/Observation/${expectedObservation1BeforeRun.id}`)
                .set(getHeaders())
                .expect(404);

            await request
                .get(`/4_0_0/Observation/_history?id=${expectedObservation1BeforeRun.id}`)
                .set(getHeaders())
                .expect(404);

            await request
                .get(`/4_0_0/Observation/${expectedObservation2BeforeRun.id}`)
                .set(getHeaders())
                .expect(404);

            await request
                .get(`/4_0_0/Observation/_history?id=${expectedObservation2BeforeRun.id}`)
                .set(getHeaders())
                .expect(404);
        });
    });
});
