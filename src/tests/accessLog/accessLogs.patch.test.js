// test file
const observationResource = require('./fixtures/observation.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getTestContainer,
    getHeadersJsonPatch
} = require('../common');
const { describe, beforeEach, afterEach, test, expect, jest } = require('@jest/globals');

describe('AccessLogs Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('AccessLogs patch Tests', () => {
        test('AccessLog is generated', async () => {
            const request = await createTestRequest();

            const container = await getTestContainer();

            const accessLogger = container.accessLogger;

            const logAccessLogAsync = jest.spyOn(
                accessLogger,
                'logAccessLogAsync'
            );

            expect(logAccessLogAsync).toBeCalledTimes(0);

            observationResource.status = 'final';
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

            expect(logAccessLogAsync).toBeCalledTimes(3);
        });
    });
});
