const {
    commonBeforeEach,
    commonAfterEach,
    createTestRequest,
    getTestContainer,
    getHeaders,
    getJsonHeadersWithAdminToken,
    getGraphQLHeaders
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect, jest } = require('@jest/globals');
const { BadRequestError, NotFoundError, ForbiddenError } = require('../../../utils/httpErrors');
const { ServerError } = require('../../../middleware/fhir/utils/server.error');

const sensitiveMessage = 'ECONNREFUSED 127.0.0.1:27017 secret-internal-detail';

describe('Error Sanitization Integration Tests', () => {
    let request;

    beforeEach(async () => {
        await commonBeforeEach();
        request = await createTestRequest();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('FHIR REST endpoint - 500 errors', () => {
        function spyOnFhirSearch (container, error) {
            // STREAM_RESPONSE=1 in test env, so search goes through searchStreaming
            jest.spyOn(container.fhirOperationsManager, 'searchStreaming').mockRejectedValueOnce(error);
            // Also spy on search in case streaming is disabled
            jest.spyOn(container.fhirOperationsManager, 'search').mockRejectedValueOnce(error);
        }

        test('search that throws unhandled error returns sanitized 500 OperationOutcome', async () => {
            const container = getTestContainer();
            spyOnFhirSearch(container, new Error(sensitiveMessage));

            const resp = await request
                .get('/4_0_0/Patient')
                .set(getHeaders());

            expect(resp.status).toBe(500);
            expect(resp.body.resourceType).toBe('OperationOutcome');
            const body = JSON.stringify(resp.body);
            expect(body).not.toContain(sensitiveMessage);
            expect(body).not.toContain('ECONNREFUSED');
            expect(body).toContain('Internal Server Error');
        });

        test('search that throws ServerError with statusCode 500 returns sanitized response', async () => {
            const container = getTestContainer();
            const err = new ServerError(sensitiveMessage, {
                statusCode: 500,
                issue: [{ severity: 'error', code: 'exception', diagnostics: sensitiveMessage }]
            });
            spyOnFhirSearch(container, err);

            const resp = await request
                .get('/4_0_0/Patient')
                .set(getHeaders());

            expect(resp.status).toBe(500);
            expect(resp.body.resourceType).toBe('OperationOutcome');
            const body = JSON.stringify(resp.body);
            expect(body).not.toContain(sensitiveMessage);
            expect(body).toContain('Internal Server Error');
        });

        test('non-500 errors preserve their message in response', async () => {
            const container = getTestContainer();
            spyOnFhirSearch(container, new BadRequestError(new Error('missing required field: name')));

            const resp = await request
                .get('/4_0_0/Patient')
                .set(getHeaders());

            expect(resp.status).toBe(400);
            expect(resp.body.resourceType).toBe('OperationOutcome');
            expect(resp.body.issue[0].details.text).toBe('missing required field: name');
        });
    });

    describe('Admin routes - 500 errors', () => {
        test('GET /admin/:op that throws returns sanitized 500', async () => {
            const container = getTestContainer();
            jest.spyOn(container.indexManager, 'compareCurrentIndexesWithConfigurationInAllCollectionsAsync')
                .mockRejectedValueOnce(new Error(sensitiveMessage));

            const resp = await request
                .get('/admin/indexes')
                .set(getJsonHeadersWithAdminToken());

            // handleAdminGet outer catch uses res.end(JSON.stringify(...)) without setting status
            const body = resp.text;
            expect(body).not.toContain(sensitiveMessage);
            expect(body).not.toContain('ECONNREFUSED');
            expect(body).toContain('Internal Server Error');
        });

        test('POST /admin/:op that throws returns sanitized 500', async () => {
            const container = getTestContainer();
            jest.spyOn(container.adminPersonPatientLinkManager, 'createPersonToPersonLinkAsync')
                .mockRejectedValueOnce(new Error(sensitiveMessage));

            const resp = await request
                .post('/admin/createPersonToPersonLink')
                .send({ bwellPersonId: 'person-1', externalPersonId: 'person-2' })
                .set(getJsonHeadersWithAdminToken());

            expect(resp.status).toBe(500);
            const body = JSON.stringify(resp.body);
            expect(body).not.toContain(sensitiveMessage);
            expect(body).not.toContain('ECONNREFUSED');
            expect(body).toContain('Internal Server Error');
        });

        test('PUT /admin/:op that throws returns sanitized 500', async () => {
            const container = getTestContainer();
            jest.spyOn(container.adminExportManager, 'updateExportStatus')
                .mockRejectedValueOnce(new Error(sensitiveMessage));

            const resp = await request
                .put('/admin/ExportStatus/123')
                .send({})
                .set(getJsonHeadersWithAdminToken());

            expect(resp.status).toBe(500);
            const body = JSON.stringify(resp.body);
            expect(body).not.toContain(sensitiveMessage);
            expect(body).not.toContain('ECONNREFUSED');
            expect(body).toContain('Internal Server Error');
        });

        test('DELETE /admin/:op that throws returns sanitized 500', async () => {
            const container = getTestContainer();
            jest.spyOn(container.adminPersonPatientLinkManager, 'deletePersonAsync')
                .mockRejectedValueOnce(new Error(sensitiveMessage));

            const resp = await request
                .delete('/admin/deletePerson?personId=person-1')
                .set(getJsonHeadersWithAdminToken());

            // handleAdminDelete outer catch uses res.end(JSON.stringify(...)) without setting status
            const body = resp.text;
            expect(body).not.toContain(sensitiveMessage);
            expect(body).not.toContain('ECONNREFUSED');
            expect(body).toContain('Internal Server Error');
        });

        test('admin inner catch (getCacheKeys) sanitizes 500 but preserves non-500', async () => {
            const container = getTestContainer();
            jest.spyOn(container.fhirCacheKeyManager, 'getAllKeysForResource')
                .mockRejectedValueOnce(new Error(sensitiveMessage));

            const resp = await request
                .get('/admin/getCacheKeys?resourceType=Patient&resourceId=123')
                .set(getJsonHeadersWithAdminToken());

            expect(resp.status).toBe(500);
            expect(resp.body.resourceType).toBe('OperationOutcome');
            const body = JSON.stringify(resp.body);
            expect(body).not.toContain(sensitiveMessage);
            expect(body).toContain('Internal Server Error');
        });

        test('admin 403 without admin scope does not leak internals', async () => {
            const resp = await request
                .get('/admin/indexes')
                .set(getHeaders());

            expect(resp.status).toBe(403);
            const body = JSON.stringify(resp.body);
            expect(body).toContain('Missing scopes');
        });
    });

    describe('GraphQL v2 endpoint - error sanitization', () => {
        test('GraphQL error response does not contain stacktrace or exception fields', async () => {
            const container = getTestContainer();
            jest.spyOn(container.searchBundleOperation, 'searchBundleAsync')
                .mockRejectedValueOnce(new Error(sensitiveMessage));

            const resp = await request
                .post('/4_0_0/$graphqlv2')
                .send({
                    operationName: null,
                    variables: {},
                    query: '{ patient(id: "test") { id } }'
                })
                .set(getGraphQLHeaders());

            const body = JSON.stringify(resp.body);
            expect(body).not.toContain('stacktrace');
            expect(body).not.toContain('"exception"');
        });
    });

    describe('FHIR REST endpoint - non-500 error classes', () => {
        function spyOnFhirSearch (container, error) {
            jest.spyOn(container.fhirOperationsManager, 'searchStreaming').mockRejectedValueOnce(error);
            jest.spyOn(container.fhirOperationsManager, 'search').mockRejectedValueOnce(error);
        }

        test('BadRequestError (400) preserves user-facing message', async () => {
            const container = getTestContainer();
            spyOnFhirSearch(container, new BadRequestError(new Error('invalid JSON at position 42')));

            const resp = await request
                .get('/4_0_0/Patient')
                .set(getHeaders());

            expect(resp.status).toBe(400);
            expect(resp.body.resourceType).toBe('OperationOutcome');
            expect(resp.body.issue[0].details.text).toBe('invalid JSON at position 42');
        });

        test('NotFoundError (404) preserves user-facing message', async () => {
            const container = getTestContainer();
            spyOnFhirSearch(container, new NotFoundError('Resource Patient/999 not found'));

            const resp = await request
                .get('/4_0_0/Patient')
                .set(getHeaders());

            expect(resp.status).toBe(404);
            expect(resp.body.resourceType).toBe('OperationOutcome');
            expect(resp.body.issue[0].details.text).toBe('Resource Patient/999 not found');
        });

        test('ForbiddenError (403) preserves user-facing message', async () => {
            const container = getTestContainer();
            spyOnFhirSearch(container, new ForbiddenError('Access denied to resource'));

            const resp = await request
                .get('/4_0_0/Patient')
                .set(getHeaders());

            expect(resp.status).toBe(403);
            expect(resp.body.resourceType).toBe('OperationOutcome');
            expect(resp.body.issue[0].details.text).toBe('Access denied to resource');
        });
    });

    describe('FHIR REST endpoint - 404 catch-all', () => {
        test('request to invalid FHIR path returns 404 OperationOutcome without stack', async () => {
            const resp = await request
                .get('/4_0_0/NonExistentEndpoint')
                .set(getHeaders());

            expect(resp.status).toBe(404);
            const body = JSON.stringify(resp.body);
            expect(body).not.toContain('stack');
        });
    });
});
