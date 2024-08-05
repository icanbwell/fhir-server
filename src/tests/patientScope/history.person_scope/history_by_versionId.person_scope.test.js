// test file
const observation1Resource = require('./fixtures/Observation/observation1.json');
const observation2Resource = require('./fixtures/Observation/observation2.json');
const person1Resource = require('./fixtures/Person/person1.json');

// expected
const expectedObservationByUuidResources = require('./fixtures/expected/expected_observation_by_uuid.json');
const expectedObservationByAccessResources = require('./fixtures/expected/expected_observation_by_access.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getTestContainer,
    getHeadersWithCustomPayload,
    mockHttpContext
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { ConfigManager } = require('../../../utils/configManager');
const { IdentifierSystem } = require('../../../utils/identifierSystem');

class MockConfigManager extends ConfigManager {
    get enableReturnBundle () {
        return true;
    }
}

const person_payload = {
    scope: 'patient/Observation.read user/*.* access/*.*',
    username: 'patient-123@example.com',
    clientFhirPersonId: 'person1',
    clientFhirPatientId: 'clientFhirPatient',
    bwellFhirPersonId: 'person1',
    bwellFhirPatientId: 'bwellFhirPatient',
    token_use: 'access'
};
const headers = getHeadersWithCustomPayload(person_payload);
describe('Observation Tests', () => {
    let requestId;
    beforeEach(async () => {
        await commonBeforeEach();
        requestId = mockHttpContext();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('History by versionId tests', () => {
        test('using id', async () => {
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
            expect(resp).toHaveMergeResponse({ created: true });

            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = container.postRequestProcessor;
            await postRequestProcessor.waitTillDoneAsync({ requestId });

            resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });
            await postRequestProcessor.waitTillDoneAsync({ requestId });

            resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(person1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });
            await postRequestProcessor.waitTillDoneAsync({ requestId });

            // ACT AND ASSERT
            // search by owner security tag should only return 1
            resp = await request
                .get('/4_0_0/Observation/1/_history/1')
                .set(headers)
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservationByAccessResources.entry[0].resource);
        });
        test('using uuid', async () => {
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
            expect(resp).toHaveMergeResponse({ created: true });

            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = container.postRequestProcessor;
            await postRequestProcessor.waitTillDoneAsync({ requestId });

            resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });
            await postRequestProcessor.waitTillDoneAsync({ requestId });

            resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(person1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });
            await postRequestProcessor.waitTillDoneAsync({ requestId });

            // First call by id to find the uuid and then call by uuid
            resp = await request
                .get('/4_0_0/Observation/1|C/?_debug=1')
                .set(headers);
            // read the uuid for the resource
            const uuid = resp.body.identifier.filter(i => i.system === IdentifierSystem.uuid)[0].value;
            expect(uuid).toBeDefined();

            resp = await request
                .get(`/4_0_0/Observation/${uuid}/_history/1`)
                .set(headers)
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservationByUuidResources.entry[0].resource);

            await request
                .get('/4_0_0/Observation/1|A/_history')
                .set(headers)
                .expect(404);
        });
    });
});
