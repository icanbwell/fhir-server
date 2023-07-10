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
const { FixReferenceIdHapiRunner } = require('../../../../admin/runners/fixReferenceIdHapiRunner');
const { assertTypeEquals } = require('../../../../utils/assertType');

class MockFixReferenceIdHapiRunner extends FixReferenceIdHapiRunner {
    async getDataFromS3() {
        this.idCache.set('Observation', new Map());

        this.idCache.get('Observation').set(
            'thedacare-12345678901234567890123-Actin--Smooth-Muscle--Antibody',
            'thedacare-12345678901234567890123-Actin--Smooth-Muscle--Antibody-1'
        );

        this.idCache.get('Observation').set(
            'thedacare-1234567890123456789abcd-Actin--Smooth-Muscle--Antibody',
            'thedacare-1234567890123456789abcd-Actin--Smooth-Muscle--Antibody-2'
        );
    }

    async updateRecordReferencesAsync(doc) {
        throw new Error(`To test if the script fails while updating the references ${JSON.stringify(doc)}`);
    }
}

describe('Observation Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Observation MockFixReferenceId Tests', () => {
        test('fixReferenceId doesnot work with error', async () => {
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
                .get(`/4_0_0/Observation/${expectedObservation1BeforeRun.id}`)
                .set(getHeaders())
                .expect(200);

            const observation1BeforeRun = resp.body;
            delete observation1BeforeRun.meta.lastUpdated;
            expect(observation1BeforeRun).toEqual(expectedObservation1BeforeRun);

            resp = await request
                .get(`/4_0_0/Observation/${expectedObservation2BeforeRun.id}`)
                .set(getHeaders())
                .expect(200);

            const observation2BeforeRun = resp.body;
            delete observation2BeforeRun.meta.lastUpdated;
            expect(observation2BeforeRun).toEqual(expectedObservation2BeforeRun);

            const container = getTestContainer();

            // run admin runner
            const collections = ['all'];
            const batchSize = 1;

            container.register('fixReferenceIdHapiRunner', (c) => new MockFixReferenceIdHapiRunner(
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
                    resourceMerger: c.resourceMerger
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
                .get(`/4_0_0/Observation/${expectedObservation1BeforeRun.id}`)
                .set(getHeaders())
                .expect(200);

            const observation1AfterRun = resp.body;
            delete observation1AfterRun.meta.lastUpdated;
            expect(observation1AfterRun).toEqual(expectedObservation1BeforeRun);

            resp = await request
                .get(`/4_0_0/Observation/${expectedObservation2BeforeRun.id}`)
                .set(getHeaders())
                .expect(200);

            const observation2AfterRun = resp.body;
            delete observation2AfterRun.meta.lastUpdated;
            expect(observation2AfterRun).toEqual(expectedObservation2BeforeRun);

            await request
                .get(`/4_0_0/Observation/${expectedObservation1AfterRun.id}`)
                .set(getHeaders())
                .expect(404);

            await request
                .get(`/4_0_0/Observation/${expectedObservation2AfterRun.id}`)
                .set(getHeaders())
                .expect(404);
        });
    });
});
