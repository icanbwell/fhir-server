// test file
const condition1Resource = require('./fixtures/Condition/condition1.json');

const {
    commonBeforeEach, commonAfterEach, createTestRequest, getHeadersWithCustomPayload
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
        return resourceType !== 'Condition';
    }
}

describe('Condition Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Create Condition without patient scopes test', () => {
        test('create with valid user scopes doesn\'t work if patient scopes are passed', async () => {
            const request = await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManager());
                c.register('patientFilterManager', () => new MockPatientFilterManager());
                return c;
            });

            const person1_payload = {
                'cognito:username': 'patient-123@example.com',
                'custom:bwell_fhir_person_id': 'person1',
                scope: 'patient/Condition.* user/*.* access/*.*',
                username: 'patient-123@example.com',
                'custom:clientFhirPersonId': 'clientFhirPerson',
                'custom:clientFhirPatientId': 'clientFhirPatient',
                'custom:bwellFhirPersonId': 'person1',
                'custom:bwellFhirPatientId': 'bwellFhirPatient'
            };
            const headers1 = getHeadersWithCustomPayload(person1_payload);

            // ARRANGE
            // add the resources to FHIR server
            const resp = await request
                .post('/4_0_0/Condition')
                .send(condition1Resource)
                .set(headers1);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(403);
            const body = resp.body;
            expect(body.resourceType).toStrictEqual('OperationOutcome');
            expect(body.issue[0].details.text).toStrictEqual('Write not allowed using user scopes if patient scope is present: user patient-123@example.com with scopes [user/*.*] failed access check to [Condition.write]');
        });
    });
});
