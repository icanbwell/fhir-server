const explanationOfBenefitBundleResource = require('./fixtures/explanation_of_benefits.json');
const allergyIntoleranceBundleResource = require('./fixtures/allergy_intolerances.json');
const careTeamBundleResource = require('./fixtures/care_team.json');
const expectedGraphQlResponse = require('./fixtures/expected_graphql_response.json');
const expectedGraphQlFilterByNameResponse = require('./fixtures/expected_graphql_filter_by_name_response.json');
const expectedGraphQlWithExplainResponse = require('./fixtures/expected_graphql_with_explain_response.json');
const expectedGraphQlMissingPersonResponse = require('./fixtures/expected_graphql_response_missing_person.json');
const expectedGraphqlMissingUserScopesResponse = require('./fixtures/expected_graphql_missing_user_scopes_response.json');
const expectedGraphqlMissingAccessScopesResponse = require('./fixtures/expected_graphql_missing_access_scopes_response.json');
const expectedNotGraphQlResponse = require('./fixtures/expected_graphql_not_response.json');

const patientBundleResource = require('./fixtures/patients.json');
const organizationBundleResource = require('./fixtures/organizations.json');
const personBundleResource = require('./fixtures/person.json');

const fs = require('fs');
const path = require('path');

const patientQuery = fs.readFileSync(
    path.resolve(__dirname, './fixtures/query.graphql'),
    'utf8'
);
const patientFilterByNameQuery = fs.readFileSync(
    path.resolve(__dirname, './fixtures/query_filter_by_name.graphql'),
    'utf8'
);
const patientNotQuery = fs.readFileSync(
    path.resolve(__dirname, './fixtures/query_not.graphql'),
    'utf8'
);
const patientQueryWithExplain = fs.readFileSync(
    path.resolve(__dirname, './fixtures/query_explain.graphql'),
    'utf8'
);

const patientNonExistentQuery = fs.readFileSync(
    path.resolve(__dirname, './fixtures/query_non_existent.graphql'),
    'utf8'
);

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getGraphQLHeaders,
    getUnAuthenticatedGraphQLHeaders,
    createTestRequest
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { ConfigManager } = require('../../../utils/configManager');
const { cleanMeta } = require('../../customMatchers');

class MockConfigManagerWithTwoStepOptimizationBundle extends ConfigManager {
    get enableTwoStepOptimization () {
        return true;
    }

