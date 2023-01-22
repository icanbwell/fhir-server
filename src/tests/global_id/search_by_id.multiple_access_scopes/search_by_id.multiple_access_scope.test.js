// test file
const observation1Resource = require('./fixtures/Observation/observation1.json');
const observation2Resource = require('./fixtures/Observation/observation2.json');

// expected
const expectedObservationByOwnerResources = require('./fixtures/expected/expected_observation_by_owner.json');
const expectedObservationByAccessResources = require('./fixtures/expected/expected_observation_by_access.json');
const expectedObservationBySourceAssigningAuthorityResources = require('./fixtures/expected/expected_observation_by_sourceAssigningAuthority.json');
const expectedObservationByUuidResources = require('./fixtures/expected/expected_observation_by_uuid.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getTestContainer,
    getRequestId
} = require('../../common');
const {describe, beforeEach, afterEach, test} = require('@jest/globals');
const {ConfigManager} = require('../../../utils/configManager');
const {IdentifierSystem} = require('../../../utils/identifierSystem');
const deepcopy = require('deepcopy');

class MockConfigManager extends ConfigManager {
    get enableGlobalIdSupport() {
        return true;
    }

    get enableReturnBundle() {
        return true;
    }
}

const headers = getHeaders('user/*.read user/*.write access/C.* access/A.*');
describe('Observation Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('SearchById Tests for two resources with same id (multiple access scopes)', () => {
        test('using id only', async () => {
            const request = await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManager());
                return c;
            });

            const container = getTestContainer();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = container.postRequestProcessor;
            await postRequestProcessor.waitTillDoneAsync({requestId: getRequestId(resp)});

            resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});
            await postRequestProcessor.waitTillDoneAsync({requestId: getRequestId(resp)});

            // ACT AND ASSERT
            // search by owner security tag should only return 1
            resp = await request
                .get('/4_0_0/Observation/?id=1&_debug=1')
                .set(headers);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservationByAccessResources);
        });
        test('using id + security filter', async () => {
            const request = await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManager());
                return c;
            });

            const container = getTestContainer();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = container.postRequestProcessor;
            await postRequestProcessor.waitTillDoneAsync({requestId: getRequestId(resp)});

            resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});
            await postRequestProcessor.waitTillDoneAsync({requestId: getRequestId(resp)});

            // search by owner security tag should only return 1
            resp = await request
                .get('/4_0_0/Observation/?id=1&_debug=1&_security=https://www.icanbwell.com/owner|C')
                .set(headers);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservationByOwnerResources);
        });
        test('using id + sourceAssigningAuthority', async () => {
            const request = await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManager());
                return c;
            });

            const container = getTestContainer();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = container.postRequestProcessor;
            await postRequestProcessor.waitTillDoneAsync({requestId: getRequestId(resp)});

            resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});
            await postRequestProcessor.waitTillDoneAsync({requestId: getRequestId(resp)});

            // search by sourceAssigningAuthority security tag should only return 1
            resp = await request
                .get('/4_0_0/Observation/?id=1|C&_debug=1')
                .set(headers);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservationBySourceAssigningAuthorityResources);
        });
        test('using guid', async () => {
            const request = await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManager());
                return c;
            });

            const container = getTestContainer();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = container.postRequestProcessor;
            await postRequestProcessor.waitTillDoneAsync({requestId: getRequestId(resp)});

            resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});
            await postRequestProcessor.waitTillDoneAsync({requestId: getRequestId(resp)});

            // First call by id to find the uuid and then call by uuid
            resp = await request
                .get('/4_0_0/Observation/1|C/?_debug=1')
                .set(headers);
            // read the uuid for the resource
            const uuid = resp.body.identifier.filter(i => i.system === IdentifierSystem.uuid)[0].value;
            expect(uuid).toBeDefined();

            const expectedObservationByUuidResourcesCopy = deepcopy(expectedObservationByUuidResources);
            expectedObservationByUuidResourcesCopy.meta.tag
                .filter(m => m.system === 'https://www.icanbwell.com/query')
                .forEach(m => {
                    m.display = m.display.replace('11111111-1111-1111-1111-111111111111', uuid);
                    return m;
                });

            resp = await request
                .get(`/4_0_0/Observation/?id=${uuid}&_debug=1`)
                .set(headers);


            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservationByUuidResourcesCopy);
        });
    });
});
