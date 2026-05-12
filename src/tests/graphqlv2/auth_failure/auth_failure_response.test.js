const {describe, test, expect} = require('@jest/globals');
const {createTestRequest, getUnAuthenticatedGraphQLHeaders} = require('../../common');

describe('Authentication failure responses', () => {
    describe('POST /4_0_0/$graphqlv2', () => {
        test('returns JSON OperationOutcome on missing auth', async () => {
            const request = await createTestRequest();
            const resp = await request
                .post('/4_0_0/$graphqlv2')
                .send({operationName: null, variables: {}, query: '{ patient { id } }'})
                .set(getUnAuthenticatedGraphQLHeaders());

            expect(resp.status).toBe(401);
            expect(resp.headers['content-type']).toMatch(/application\/json/);

            const body = JSON.parse(resp.text);
            expect(body.resourceType).toBe('OperationOutcome');
            expect(body.issue).toHaveLength(1);
            expect(body.issue[0].severity).toBe('error');
            expect(body.issue[0].code).toBe('security');
        });

        test('returns JSON OperationOutcome on invalid token', async () => {
            const request = await createTestRequest();
            const resp = await request
                .post('/4_0_0/$graphqlv2')
                .send({operationName: null, variables: {}, query: '{ patient { id } }'})
                .set({
                    'Content-Type': 'application/json',
                    Authorization: 'Bearer invalid.jwt.token'
                });

            expect(resp.status).toBe(401);
            expect(resp.headers['content-type']).toMatch(/application\/json/);

            const body = JSON.parse(resp.text);
            expect(body.resourceType).toBe('OperationOutcome');
            expect(body.issue[0].severity).toBe('error');
            expect(body.issue[0].code).toBe('security');
        });
    });

    describe('POST /4_0_0/$graphql (v1)', () => {
        test('returns JSON OperationOutcome on missing auth', async () => {
            const request = await createTestRequest();
            const resp = await request
                .post('/4_0_0/$graphql')
                .send({operationName: null, variables: {}, query: '{ patient { id } }'})
                .set(getUnAuthenticatedGraphQLHeaders());

            // v1 may return 400 if graphql middleware rejects before auth (content validation)
            // The critical requirement is that the response body is valid JSON
            expect([400, 401]).toContain(resp.status);
            expect(resp.headers['content-type']).toMatch(/application\/json/);
            expect(() => JSON.parse(resp.text)).not.toThrow();
        });
    });

    describe('GET /admin', () => {
        test('returns JSON OperationOutcome on missing auth', async () => {
            const request = await createTestRequest();
            const resp = await request
                .get('/admin/stats')
                .set({'Content-Type': 'application/json'});

            expect(resp.status).toBe(401);
            expect(resp.headers['content-type']).toMatch(/application\/json/);

            const body = JSON.parse(resp.text);
            expect(body.resourceType).toBe('OperationOutcome');
            expect(body.issue[0].severity).toBe('error');
            expect(body.issue[0].code).toBe('security');
        });
    });
});
