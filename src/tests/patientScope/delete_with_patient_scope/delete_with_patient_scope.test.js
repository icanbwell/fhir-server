// test file
const person1Resource = require('./fixtures/Person/person1.json');
const condition1Resource = require('./fixtures/Condition/condition1.json');

// expected
// const expectedConditionResources = require('./fixtures/expected/expected_condition.json');

const {
 commonBeforeEach, commonAfterEach, createTestRequest, getHeadersWithCustomPayload, getHeaders, getTestContainer,
    mockHttpContext
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { ConfigManager } = require('../../../utils/configManager');
const deepcopy = require('deepcopy');

const person_payload = {
    'cognito:username': 'patient-123@example.com',
    'custom:bwell_fhir_person_id': 'person1',
    scope: 'patient/*.read user/*.* access/*.*',
    username: 'patient-123@example.com',
    'custom:clientFhirPersonId': 'clientFhirPerson',
    'custom:clientFhirPatientId': 'clientFhirPatient',
    'custom:bwellFhirPersonId': 'person1',
    'custom:bwellFhirPatientId': 'bwellFhirPatient'
};
const headers = getHeadersWithCustomPayload(person_payload);

class MockConfigManager extends ConfigManager {
    get enableReturnBundle () {
        return true;
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
        test('delete_with_patient_scope works', async () => {
            const request = await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManager());
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
            // insert Person record
            let resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(person1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });
            await postRequestProcessor.waitTillDoneAsync({ requestId });

            // first insert with non-patient scope headers
            resp = await request
                .post('/4_0_0/Condition/1/$merge?validate=true')
                .send(condition1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });
            await postRequestProcessor.waitTillDoneAsync({ requestId });

            // now try to update with patient scope headers
            resp = await request
                .delete('/4_0_0/Condition/14736deef3663a7946a8fde33e67c50d03d903cdd1a46c36a426c47a24fb71f')
                .set(headers);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(204);
        });
        test('delete_with_patient_scope fails if patient id does not match', async () => {
            const request = await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManager());
                return c;
            });
            /** @type {SimpleContainer} */
            const container = getTestContainer();
            // add the resources to FHIR server
            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = container.postRequestProcessor;
            // insert Person record
            let resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(person1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });
            await postRequestProcessor.waitTillDoneAsync({ requestId });

            const condition1WithDifferentPatientId = deepcopy(condition1Resource);
            condition1WithDifferentPatientId.subject.reference = 'Patient/2';

            // first insert with non-patient scope headers
            resp = await request
                .post('/4_0_0/Condition/1/$merge?validate=true')
                .send(condition1WithDifferentPatientId)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });
            await postRequestProcessor.waitTillDoneAsync({ requestId });

            // now try to update with patient scope headers
            resp = await request
                .delete('/4_0_0/Condition/14736deef3663a7946a8fde33e67c50d03d903cdd1a46c36a426c47a24fb71f')
                .set(headers);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(403);
            const body = resp.body;
            expect(body.resourceType).toStrictEqual('OperationOutcome');
            expect(body.issue[0].diagnostics).toStrictEqual('The current patient scope and person id in the JWT token do not allow deleting this resource.')
        });
    });
});
