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
    /** @type {import('supertest').SuperTest<import('supertest').Test>} */
    let request;

    // Creating all collections and their indexes via createCollectionsRunner.processAsync()
    // is slow (tens of seconds) and would exhaust the per-test timeout. Run it here in setup
    // with an extended hook timeout so it is excluded from each test's measured time. It must
    // run in beforeEach (not beforeAll) because commonAfterEach drops the database after every test.
    beforeEach(async () => {
        await commonBeforeEach();
        request = await createTestRequest((container) => {
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
        // create collections and indexes
        await getTestContainer().createCollectionsRunner.processAsync();
    }, 180000);

    afterEach(async () => {
        await commonAfterEach();
    });

    test('Graph contained with multiple targets works properly', async () => {
        let resp = await request
            .get('/4_0_0/ExplanationOfBenefit')
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResourceCount(0);

        resp = await request
            .post('/4_0_0/Bundle/$merge')
            .send([practitionerResource, organizationResource, ...claimResource])
            .set(getHeaders());

        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse([{ created: true }, { created: true }, { created: true }, { created: true }]);

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
