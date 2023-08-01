// test file
const mpsBwellPatient = require('./fixtures/Patient/mps-bwell-patient.json');
const mpsPatient = require('./fixtures/Patient/mps-patient.json');

const mpsBwellPerson = require('./fixtures/Person/mps-bwell-person.json');
const mpsClientPerson = require('./fixtures/Person/mps-client.json');

const northWellBwellPatient = require('./fixtures/Patient/northwell-bwell-patient.json');
const northWellPatient = require('./fixtures/Patient/northwell-patient.json');

const northWellBwellPerson = require('./fixtures/Person/northwell-bwell-person.json');
const northWellClientPerson = require('./fixtures/Person/northwell-client.json');
const task1 = require('./fixtures/Task/task1.json');
const task2 = require('./fixtures/Task/task2.json');

// expected
const expectedTasksResponse = require('./fixtures/expected/expected_tasks.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getHeadersWithCustomPayload
} = require('../../common');
const {describe, beforeEach, afterEach, test} = require('@jest/globals');
const {ConfigManager} = require('../../../utils/configManager');

class MockConfigManager extends ConfigManager {
    get enableGlobalIdSupport() {
        return true;
    }

    get enableReturnBundle() {
        return true;
    }

    get supportLegacyIds() {
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
            // Verifies https://icanbwell.atlassian.net/browse/EFS-180
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
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(mpsClientPerson)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send(mpsBwellPatient)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send(mpsPatient)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});


            // create northwell data
            resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(northWellBwellPerson)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(northWellClientPerson)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send(northWellBwellPatient)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send(northWellPatient)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Task/1/$merge?validate=true')
                .send(task1)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Task/1/$merge?validate=true')
                .send(task2)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});


            const mps_person_payload = {
                'cognito:username': 'patient-123@example.com',
                'custom:bwell_fhir_person_id': '41db6857-b989-4617-ac8b-35d853250449',
                scope: 'patient/*.read user/*.* access/*.*',
                username: 'patient-123@example.com',
                'custom:clientFhirPersonId': 'clientFhirPerson',
                'custom:clientFhirPatientId': 'clientFhirPatient',
                'custom:bwellFhirPersonId': '41db6857-b989-4617-ac8b-35d853250449',
                'custom:bwellFhirPatientId': 'bwellFhirPatient',
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
