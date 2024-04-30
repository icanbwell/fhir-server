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
const { MockedAccessLogger } = require('./mocks/mockedAccessLogger');

describe('AccessLogs Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('AccessLogs create Tests', () => {
        test('AccessLog is generated', async () => {
            const request = await createTestRequest();

            const container = await getTestContainer();

            container.register('accessLogger', (c) => new MockedAccessLogger({
                databaseUpdateFactory: c.databaseUpdateFactory,
                scopesManager: c.scopesManager
            }));
            const accessLogger = container.accessLogger;

            const logAccessLogAsync = jest.spyOn(
                accessLogger,
                'logAccessLogAsync'
            );

            expect(logAccessLogAsync).toHaveBeenCalledTimes(0);
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

            expect(logAccessLogAsync).toHaveBeenCalledTimes(3);
        });
    });
});
