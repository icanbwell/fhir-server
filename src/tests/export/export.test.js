// test file
const parameters1Resource = require('./fixtures/parameters/parameters1.json');
const patient1Resource = require('./fixtures/patient/patient1.json');
const patient2Resource = require('./fixtures/patient/patient2.json');
const person1Resource = require('./fixtures/person/person1.json');

const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest, getTestContainer } = require('../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const env = require('var');
const { BulkDataExportRunner } = require('../../operations/export/script/bulkDataExportRunner');
const { MockK8sClient } = require('./mocks/k8sClient');
const { MockS3Client } = require('./mocks/s3Client');

describe('Export Tests', () => {
    beforeEach(async () => {
        env.ENABLE_BULK_EXPORT = '1';
        const container = getTestContainer();
        if (container) {
            delete container.services.bulkDataExportRunner;
        }
        await commonBeforeEach();
    });

    afterEach(async () => {
        env.ENABLE_BULK_EXPORT = '0';
        await commonAfterEach();
    });

    describe('Export tests', () => {
        test('Export triggering for Patient works', async () => {
            const request = await createTestRequest((c) => {
                c.register('k8sClient', (c) => new MockK8sClient({
                    configManager: c.configManager
                }));
                return c;
            });

            let resp = await request
                .post('/4_0_0/$export?_type=Patient')
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

            // create patients to export
            resp = await request
                .post('/4_0_0/Patient/$merge')
                .send(patient1Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Patient/$merge')
                .send(patient2Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            // Update the status of ExportStatus resource to completed
            const container = getTestContainer();

            container.register('bulkDataExportRunner', (c) => new BulkDataExportRunner({
                databaseQueryFactory: c.databaseQueryFactory,
                databaseExportManager: c.databaseExportManager,
                patientFilterManager: c.patientFilterManager,
                databaseAttachmentManager: c.databaseAttachmentManager,
                r4SearchQueryCreator: c.r4SearchQueryCreator,
                securityTagManager: c.securityTagManager,
                patientQueryCreator: c.patientQueryCreator,
                exportStatusId,
                batchSize: 1000,
                logAfterReads: 1000,
                uploadPartSize: 1024 * 1024,
                s3Client: new MockS3Client({
                    bucketName: 'test',
                    region: 'test'
                })
            }));

            const bulkDataExportRunner = container.bulkDataExportRunner;

            await bulkDataExportRunner.processAsync();

            // Query again to check the status
            resp = await request
                .get(`/4_0_0/$export/${exportStatusId}`)
                .set(getHeaders())
                .expect(200);

            expect(resp.body.output).toHaveLength(1);
            expect(resp.body.output[0].type).toEqual('Patient');
            expect(resp.body.output[0].url.split('/').pop()).toEqual('Patient.ndjson');

            expect(resp.body.errors).toHaveLength(0);
        });

        test('Export triggering all resources works only for resources present in db', async () => {
            const request = await createTestRequest((c) => {
                c.register('k8sClient', (c) => new MockK8sClient({
                    configManager: c.configManager
                }));
                return c;
            });

            let resp = await request
                .post('/4_0_0/$export')
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

            // create patients to export
            resp = await request
                .post('/4_0_0/Patient/$merge')
                .send(patient1Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Patient/$merge')
                .send(patient2Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Person/$merge')
                .send(person1Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            // Update the status of ExportStatus resource to completed
            const container = getTestContainer();

            container.register('bulkDataExportRunner', (c) => new BulkDataExportRunner({
                databaseQueryFactory: c.databaseQueryFactory,
                databaseExportManager: c.databaseExportManager,
                patientFilterManager: c.patientFilterManager,
                databaseAttachmentManager: c.databaseAttachmentManager,
                r4SearchQueryCreator: c.r4SearchQueryCreator,
                securityTagManager: c.securityTagManager,
                patientQueryCreator: c.patientQueryCreator,
                exportStatusId,
                batchSize: 1000,
                logAfterReads: 1000,
                uploadPartSize: 1024 * 1024,
                s3Client: new MockS3Client({
                    bucketName: 'test',
                    region: 'test'
                })
            }));

            const bulkDataExportRunner = container.bulkDataExportRunner;

            await bulkDataExportRunner.processAsync();

            // Query again to check the status
            resp = await request
                .get(`/4_0_0/$export/${exportStatusId}`)
                .set(getHeaders())
                .expect(200);

            expect(resp.body.output).toHaveLength(2);
            expect(resp.body.errors).toHaveLength(0);
        });

        test('Export triggering for resource without access doesn\'t work', async () => {
            const request = await createTestRequest((c) => {
                c.register('k8sClient', (c) => new MockK8sClient({
                    configManager: c.configManager
                }));
                return c;
            });

            let resp = await request
                .post('/4_0_0/$export?_type=Patient')
                .send(parameters1Resource)
                .set(getHeaders('access/*.* user/Person.*'))
                .expect(202);

            expect(resp.headers['content-location']).toBeDefined();
            const exportStatusId = resp.headers['content-location'].split('/').pop();

            resp = await request
                .get(`/4_0_0/$export/${exportStatusId}`)
                .set(getHeaders())
                .expect(202);

            expect(resp.headers['x-progress']).toEqual('accepted');

            // create patients to export
            resp = await request
                .post('/4_0_0/Patient/$merge')
                .send(patient1Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Patient/$merge')
                .send(patient2Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            // Update the status of ExportStatus resource to completed
            const container = getTestContainer();

            container.register('bulkDataExportRunner', (c) => new BulkDataExportRunner({
                databaseQueryFactory: c.databaseQueryFactory,
                databaseExportManager: c.databaseExportManager,
                patientFilterManager: c.patientFilterManager,
                databaseAttachmentManager: c.databaseAttachmentManager,
                r4SearchQueryCreator: c.r4SearchQueryCreator,
                securityTagManager: c.securityTagManager,
                patientQueryCreator: c.patientQueryCreator,
                exportStatusId,
                batchSize: 1000,
                logAfterReads: 1000,
                uploadPartSize: 1024 * 1024,
                s3Client: new MockS3Client({
                    bucketName: 'test',
                    region: 'test'
                })
            }));

            const bulkDataExportRunner = container.bulkDataExportRunner;

            await bulkDataExportRunner.processAsync();

            // Query again to check the status
            resp = await request
                .get(`/4_0_0/$export/${exportStatusId}`)
                .set(getHeaders())
                .expect(200);

            expect(resp.body.output).toHaveLength(0);
            expect(resp.body.errors).toHaveLength(1);
            expect(resp.body.errors[0].type).toEqual('OperationOutcome');
            expect(resp.body.errors[0].url.split('/').pop()).toEqual('OperationOutcome.ndjson');
        });

        test('Export cannot be triggered with invalid access tags', async () => {
            const request = await createTestRequest((c) => {
                c.register('k8sClient', (c) => new MockK8sClient({
                    configManager: c.configManager
                }));
                return c;
            });

            const resp = await request
                .post('/4_0_0/$export')
                .send(parameters1Resource)
                .set(getHeaders('access/client1.*'))
                .expect(403);

            expect(resp).toHaveResponse({
                issue: [
                    {
                        code: "forbidden",
                        details: {
                            text: "User imran cannot trigger Bulk Export with access tags: client"
                        },
                        diagnostics: "User imran cannot trigger Bulk Export with access tags: client",
                        severity: "error"
                    }
                ],
                resourceType: "OperationOutcome"
            });
        });

        test('Export cannot be triggered with invalid owner tag', async () => {
            const request = await createTestRequest((c) => {
                c.register('k8sClient', (c) => new MockK8sClient({
                    configManager: c.configManager
                }));
                return c;
            });

            const resp = await request
                .post('/4_0_0/$export')
                .send(parameters1Resource)
                .set(getHeaders('access/client.*'))
                .expect(403);

            expect(resp).toHaveResponse({
                issue: [
                    {
                        code: "forbidden",
                        details: {
                            text: "User imran cannot trigger Bulk Export with owner tag: client1"
                        },
                        diagnostics: "User imran cannot trigger Bulk Export with owner tag: client1",
                        severity: "error"
                    }
                ],
                resourceType: "OperationOutcome"
            });
        });
    });
});
