// test file
const parameters1Resource = require('./fixtures/parameters/parameters1.json');

const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest, getTestContainer } = require('../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const env = require('var');
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

    describe('Export tests', () => {
        test('Export triggering works', async () => {
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

            // Update the status of ExportStatus resource to completed
            const container = getTestContainer();

            /**
             * @type {import('../../utils/mongoDatabaseManager').MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;

            const db = await mongoDatabaseManager.getClientDbAsync();

            const exportStatusCollection = db.collection('ExportStatus_4_0_0');

            const output = [{
                url: 'http://localhost:3000/4_0_0/Patient',
                type: 'Patient'
            }];

            exportStatusCollection.updateOne({ _uuid: exportStatusId }, {
                $set: {
                    status: 'completed',
                    output
                }
            });

            // Query again to check the status
            resp = await request
                .get(`/4_0_0/$export/${exportStatusId}`)
                .set(getHeaders())
                .expect(200);

            expect(resp.body?.output).toEqual(output);
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