    get streamResponse () {
        return false;
    }
}

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
            const graphqlQueryText = patientQuery.replace(/\\n/g, '');

            let resp = await request
                .get('/4_0_0/ExplanationOfBenefit')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            resp = await request
                .get('/4_0_0/AllergyIntolerance')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            resp = await request
                .post('/4_0_0/Patient/1/$merge')
                .send(patientBundleResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);

            resp = await request
                .post('/4_0_0/Organization/1/$merge')
                .send(organizationBundleResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);

            resp = await request
                .post('/4_0_0/ExplanationOfBenefit/1/$merge')
                .send(explanationOfBenefitBundleResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);

            resp = await request
                .post('/4_0_0/AllergyIntolerance/1/$merge')
                .send(allergyIntoleranceBundleResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);

            resp = await request
                .post('/4_0_0/CareTeam/1/$merge')
                .send(careTeamBundleResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);

            resp = await request
                .get('/4_0_0/Patient/')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(2);

            resp = await request
                .get('/4_0_0/ExplanationOfBenefit/')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(2);

            resp = await request
                .post('/$graphql')
                .send({
                    operationName: null,
                    variables: {},
                    query: graphqlQueryText
                })
                .set(getGraphQLHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedGraphQlResponse, r => {
                r.explanationOfBenefit.forEach(resource => {
                    cleanMeta(resource);
                });
                return r;
            });
            expect(resp.headers['x-request-id']).toBeDefined();
        });
        test('GraphQL Patient with filter on name', async () => {
            const request = await createTestRequest();
            const graphqlQueryText = patientFilterByNameQuery.replace(/\\n/g, '');

            let resp = await request
                .get('/4_0_0/ExplanationOfBenefit')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            resp = await request
                .get('/4_0_0/AllergyIntolerance')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            resp = await request
                .post('/4_0_0/Patient/1/$merge')
                .send(patientBundleResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);

            resp = await request
                .post('/4_0_0/Organization/1/$merge')
                .send(organizationBundleResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);

            resp = await request
                .post('/4_0_0/ExplanationOfBenefit/1/$merge')
                .send(explanationOfBenefitBundleResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);

            resp = await request
                .post('/4_0_0/AllergyIntolerance/1/$merge')
                .send(allergyIntoleranceBundleResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);

            resp = await request
                .post('/4_0_0/CareTeam/1/$merge')
                .send(careTeamBundleResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);

            resp = await request
                .get('/4_0_0/Patient/')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(2);

            resp = await request
                .get('/4_0_0/ExplanationOfBenefit/')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(2);

            resp = await request
                .post('/$graphql')
                .send({
                    operationName: null,
                    variables: {},
                    query: graphqlQueryText
                })
                .set(getGraphQLHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedGraphQlFilterByNameResponse, r => {
                r.explanationOfBenefit.forEach(resource => {
                    cleanMeta(resource);
                });
                return r;
            });
            expect(resp.headers['x-request-id']).toBeDefined();
        });
        test('GraphQL Patient with not equals', async () => {
            const request = await createTestRequest();
            const graphqlQueryText = patientNotQuery.replace(/\\n/g, '');

            let resp = await request
                .get('/4_0_0/ExplanationOfBenefit')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            resp = await request
                .get('/4_0_0/AllergyIntolerance')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            resp = await request
                .post('/4_0_0/Patient/1/$merge')
                .send(patientBundleResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);

            resp = await request
                .post('/4_0_0/Organization/1/$merge')
                .send(organizationBundleResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);

            resp = await request
                .post('/4_0_0/ExplanationOfBenefit/1/$merge')
                .send(explanationOfBenefitBundleResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);

            resp = await request
                .post('/4_0_0/AllergyIntolerance/1/$merge')
                .send(allergyIntoleranceBundleResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);

            resp = await request
                .post('/4_0_0/CareTeam/1/$merge')
                .send(careTeamBundleResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);

            resp = await request
                .get('/4_0_0/Patient/')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(2);

            resp = await request
                .get('/4_0_0/ExplanationOfBenefit/')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(2);

            resp = await request
                .post('/$graphql')
                .send({
                    operationName: null,
                    variables: {},
                    query: graphqlQueryText
                })
                .set(getGraphQLHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedNotGraphQlResponse, r => {
                    const bundle = r.data.patient;
                    if (bundle.meta && bundle.meta.tag) {
                        bundle.meta.tag.forEach((tag) => {
                            if (tag.system === 'https://www.icanbwell.com/queryTime' && tag.display) {
                                delete tag.display;
                            }
                            if (tag.system === 'https://www.icanbwell.com/queryExplain' && tag.display) {
                                delete tag.display;
                            }
                            if (tag.system === 'https://www.icanbwell.com/queryExplainSimple' && tag.display) {
                                delete tag.display;
                            }
                            if (tag.system === 'https://www.icanbwell.com/query' && tag.display) {
                                delete tag.display;
                            }
                            if (tag.system === 'https://www.icanbwell.com/queryFields' && tag.display) {
                                delete tag.display;
                            }
                        });
                    }
                }
            );
            expect(resp.headers['x-request-id']).toBeDefined();
            });
            test('GraphQL Patient with explain properly', async () => {
                const request = await createTestRequest();
                const graphqlQueryText = patientQueryWithExplain.replace(/\\n/g, '');

                let resp = await request
                    .get('/4_0_0/ExplanationOfBenefit')
                    .set(getHeaders());
                // noinspection JSUnresolvedFunction
                expect(resp).toHaveResourceCount(0);

                resp = await request
                    .get('/4_0_0/AllergyIntolerance')
                    .set(getHeaders());
                // noinspection JSUnresolvedFunction
                expect(resp).toHaveResourceCount(0);

                resp = await request
                    .post('/4_0_0/Patient/1/$merge')
                    .send(patientBundleResource)
                    .set(getHeaders());
                // noinspection JSUnresolvedFunction
                expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);

                resp = await request
                    .post('/4_0_0/Organization/1/$merge')
                    .send(organizationBundleResource)
                    .set(getHeaders());
                // noinspection JSUnresolvedFunction
                expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);

                resp = await request
                    .post('/4_0_0/ExplanationOfBenefit/1/$merge')
                    .send(explanationOfBenefitBundleResource)
                    .set(getHeaders());
                // noinspection JSUnresolvedFunction
                expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);

                resp = await request
                    .post('/4_0_0/AllergyIntolerance/1/$merge')
                    .send(allergyIntoleranceBundleResource)
                    .set(getHeaders());
                // noinspection JSUnresolvedFunction
                expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);

                resp = await request
                    .post('/4_0_0/CareTeam/1/$merge')
                    .send(careTeamBundleResource)
                    .set(getHeaders());
                // noinspection JSUnresolvedFunction
                expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);

                resp = await request
                    .get('/4_0_0/Patient/')
                    .set(getHeaders());
                // noinspection JSUnresolvedFunction
                expect(resp).toHaveResourceCount(2);

                resp = await request
                    .get('/4_0_0/ExplanationOfBenefit/')
                    .set(getHeaders());
                // noinspection JSUnresolvedFunction
                expect(resp).toHaveResourceCount(2);

                resp = await request
                    .post('/$graphql')
                    .send({
                        operationName: null,
                        variables: {},
                        query: graphqlQueryText
                    })
                    .set(getGraphQLHeaders());
                // noinspection JSUnresolvedFunction
                expect(resp).toHaveResponse(expectedGraphQlWithExplainResponse);
                expect(resp.headers['x-request-id']).toBeDefined();
            });
            test('GraphQL Patient for missing person', async () => {
                const request = await createTestRequest((c) => {
                    c.register('configManager', () => new MockConfigManagerWithTwoStepOptimizationBundle());
                    return c;
                });
                const graphqlQueryText = patientNonExistentQuery.replace(/\\n/g, '');

                let resp = await request
                    .post('/4_0_0/Person/1/$merge')
                    .send(personBundleResource)
                    .set(getHeaders());
                // noinspection JSUnresolvedFunction
                expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);

                resp = await request
                    // .get('/$graphql/?query=' + graphqlQueryText)
                    // .set(getHeaders())
                    .post('/$graphql')
                    .send({
                        operationName: null,
                        variables: {},
                        query: graphqlQueryText
                    })
                    .set(getGraphQLHeaders());
                // noinspection JSUnresolvedFunction
                expect(resp).toHaveResponse(expectedGraphQlMissingPersonResponse);
            });
            test('GraphQL Patient properly (unauthenticated)', async () => {
                const request = await createTestRequest();
                const graphqlQueryText = patientQuery.replace(/\\n/g, '');

                let resp = await request
                    .get('/4_0_0/ExplanationOfBenefit')
                    .set(getHeaders());
                // noinspection JSUnresolvedFunction
                expect(resp).toHaveResourceCount(0);

                resp = await request.get('/4_0_0/AllergyIntolerance').set(getHeaders());
                // noinspection JSUnresolvedFunction
                expect(resp).toHaveResourceCount(0);

                resp = await request
                    .post('/4_0_0/Patient/1/$merge')
                    .send(patientBundleResource)
                    .set(getHeaders());
                // noinspection JSUnresolvedFunction
                expect(resp).toHaveMergeResponse({ created: true });

                resp = await request
                    .post('/4_0_0/Organization/1/$merge')
                    .send(organizationBundleResource)
                    .set(getHeaders());
                // noinspection JSUnresolvedFunction
                expect(resp).toHaveMergeResponse({ created: true });

                resp = await request
                    .post('/4_0_0/ExplanationOfBenefit/1/$merge')
                    .send(explanationOfBenefitBundleResource)
                    .set(getHeaders());
                // noinspection JSUnresolvedFunction
                expect(resp).toHaveMergeResponse({ created: true });

                resp = await request
                    .post('/4_0_0/AllergyIntolerance/1/$merge')
                    .send(allergyIntoleranceBundleResource)
                    .set(getHeaders());
                // noinspection JSUnresolvedFunction
                expect(resp).toHaveMergeResponse({ created: true });

                resp = await request
                    .post('/4_0_0/CareTeam/1/$merge')
                    .send(careTeamBundleResource)
                    .set(getHeaders());
                // noinspection JSUnresolvedFunction
                expect(resp).toHaveMergeResponse({ created: true });

                resp = await request.get('/4_0_0/Patient/').set(getHeaders());
                // noinspection JSUnresolvedFunction
                expect(resp).toHaveResourceCount(2);

                resp = await request.get('/4_0_0/ExplanationOfBenefit/').set(getHeaders());
                // noinspection JSUnresolvedFunction
                expect(resp).toHaveResourceCount(2);

                resp = await request
                    // .get('/$graphql/?query=' + graphqlQueryText)
                    // .set(getHeaders())
                    .post('/$graphql')
                    .send({
                        operationName: null,
                        variables: {},
                        query: graphqlQueryText
                    })
                    .set(getUnAuthenticatedGraphQLHeaders());
                // noinspection JSUnresolvedFunction
                expect(resp).toHaveStatusCode(401);
            });
            test('GraphQL Patient properly (missing user scopes)', async () => {
                const request = await createTestRequest();
                const graphqlQueryText = patientQuery.replace(/\\n/g, '');

                let resp = await request
                    .get('/4_0_0/ExplanationOfBenefit')
                    .set(getHeaders());
                // noinspection JSUnresolvedFunction
                expect(resp).toHaveResourceCount(0);

                resp = await request.get('/4_0_0/AllergyIntolerance').set(getHeaders());
                // noinspection JSUnresolvedFunction
                expect(resp).toHaveResourceCount(0);

                resp = await request
                    .post('/4_0_0/Patient/1/$merge')
                    .send(patientBundleResource)
                    .set(getHeaders());
                // noinspection JSUnresolvedFunction
                expect(resp).toHaveMergeResponse({ created: true });

                resp = await request
                    .post('/4_0_0/Organization/1/$merge')
                    .send(organizationBundleResource)
                    .set(getHeaders());
                // noinspection JSUnresolvedFunction
                expect(resp).toHaveMergeResponse({ created: true });

                resp = await request
                    .post('/4_0_0/ExplanationOfBenefit/1/$merge')
                    .send(explanationOfBenefitBundleResource)
                    .set(getHeaders());
                // noinspection JSUnresolvedFunction
                expect(resp).toHaveMergeResponse({ created: true });

                resp = await request
                    .post('/4_0_0/AllergyIntolerance/1/$merge')
                    .send(allergyIntoleranceBundleResource)
                    .set(getHeaders());
                // noinspection JSUnresolvedFunction
                expect(resp).toHaveMergeResponse({ created: true });

                resp = await request
                    .post('/4_0_0/CareTeam/1/$merge')
                    .send(careTeamBundleResource)
                    .set(getHeaders());
                // noinspection JSUnresolvedFunction
                expect(resp).toHaveMergeResponse({ created: true });

                resp = await request.get('/4_0_0/Patient/').set(getHeaders());
                // noinspection JSUnresolvedFunction
                expect(resp).toHaveResourceCount(2);

                resp = await request.get('/4_0_0/ExplanationOfBenefit/').set(getHeaders()).expect(200);
                // noinspection JSUnresolvedFunction
                expect(resp).toHaveResourceCount(2);

                resp = await request
                    // .get('/$graphql/?query=' + graphqlQueryText)
                    // .set(getHeaders())
                    .post('/$graphql')
                    .send({
                        operationName: null,
                        variables: {},
                        query: graphqlQueryText
                    })
                    .set(getGraphQLHeaders('user/Practitioner.read access/client.*'))
                    .expect(200);

                // noinspection JSUnresolvedFunction
                expect(resp).toHaveResponse(expectedGraphqlMissingUserScopesResponse);
            });
            test('GraphQL Patient properly (missing access scopes)', async () => {
                const request = await createTestRequest();
                const graphqlQueryText = patientQuery.replace(/\\n/g, '');

                let resp = await request
                    .get('/4_0_0/ExplanationOfBenefit')
                    .set(getHeaders());
                // noinspection JSUnresolvedFunction
                expect(resp).toHaveResourceCount(0);

                resp = await request.get('/4_0_0/AllergyIntolerance').set(getHeaders());
                // noinspection JSUnresolvedFunction
                expect(resp).toHaveResourceCount(0);

                resp = await request
                    .post('/4_0_0/Patient/1/$merge')
                    .send(patientBundleResource)
                    .set(getHeaders());
                // noinspection JSUnresolvedFunction
                expect(resp).toHaveMergeResponse({ created: true });

                resp = await request
                    .post('/4_0_0/Organization/1/$merge')
                    .send(organizationBundleResource)
                    .set(getHeaders());
                // noinspection JSUnresolvedFunction
                expect(resp).toHaveMergeResponse({ created: true });

                resp = await request
                    .post('/4_0_0/ExplanationOfBenefit/1/$merge')
                    .send(explanationOfBenefitBundleResource)
                    .set(getHeaders());
                // noinspection JSUnresolvedFunction
                expect(resp).toHaveMergeResponse({ created: true });

                resp = await request
                    .post('/4_0_0/AllergyIntolerance/1/$merge')
                    .send(allergyIntoleranceBundleResource)
                    .set(getHeaders());
                // noinspection JSUnresolvedFunction
                expect(resp).toHaveMergeResponse({ created: true });

                resp = await request
                    .post('/4_0_0/CareTeam/1/$merge')
                    .send(careTeamBundleResource)
                    .set(getHeaders());
                // noinspection JSUnresolvedFunction
                expect(resp).toHaveMergeResponse({ created: true });

                resp = await request.get('/4_0_0/Patient/').set(getHeaders());
                // noinspection JSUnresolvedFunction
                expect(resp).toHaveResourceCount(2);

                resp = await request.get('/4_0_0/ExplanationOfBenefit/').set(getHeaders());
                // noinspection JSUnresolvedFunction
                expect(resp).toHaveResourceCount(2);

                resp = await request
                    // .get('/$graphql/?query=' + graphqlQueryText)
                    // .set(getHeaders())
                    .post('/$graphql')
                    .send({
                        operationName: null,
                        variables: {},
                        query: graphqlQueryText
                    })
                    .set(getGraphQLHeaders('user/Patient.read access/fake.*'))
                    .expect(200);

                // noinspection JSUnresolvedFunction
                expect(resp).toHaveResponse(expectedGraphqlMissingAccessScopesResponse);
            });
        });
    });
