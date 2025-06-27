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

    describe('AccessLogs merge Tests', () => {
        test('AccessLog is generated', async () => {
            const request = await createTestRequest();

            const container = await getTestContainer();

            const accessLogger = container.accessLogger;

            const logAccessLogAsync = jest.spyOn(
                accessLogger,
                'logAccessLogAsync'
            );

            expect(logAccessLogAsync).toBeCalledTimes(0);
            await request
                .post('/4_0_0/Observation/$merge')
                .send(observationResource)
                .set(getHeaders())
                .expect(200);
            await request
                .post('/4_0_0/Observation/$merge')
                .send(observationResource)
                .set(getHeaders())
                .expect(200);

            observationResource.status = 'final';
            await request
                .post('/4_0_0/Observation/$merge')
                .send(observationResource)
                .set(getHeaders())
                .expect(200);

            expect(logAccessLogAsync).toBeCalledTimes(3);
        });
    });
});
