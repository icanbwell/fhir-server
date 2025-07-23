// test file
const observationResource = require('./fixtures/observation.json');
// expected
const accessLogs5 = require('./fixtures/access-logs5.json');

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

    describe('AccessLogs delete Tests', () => {
        test('AccessLog when trying to update patient ref in resouce', async () => {
            const request = await createTestRequest((container) => {
                container.register(
                    'accessLogger',
                    (c) =>
                        new AccessLogger({
                            scopesManager: c.scopesManager,
                            fhirOperationsManager: c.fhirOperationsManager,
                            configManager: c.configManager,
                            databaseBulkInserter: c.databaseBulkInserter
                        })
                );
                return container;
            });

            await request.post('/4_0_0/Observation/$merge').send(observationResource).set(getHeaders()).expect(200);

            await request
                .delete('/4_0_0/Observation?_security=|bwell')
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

            accessLogs5._id = expect.any(String);
            accessLogs5.timestamp = expect.any(String);
            accessLogs5.request.start = expect.any(String);
            accessLogs5.details.host = expect.any(String);
            accessLogs5.request.end = expect.any(String);
            accessLogs5.request.systemGeneratedRequestId = expect.any(String);
            accessLogs5.request.duration = expect.any(Number);
            expect(resp.body[0]).toEqual(accessLogs5);
        });
    });
});
