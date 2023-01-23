// test file
const observation1Resource = require('./fixtures/Observation/observation1.json');
const observation2Resource = require('./fixtures/Observation/observation2.json');
const patient1Resource = require('./fixtures/Patient/patient1.json');

// expected
const expectedObservationByOwnerResources = require('./fixtures/expected/expected_observation_by_owner.json');
const expectedObservationIdOnlyByOwnerResources = require('./fixtures/expected/expected_observation_by_owner_id_only.json');
const expectedObservationByAccessResources = require('./fixtures/expected/expected_observation_by_access.json');
const expectedObservationIdOnlyByAccessResources = require('./fixtures/expected/expected_observation_by_access_id_only.json');
const expectedObservationBySourceAssigningAuthorityResources = require('./fixtures/expected/expected_observation_by_sourceAssigningAuthority.json');
const expectedObservationIdOnlyBySourceAssigningAuthorityResources = require('./fixtures/expected/expected_observation_by_sourceAssigningAuthority_id_only.json');
const expectedObservationByUuidResources = require('./fixtures/expected/expected_observation_by_uuid.json');
const expectedObservationIdOnlyByUuidResources = require('./fixtures/expected/expected_observation_by_uuid_id_only.json');


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

    describe('SearchByReference Tests for two resources with same id (multiple access scopes)', () => {
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

            resp = await request
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send(patient1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});
            await postRequestProcessor.waitTillDoneAsync({requestId: getRequestId(resp)});

            // ACT AND ASSERT
            // search by owner security tag should only return 1
            resp = await request
                .get('/4_0_0/Observation/?patient=Patient/patient1&_debug=1')
                .set(headers);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservationByAccessResources);

            resp = await request
                .get('/4_0_0/Observation/?patient=patient1&_debug=1')
                .set(headers);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservationIdOnlyByAccessResources);
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

            resp = await request
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send(patient1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});
            await postRequestProcessor.waitTillDoneAsync({requestId: getRequestId(resp)});

            // search by owner security tag should only return 1
            resp = await request
                .get('/4_0_0/Observation/?patient=Patient/patient1&_debug=1&_security=https://www.icanbwell.com/owner|C')
                .set(headers);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservationByOwnerResources);

            resp = await request
                .get('/4_0_0/Observation/?patient=patient1&_debug=1&_security=https://www.icanbwell.com/owner|C')
                .set(headers);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservationIdOnlyByOwnerResources);
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

            resp = await request
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send(patient1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});
            await postRequestProcessor.waitTillDoneAsync({requestId: getRequestId(resp)});

            resp = await request
                .get('/4_0_0/Observation/?patient=Patient/patient1|C&_debug=1')
                .set(headers);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservationBySourceAssigningAuthorityResources);

            resp = await request
                .get('/4_0_0/Observation/?patient=patient1|C&_debug=1')
                .set(headers);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservationIdOnlyBySourceAssigningAuthorityResources);
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

            resp = await request
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send(patient1Resource)
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
                .get(`/4_0_0/Observation/?patient=Patient/${uuid}&_debug=1`)
                .set(headers);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservationByUuidResourcesCopy);

            const expectedObservationIdOnlyByUuidResourcesCopy = deepcopy(expectedObservationIdOnlyByUuidResources);
            expectedObservationIdOnlyByUuidResourcesCopy.meta.tag
                .filter(m => m.system === 'https://www.icanbwell.com/query')
                .forEach(m => {
                    m.display = m.display.replace('11111111-1111-1111-1111-111111111111', uuid);
                    return m;
                });

            resp = await request
                .get(`/4_0_0/Observation/?patient=${uuid}&_debug=1`)
                .set(headers);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservationIdOnlyByUuidResourcesCopy);
        });
    });
});
