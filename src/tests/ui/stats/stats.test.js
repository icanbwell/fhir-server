// provider file
const patient1Resource = require('./fixtures/patient/patient1.json');
const expectedStats1Resource = require('./fixtures/expected/stats1.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest, getTestContainer, mockHttpContext
} = require('../../common');
const {describe, beforeEach, afterEach, jest, test, expect} = require('@jest/globals');
const {assertTypeEquals} = require('../../../utils/assertType');
const {PostRequestProcessor} = require('../../../utils/postRequestProcessor');
const { ConfigManager } = require('../../../utils/configManager');

class MockConfigManager extends ConfigManager {
    get enableStatsEndpoint () {
        return true;
    }
}

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
            const request = await createTestRequest((container) => {
                container.register('configManager', () => new MockConfigManager());
            });
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

            const spyFn = jest.fn();
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedStats1Resource, (response) => {
                response?.collections.forEach((c) => {
                    // indexes can be added or removed, so delete it from expected output
                    if (c.indexes && Array.isArray(c.indexes)) {
                        spyFn();
                    }
                    delete c.indexes;
                });
                return response;
            });

            // if index is coming then it should be called atleast once
            expect(spyFn).toHaveBeenCalled();
        });
    });
});
