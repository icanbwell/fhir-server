// test file
const observation2Resource = require('./fixtures/Observation/observation2.json');

// expected
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
const { PatientFilterManager } = require('../../../fhir/patientFilterManager');

class MockConfigManager extends ConfigManager {
    get enableReturnBundle () {
        return true;
    }
}

class MockPatientFilterManager extends PatientFilterManager {
    /**
     * Returns whether access is allowed to the specified resource with patient scope
     * @param {string} resourceType
     * @returns {boolean}
     */
    canAccessResourceWithPatientScope ({ resourceType }) {
        return resourceType !== 'Observation';
    }
}

describe('Observation Tests', () => {
    let requestId;
    beforeEach(async () => {
        await commonBeforeEach();
        requestId = mockHttpContext();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('ReadById Tests for two resources with same id (user scope)', () => {
        test('using id only with valid user scopes', async () => {
            const request = await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManager());
                c.register('patientFilterManager', () => new MockPatientFilterManager());
                return c;
            });

            const container = getTestContainer();

            let resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = container.postRequestProcessor;

            await postRequestProcessor.waitTillDoneAsync({ requestId });

            const person1_payload = {
                scope: 'patient/Condition.write user/Observation.read access/C.*',
                username: 'patient-123@example.com',
                clientFhirPersonId: 'clientFhirPerson',
                clientFhirPatientId: 'clientFhirPatient',
                bwellFhirPersonId: 'person1',
                bwellFhirPatientId: 'bwellFhirPatient',
                token_use: 'access'
            };
            const headers1 = getHeadersWithCustomPayload(person1_payload);

            // ACT AND ASSERT
            // search by owner security tag should only return 1
            resp = await request
                .get('/4_0_0/Observation/1/')
                .set(headers1);

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservationByAccessResources);
        });

        test('using id only with invalid user scopes', async () => {
            const request = await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManager());
                c.register('patientFilterManager', () => new MockPatientFilterManager());
                return c;
            });

            const person1_payload = {
                scope: 'patient/Condition.write user/Observation.write access/C.*',
                username: 'patient-123@example.com',
                clientFhirPersonId: 'clientFhirPerson',
                clientFhirPatientId: 'clientFhirPatient',
                bwellFhirPersonId: 'person1',
                bwellFhirPatientId: 'bwellFhirPatient',
                token_use: 'access'
            };
            const headers1 = getHeadersWithCustomPayload(person1_payload);

            // ACT AND ASSERT
            // search by owner security tag should only return 1
            const resp = await request
                .get('/4_0_0/Observation/1/')
                .set(headers1)
                .expect(403);

            const body = resp.body;
            expect(body.resourceType).toStrictEqual('OperationOutcome');
            expect(body.issue[0].details.text).toStrictEqual('None of the provided scopes matched an allowed scope.: user clientFhirPerson with scopes [user/Observation.write] failed access check to [Observation.read]');
        });
    });
});
