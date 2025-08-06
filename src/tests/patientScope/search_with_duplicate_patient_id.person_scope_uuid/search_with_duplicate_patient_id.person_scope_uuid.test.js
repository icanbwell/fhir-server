// test file
const mpsBwellPatient = require('./fixtures/Patient/mps-bwell-patient.json');
const mpsPatient = require('./fixtures/Patient/mps-patient.json');

const mpsBwellPerson = require('./fixtures/Person/mps-bwell-person.json');
const mpsClientPerson = require('./fixtures/Person/mps-client.json');

const clientBwellPatient = require('./fixtures/Patient/client-bwell-patient.json');
const clientPatient = require('./fixtures/Patient/client-patient.json');

const clientBwellPerson = require('./fixtures/Person/client-bwell-person.json');
const clientPerson = require('./fixtures/Person/client-person.json');
const task1 = require('./fixtures/Task/task1.json');
const task2 = require('./fixtures/Task/task2.json');
const task3 = require('./fixtures/Task/task3.json');

// expected
const expectedTasksResponse = require('./fixtures/expected/expected_tasks.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getHeadersWithCustomPayload
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { ConfigManager } = require('../../../utils/configManager');

class MockConfigManager extends ConfigManager {
    get enableReturnBundle () {
        return true;
    }

    get supportLegacyIds () {
        return false;
    }
}

describe('Patient Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Patient search_with_duplicate_patient_id_person_scope Tests', () => {
        test('search_by_reference.person_scope works', async () => {
            const request = await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManager());
                return c;
            });
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(mpsBwellPerson)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(mpsClientPerson)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send(mpsBwellPatient)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send(mpsPatient)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            // create client data
            resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(clientBwellPerson)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(clientPerson)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send(clientBwellPatient)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send(clientPatient)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Task/1/$merge?validate=true')
                .send(task1)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Task/1/$merge?validate=true')
                .send(task2)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Task/1/$merge?validate=true')
                .send(task3)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            const mps_person_payload = {
                scope: 'patient/Task.read',
                username: 'patient-123@example.com',
                clientFhirPersonId: '41db6857-b989-4617-ac8b-35d853250449',
                clientFhirPatientId: 'clientFhirPatient',
                bwellFhirPersonId: '41db6857-b989-4617-ac8b-35d853250449',
                bwellFhirPatientId: 'bwellFhirPatient',
                token_use: 'access'
            };
            const headers = getHeadersWithCustomPayload(mps_person_payload);
            // ACT & ASSERT
            // search by token system and code and make sure we get the right Patient back
            resp = await request
                .get('/4_0_0/Task/?_debug=1')
                .set(headers);
            // noinspection JSUnresolvedFunction
            console.log(JSON.stringify(JSON.parse(resp.text), undefined, '\t'));
            expect(resp).toHaveResponse(expectedTasksResponse);
        });
    });
});
