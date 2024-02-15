// test file
const careplan1Resource = require('./fixtures/CarePlan/careplan1.json');
const careplan2Resource = require('./fixtures/CarePlan/careplan2.json');
const observation1Resource = require('./fixtures/Observation/observation1.json');
const observation2Resource = require('./fixtures/Observation/observation2.json');
const observation3Resource = require('./fixtures/Observation/observation3.json');

// expected
const expectedObservation1BeforeRun = require('./fixtures/expected/expectedObservation1BeforeRun.json');
const expectedObservation1AfterRun = require('./fixtures/expected/expectedObservation1AfterRun.json');
const expectedObservation2BeforeRun = require('./fixtures/expected/expectedObservation2BeforeRun.json');
const expectedObservation2AfterRun = require('./fixtures/expected/expectedObservation2AfterRun.json');
const expectedObservation3BeforeRun = require('./fixtures/expected/expectedObservation3BeforeRun.json');

const expectedCareplan1BeforeRun = require('./fixtures/expected/expectedCarePlan1BeforeRun.json');
const expectedCareplan1AfterRun = require('./fixtures/expected/expectedCarePlan1AfterRun.json');
const expectedCareplan2BeforeRun = require('./fixtures/expected/expectedCarePlan2BeforeRun.json');

const {
    commonBeforeEach,
    commonAfterEach,
    createTestRequest,
    getTestContainer,
    getHeaders,
} = require('../../../common');
const { AdminLogger } = require('../../../../admin/adminLogger');
const {
    FixCodeableConceptsRunner,
} = require('../../../../admin/runners/fixCodeableConceptsRunner');
const { assertTypeEquals } = require('../../../../utils/assertType');
const oidToStandardSystemUrlMap = require('../../../../admin/utils/oidToStandardSystemUrlMapping.json');
const {describe, beforeEach, afterEach, test, expect} = require('@jest/globals');

describe('FixCodeableConcepts Tests', () => {
    beforeEach(async () => {
        const container = getTestContainer();
        if (container) {
            delete container.services.fixCodeableConceptsRunner;
        }
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Proa and Hapi Tests', () => {
        test('CodeableConcepts are updated in proa observation', async () => {
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
                .post('/4_0_0/Observation/$merge')
                .send(observation3Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/CarePlan/$merge')
                .send(careplan1Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/CarePlan/$merge')
                .send(careplan2Resource)
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

            resp = await request
                .get(`/4_0_0/Observation/${observation3Resource.id}`)
                .set(getHeaders())
                .expect(200);

            const observation3BeforeRun = resp.body;
            delete observation3BeforeRun.meta.lastUpdated;
            expect(observation3BeforeRun).toEqual(expectedObservation3BeforeRun);

            resp = await request
                .get(`/4_0_0/CarePlan/${careplan1Resource.id}`)
                .set(getHeaders())
                .expect(200);

            const careplan1BeforeRun = resp.body;
            delete careplan1BeforeRun.meta.lastUpdated;
            expect(careplan1BeforeRun).toEqual(expectedCareplan1BeforeRun);

            resp = await request
                .get(`/4_0_0/CarePlan/${careplan2Resource.id}`)
                .set(getHeaders())
                .expect(200);

            const careplan2BeforeRun = resp.body;
            delete careplan2BeforeRun.meta.lastUpdated;
            expect(careplan2BeforeRun).toEqual(expectedCareplan2BeforeRun);

            const container = getTestContainer();

            // run admin runner
            const collections = ['Observation_4_0_0', 'CarePlan_4_0_0'];
            const batchSize = 10000;

            container.register('fixCodeableConceptsRunner', (c) =>
                new FixCodeableConceptsRunner({
                    mongoCollectionManager: c.mongoCollectionManager,
                    collections,
                    batchSize,
                    promiseConcurrency: 3,
                    useAuditDatabase: false,
                    adminLogger: new AdminLogger(),
                    mongoDatabaseManager: c.mongoDatabaseManager,
                    databaseQueryFactory: c.databaseQueryFactory,
                    resourceLocatorFactory: c.resourceLocatorFactory,
                    resourceMerger: c.resourceMerger,
                    oidToStandardSystemUrlMap,
                    updateResources: true,
                })
            );

            /**
             * @type {FixCodeableConceptsRunner}
             */
            const fixCodeableConceptsRunner = container.fixCodeableConceptsRunner;
            assertTypeEquals(fixCodeableConceptsRunner, FixCodeableConceptsRunner);
            await fixCodeableConceptsRunner.processAsync();

            resp = await request
                .get(`/4_0_0/Observation/${observation1Resource.id}`)
                .set(getHeaders())
                .expect(200);

            const observation1AfterRun = resp.body;
            delete observation1AfterRun.meta.lastUpdated;
            expect(observation1AfterRun).toEqual(expectedObservation1AfterRun);

            resp = await request
                .get(`/4_0_0/Observation/${observation2Resource.id}`)
                .set(getHeaders())
                .expect(200);

            const observation2AfterRun = resp.body;
            delete observation2AfterRun.meta.lastUpdated;
            expect(observation2AfterRun).toEqual(expectedObservation2AfterRun);

            resp = await request
                .get(`/4_0_0/Observation/${observation3Resource.id}`)
                .set(getHeaders())
                .expect(200);

            const observation3AfterRun = resp.body;
            delete observation3AfterRun.meta.lastUpdated;
            expect(observation3AfterRun).toEqual(expectedObservation3BeforeRun);

            resp = await request
                .get(`/4_0_0/CarePlan/${careplan1Resource.id}`)
                .set(getHeaders())
                .expect(200);

            const careplan1AterRun = resp.body;
            delete careplan1AterRun.meta.lastUpdated;
            expect(careplan1AterRun).toEqual(expectedCareplan1AfterRun);

            resp = await request
                .get(`/4_0_0/CarePlan/${careplan2Resource.id}`)
                .set(getHeaders())
                .expect(200);

            const careplan2AterRun = resp.body;
            delete careplan2AterRun.meta.lastUpdated;
            expect(careplan2AterRun).toEqual(expectedCareplan2BeforeRun);
        });
    });
});
