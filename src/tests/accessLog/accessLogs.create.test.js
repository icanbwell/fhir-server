// test file
const observationResource = require('./fixtures/observation.json');
// expected
const accessLogs1 = require('./fixtures/access-logs1.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getTestContainer,
    getJsonHeadersWithAdminToken
} = require('../common');
const { describe, beforeEach, afterEach, test, expect, jest } = require('@jest/globals');
const { AccessLogger } = require('../../utils/accessLogger');

describe('AccessLogs Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('AccessLogs create Tests', () => {
        test('Access Log is created', async () => {
            const request = await createTestRequest((container) => {
                container.register('accessLogger', (c) => new AccessLogger({
                    scopesManager: c.scopesManager,
                    fhirOperationsManager: c.fhirOperationsManager,
                    configManager: c.configManager,
                    databaseBulkInserter: c.databaseBulkInserter
                }));
                return container;
            });

            const container = await getTestContainer();
            /**
             * @type {AccessLogger}
             */
            const accessLogger = container.accessLogger;

            const logAccessLogAsync = jest.spyOn(
                accessLogger,
                'logAccessLogAsync'
            );

            expect(logAccessLogAsync).toHaveBeenCalledTimes(0);

            await request
                .post('/4_0_0/Observation/$merge')
                .send(observationResource)
                .set({...getHeaders(), 'origin-server': 'test-server', 'x-request-id': 'test-request-id'})
                .expect(200);

            expect(logAccessLogAsync).toHaveBeenCalledTimes(1);

            await accessLogger.flushAsync();

            const resp = await request.get('/admin/searchLogResults?id=test-request-id').set(getJsonHeadersWithAdminToken());

            accessLogs1._id = expect.any(String);
            accessLogs1.recorded = expect.any(String);
            accessLogs1.request.start = expect.any(String);
            accessLogs1.details.host = expect.any(String);
            accessLogs1.request.end = expect.any(String);
            accessLogs1.request.systemGeneratedRequestId = expect.any(String);
            accessLogs1.request.duration = expect.any(Number);
            expect(resp.body[0]).toEqual(accessLogs1);
        });

        test('AccessLog is called every time as expected', async () => {
            const request = await createTestRequest();

            const container = await getTestContainer();

            const accessLogger = container.accessLogger;

            const logAccessLogAsync = jest.spyOn(
                accessLogger,
                'logAccessLogAsync'
            );
            delete observationResource.status;
            expect(logAccessLogAsync).toHaveBeenCalledTimes(1);
            await request
                .post('/4_0_0/Observation/')
                .send(observationResource)
                .set(getHeaders())
                .expect(400);

            await request
                .post('/4_0_0/Observation/')
                .send(observationResource)
                .set(getHeaders())
                .expect(400);

            observationResource.status = 'final';
            await request
                .post('/4_0_0/Observation/')
                .send(observationResource)
                .set(getHeaders())
                .expect(400);

            expect(logAccessLogAsync).toHaveBeenCalledTimes(4);
        });
    });
});
