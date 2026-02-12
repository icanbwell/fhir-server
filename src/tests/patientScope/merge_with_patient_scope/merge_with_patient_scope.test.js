// test file
const person1Resource = require('./fixtures/Person/person1.json');
const condition1Resource = require('./fixtures/Condition/condition1.json');
const resourceStructure = require('./fixtures/Resource/resource.json');
const linkageResource = require('./fixtures/Linkage/linkage.json')
const paymentNoticeResource = require('./fixtures/PaymentNotice/paymentNotice.json')

const expectedLinkageResource = require('./fixtures/expected/expected_linkage.json')
const expctedPaymentNoticeResource = require('./fixtures/expected/expected_payment_notice.json')

const {
 commonBeforeEach, commonAfterEach, createTestRequest, getHeadersWithCustomPayload, getHeaders, getTestContainer,
    mockHttpContext
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { ConfigManager } = require('../../../utils/configManager');
const deepcopy = require('deepcopy');
const { COLLECTION } = require('../../../constants');

const Bundle = require('../../../../src/fhir/classes/4_0_0/resources/bundle');

const person_payload = {
    scope: 'patient/*.*',
    username: 'patient-123@example.com',
    clientFhirPersonId: 'person1',
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

describe('Patient Scope merge Tests', () => {
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
            expect(body.issue.details.text).toStrictEqual('The current patient scope and person id in the JWT token do not allow writing the Condition resource.');
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
            expect(body.issue.diagnostics).toStrictEqual('None of the provided scopes matched an allowed scope.: user clientFhirPerson with scopes [patient/Encounter.*] failed access check to [Condition.write]');
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
            condition1WithDifferentPatientId.id = '2';

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
            expect(condition1Response.issue.details.text).toStrictEqual('The current patient scope and person id in the JWT token do not allow writing the Condition resource.');

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
            expect(condition1Response.issue.details.text).toStrictEqual('The current patient scope and person id in the JWT token do not allow writing the Condition resource.');
        });
        test('Non patient resources can not be accessed with patient scopes', async () => {
            const envValue = process.env.VALIDATE_SCHEMA;
            process.env.VALIDATE_SCHEMA = '0';

            const request = await createTestRequest();
            const container = getTestContainer();
            /**
             * @type {PatientFilterManager}
             */
            const patientFilterManager = container.patientFilterManager;
            const person1_payload = {
                scope: 'patient/*.*',
                username: 'patient-123@example.com',
                clientFhirPersonId: 'clientFhirPerson',
                clientFhirPatientId: 'clientFhirPatient',
                bwellFhirPersonId: 'person1',
                bwellFhirPatientId: 'bwellFhirPatient',
                token_use: 'access'
            };
            const headers1 = getHeadersWithCustomPayload(person1_payload);

            // get list of patient resources from patientFilterManager
            const patientResources = patientFilterManager.getAllPatientOrPersonRelatedResources();
            const skipResources = ['Bundle', 'ImplementationGuide', 'Parameters'];
            // calculate non patient resources
            const nonPatientResources = Object.values(COLLECTION)
                .filter(resource => !patientResources.includes(resource) && !skipResources.includes(resource));
            for (const resourceType of nonPatientResources) {
                const resp = await request
                    .post(`/4_0_0/${resourceType}/$merge`)
                    .send({ ...resourceStructure, resourceType })
                    .set(headers1);

                expect(resp.body.issue).toEqual({
                    severity: 'error',
                    code: 'forbidden',
                    details: {
                        text: `Write not allowed using user scopes if patient scope is present: user clientFhirPerson with scopes [] failed access check to [${resourceType}.write]`
                    },
                    diagnostics: `Write not allowed using user scopes if patient scope is present: user clientFhirPerson with scopes [] failed access check to [${resourceType}.write]`
                });
            }
            process.env.VALIDATE_SCHEMA = envValue;
        });
    });

    test('merge and get with patient scope works', async () => {
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
            .post('/4_0_0/Linkage/$merge')
            .send(linkageResource)
            .set(headers);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/PaymentNotice/$merge')
            .send(paymentNoticeResource)
            .set(headers);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .get('/4_0_0/Linkage?_debug=true')
            .set(headers);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedLinkageResource);

        resp = await request
            .get('/4_0_0/PaymentNotice?_debug=true')
            .set(headers);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expctedPaymentNoticeResource);
    });
});
