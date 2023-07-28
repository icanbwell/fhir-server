// provider file
const patient1Resource = require('./fixtures/patient/patient1.json');
const expectedStats1Resource = require('./fixtures/expected/stats1.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest, getTestContainer, mockHttpContext
} = require('../../common');
const {describe, beforeEach, afterEach, expect, test} = require('@jest/globals');
const {assertTypeEquals} = require('../../../utils/assertType');
const {PostRequestProcessor} = require('../../../utils/postRequestProcessor');

describe('Stats Tests', () => {
    let requestId;
    beforeEach(async () => {
        await commonBeforeEach();
        requestId = mockHttpContext();
    });

    afterEach(async () => {
        await commonAfterEach();
    });



    describe('Stats Tests', () => {
        test('stats works', async () => {

            const request = await createTestRequest();
            let resp = await request.get('/4_0_0/Patient').set(getHeaders());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            resp = await request
                .post('/4_0_0/Patient/1679033641/$merge?validate=true')
                .send(patient1Resource)
                .set(getHeaders());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            /**
             * @type {SimpleContainer}
             */
            const container = getTestContainer();

            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = container.postRequestProcessor;
            assertTypeEquals(postRequestProcessor, PostRequestProcessor);

            await postRequestProcessor.waitTillDoneAsync(
                {
                    requestId: requestId
                }
            );

            resp = await request
                .get('/stats')
                .set(getHeaders());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedStats1Resource);
        });
    });
});
