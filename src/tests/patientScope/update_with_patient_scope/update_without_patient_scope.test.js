// test file
const condition1Resource = require('./fixtures/Condition/condition1.json');

const {
 commonBeforeEach, commonAfterEach, createTestRequest, getHeadersWithCustomPayload, getHeaders, getTestContainer,
    mockHttpContext
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { ConfigManager } = require('../../../utils/configManager');
const deepcopy = require('deepcopy');
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
        return resourceType !== 'Condition';
    }
}

describe('Condition Tests', () => {
    /**
     * @type {string|undefined}
     */
    let requestId;
    beforeEach(async () => {
        await commonBeforeEach();
        requestId = mockHttpContext();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Condition merge_with_patient_scope Tests', () => {
        test('update_with_user_scope doesn\'t work with patient scopes', async () => {
            const request = await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManager());
                c.register('patientFilterManager', () => new MockPatientFilterManager());
                return c;
            });

            // ARRANGE
            /** @type {SimpleContainer} */
            const container = getTestContainer();
            // add the resources to FHIR server
            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = container.postRequestProcessor;
            // first insert with non-patient scope headers
            let resp = await request
                .post('/4_0_0/Condition/1/$merge?validate=true')
                .send(condition1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });
            await postRequestProcessor.waitTillDoneAsync({ requestId });

            const person_payload = {
                scope: 'patient/Observation.* user/Condition.write access/*.*',
                username: 'patient-123@example.com',
                clientFhirPersonId: 'clientFhirPerson',
                clientFhirPatientId: 'clientFhirPatient',
                bwellFhirPersonId: 'person1',
                bwellFhirPatientId: 'bwellFhirPatient',
                token_use: 'access'
            };
            const headers = getHeadersWithCustomPayload(person_payload);

            // create a change so we can test the update
            const condition1ResourceWithChange = deepcopy(condition1Resource);
            condition1ResourceWithChange.onsetDateTime = '2022-01-01T00:00:00Z';
            // now try to update with patient scope headers
            resp = await request
                .put('/4_0_0/Condition/14736deef3663a7946a8fde33e67c50d03d903cdd1a46c36a426c47a24fb71f')
                .send(condition1ResourceWithChange)
                .set(headers);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(403);
            const body = resp.body;
            expect(body.resourceType).toStrictEqual('OperationOutcome');
            expect(body.issue[0].details.text).toStrictEqual('Write not allowed using user scopes if patient scope is present: user patient-123@example.com with scopes [user/Condition.write] failed access check to [Condition.write]');

            // check version id
            resp = await request
                .get('/4_0_0/Condition/14736deef3663a7946a8fde33e67c50d03d903cdd1a46c36a426c47a24fb71f')
                .set(getHeaders());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(200);
            expect(resp.body.meta.versionId).toStrictEqual('1');
        });

        test('update_without_user_scope doesn\'t work', async () => {
            const request = await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManager());
                c.register('patientFilterManager', () => new MockPatientFilterManager());
                return c;
            });

            // ARRANGE
            /** @type {SimpleContainer} */
            const container = getTestContainer();
            // add the resources to FHIR server
            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = container.postRequestProcessor;
            // first insert with non-patient scope headers
            let resp = await request
                .post('/4_0_0/Condition/1/$merge?validate=true')
                .send(condition1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });
            await postRequestProcessor.waitTillDoneAsync({ requestId });

            const person_payload = {
                scope: 'patient/Observation.*',
                username: 'patient-123@example.com',
                clientFhirPersonId: 'clientFhirPerson',
                clientFhirPatientId: 'clientFhirPatient',
                bwellFhirPersonId: 'person1',
                bwellFhirPatientId: 'bwellFhirPatient',
                token_use: 'access'
            };
            const headers = getHeadersWithCustomPayload(person_payload);

            // create a change so we can test the update
            const condition1ResourceWithChange = deepcopy(condition1Resource);
            condition1ResourceWithChange.onsetDateTime = '2022-01-01T00:00:00Z';
            // now try to update with patient scope headers
            resp = await request
                .put('/4_0_0/Condition/14736deef3663a7946a8fde33e67c50d03d903cdd1a46c36a426c47a24fb71f')
                .send(condition1ResourceWithChange)
                .set(headers);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(403);
            const body = resp.body;
            expect(body.resourceType).toStrictEqual('OperationOutcome');
            expect(body.issue[0].details.text).toStrictEqual('Write not allowed using user scopes if patient scope is present: user patient-123@example.com with scopes [] failed access check to [Condition.write]');

            // check version id
            resp = await request
                .get('/4_0_0/Condition/14736deef3663a7946a8fde33e67c50d03d903cdd1a46c36a426c47a24fb71f')
                .set(getHeaders());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(200);
            expect(resp.body.meta.versionId).toStrictEqual('1');
        });
    });
});
