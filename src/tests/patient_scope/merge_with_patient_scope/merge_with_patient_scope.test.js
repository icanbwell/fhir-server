// test file
const condition1Resource = require('./fixtures/Condition/condition1.json');

// expected
// const expectedConditionResources = require('./fixtures/expected/expected_condition.json');

const { commonBeforeEach, commonAfterEach, createTestRequest, getHeadersWithCustomPayload } = require('../../common');
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
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Condition merge_with_patient_scope Tests', () => {
        test('merge_with_patient_scope works', async () => {
            const request = await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManager());
                return c;
            });

            // ARRANGE
            // add the resources to FHIR server
            const resp = await request
                .post('/4_0_0/Condition/1/$merge?validate=true')
                .send(condition1Resource)
                .set(headers);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });
        });
        test('merge_with_patient_scope fails if patient id does not match', async () => {
            const request = await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManager());
                return c;
            });

            const condition1WithDifferentPatientId = deepcopy(condition1Resource);
            condition1WithDifferentPatientId.subject.reference = 'Patient/2';
            // ARRANGE
            // add the resources to FHIR server
            const resp = await request
                .post('/4_0_0/Condition/1/$merge?validate=true')
                .send(condition1WithDifferentPatientId)
                .set(headers);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: false });
            const body = resp.body;
            expect(body.issue.diagnostics).toStrictEqual('The current patient scope and person id in the JWT token do not allow writing this resource.');
        });
    });
});
