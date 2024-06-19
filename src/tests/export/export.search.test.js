const expectedExportStatusResponse = require('./fixtures/expected/expected_export_status1_response.json');
const expectedExportStatusResponse2 = require('./fixtures/expected/expected_export_status2_response.json');
const expectedExportStatusResponse3 = require('./fixtures/expected/expected_export_status3_response.json');
const expectedExportStatusResponseList = require('./fixtures/expected/expected_export_status_list.json');

const deepcopy = require('deepcopy');
const env = require('var');
const { generateUUID } = require('../../../src/utils/uid.util');

const parameters1Resource = require('./fixtures/parameters/parameters1.json');

const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { MockK8sClient } = require('./mocks/k8sClient');


describe('Export Tests', () => {
    beforeEach(async () => {
        env.ENABLE_BULK_EXPORT = '1';
        await commonBeforeEach();
    });

    afterEach(async () => {
        env.ENABLE_BULK_EXPORT = '0';
        await commonAfterEach();
    });

    describe('Get ExportStatus tests', () => {

        test('Test Get ExportStatus Successful', async () => {
            const request = await createTestRequest((c) => {
                c.register('k8sClient', (c) => new MockK8sClient({
                    configManager: c.configManager
                }));
                return c;
            });
            let resp = await request
                .post('/4_0_0/Patient/$export?_type=Patient')
                .send(parameters1Resource)
                .set(getHeaders())
                .expect(202);

            expect(resp.headers['content-location']).toBeDefined();
            const exportStatusId = resp.headers['content-location'].split('/').pop();

            resp = await request
                .get(`/4_0_0/$export/${exportStatusId}`)
                .set(getHeaders())
                .expect(202);

            expect(resp.headers['x-progress']).toEqual('accepted');

            // Get Export Status
            let exportStatusResponse = await request
                .get(`/admin/ExportStatus?id=${exportStatusId}`)
                .set(getHeaders('admin/*.* user/*.* access/*.*'))
                .expect(200);

            delete exportStatusResponse.body.transactionTime;
            delete exportStatusResponse.body.id;
            delete exportStatusResponse.body.identifier[0].value;
            delete exportStatusResponse.body.identifier[1].value;

            expect(exportStatusResponse).toHaveResponse(expectedExportStatusResponse);
        });

        test('Test Get ExportStatus Via Patient Scope', async () => {
            const request = await createTestRequest((c) => {

                c.register('k8sClient', (c) => new MockK8sClient({
                    configManager: c.configManager
                }));
                return c;
            });
            let resp = await request
                .post('/4_0_0/Patient/$export?_type=Patient')
                .send(parameters1Resource)
                .set(getHeaders())
                .expect(202);

            expect(resp.headers['content-location']).toBeDefined();
            const exportStatusId = resp.headers['content-location'].split('/').pop();

            let exportStatusResponseViaPatientScope = await request
                .get(`/admin/ExportStatus?id=${exportStatusId}`)
                .set(getHeaders('patient/*.*'))
                .expect(403);

            expect(exportStatusResponseViaPatientScope).toHaveResponse(
                {
                    message: "Missing scopes for admin/*.read in patient/*.*"
                }
            );
        });

        test('Test Get ExportStatus Not Present', async () => {
            const request = await createTestRequest((c) => {
                c.register('k8sClient', (c) => new MockK8sClient({
                    configManager: c.configManager
                }));
                return c;
            });
            let resp = await request
                .post('/4_0_0/Patient/$export?_type=Patient')
                .send(parameters1Resource)
                .set(getHeaders())
                .expect(202);

            expect(resp.headers['content-location']).toBeDefined();
            const exportStatusId = resp.headers['content-location'].split('/').pop();

            resp = await request
                .get(`/4_0_0/$export/${exportStatusId}`)
                .set(getHeaders())
                .expect(202);

            expect(resp.headers['x-progress']).toEqual('accepted');
            const randomUUID = generateUUID()
            let exportStatusResponse2 = await request
                .get(`/admin/ExportStatus?id=${randomUUID}`)
                .set(getHeaders('admin/*.* user/*.* access/*.*'))
                .expect(200)

            expect(JSON.parse(exportStatusResponse2.text)).toStrictEqual(
                {
                    resourceType: "OperationOutcome",
                    issue: [
                        {
                            severity: 'error',
                            code: 'exception',
                            diagnostics: `Resource not found: ExportStatus/${randomUUID}`
                        }
                    ]
                }
            );
        });

    });

    describe('Test Fetch ExportStatus List', () => {

        test('Test Fetch ExportStatus List Successful', async () => {
            const request = await createTestRequest((c) => {
                c.register('k8sClient', (c) => new MockK8sClient({
                    configManager: c.configManager
                }));
                return c;
            });

            let resp = await request
                .post('/4_0_0/Patient/$export?_type=Patient')
                .send(parameters1Resource)
                .set(getHeaders())
                .expect(202);

            expect(resp.headers['content-location']).toBeDefined();
            const exportStatusId = resp.headers['content-location'].split('/').pop();

            resp = await request
                .get(`/4_0_0/$export/${exportStatusId}`)
                .set(getHeaders())
                .expect(202);

            expect(resp.headers['x-progress']).toEqual('accepted');

            // Get Export Status List
            let exportStatusResponseList = await request
                .get('/admin/ExportStatus/')
                .set(getHeaders('admin/*.* user/*.* access/*.*'))
                .expect(200);

            expect(exportStatusResponseList.body.entry).toHaveLength(1);

            delete exportStatusResponseList.body.entry[0].resource.transactionTime;
            delete exportStatusResponseList.body.entry[0].id;
            delete exportStatusResponseList.body.entry[0].resource.id;
            delete exportStatusResponseList.body.entry[0].resource.identifier[0].value;
            delete exportStatusResponseList.body.entry[0].resource.identifier[1].value;

            expect(exportStatusResponseList).toHaveResponse(expectedExportStatusResponseList)
        });

        test('Test Get ExportStatus List via Patient Scope', async () => {
            const request = await createTestRequest((c) => {
                c.register('k8sClient', (c) => new MockK8sClient({
                    configManager: c.configManager
                }));
                return c;
            });

            let resp = await request
                .post('/4_0_0/Patient/$export?_type=Patient')
                .send(parameters1Resource)
                .set(getHeaders())
                .expect(202);

            expect(resp.headers['content-location']).toBeDefined();

            // Get Export Status List Via Patient Scope
            let exportStatusResponseListViaPatientScope = await request
                .get('/admin/ExportStatus/')
                .set(getHeaders('patient/*.*'))
                .expect(403);

            expect(exportStatusResponseListViaPatientScope).toHaveResponse(
                {
                    message: "Missing scopes for admin/*.read in patient/*.*"
                });
        });
    });

    describe('Test Update ExportStatus', () => {

        test('Test Update ExportStatus Successful', async () => {
            const request = await createTestRequest((c) => {
                c.register('k8sClient', (c) => new MockK8sClient({
                    configManager: c.configManager
                }));
                return c;
            });

            let resp = await request
                .post('/4_0_0/Patient/$export?_type=Patient')
                .send(parameters1Resource)
                .set(getHeaders())
                .expect(202);

            expect(resp.headers['content-location']).toBeDefined();
            const exportStatusId = resp.headers['content-location'].split('/').pop();

            resp = await request
                .get(`/4_0_0/$export/${exportStatusId}`)
                .set(getHeaders())
                .expect(202);

            expect(resp.headers['x-progress']).toEqual('accepted');

            const expectedExportStatusResponseCopy = deepcopy(expectedExportStatusResponse[0]);
            expectedExportStatusResponseCopy.status = "in-progress";

            // Update ExportStatus Request
            let exportStatusPutResponse = await request
                .put(`/admin/ExportStatus?id=${exportStatusId}`)
                .set(getHeaders('admin/*.* user/*.* access/*.*'))
                .send(expectedExportStatusResponseCopy)
                .expect(200);

            delete exportStatusPutResponse.body.transactionTime;
            delete exportStatusPutResponse.body.id;
            delete exportStatusPutResponse.body.identifier[0].value;
            delete exportStatusPutResponse.body.identifier[1].value;

            expect(exportStatusPutResponse).toHaveResponse(expectedExportStatusResponse2);

        });

        test('Test Update ExportStatus without allowed Content Types', async () => {
            const request = await createTestRequest((c) => {
                c.register('k8sClient', (c) => new MockK8sClient({
                    configManager: c.configManager
                }));
                return c;
            });

            let resp = await request
                .post('/4_0_0/Patient/$export?_type=Patient')
                .send(parameters1Resource)
                .set(getHeaders())
                .expect(202);

            expect(resp.headers['content-location']).toBeDefined();
            const exportStatusId = resp.headers['content-location'].split('/').pop();

            resp = await request
                .get(`/4_0_0/$export/${exportStatusId}`)
                .set(getHeaders())
                .expect(202);

            expect(resp.headers['x-progress']).toEqual('accepted');

            const expectedExportStatusResponseCopy = deepcopy(expectedExportStatusResponse[0]);
            expectedExportStatusResponseCopy.status = "in-progress";

            // Update ExportStatus Request

            const headers = getHeaders('admin/*.* user/*.* access/*.*');
            headers['Content-Type'] = 'application/json';

            let exportStatusPutResponse = await request
                .put(`/admin/ExportStatus?id=${exportStatusId}`)
                .set(headers)
                .send(expectedExportStatusResponseCopy)
                .expect(400);

            expect(exportStatusPutResponse).toHaveResponse(
                {
                    message: 'Content Type application/json is not supported. Please use one of: application/fhir+json,application/json+fhir'
                }
            );

        });

        test('Update ExportStatus which is not present', async () => {
            const request = await createTestRequest((c) => {
                c.register('k8sClient', (c) => new MockK8sClient({
                    configManager: c.configManager
                }));
                return c;
            });

            let resp = await request
                .post('/4_0_0/Patient/$export?_type=Patient')
                .send(parameters1Resource)
                .set(getHeaders())
                .expect(202);

            expect(resp.headers['content-location']).toBeDefined();

            const expectedExportStatusResponseCopy = deepcopy(expectedExportStatusResponse[0]);
            expectedExportStatusResponseCopy.status = "in-progress";

            // Update ExportStatus Request which is not present
            const randomUUID = generateUUID();
            let exportStatusNotPresentPutResponse = await request
                .put(`/admin/ExportStatus?id=${randomUUID}`)
                .set(getHeaders('admin/*.* user/*.* access/*.*'))
                .send(expectedExportStatusResponseCopy)
                .expect(404);

            expect(exportStatusNotPresentPutResponse).toHaveResponse(
                {
                    resourceType: 'OperationOutcome',
                    issue: [
                        {
                            severity: 'error',
                            code: 'exception',
                            diagnostics: `ExportStatus resoure with id ${randomUUID} doesn't exists`
                        }
                    ]
                }
            );

        });


        test('Update ExportStatus Via Patient Scope', async () => {
            const request = await createTestRequest((c) => {
                c.register('k8sClient', (c) => new MockK8sClient({
                    configManager: c.configManager
                }));
                return c;
            });

            let resp = await request
                .post('/4_0_0/Patient/$export?_type=Patient')
                .send(parameters1Resource)
                .set(getHeaders())
                .expect(202);

            expect(resp.headers['content-location']).toBeDefined();
            const exportStatusId = resp.headers['content-location'].split('/').pop();

            const expectedExportStatusResponseCopy = deepcopy(expectedExportStatusResponse[0]);
            expectedExportStatusResponseCopy.status = "in-progress";

            // Update ExportStatus Request Via Patient Scope
            let exportStatusPutResponseViaPatientScope = await request
                .put(`/admin/ExportStatus?id=${exportStatusId}`)
                .send(expectedExportStatusResponseCopy)
                .set(getHeaders('patient/*.*'))
                .expect(403);

            expect(exportStatusPutResponseViaPatientScope).toHaveResponse(
                {
                    message: "Missing scopes for admin/*.read in patient/*.*"
                }
            );
        });

        test('Update ExportStatus with no changes', async () => {
            const request = await createTestRequest((c) => {
                c.register('k8sClient', (c) => new MockK8sClient({
                    configManager: c.configManager
                }));
                return c;
            });

            let resp = await request
                .post('/4_0_0/Patient/$export?_type=Patient')
                .send(parameters1Resource)
                .set(getHeaders())
                .expect(202);

            expect(resp.headers['content-location']).toBeDefined();
            const exportStatusId = resp.headers['content-location'].split('/').pop();
            // Update ExportStatus with No changes

            const expectedExportStatusResponseCopy2 = deepcopy(expectedExportStatusResponse[0]);
            let exportStatusNoChangesPutResponse = await request
                .put(`/admin/ExportStatus?id=${exportStatusId}`)
                .set(getHeaders('admin/*.* user/*.* access/*.*'))
                .send(expectedExportStatusResponseCopy2)
                .expect(200);

            delete exportStatusNoChangesPutResponse.body.transactionTime;
            delete exportStatusNoChangesPutResponse.body.id;
            delete exportStatusNoChangesPutResponse.body.identifier[0].value;
            delete exportStatusNoChangesPutResponse.body.identifier[1].value;
            expect(exportStatusNoChangesPutResponse).toHaveResponse(expectedExportStatusResponse3)
        });
    });
});
