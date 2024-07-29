// test file
const observation1Resource = require('./fixtures/observation1.json');
const patientBundleResource = require('./fixtures/patient/patient1.json');
const personBundleResource = require('./fixtures/person/person1.json');

// expected
const expectedObservationResources = require('./fixtures/expected_observation.json');
const expectedObservationSubjectResources = require('./fixtures/expected_observation_w_subject.json');
const expectedObservationNotSubjectResources = require('./fixtures/expected_observation_not_subject.json');
const expectedObservationQuantityResources = require('./fixtures/expected_observation_quantity.json');

const fs = require('fs');
const path = require('path');

const observationQuery = fs.readFileSync(path.resolve(__dirname, './fixtures/query.graphql'), 'utf8');
const observationSubjectQuery = fs.readFileSync(path.resolve(__dirname, './fixtures/query_subject.graphql'), 'utf8');
const observationNotSubjectQuery = fs.readFileSync(path.resolve(__dirname, './fixtures/query_not_subject.graphql'), 'utf8');
const observationQuantityQuery = fs.readFileSync(path.resolve(__dirname, './fixtures/query_quantity.graphql'), 'utf8');
const observationQuantityLTQuery = fs.readFileSync(path.resolve(__dirname, './fixtures/query_lt_quantity.graphql'), 'utf8');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getGraphQLHeadersWithPerson,
    createTestRequest
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('GraphQL Observation Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('GraphQL Observation Tests', () => {
        test('GraphQL vitals, not laboratory works', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send(patientBundleResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(personBundleResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            const graphqlQueryText = observationQuery.replace(/\\n/g, '');
            // ACT & ASSERT
            resp = await request
                // .get('/4_0_0/$graphqlv2/?query=' + graphqlQueryText)
                // .set(getHeaders())
                .post('/4_0_0/$graphqlv2')
                .send({
                    operationName: null,
                    variables: {
                        FHIR_DEFAULT_COUNT: 10
                    },
                    query: graphqlQueryText
                })
                .set(getGraphQLHeadersWithPerson('79e59046-ffc7-4c41-9819-c8ef83275454'));

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveGraphQLResponse(expectedObservationResources, 'observation');
        });
        test('GraphQL Reference type', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send(patientBundleResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(personBundleResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            const graphqlQueryText = observationSubjectQuery.replace(/\\n/g, '');
            // ACT & ASSERT
            resp = await request
                // .get('/4_0_0/$graphqlv2/?query=' + graphqlQueryText)
                // .set(getHeaders())
                .post('/4_0_0/$graphqlv2')
                .send({
                    operationName: null,
                    variables: {
                        FHIR_DEFAULT_COUNT: 10
                    },
                    query: graphqlQueryText
                })
                .set(getGraphQLHeadersWithPerson('79e59046-ffc7-4c41-9819-c8ef83275454'));

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveGraphQLResponse(expectedObservationSubjectResources, 'observation');
        });
        test('GraphQL notEquals Reference type', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send(patientBundleResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(personBundleResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            const graphqlQueryText = observationNotSubjectQuery.replace(/\\n/g, '');
            // ACT & ASSERT
            resp = await request
                // .get('/4_0_0/$graphqlv2/?query=' + graphqlQueryText)
                // .set(getHeaders())
                .post('/4_0_0/$graphqlv2')
                .send({
                    operationName: null,
                    variables: {
                        FHIR_DEFAULT_COUNT: 10
                    },
                    query: graphqlQueryText
                })
                .set(getGraphQLHeadersWithPerson('79e59046-ffc7-4c41-9819-c8ef83275454'));

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveGraphQLResponse(expectedObservationNotSubjectResources, 'observation');
        });
        test('GraphQL equals Quantity value', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send(patientBundleResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(personBundleResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            const graphqlQueryText = observationQuantityQuery.replace(/\\n/g, '');
            // ACT & ASSERT
            resp = await request
                // .get('/4_0_0/$graphqlv2/?query=' + graphqlQueryText)
                // .set(getHeaders())
                .post('/4_0_0/$graphqlv2')
                .send({
                    operationName: null,
                    variables: {
                        FHIR_DEFAULT_COUNT: 10
                    },
                    query: graphqlQueryText
                })
               .set(getGraphQLHeadersWithPerson('79e59046-ffc7-4c41-9819-c8ef83275454'));

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveGraphQLResponse(expectedObservationQuantityResources, 'observation');
        });
         test('GraphQL lt prefix Quantity value', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send(patientBundleResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(personBundleResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            const graphqlQueryText = observationQuantityLTQuery.replace(/\\n/g, '');
            // ACT & ASSERT
            resp = await request
                // .get('/4_0_0/$graphqlv2/?query=' + graphqlQueryText)
                // .set(getHeaders())
                .post('/4_0_0/$graphqlv2')
                .send({
                    operationName: null,
                    variables: {
                        FHIR_DEFAULT_COUNT: 10
                    },
                    query: graphqlQueryText
                })
               .set(getGraphQLHeadersWithPerson('79e59046-ffc7-4c41-9819-c8ef83275454'));

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveGraphQLResponse(expectedObservationQuantityResources, 'observation');
        });
   });
});
