// claim
const claimResource = require('./fixtures/claim/explanation_of_benefits.json');
const practitionerResource = require('./fixtures/claim/practitioner.json');
const organizationResource = require('./fixtures/claim/organization.json');

// graph
const graphDefinitionResource = require('./fixtures/graph/my_graph.json');

// expected
const expectedResource_230916613368 = require('./fixtures/expected/expected-WPS-Claim-230916613368.json');
const expectedResource_230916613369 = require('./fixtures/expected/expected-WPS-Claim-230916613369.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
} = require('../../common');
const {describe, beforeEach, afterEach, expect, test} = require('@jest/globals');

describe('Claim Graph By Id Contained Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Graph By Id Contained Tests', () => {
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
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Organization/1407857790/$merge')
                .send(organizationResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/ExplanationOfBenefit/WPS-Claim-230916613369/$merge')
                .send(claimResource[0])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/ExplanationOfBenefit/WPS-Claim-230916613368/$merge')
                .send(claimResource[1])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/ExplanationOfBenefit/WPS-Claim-230916613368/$graph?contained=true')
                .set(getHeaders())
                .send(graphDefinitionResource);

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResource_230916613368);

            resp = await request
                .post('/4_0_0/ExplanationOfBenefit/WPS-Claim-230916613369/$graph?contained=true')
                .set(getHeaders())
                .send(graphDefinitionResource);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResource_230916613369);
        });
    });
});
