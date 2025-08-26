// test file
const observationResource = require('./fixtures/observation.json');
// expected
const accessLogs2 = require('./fixtures/access-logs2.json');
const accessLogs3 = require('./fixtures/access-logs3.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getTestContainer,
    getJsonHeadersWithAdminToken
} = require('../common');
const { describe, beforeEach, afterEach, test, expect, jest } = require('@jest/globals');
const deepcopy = require('deepcopy');
const { AccessLogger } = require('../../utils/accessLogger');

describe('AccessLogs Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('AccessLogs merge Tests', () => {
        test('AccessLog for merge operation', async () => {
            const request = await createTestRequest((container) => {
                container.register(
                    'accessLogger',
                    (c) =>
                        new AccessLogger({
                            scopesManager: c.scopesManager,
                            fhirOperationsManager: c.fhirOperationsManager,
                            configManager: c.configManager,
                            databaseBulkInserter: c.databaseBulkInserter,
                            accessEventProducer: c.accessEventProducer
                        })
                );
                return container;
            });

            await request
                .post('/4_0_0/Observation/$merge')
                .send([observationResource])
                .set({ ...getHeaders(), 'Origin-Service': 'test-server', 'x-request-id': 'test-request-id' })
                .expect(200);

            const container = await getTestContainer();
            /**
             * @type {AccessLogger}
             */
            const accessLogger = container.accessLogger;
            await accessLogger.flushAsync();

            const resp = await request
                .get('/admin/searchLogResults?id=test-request-id')
                .set(getJsonHeadersWithAdminToken());

            accessLogs2._id = expect.any(String);
            accessLogs2.timestamp = expect.any(String);
            accessLogs2.request.start = expect.any(String);
            accessLogs2.details.host = expect.any(String);
            accessLogs2.request.end = expect.any(String);
            accessLogs2.request.systemGeneratedRequestId = expect.any(String);
            accessLogs2.request.duration = expect.any(Number);
            expect(resp.body[0]).toEqual(accessLogs2);
        });

        test('AccessLog when payload resource dont contain meta', async () => {
            const request = await createTestRequest((container) => {
                container.register(
                    'accessLogger',
                    (c) =>
                        new AccessLogger({
                            scopesManager: c.scopesManager,
                            fhirOperationsManager: c.fhirOperationsManager,
                            configManager: c.configManager,
                            databaseBulkInserter: c.databaseBulkInserter,
                            accessEventProducer: c.accessEventProducer
                        })
                );
                return container;
            });

            let payload = deepcopy(observationResource);
            delete payload.meta;
            await request
                .post('/4_0_0/Observation/$merge')
                .send([payload])
                .set({ ...getHeaders(), 'Origin-Service': 'test-server', 'x-request-id': 'test-request-id' })
                .expect(200);

            const container = await getTestContainer();
            /**
             * @type {AccessLogger}
             */
            const accessLogger = container.accessLogger;
            await accessLogger.flushAsync();

            const resp = await request
                .get('/admin/searchLogResults?id=test-request-id')
                .set(getJsonHeadersWithAdminToken());

            accessLogs3._id = expect.any(String);
            accessLogs3.timestamp = expect.any(String);
            accessLogs3.request.start = expect.any(String);
            accessLogs3.details.host = expect.any(String);
            accessLogs3.request.end = expect.any(String);
            accessLogs3.request.systemGeneratedRequestId = expect.any(String);
            accessLogs3.request.duration = expect.any(Number);
            expect(resp.body[0]).toEqual(accessLogs3);
        });
    });
});
