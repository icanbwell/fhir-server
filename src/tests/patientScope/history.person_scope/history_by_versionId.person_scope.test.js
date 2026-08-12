// test file
const observation1Resource = require('./fixtures/Observation/observation1.json');
const observation2Resource = require('./fixtures/Observation/observation2.json');
const person1Resource = require('./fixtures/Person/person1.json');

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

// Person/person1's _uuid (generateUUIDv5('person1|client')) -- a patient-scoped caller's
// identity is now matched strictly against the Person collection's _uuid field, so the JWT
// must carry the actual uuid rather than the raw source id.
const person_payload = {
    scope: 'patient/Observation.read user/*.* access/*.*',
    username: 'patient-123@example.com',
    clientFhirPersonId: '7b99904f-2f85-51a3-9398-e2eed6854639',
    clientFhirPatientId: 'clientFhirPatient',
    bwellFhirPersonId: '7b99904f-2f85-51a3-9398-e2eed6854639',
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
                .expect(403);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse({
                resourceType: 'OperationOutcome',
                issue: [
                    {
                        severity: 'error',
                        code: 'forbidden',
                        details: {
                            text: "user 7b99904f-2f85-51a3-9398-e2eed6854639 with scopes [patient/Observation.read user/*.* access/*.*] failed access check to Observation's history: Access to history resources not allowed if patient scope is present"
                        },
                        diagnostics:
                            "user 7b99904f-2f85-51a3-9398-e2eed6854639 with scopes [patient/Observation.read user/*.* access/*.*] failed access check to Observation's history: Access to history resources not allowed if patient scope is present"
                    }
                ]
            });
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
                .expect(403);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse({
                resourceType: 'OperationOutcome',
                issue: [
                    {
                        severity: 'error',
                        code: 'forbidden',
                        details: {
                            text: "user 7b99904f-2f85-51a3-9398-e2eed6854639 with scopes [patient/Observation.read user/*.* access/*.*] failed access check to Observation's history: Access to history resources not allowed if patient scope is present"
                        },
                        diagnostics:
                            "user 7b99904f-2f85-51a3-9398-e2eed6854639 with scopes [patient/Observation.read user/*.* access/*.*] failed access check to Observation's history: Access to history resources not allowed if patient scope is present"
                    }
                ]
            });

            await request
                .get('/4_0_0/Observation/1|A/_history')
                .set(headers)
                .expect(403);
        });
    });
});
