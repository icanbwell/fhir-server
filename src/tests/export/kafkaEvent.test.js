const expectedExportStatusResponse = require('./fixtures/expected/expected_export_status1_response.json');
const expectedExportStatusResponse2 = require('./fixtures/expected/expected_export_status2_response.json');

const deepcopy = require('deepcopy');

const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest, getTestContainer } = require('../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { MockK8sClient } = require('./mocks/k8sClient');
const { MockKafkaClient } = require('../mocks/mockKafkaClient');
const { assertTypeEquals } = require('../../utils/assertType');
const { isUuid } = require('../../utils/uid.util');


describe('Export Tests', () => {
    beforeEach(async () => {
        process.env.ENABLE_BULK_EXPORT = '1';
        await commonBeforeEach();
    });

    afterEach(async () => {
        process.env.ENABLE_BULK_EXPORT = '0';
        await commonAfterEach();
    });

    describe('Test kafka events creation for ExportStatus', () => {
        test('Test if kafka events are created when export endpoint triggered & updated via admin api', async () => {
            const request = await createTestRequest((c) => {
                c.register('k8sClient', (c) => new MockK8sClient({
                    configManager: c.configManager
                }));
                return c;
            });
            /*
             * @type {PostSaveProcessor}
             */
            const postSaveProcessor = getTestContainer().postSaveProcessor;
            const mockKafkaClient = getTestContainer().kafkaClient;
            assertTypeEquals(mockKafkaClient, MockKafkaClient);
            await postSaveProcessor.flushAsync();
            let messages = mockKafkaClient.getMessages();
            expect(messages.length).toBe(0);

            let resp = await request
                .post('/4_0_0/Patient/$export?_type=Patient')
                .set(getHeaders())
                .expect(202);
            await postSaveProcessor.flushAsync();
            messages = mockKafkaClient.getMessages();
            expect(messages.length).toBe(2);

            expect(resp.headers['content-location']).toBeDefined();
            const exportStatusId = resp.headers['content-location'].split('/').pop();

            let messageData = JSON.parse(messages[0].value);
            expect(messageData).toEqual(
                {
                    data:  {
                        exportJobId: exportStatusId,
                        request: "http://localhost:3000/4_0_0/Patient/$export?_type=Patient",
                        status: "accepted",
                        transactionTime: expect.any(String)
                    },
                    datacontenttype: "application/json",
                    id: expect.any(String),
                    source: "https://www.icanbwell.com/fhir-server",
                    specversion: "1.0",
                    type: "ExportInitiated"
                }
            )
            expect(isUuid(messageData.id)).toBeTruthy();
            expect(!isNaN((new Date(messageData.data.transactionTime)).getTime())).toBeTruthy();

            resp = await request
                .get(`/4_0_0/$export/${exportStatusId}`)
                .set(getHeaders())
                .expect(202);

            expect(resp.headers['x-progress']).toEqual('accepted');

            const expectedExportStatusResponseCopy = deepcopy(expectedExportStatusResponse[0]);
            expectedExportStatusResponseCopy.status = "in-progress";

            // Update ExportStatus Request
            let exportStatusPutResponse = await request
                .put(`/admin/ExportStatus/${exportStatusId}`)
                .set(getHeaders('admin/*.* user/*.* access/*.*'))
                .send(expectedExportStatusResponseCopy)
                .expect(200);
            await postSaveProcessor.flushAsync();
            messages = mockKafkaClient.getMessages();
            expect(messages.length).toBe(4);

            delete exportStatusPutResponse.body.transactionTime;
            delete exportStatusPutResponse.body.id;
            delete exportStatusPutResponse.body.identifier;

            expect(exportStatusPutResponse).toHaveResponse(expectedExportStatusResponse2);
        });
    });
});
