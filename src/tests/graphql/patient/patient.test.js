const explanationOfBenefitBundleResource = require('./fixtures/explanation_of_benefits.json');
const allergyIntoleranceBundleResource = require('./fixtures/allergy_intolerances.json');
const careTeamBundleResource = require('./fixtures/care_team.json');
const expectedGraphQlResponse = require('./fixtures/expected_graphql_response.json');
const expectedGraphqlMissingUserScopesResponse = require('./fixtures/expected_graphql_missing_user_scopes_response.json');
const expectedGraphqlMissingAccessScopesResponse = require('./fixtures/expected_graphql_missing_access_scopes_response.json');

const patientBundleResource = require('./fixtures/patients.json');
const organizationBundleResource = require('./fixtures/organizations.json');

const fs = require('fs');
const path = require('path');

// eslint-disable-next-line security/detect-non-literal-fs-filename
const explanationOfBenefitQuery = fs.readFileSync(
    path.resolve(__dirname, './fixtures/query.graphql'),
    'utf8'
);

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getGraphQLHeaders,
    getUnAuthenticatedGraphQLHeaders,
    createTestRequest,
} = require('../../common');
const {describe, beforeEach, afterEach} = require('@jest/globals');
const {
    expectMergeResponse,
    expectResourceCount,
    expectResponse, expectStatusCode
} = require('../../fhirAsserts');

