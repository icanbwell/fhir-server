// test file
const observationResource = require('./fixtures/observation.json');
// expected
const accessLogs4 = require('./fixtures/access-logs4.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getTestContainer,
    getHeadersJsonPatch,
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

    describe('AccessLogs patch Tests', () => {
        test('AccessLog is generated', async () => {
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

            const container = await getTestContainer();

            const accessLogger = container.accessLogger;

            const logAccessLogAsync = jest.spyOn(
                accessLogger,
                'logAccessLogAsync'
            );

            expect(logAccessLogAsync).toHaveBeenCalledTimes(0);

            await request
                .post('/4_0_0/Observation/$merge')
                .send(observationResource)
                .set(getHeaders())
                .expect(200);

            await request
                .patch('/4_0_0/Observation/1')
                .send([
                    {
                        op: 'remove',
                        path: '/status'
                    }
                ])
                .set(getHeadersJsonPatch())
                .expect(400);
            await request
                .patch('/4_0_0/Observation/1')
                .send([
                    {
                        op: 'remove',
                        path: '/status'
                    }
                ])
                .set(getHeadersJsonPatch())
                .expect(400);

            expect(logAccessLogAsync).toHaveBeenCalledTimes(3);
        });
    });

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
            .patch('/4_0_0/Observation/61abdd48-df46-5e98-ac6c-fde3cace4d07')
            .send([
                {
                    op: 'replace',
                    path: '/subject/reference',
                    value: 'Patient/123'
                }
            ])
            .set({ ...getHeadersJsonPatch(), 'Origin-Service': 'test-server', 'x-request-id': 'test-request-id' })
            .expect(400);

        const container = await getTestContainer();
        /**
         * @type {AccessLogger}
         */
        const accessLogger = container.accessLogger;
        await accessLogger.flushAsync();

        const resp = await request
            .get('/admin/searchLogResults?id=test-request-id')
            .set(getJsonHeadersWithAdminToken());

        accessLogs4._id = expect.any(String);
        accessLogs4.recorded = expect.any(String);
        accessLogs4.request.start = expect.any(String);
        accessLogs4.details.host = expect.any(String);
        accessLogs4.request.end = expect.any(String);
        accessLogs4.request.systemGeneratedRequestId = expect.any(String);
        accessLogs4.request.duration = expect.any(Number);
        expect(resp.body[0]).toEqual(accessLogs4);
    });
});
