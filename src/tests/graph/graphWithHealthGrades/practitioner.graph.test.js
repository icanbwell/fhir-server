// claim
const claimResource = require('./fixtures/claim/explanation_of_benefits.json');
const practitionerResource = require('./fixtures/claim/practitioner.json');
const organizationResource = require('./fixtures/claim/organization.json');

// graph
const graphDefinitionResource = require('./fixtures/graph/my_graph.json');
const graphDefinitionClientResource = require('./fixtures/graph/my_graph_client.json');

// expected
const expectedResource = require('./fixtures/expected/expected.json');
const expectedClientResource = require('./fixtures/expected/expectedClient.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest
} = require('../../common');
const { describe, beforeAll, afterAll, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('Claim Graph Contained Tests', () => {
    const originalUseAccessIndex = process.env.USE_ACCESS_INDEX;
    const originalAccessTagsIndexed = process.env.ACCESS_TAGS_INDEXED;

    beforeAll(() => {
        process.env.USE_ACCESS_INDEX = '1';
        process.env.ACCESS_TAGS_INDEXED = 'client';
    });

    afterAll(() => {
        if (originalUseAccessIndex === undefined) {
            delete process.env.USE_ACCESS_INDEX;
        } else {
            process.env.USE_ACCESS_INDEX = originalUseAccessIndex;
        }
        if (originalAccessTagsIndexed === undefined) {
            delete process.env.ACCESS_TAGS_INDEXED;
        } else {
            process.env.ACCESS_TAGS_INDEXED = originalAccessTagsIndexed;
        }
    });

    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Graph Contained Tests', () => {
        test('Graph contained with multiple targets works properly', async () => {
            const request = await createTestRequest();
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
                    '/4_0_0/Practitioner/$graph?id=1376656959&contained=true&_debug=1'
                )
                .set(getHeaders())
                .send(graphDefinitionResource);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResource);

            resp = await request
                .post(
                    '/4_0_0/Practitioner/$graph?id=1376656959&contained=true&_debug=1'
                )
                .set(getHeaders())
                .send(graphDefinitionClientResource);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedClientResource);
        });
    });
});
