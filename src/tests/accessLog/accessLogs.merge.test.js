// test file
const observationResource = require('./fixtures/observation.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getTestContainer,
    mockHttpContext
} = require('../common');
const { describe, beforeEach, afterEach, test, expect, jest } = require('@jest/globals');

describe('AccessLogs Tests', () => {
    let requestId;
    beforeEach(async () => {
        requestId = mockHttpContext();
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('AccessLogs merge Tests', () => {
        test('AccessLog is generated', async () => {
            const request = await createTestRequest();

            const container = await getTestContainer();
            /**
             * @type {import('../../utils/postRequestProcessor').PostRequestProcessor}
             */
            const postRequestProcessor = container.postRequestProcessor;
            /**
             * @type {import('../../operations/common/fhirLoggingManager').FhirLoggingManager}
             */
            const fhirLoggingManager = container.fhirLoggingManager;

            const logOperationFailureAsync = jest.spyOn(
                fhirLoggingManager,
                'logOperationFailureAsync'
            );
            const logOperationSuccessAsync = jest.spyOn(
                fhirLoggingManager,
                'logOperationSuccessAsync'
            );

            expect(logOperationFailureAsync).toHaveBeenCalledTimes(0);
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

            await postRequestProcessor.waitTillDoneAsync({ requestId });
            expect(logOperationFailureAsync).toHaveBeenCalledTimes(0);
            expect(logOperationSuccessAsync).toHaveBeenCalledTimes(3);
        });
    });
});
