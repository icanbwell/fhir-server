// test file
const person1Resource = require('./fixtures/Person/person1.json');
const condition1Resource = require('./fixtures/Condition/condition1.json');
const resourceStructure = require('./fixtures/Resource/resource.json');

const {
 commonBeforeEach, commonAfterEach, createTestRequest, getHeadersWithCustomPayload, getHeaders, getTestContainer,
    mockHttpContext
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { ConfigManager } = require('../../../utils/configManager');
const { COLLECTION } = require('../../../constants');
const deepcopy = require('deepcopy');
const env = require('var');

const person_payload = {
    scope: 'patient/Condition.*',
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

            // now try to get with non-patient scope headers to confirm if resource is deleted
            resp = await request
                .get('/4_0_0/Condition/14736deef3663a7946a8fde33e67c50d03d903cdd1a46c36a426c47a24fb71f')
                .set(getHeaders())
                .expect(404);
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
            expect(resp).toHaveStatusCode(204);

            // now try to get with non-patient scope headers to confirm if resource is deleted
            resp = await request
                .get('/4_0_0/Condition/14736deef3663a7946a8fde33e67c50d03d903cdd1a46c36a426c47a24fb71f')
                .set(getHeaders())
                .expect(200);
        });

        test('delete_with_patient_scope fails if patient scopes does not match', async () => {
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

            // first insert with non-patient scope headers
            resp = await request
                .post('/4_0_0/Condition/1/$merge?validate=true')
                .send(condition1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });
            await postRequestProcessor.waitTillDoneAsync({ requestId });

            const person1_payload = {
                scope: 'patient/Patient.write',
                username: 'patient-123@example.com',
                clientFhirPersonId: 'clientFhirPerson',
                clientFhirPatientId: 'clientFhirPatient',
                bwellFhirPersonId: 'person1',
                bwellFhirPatientId: 'bwellFhirPatient',
                token_use: 'access'
            };
            const headers1 = getHeadersWithCustomPayload(person1_payload);

            // now try to update with patient scope headers
            resp = await request
                .delete('/4_0_0/Condition/14736deef3663a7946a8fde33e67c50d03d903cdd1a46c36a426c47a24fb71f')
                .set(headers1);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(403);

            // now try to get with non-patient scope headers to confirm if resource is deleted
            resp = await request
                .get('/4_0_0/Condition/14736deef3663a7946a8fde33e67c50d03d903cdd1a46c36a426c47a24fb71f')
                .set(getHeaders())
                .expect(200);
        });
        test('Non patient resources can not be accessed with patient scopes', async () => {
            const envValue = env.VALIDATE_SCHEMA;
            env.VALIDATE_SCHEMA = '0';

            const request = await createTestRequest();
            const container = getTestContainer();
            /**
             * @type {import('../../../fhir/patientFilterManager').PatientFilterManager}
             */
            const patientFilterManager = container.patientFilterManager;
            for (const resourceType of Object.values(COLLECTION)) {
                if (!patientFilterManager.canAccessResourceWithPatientScope({ resourceType })) {
                    const resp = await request
                        .delete(`/4_0_0/${resourceType}/1`)
                        .send({ ...resourceStructure, resourceType })
                        .set(getHeaders('patient/*.*'));

                    if (resp.statusCode !== 404) {
                        expect(resp).toHaveStatusCode(403);
                    }
                }
            }
            env.VALIDATE_SCHEMA = envValue;
        });
    });
});
