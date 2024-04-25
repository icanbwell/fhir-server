// test file
const person1Resource = require('./fixtures/Person/person1.json');
const condition1Resource = require('./fixtures/Condition/condition1.json');

const {
 commonBeforeEach, commonAfterEach, createTestRequest, getHeadersWithCustomPayload, getHeaders, getTestContainer,
    mockHttpContext
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { ConfigManager } = require('../../../utils/configManager');
const deepcopy = require('deepcopy');

const Bundle = require('../../../../src/fhir/classes/4_0_0/resources/bundle');

const person_payload = {
    scope: 'patient/Condition.write',
    username: 'patient-123@example.com',
    clientFhirPersonId: 'clientFhirPerson',
    clientFhirPatientId: 'clientFhirPatient',
    bwellFhirPersonId: 'person1',
    bwellFhirPatientId: 'bwellFhirPatient',
    token_use: 'access'
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
        test('merge_with_patient_scope works', async () => {
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

            resp = await request
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
            // ARRANGE
            // add the resources to FHIR server
            resp = await request
                .post('/4_0_0/Condition/1/$merge?validate=true')
                .send(condition1WithDifferentPatientId)
                .set(headers);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(200);
            const body = resp.body;
            expect(body.issue.details.text).toStrictEqual('The current patient scope and person id in the JWT token do not allow writing this resource.');
        });
        test('merge_with_patient_scope fails if patient scope does not allow', async () => {
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

            const person1_payload = {
                scope: 'patient/Encounter.* user/*.* access/*.*',
                username: 'patient-123@example.com',
                clientFhirPersonId: 'clientFhirPerson',
                clientFhirPatientId: 'clientFhirPatient',
                bwellFhirPersonId: 'person1',
                bwellFhirPatientId: 'bwellFhirPatient',
                token_use: 'access'
            };
            const headers1 = getHeadersWithCustomPayload(person1_payload);
            // ARRANGE
            // add the resources to FHIR server
            resp = await request
                .post('/4_0_0/Condition/1/$merge?validate=true')
                .send(condition1Resource)
                .set(headers1);

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(200);
            const body = resp.body;
            expect(body.issue.diagnostics).toStrictEqual('None of the provided scopes matched an allowed scope.: user patient-123@example.com with scopes [patient/Encounter.*] failed access check to [Condition.write]');
        });
        test('merge_with_patient_scope with multiple resources if patient id does not match in one', async () => {
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
                        },
                        {
                            resource: condition1WithDifferentPatientId,
                            request: {
                                method: 'POST',
                                url: 'Condition'
                            }
                        }
                    ]
                }
            );
            // ARRANGE
            // add the resources to FHIR server
            resp = await request
                .post('/4_0_0/Condition/1/$merge?validate=true')
                .send(bundle)
                .set(headers);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(200);
            const body = resp.body;
            expect(body.length).toStrictEqual(2);

            const condition1Response = body[1];
            expect(condition1Response.created).toStrictEqual(false);
            expect(condition1Response.issue.details.text).toStrictEqual('The current patient scope and person id in the JWT token do not allow writing this resource.');

            const condition2Response = body[0];
            expect(condition2Response.created).toStrictEqual(true);
        });
        test('merge_with_patient_scope with multiple resources does not allow changing of patient property', async () => {
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

            const bundle = new Bundle(
                {
                    resourceType: 'Bundle',
                    type: 'transaction',
                    entry: [
                        {
                            resource: condition1WithDifferentPatientId,
                            request: {
                                method: 'POST',
                                url: 'Condition'
                            }
                        }
                    ]
                }
            );
            // ARRANGE
            // add the resources to FHIR server
            // We should be able to add this resource since we are not using the patient scope
            resp = await request
                .post('/4_0_0/Condition/1/$merge?validate=true')
                .send(bundle)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            // now try to update the resource which should fail since we don't have access to the patient reference of that resource
            const bundle2 = new Bundle(
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
            resp = await request
                .post('/4_0_0/Condition/1/$merge?validate=true')
                .send(bundle2)
                .set(headers);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(200);

            const body = resp.body;
            expect(body.length).toStrictEqual(1);

            const condition1Response = body[0];
            expect(condition1Response.created).toStrictEqual(false);
            expect(condition1Response.issue.details.text).toStrictEqual('The current patient scope and person id in the JWT token do not allow writing this resource.');
        });
    });
});
