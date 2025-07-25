// claim
const claimResource = require('./fixtures/claim/explanation_of_benefits.json');
const practitionerResource = require('./fixtures/claim/practitioner.json');
const organizationResource = require('./fixtures/claim/organization.json');

// graph
const graphDefinitionResource = require('./fixtures/graph/my_graph.json');

// expected
const expectedResource = require('./fixtures/expected/expected.json');
const expectedWithExplainResource = require('./fixtures/expected/expectedWithExplain.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getTestContainer
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { CreateCollectionsRunner } = require('../../../admin/runners/createCollectionsRunner');
const { AdminLogger } = require('../../../admin/adminLogger');

describe('Claim Graph Contained Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Graph Contained Tests', () => {
        test('Graph contained with multiple targets works properly', async () => {
            const request = await createTestRequest((container) => {
                container.register(
                    'createCollectionsRunner',
                    (c) =>
                        new CreateCollectionsRunner({
                            indexManager: c.indexManager,
                            adminLogger: new AdminLogger(),
                            mongoDatabaseManager: c.mongoDatabaseManager
                        })
                );
                return container;
            });

            const container = getTestContainer();
            // create collections and indexes
            const createCollectionsRunner = container.createCollectionsRunner;
            await createCollectionsRunner.processAsync();

            let resp = await request
                .get('/4_0_0/ExplanationOfBenefit')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            resp = await request
                .post('/4_0_0/Practitioner/1376656959/$merge')
                .send(practitionerResource)
                .set(getHeaders());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Organization/1407857790/$merge')
                .send(organizationResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/ExplanationOfBenefit/WPS-Claim-230916613369/$merge')
                .send(claimResource[0])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/ExplanationOfBenefit/WPS-Claim-230916613368/$merge')
                .send(claimResource[1])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post(
                    '/4_0_0/ExplanationOfBenefit/$graph?id=WPS-Claim-230916613369,WPS-Claim-230916613368&contained=true'
                )
                .set(getHeaders())
                .send(graphDefinitionResource);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResource);

            resp = await request
                .post(
                    '/4_0_0/ExplanationOfBenefit/$graph?id=WPS-Claim-230916613369,WPS-Claim-230916613368&contained=true&_explain=1'
                )
                .set(getHeaders())
                .send(graphDefinitionResource);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedWithExplainResource);
        });
    });
});
