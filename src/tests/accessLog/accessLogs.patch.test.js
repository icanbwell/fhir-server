// test file
const observationResource = require('./fixtures/observation.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getTestContainer,
    mockHttpContext,
    getHeadersJsonPatch
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

    describe('AccessLogs patch Tests', () => {
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

            await postRequestProcessor.waitTillDoneAsync({ requestId });
            expect(logOperationFailureAsync).toHaveBeenCalledTimes(2);
            expect(logOperationSuccessAsync).toHaveBeenCalledTimes(1);
        });
    });
});
