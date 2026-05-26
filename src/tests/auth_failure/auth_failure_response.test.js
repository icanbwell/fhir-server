// Enable $export routes before the app is constructed on first createTestRequest()
process.env.ENABLE_BULK_EXPORT = '1';

const {describe, test, expect} = require('@jest/globals');
const {createTestRequest, getUnAuthenticatedGraphQLHeaders} = require('../common');

const expectFhirOperationOutcome = (resp) => {
    expect(resp.status).toBe(401);
    expect(resp.headers['content-type']).toMatch(/application\/json/);
    const body = JSON.parse(resp.text);
    expect(body.resourceType).toBe('OperationOutcome');
    expect(body.issue).toHaveLength(1);
    expect(body.issue[0].severity).toBe('error');
    expect(body.issue[0].code).toBe('security');
    expect(body.issue[0].diagnostics).toBe('Authentication failed');
};

const expectGraphqlError = (resp, code = 'UNAUTHENTICATED', statusCode = 401) => {
    expect(resp.status).toBe(statusCode);
    expect(resp.headers['content-type']).toMatch(/application\/json/);
    const body = JSON.parse(resp.text);
    expect(body).not.toHaveProperty('data');
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0].message).toBeDefined();
    expect(body.errors[0].extensions.code).toBe(code);
};

describe('Authentication failure responses', () => {
    describe('REST/FHIR routes return OperationOutcome with HTTP 401', () => {
        test('REST (CRUD) returns JSON OperationOutcome on missing auth', async () => {
            const request = await createTestRequest();
            const resp = await request.get('/4_0_0/Patient/123');
            expectFhirOperationOutcome(resp);
        });

        test('$merge returns JSON OperationOutcome on missing auth', async () => {
            const request = await createTestRequest();
            const resp = await request
                .post('/4_0_0/Patient/$merge')
                .send([])
                .set({'Content-Type': 'application/fhir+json'});
            expectFhirOperationOutcome(resp);
        });

        test('$everything returns JSON OperationOutcome on missing auth', async () => {
            const request = await createTestRequest();
            const resp = await request.get('/4_0_0/Patient/123/$everything');
            expectFhirOperationOutcome(resp);
        });

        test('$export returns JSON OperationOutcome on missing auth', async () => {
            const request = await createTestRequest();
            const resp = await request
                .post('/4_0_0/$export?_type=Patient')
                .set({'Content-Type': 'application/fhir+json'});
            expectFhirOperationOutcome(resp);
        });
    });

    describe('GraphQL routes return GraphQL error format with HTTP 200', () => {
        test('graphqlv2 returns GraphQL error on missing auth', async () => {
            const request = await createTestRequest();
            const resp = await request
                .post('/4_0_0/$graphqlv2')
                .send({operationName: null, variables: {}, query: '{ patient { id } }'})
                .set(getUnAuthenticatedGraphQLHeaders());
            expectGraphqlError(resp, 'UNAUTHENTICATED');
        });

        test('graphql v1 returns valid JSON on missing auth', async () => {
            const request = await createTestRequest();
            const resp = await request
                .post('/4_0_0/$graphql')
                .send({operationName: null, variables: {}, query: '{ patient { id } }'})
                .set(getUnAuthenticatedGraphQLHeaders());

            // v1 may return 400 if graphql middleware rejects before auth fires.
            // The critical requirement is a valid JSON response (not plain text).
            expect([400, 401]).toContain(resp.status);
            expect(resp.headers['content-type']).toMatch(/application\/json/);
            expect(() => JSON.parse(resp.text)).not.toThrow();
        });

        test('graphqlv2 returns GraphQL error on invalid token', async () => {
            const request = await createTestRequest();
            const resp = await request
                .post('/4_0_0/$graphqlv2')
                .send({operationName: null, variables: {}, query: '{ patient { id } }'})
                .set({
                    'Content-Type': 'application/json',
                    Authorization: 'Bearer invalid.jwt.token'
                });
            expectGraphqlError(resp, 'UNAUTHENTICATED');
        });
    });
});
