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
const { FixReferenceIdThedacareRunner } = require('../../../../admin/runners/fixReferenceIdThedacareRunner');
const { assertTypeEquals } = require('../../../../utils/assertType');
const referenceCollections = require('../../../../admin/utils/referenceCollectionsThedacare.json');

class MockFixReferenceIdThedacareRunner extends FixReferenceIdThedacareRunner {
    async preloadReferencesAsync() {
        this.caches.set('Observation', new Map());

        this.caches.get('Observation').set(
            'Observation/thedacare-12345678901234567890123-Actin--Smooth-Muscle--Antibody',
            'Observation/thedacare-12345678901234567890123-Actin--Smooth-Muscle--Antibody-1'
        );

        this.caches.get('Observation').set(
            'Observation/thedacare-1234567890123456789abcd-Actin--Smooth-Muscle--Antibody',
            'Observation/thedacare-1234567890123456789abcd-Actin--Smooth-Muscle--Antibody-2'
        );

        this.idCache.set('Observation', new Map());

        this.idCache.get('Observation').set(
            'thedacare-12345678901234567890123-Actin--Smooth-Muscle--Antibody',
            'thedacare-12345678901234567890123-Actin--Smooth-Muscle--Antibody-1'
        );

        this.idCache.get('Observation').set(
            'thedacare-1234567890123456789abcd-Actin--Smooth-Muscle--Antibody',
            'thedacare-1234567890123456789abcd-Actin--Smooth-Muscle--Antibody-2'
        );

        this.uuidCache.set(
            'thedacare-12345678901234567890123-Actin--Smooth-Muscle--Antibody',
            '56448d75-d587-554f-9a52-a36e228f3398'
        );

        this.uuidCache.set(
            'thedacare-1234567890123456789abcd-Actin--Smooth-Muscle--Antibody',
            '67456812-0565-5174-b766-36d3708ab906'
        );
    }
}

describe('Observation Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Observation fixReferenceId Tests', () => {
        test('fixReferenceId works for observation', async () => {
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
                .get(`/4_0_0/Observation/${observation2Resource.id}`)
                .set(getHeaders())
                .expect(200);

            const observation2BeforeRun = resp.body;
            delete observation2BeforeRun.meta.lastUpdated;
            expect(observation2BeforeRun).toEqual(expectedObservation2BeforeRun);

            const container = getTestContainer();

            // run admin runner
            const collections = ['all'];
            const batchSize = 10000;

            container.register('fixReferenceIdThedacareRunner', (c) => new MockFixReferenceIdThedacareRunner(
                {
                    mongoCollectionManager: c.mongoCollectionManager,
                    collections,
                    batchSize,
                    useAuditDatabase: false,
                    adminLogger: new AdminLogger(),
                    proaCollections: ['Observation_4_0_0'],
                    referenceCollections,
                    mongoDatabaseManager: c.mongoDatabaseManager,
                    preSaveManager: c.preSaveManager,
                    databaseQueryFactory: c.databaseQueryFactory,
                    resourceLocatorFactory: c.resourceLocatorFactory,
                    resourceMerger: c.resourceMerger
                }
            ));

            /**
             * @type {FixReferenceIdThedacareRunner}
             */
            const fixReferenceIdThedacareRunner = container.fixReferenceIdThedacareRunner;
            assertTypeEquals(fixReferenceIdThedacareRunner, FixReferenceIdThedacareRunner);
            await fixReferenceIdThedacareRunner.processAsync();

            resp = await request
                .get(`/4_0_0/Observation/${expectedObservation1AfterRun.id}`)
                .set(getHeaders())
                .expect(200);

            const observation1AfterRun = resp.body;
            delete observation1AfterRun.meta.lastUpdated;
            expect(observation1AfterRun).toEqual(expectedObservation1AfterRun);

            resp = await request
                .get(`/4_0_0/Observation/${expectedObservation2AfterRun.id}`)
                .set(getHeaders())
                .expect(200);

            const observation2AfterRun = resp.body;
            delete observation2AfterRun.meta.lastUpdated;
            expect(observation2AfterRun).toEqual(expectedObservation2AfterRun);

            await request
                .get(`/4_0_0/Observation/${expectedObservation1BeforeRun.id}`)
                .set(getHeaders())
                .expect(404);

            await request
                .get(`/4_0_0/Observation/${expectedObservation2BeforeRun.id}`)
                .set(getHeaders())
                .expect(404);
        });
    });
});
