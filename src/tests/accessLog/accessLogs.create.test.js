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
const { AccessLogger } = require('../../utils/accessLogger');

class MockAccessLogger extends AccessLogger {
    /**
     * Logs a FHIR operation
     * @param {Request} req
     * @param {number} statusCode
     * @param {number|null} startTime
     * @param {number|null|undefined} [stopTime]
     * @param {string} action
     * @param {string|undefined} [query]
     */
    async logAccessLogAsync ({
        req,
        statusCode,
        startTime,
        stopTime = Date.now(),
        query
    }) {
        expect(statusCode).toEqual(400);
    }
}

describe('AccessLogs Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('AccessLogs create Tests', () => {
        test('Access Log is created', async () => {
            const request = await createTestRequest();

            const container = await getTestContainer();

            // Using mocked access logger to test creation of access logs in db
            container.register('accessLogger', (c) => new MockAccessLogger({
                databaseUpdateFactory: c.databaseUpdateFactory,
                scopesManager: c.scopesManager,
                fhirOperationsManager: c.fhirOperationsManager
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
            expect(logAccessLogAsync).toHaveBeenCalledTimes(1);
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
                .expect(201);

            expect(logAccessLogAsync).toHaveBeenCalledTimes(4);
        });
    });
});
