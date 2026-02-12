// test file
const condition1Resource = require('./fixtures/Condition/condition1.json');

const {
 commonBeforeEach, commonAfterEach, createTestRequest, getHeadersWithCustomPayload
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { ConfigManager } = require('../../../utils/configManager');
const Bundle = require('../../../../src/fhir/classes/4_0_0/resources/bundle');
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

    describe('Condition merge_with_patient_scope Tests', () => {
        test('merge_with_user_scope works with patient scopes', async () => {
            const request = await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManager());
                c.register('patientFilterManager', () => new MockPatientFilterManager());
                return c;
            });

            const person_payload = {
                scope: 'patient/Observation.* user/*.* access/*.*',
                username: 'patient-123@example.com',
                clientFhirPersonId: 'clientFhirPerson',
                clientFhirPatientId: 'clientFhirPatient',
                bwellFhirPersonId: 'person1',
                bwellFhirPatientId: 'bwellFhirPatient',
                token_use: 'access'
            };
            const headers = getHeadersWithCustomPayload(person_payload);

            const resp = await request
                .post('/4_0_0/Condition/1/$merge?validate=true')
                .send(condition1Resource)
                .set(headers);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: false });
            const body = resp.body;
            expect(body.issue.diagnostics).toStrictEqual('Write not allowed using user scopes if patient scope is present: user clientFhirPerson with scopes [user/*.*] failed access check to [Condition.write]');
        });
        test('merge_with_user_scope with bundle resource', async () => {
            const request = await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManager());
                c.register('patientFilterManager', () => new MockPatientFilterManager());
                return c;
            });

            const bundle = new Bundle(
                {
                    resourceType: 'Bundle',
                    type: 'transaction',
                    entry: [
                        {
                            resource: condition1Resource,
                            request: {
                                method: 'POST',
                                url: 'Condition'
                            }
                        }
                    ]
                }
            );
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
            // ARRANGE
            // add the resources to FHIR server
            const resp = await request
                .post('/4_0_0/Condition/1/$merge?validate=true')
                .send(bundle)
                .set(headers);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(200);
            const body = resp.body;

            const condition1Response = body[0];
            expect(condition1Response.created).toStrictEqual(false);
            expect(condition1Response.issue.diagnostics).toStrictEqual('Write not allowed using user scopes if patient scope is present: user clientFhirPerson with scopes [user/Condition.write] failed access check to [Condition.write]');
        });
    });
});
