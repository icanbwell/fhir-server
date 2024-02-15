const organizationBundleResourceInit = require('./fixtures/organization_init.json');
const organizationBundleResourceUpdate = require('./fixtures/organization_update.json');
const expectedOrganizationBundleResource = require('./fixtures/expected_organization.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest, getTestContainer, mockHttpContext
} = require('../../common');
const {describe, beforeEach, afterEach, test, expect} = require('@jest/globals');
const {assertTypeEquals} = require('../../../utils/assertType');
const {PostRequestProcessor} = require('../../../utils/postRequestProcessor');

describe('Organization Merge Tests', () => {
    let requestId;
    beforeEach(async () => {
        await commonBeforeEach();
        requestId = mockHttpContext();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Organization Merge Bundles', () => {
        test('Organization name merges properly', async () => {
            const request = await createTestRequest();
            let resp = await request.get('/4_0_0/Organization').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            resp = await request
                .post('/4_0_0/Organization/1/$merge')
                .send(organizationBundleResourceInit)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse([{created: true}, {created: true}]);

            const container = getTestContainer();
            /**
             * @type {PostRequestProcessor}
             */
                // eslint-disable-next-line no-unused-vars
            const postRequestProcessor = container.postRequestProcessor;
            assertTypeEquals(postRequestProcessor, PostRequestProcessor);

            await postRequestProcessor.waitTillDoneAsync({requestId: requestId});

            resp = await request
                .post('/4_0_0/Organization/1/$merge')
                .send(organizationBundleResourceUpdate)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse([{updated: true}, {updated: true}]);

            resp = await request.get('/4_0_0/Organization?_count=10').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedOrganizationBundleResource);
        });
    });
});