describe('GraphQL Patient Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('GraphQL Patient', () => {
        test('GraphQL Patient properly', async () => {
            const request = await createTestRequest();
            const graphqlQueryText = explanationOfBenefitQuery.replace(/\\n/g, '');

            let resp = await request
                .get('/4_0_0/ExplanationOfBenefit')
                .set(getHeaders());
            expectResourceCount(resp, 0);

            resp = await request
                .get('/4_0_0/AllergyIntolerance')
                .set(getHeaders());
            expectResourceCount(resp, 0);

            resp = await request
                .post('/4_0_0/Patient/1/$merge')
                .send(patientBundleResource)
                .set(getHeaders());
            expectMergeResponse(resp, [{created: true}, {created: true}]);

            resp = await request
                .post('/4_0_0/Organization/1/$merge')
                .send(organizationBundleResource)
                .set(getHeaders());
            expectMergeResponse(resp, [{created: true}, {created: true}]);

            resp = await request
                .post('/4_0_0/ExplanationOfBenefit/1/$merge')
                .send(explanationOfBenefitBundleResource)
                .set(getHeaders());
            expectMergeResponse(resp, [{created: true}, {created: true}]);

            resp = await request
                .post('/4_0_0/AllergyIntolerance/1/$merge')
                .send(allergyIntoleranceBundleResource)
                .set(getHeaders());
            expectMergeResponse(resp, [{created: true}, {created: true}]);

            resp = await request
                .post('/4_0_0/CareTeam/1/$merge')
                .send(careTeamBundleResource)
                .set(getHeaders());
            expectMergeResponse(resp, [{created: true}, {created: true}]);

            resp = await request
                .get('/4_0_0/Patient/')
                .set(getHeaders());
            expectResourceCount(resp, 2);

            resp = await request
                .get('/4_0_0/ExplanationOfBenefit/')
                .set(getHeaders());
            expectResourceCount(resp, 2);

            resp = await request
                // .get('/graphql/?query=' + graphqlQueryText)
                // .set(getHeaders())
                .post('/graphql')
                .send({
                    operationName: null,
                    variables: {},
                    query: graphqlQueryText,
                })
                .set(getGraphQLHeaders());
            expectResponse(resp, expectedGraphQlResponse);
        });
        test('GraphQL Patient properly (unauthenticated)', async () => {
            const request = await createTestRequest();
            const graphqlQueryText = explanationOfBenefitQuery.replace(/\\n/g, '');

            let resp = await request
                .get('/4_0_0/ExplanationOfBenefit')
                .set(getHeaders());
            expectResourceCount(resp, 0);

            resp = await request.get('/4_0_0/AllergyIntolerance').set(getHeaders());
            expectResourceCount(resp, 0);

            resp = await request
                .post('/4_0_0/Patient/1/$merge')
                .send(patientBundleResource)
                .set(getHeaders());
            expectMergeResponse(resp, {created: true});

            resp = await request
                .post('/4_0_0/Organization/1/$merge')
                .send(organizationBundleResource)
                .set(getHeaders());
            expectMergeResponse(resp, {created: true});

            resp = await request
                .post('/4_0_0/ExplanationOfBenefit/1/$merge')
                .send(explanationOfBenefitBundleResource)
                .set(getHeaders());
            expectMergeResponse(resp, {created: true});

            resp = await request
                .post('/4_0_0/AllergyIntolerance/1/$merge')
                .send(allergyIntoleranceBundleResource)
                .set(getHeaders());
            expectMergeResponse(resp, {created: true});

            resp = await request
                .post('/4_0_0/CareTeam/1/$merge')
                .send(careTeamBundleResource)
                .set(getHeaders());
            expectMergeResponse(resp, {created: true});

            resp = await request.get('/4_0_0/Patient/').set(getHeaders());
            expectResourceCount(resp, 1);

            resp = await request.get('/4_0_0/ExplanationOfBenefit/').set(getHeaders());
            expectResourceCount(resp, 1);

            await request
                // .get('/graphql/?query=' + graphqlQueryText)
                // .set(getHeaders())
                .post('/graphql')
                .send({
                    operationName: null,
                    variables: {},
                    query: graphqlQueryText,
                })
                .set(getUnAuthenticatedGraphQLHeaders());
            expectStatusCode(resp, 401);
        });
        test('GraphQL Patient properly (missing user scopes)', async () => {
            const request = await createTestRequest();
            const graphqlQueryText = explanationOfBenefitQuery.replace(/\\n/g, '');

            let resp = await request
                .get('/4_0_0/ExplanationOfBenefit')
                .set(getHeaders());
            expectResourceCount(resp, 0);

            resp = await request.get('/4_0_0/AllergyIntolerance').set(getHeaders());
            expectResourceCount(resp, 0);

            resp = await request
                .post('/4_0_0/Patient/1/$merge')
                .send(patientBundleResource)
                .set(getHeaders());
            expectMergeResponse(resp, {created: true});

            resp = await request
                .post('/4_0_0/Organization/1/$merge')
                .send(organizationBundleResource)
                .set(getHeaders());
            expectMergeResponse(resp, {created: true});

            resp = await request
                .post('/4_0_0/ExplanationOfBenefit/1/$merge')
                .send(explanationOfBenefitBundleResource)
                .set(getHeaders());
            expectMergeResponse(resp, {created: true});

            resp = await request
                .post('/4_0_0/AllergyIntolerance/1/$merge')
                .send(allergyIntoleranceBundleResource)
                .set(getHeaders());
            expectMergeResponse(resp, {created: true});

            resp = await request
                .post('/4_0_0/CareTeam/1/$merge')
                .send(careTeamBundleResource)
                .set(getHeaders());
            expectMergeResponse(resp, {created: true});

            resp = await request.get('/4_0_0/Patient/').set(getHeaders());
            expectResourceCount(resp, 1);

            resp = await request.get('/4_0_0/ExplanationOfBenefit/').set(getHeaders()).expect(200);
            expectResourceCount(resp, 1);

            resp = await request
                // .get('/graphql/?query=' + graphqlQueryText)
                // .set(getHeaders())
                .post('/graphql')
                .send({
                    operationName: null,
                    variables: {},
                    query: graphqlQueryText,
                })
                .set(getGraphQLHeaders('user/Practitioner.read access/medstar.*'))
                .expect(200);

            expectResponse(resp, expectedGraphqlMissingUserScopesResponse);
        });
        test('GraphQL Patient properly (missing access scopes)', async () => {
            const request = await createTestRequest();
            const graphqlQueryText = explanationOfBenefitQuery.replace(/\\n/g, '');

            let resp = await request
                .get('/4_0_0/ExplanationOfBenefit')
                .set(getHeaders());
            expectResourceCount(resp, 0);

            resp = await request.get('/4_0_0/AllergyIntolerance').set(getHeaders());
            expectResourceCount(resp, 0);

            resp = await request
                .post('/4_0_0/Patient/1/$merge')
                .send(patientBundleResource)
                .set(getHeaders());
            expectMergeResponse(resp, {created: true});

            resp = await request
                .post('/4_0_0/Organization/1/$merge')
                .send(organizationBundleResource)
                .set(getHeaders());
            expectMergeResponse(resp, {created: true});

            resp = await request
                .post('/4_0_0/ExplanationOfBenefit/1/$merge')
                .send(explanationOfBenefitBundleResource)
                .set(getHeaders());
            expectMergeResponse(resp, {created: true});

            resp = await request
                .post('/4_0_0/AllergyIntolerance/1/$merge')
                .send(allergyIntoleranceBundleResource)
                .set(getHeaders());
            expectMergeResponse(resp, {created: true});

            resp = await request
                .post('/4_0_0/CareTeam/1/$merge')
                .send(careTeamBundleResource)
                .set(getHeaders());
            expectMergeResponse(resp, {created: true});

            resp = await request.get('/4_0_0/Patient/').set(getHeaders());
            expectResourceCount(resp, 1);

            resp = await request.get('/4_0_0/ExplanationOfBenefit/').set(getHeaders());
            expectResourceCount(resp, 1);

            resp = await request
                // .get('/graphql/?query=' + graphqlQueryText)
                // .set(getHeaders())
                .post('/graphql')
                .send({
                    operationName: null,
                    variables: {},
                    query: graphqlQueryText,
                })
                .set(getGraphQLHeaders('user/Patient.read access/fake.*'))
                .expect(200);

            expectResponse(resp, expectedGraphqlMissingAccessScopesResponse);
        });
    });
});
