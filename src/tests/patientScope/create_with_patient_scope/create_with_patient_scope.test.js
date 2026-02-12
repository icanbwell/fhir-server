// test file
const person1Resource = require('./fixtures/Person/person1.json');
const condition1Resource = require('./fixtures/Condition/condition1.json');
const resourceStructure = require('./fixtures/Resource/resource.json');

const deepcopy = require('deepcopy');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const {
 commonBeforeEach, commonAfterEach, createTestRequest, getHeadersWithCustomPayload, getHeaders, getTestContainer,
    mockHttpContext
} = require('../../common');
const { ConfigManager } = require('../../../utils/configManager');
const { COLLECTION } = require('../../../constants');

const person_payload = {
    scope: 'patient/Condition.write',
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
        test('create_with_patient_scope works', async () => {
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
                .post('/4_0_0/Condition')
                .send(condition1Resource)
                .set(headers);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(201);
        });
        test('create_with_patient_scope fails if patient id does not match', async () => {
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
                .post('/4_0_0/Condition')
                .send(condition1WithDifferentPatientId)
                .set(headers);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(403);
            const body = resp.body;
            expect(body.resourceType).toStrictEqual('OperationOutcome');
            expect(body.issue[0].details.text).toStrictEqual('The current patient scope and person id in the JWT token do not allow writing the Condition resource.');
        });
        test('create_with_patient_scope fails if patient scopes are Invalid', async () => {
            const request = await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManager());
                return c;
            });
            /** @type {SimpleContainer} */
            const container = getTestContainer();
            const person1_payload = {
                scope: 'patient/Observation.*',
                username: 'patient-123@example.com',
                clientFhirPersonId: 'clientFhirPerson',
                clientFhirPatientId: 'clientFhirPatient',
                bwellFhirPersonId: 'person1',
                bwellFhirPatientId: 'bwellFhirPatient',
                token_use: 'access'
            };
            const headers1 = getHeadersWithCustomPayload(person1_payload);
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

            // ARRANGE
            // add the resources to FHIR server
            resp = await request
                .post('/4_0_0/Condition')
                .send(condition1Resource)
                .set(headers1);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(403);
            const body = resp.body;
            expect(body.resourceType).toStrictEqual('OperationOutcome');
            expect(body.issue[0].details.text).toStrictEqual('None of the provided scopes matched an allowed scope.: user clientFhirPerson with scopes [patient/Observation.*] failed access check to [Condition.write]');
        });
        test('Non patient resources can not be accessed with patient scopes', async () => {
            const envValue = process.env.VALIDATE_SCHEMA;
            process.env.VALIDATE_SCHEMA = '0';

            const request = await createTestRequest();
            const container = getTestContainer();
            /**
             * @type {import('../../../fhir/patientFilterManager').PatientFilterManager}
             */
            const patientFilterManager = container.patientFilterManager;

            // get list of patient resources from patientFilterManager
            const patientResources = Object.keys(patientFilterManager.patientFilterMapping);
            // calculate non patient resources
            const nonPatientResources = Object.values(COLLECTION)
                .filter(resource => !patientResources.includes(resource));
            for (const resourceType of nonPatientResources) {
                const resp = await request
                    .post(`/4_0_0/${resourceType}/`)
                    .send({ ...resourceStructure, resourceType })
                    .set(getHeaders('patient/*.*'));

                expect(resp).toHaveStatusCode(403);
            }
            process.env.VALIDATE_SCHEMA = envValue;
        });
    });
});
