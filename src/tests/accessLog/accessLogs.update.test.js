// test file
const observationResource = require('./fixtures/observation.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getTestContainer
} = require('../common');
const { describe, beforeEach, afterEach, test, expect, jest } = require('@jest/globals');

describe('AccessLogs Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('AccessLogs update Tests', () => {
        test('AccessLog is generated', async () => {
            const request = await createTestRequest();

            const container = await getTestContainer();

            const accessLogger = container.accessLogger;

            const logAccessLogAsync = jest.spyOn(
                accessLogger,
                'logAccessLogAsync'
            );

            expect(logAccessLogAsync).toHaveBeenCalledTimes(0);
            await request
                .put('/4_0_0/Observation/1')
                .send(observationResource)
                .set(getHeaders())
                .expect(400);

            observationResource.status = 'final';
            await request
                .put('/4_0_0/Observation/1')
                .send(observationResource)
                .set(getHeaders())
                .expect(201);

            observationResource.status = 'invalid';
            await request
                .put('/4_0_0/Observation/1')
                .send(observationResource)
                .set(getHeaders())
                .expect(400);

            expect(logAccessLogAsync).toHaveBeenCalledTimes(3);
        });
    });
});
