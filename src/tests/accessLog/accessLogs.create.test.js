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

    describe('AccessLogs create Tests', () => {
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
                .expect(201);

            expect(logAccessLogAsync).toHaveBeenCalledTimes(4);
        });
    });
});
