// Enable $export routes before the app is constructed on first createTestRequest()
process.env.ENABLE_BULK_EXPORT = '1';

const {describe, test, expect} = require('@jest/globals');
const {createTestRequest, getUnAuthenticatedGraphQLHeaders} = require('../common');

const expectAuthenticationFailedJson = (resp) => {
    expect(resp.status).toBe(401);
    expect(resp.headers['content-type']).toMatch(/application\/json/);
    const body = JSON.parse(resp.text);
    expect(body.resourceType).toBe('OperationOutcome');
    expect(body.issue).toHaveLength(1);
    expect(body.issue[0].severity).toBe('error');
    expect(body.issue[0].code).toBe('security');
    expect(body.issue[0].diagnostics).toBe('Authentication failed');
};

describe('Authentication failure responses', () => {
    test('REST (CRUD) returns JSON OperationOutcome on missing auth', async () => {
        const request = await createTestRequest();
        const resp = await request.get('/4_0_0/Patient/123');
        expectAuthenticationFailedJson(resp);
    });

    test('$merge returns JSON OperationOutcome on missing auth', async () => {
        const request = await createTestRequest();
        const resp = await request
            .post('/4_0_0/Patient/$merge')
            .send([])
            .set({'Content-Type': 'application/fhir+json'});
        expectAuthenticationFailedJson(resp);
    });

    test('$everything returns JSON OperationOutcome on missing auth', async () => {
        const request = await createTestRequest();
        const resp = await request.get('/4_0_0/Patient/123/$everything');
        expectAuthenticationFailedJson(resp);
    });

    test('$export returns JSON OperationOutcome on missing auth', async () => {
        const request = await createTestRequest();
        const resp = await request
            .post('/4_0_0/$export?_type=Patient')
            .set({'Content-Type': 'application/fhir+json'});
        expectAuthenticationFailedJson(resp);
    });

    test('graphql returns valid JSON on missing auth', async () => {
        const request = await createTestRequest();
        const resp = await request
            .post('/4_0_0/$graphql')
            .send({operationName: null, variables: {}, query: '{ patient { id } }'})
            .set(getUnAuthenticatedGraphQLHeaders());

        // v1 may return 400 if graphql middleware rejects before auth (content validation).
        // The critical requirement is that the response body is valid JSON.
        expect([400, 401]).toContain(resp.status);
        expect(resp.headers['content-type']).toMatch(/application\/json/);
        expect(() => JSON.parse(resp.text)).not.toThrow();
    });

    test('graphqlv2 returns JSON OperationOutcome on missing auth', async () => {
        const request = await createTestRequest();
        const resp = await request
            .post('/4_0_0/$graphqlv2')
            .send({operationName: null, variables: {}, query: '{ patient { id } }'})
            .set(getUnAuthenticatedGraphQLHeaders());
        expectAuthenticationFailedJson(resp);
    });
});
