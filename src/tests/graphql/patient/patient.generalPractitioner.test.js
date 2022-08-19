const expectedUpdateGraphQlResponse = require('./fixtures/expected_update_graphql_response.json');
const expectedPractitionerMissingUserScopesResponse = require('./fixtures/expected_practitioner_missing_user_scopes_response.json');
const expectedPractitionerMissingAccessScopesResponse = require('./fixtures/expected_practitioner_missing_access_scopes_response.json');

const patientBundleResource = require('./fixtures/patients.json');
const practitionerBundleResource = require('./fixtures/practitioners.json');

const fs = require('fs');
const path = require('path');

// eslint-disable-next-line security/detect-non-literal-fs-filename
const updatePractitionerQuery = fs.readFileSync(path.resolve(__dirname, './fixtures/updatePractitioner.graphql'), 'utf8');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getGraphQLHeaders, getUnAuthenticatedGraphQLHeaders, createTestRequest
} = require('../../common');
const {describe, beforeEach, afterEach, expect} = require('@jest/globals');

describe('GraphQL Patient Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('GraphQL Update General Practitioner', () => {
        test('GraphQL Update General Practitioner for Patient', async () => {
            const request = await createTestRequest();
            const graphqlQueryText = updatePractitionerQuery.replace(/\\n/g, '');

            let resp = await request
                .get('/4_0_0/Patient')
                .set(getHeaders())
                .expect(200);
            expect(resp.body.length).toBe(0);
            console.log('------- response 1 ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response 1 ------------');

            resp = await request
                .get('/4_0_0/Practitioner')
                .set(getHeaders())
                .expect(200);
            expect(resp.body.length).toBe(0);
            console.log('------- response 1 ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response 1 ------------');

            resp = await request
                .post('/4_0_0/Patient/1/$merge')
                .send(patientBundleResource)
                .set(getHeaders())
                .expect(200);

            console.log('------- response 2 ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response 2  ------------');

            resp = await request
                .post('/4_0_0/Practitioner/1/$merge')
                .send(practitionerBundleResource)
                .set(getHeaders())
                .expect(200);

            console.log('------- response 2 ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response 2  ------------');

            resp = await request
                .get('/4_0_0/Patient/')
                .set(getHeaders())
                .expect(200);
            expect(resp.body.length).toBe(2);
            console.log('------- response patient ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response patient  ------------');

            resp = await request
                .get('/4_0_0/Practitioner/')
                .set(getHeaders())
                .expect(200);
            expect(resp.body.length).toBe(2);
            console.log('------- response practitioner ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response practitioner  ------------');

            resp = await request
                .post('/graphql')
                .send({
                    'operationName': null,
                    'variables': {},
                    'query': graphqlQueryText
                })
                .set(getGraphQLHeaders('user/Patient.read user/Patient.write user/Practitioner.read access/medstar.*'))
                .expect(200);

            let body = resp.body;
            console.log('------- response graphql ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response graphql  ------------');
            if (body.errors) {
                console.log(body.errors);
                expect(body.errors).toBeUndefined();
            }
            expect(body).toStrictEqual(expectedUpdateGraphQlResponse);
        });
        test('GraphQL Update General Practitioner for Patient (unauthenticated)', async () => {
            const request = await createTestRequest();
            const graphqlQueryText = updatePractitionerQuery.replace(/\\n/g, '');

            let resp = await request
                .get('/4_0_0/Patient')
                .set(getHeaders())
                .expect(200);
            expect(resp.body.length).toBe(0);
            console.log('------- response 1 ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response 1 ------------');

            resp = await request
                .get('/4_0_0/Practitioner')
                .set(getHeaders())
                .expect(200);
            expect(resp.body.length).toBe(0);
            console.log('------- response 1 ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response 1 ------------');

            resp = await request
                .post('/4_0_0/Patient/1/$merge')
                .send(patientBundleResource)
                .set(getHeaders())
                .expect(200);

            console.log('------- response 2 ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response 2  ------------');

            resp = await request
                .post('/4_0_0/Practitioner/1/$merge')
                .send(practitionerBundleResource)
                .set(getHeaders())
                .expect(200);

            console.log('------- response 2 ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response 2  ------------');

            resp = await request
                .get('/4_0_0/Patient/')
                .set(getHeaders())
                .expect(200);
            expect(resp.body.length).toBe(2);
            console.log('------- response patient ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response patient  ------------');

            resp = await request
                .get('/4_0_0/Practitioner/')
                .set(getHeaders())
                .expect(200);
            expect(resp.body.length).toBe(2);
            console.log('------- response practitioner ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response practitioner  ------------');

            await request
                .post('/graphql')
                .send({
                    'operationName': null,
                    'variables': {},
                    'query': graphqlQueryText
                })
                .set(getUnAuthenticatedGraphQLHeaders())
                .expect(401);
        });
        test('GraphQL Update General Practitioner for Patient (missing user scopes)', async () => {
            const request = await createTestRequest();
            const graphqlQueryText = updatePractitionerQuery.replace(/\\n/g, '');

            let resp = await request
                .get('/4_0_0/Patient')
                .set(getHeaders())
                .expect(200);
            expect(resp.body.length).toBe(0);
            console.log('------- response 1 ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response 1 ------------');

            resp = await request
                .get('/4_0_0/Practitioner')
                .set(getHeaders())
                .expect(200);
            expect(resp.body.length).toBe(0);
            console.log('------- response 1 ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response 1 ------------');

            resp = await request
                .post('/4_0_0/Patient/1/$merge')
                .send(patientBundleResource)
                .set(getHeaders())
                .expect(200);

            console.log('------- response 2 ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response 2  ------------');

            resp = await request
                .post('/4_0_0/Practitioner/1/$merge')
                .send(practitionerBundleResource)
                .set(getHeaders())
                .expect(200);

            console.log('------- response 2 ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response 2  ------------');

            resp = await request
                .get('/4_0_0/Patient/')
                .set(getHeaders())
                .expect(200);
            expect(resp.body.length).toBe(2);
            console.log('------- response patient ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response patient  ------------');

            resp = await request
                .get('/4_0_0/Practitioner/')
                .set(getHeaders())
                .expect(200);
            expect(resp.body.length).toBe(2);
            console.log('------- response practitioner ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response practitioner  ------------');

            resp = await request
                .post('/graphql')
                .send({
                    'operationName': null,
                    'variables': {},
                    'query': graphqlQueryText
                })
                .set(getGraphQLHeaders('user/Patient.read user/Practitioner.read access/medstar.*'))
                .expect(200);

            let body = resp.body;
            console.log('------- response graphql ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response graphql  ------------');
            expect(body).toStrictEqual(expectedPractitionerMissingUserScopesResponse);
        });
        test('GraphQL Update General Practitioner for Patient (missing access scopes)', async () => {
            const request = await createTestRequest();
            const graphqlQueryText = updatePractitionerQuery.replace(/\\n/g, '');

            let resp = await request
                .get('/4_0_0/Patient')
                .set(getHeaders())
                .expect(200);
            expect(resp.body.length).toBe(0);
            console.log('------- response 1 ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response 1 ------------');

            resp = await request
                .get('/4_0_0/Practitioner')
                .set(getHeaders())
                .expect(200);
            expect(resp.body.length).toBe(0);
            console.log('------- response 1 ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response 1 ------------');

            resp = await request
                .post('/4_0_0/Patient/1/$merge')
                .send(patientBundleResource)
                .set(getHeaders())
                .expect(200);

            console.log('------- response 2 ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response 2  ------------');

            resp = await request
                .post('/4_0_0/Practitioner/1/$merge')
                .send(practitionerBundleResource)
                .set(getHeaders())
                .expect(200);

            console.log('------- response 2 ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response 2  ------------');

            resp = await request
                .get('/4_0_0/Patient/')
                .set(getHeaders())
                .expect(200);
            expect(resp.body.length).toBe(2);
            console.log('------- response patient ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response patient  ------------');

            resp = await request
                .get('/4_0_0/Practitioner/')
                .set(getHeaders())
                .expect(200);
            expect(resp.body.length).toBe(2);
            console.log('------- response practitioner ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response practitioner  ------------');

            resp = await request
                .post('/graphql')
                .send({
                    'operationName': null,
                    'variables': {},
                    'query': graphqlQueryText
                })
                .set(getGraphQLHeaders('user/Patient.read user/Patient.write user/Practitioner.read access/fake.*'))
                .expect(200);

            let body = resp.body;
            console.log('------- response graphql ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response graphql  ------------');
            expect(body).toStrictEqual(expectedPractitionerMissingAccessScopesResponse);
        });
    });
});
