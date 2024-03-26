// test file
const compostition1Resource = require('./fixtures/composition/composition1.json');
const compostition2Resource = require('./fixtures/composition/composition2.json');

// expected
const expectedComposition1BeforeRun = require('./fixtures/expected/expectedComposition1BeforeRun.json');
const expectedComposition1AfterRun = require('./fixtures/expected/expectedComposition1AfterRun.json');
const expectedComposition2BeforeRun = require('./fixtures/expected/expectedComposition2BeforeRun.json');

const {
    commonBeforeEach,
    commonAfterEach,
    createTestRequest,
    getTestContainer,
    getHeaders
} = require('../../../common');
const { AdminLogger } = require('../../../../admin/adminLogger');
const {
    FixCodeableConceptsRunner
} = require('../../../../admin/runners/fixCodeableConceptsRunner');
const {
    FixCompositionRunner
} = require('../../../../admin/runners/fixCompositionRunner');
const { assertTypeEquals } = require('../../../../utils/assertType');
const oidToStandardSystemUrlMap = require('../../../../admin/utils/oidToStandardSystemUrlMapping.json');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

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
                .post('/4_0_0/Composition/$merge')
                .send(compostition1Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Composition/$merge')
                .send(compostition2Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            const container = getTestContainer();

            // run admin runner
            const collections = ['Composition_4_0_0'];
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
                    updateResources: true
                })
            );

            /**
             * @type {FixCodeableConceptsRunner}
             */
            const fixCodeableConceptsRunner = container.fixCodeableConceptsRunner;
            assertTypeEquals(fixCodeableConceptsRunner, FixCodeableConceptsRunner);
            await fixCodeableConceptsRunner.processAsync();

            resp = await request
                .get(`/4_0_0/Composition/${compostition1Resource.id}`)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveResponse(expectedComposition1BeforeRun);

            resp = await request
                .get(`/4_0_0/Composition/${compostition2Resource.id}`)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveResponse(expectedComposition2BeforeRun);

            container.register('fixCompositionRunner', (c) =>
                new FixCompositionRunner({
                    mongoCollectionManager: c.mongoCollectionManager,
                    batchSize,
                    adminLogger: new AdminLogger(),
                    mongoDatabaseManager: c.mongoDatabaseManager,
                    databaseHistoryFactory: c.databaseHistoryFactory
                })
            );

            /**
             * @type {FixCompositionRunner}
             */
            const fixCompositionRunner = container.fixCompositionRunner;
            assertTypeEquals(fixCompositionRunner, FixCompositionRunner);
            await fixCompositionRunner.processAsync();

            resp = await request
                .get(`/4_0_0/Composition/${compostition1Resource.id}`)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveResponse(expectedComposition1AfterRun);

            resp = await request
                .get(`/4_0_0/Composition/${compostition2Resource.id}`)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveResponse(expectedComposition2BeforeRun);
        });
    });
});
