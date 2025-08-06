// test file
const bwellPatient1Resource = require('./fixtures/Patient/bwellPatient1.json');
const bwellFhirPatient1Resource = require('./fixtures/Patient/bwellFhirPatient1.json');

const bwellPerson1Resource = require('./fixtures/Person/bwellPerson1.json');
const bwellFhirPerson1Resource = require('./fixtures/Person/bwellFhirPerson1.json');

const task1Resource = require('./fixtures/Task/task1.json');
const task2Resource = require('./fixtures/Task/task2.json');
const task3Resource = require('./fixtures/Task/task3.json');

// expected
const expectedTaskResources = require('./fixtures/expected/expected_tasks.json');
const expectedTask1 = require('./fixtures/expected/expected_task1.json');
const expectedTask1Bundle = require('./fixtures/expected/expected_task1_bundle.json');

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

    describe('Patient search_by_reference.person_scope Tests', () => {
        test('search_by_reference.person_scope works', async () => {
            const request = await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManager());
                return c;
            });
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(bwellPerson1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(bwellFhirPerson1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send(bwellPatient1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send(bwellFhirPatient1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Task/1/$merge?validate=true')
                .send(task1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Task/1/$merge?validate=true')
                .send(task2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Task/1/$merge?validate=true')
                .send(task3Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            const person_payload = {
                scope: 'patient/*.read',
                username: 'patient-123@example.com',
                clientFhirPersonId: 'bwellPerson1',
                clientFhirPatientId: 'clientFhirPatient',
                bwellFhirPersonId: 'bwellPerson1',
                bwellFhirPatientId: 'bwellFhirPatient',
                token_use: 'access'
            };
            const headers = getHeadersWithCustomPayload(person_payload);
            // ACT & ASSERT
            // search by token system and code and make sure we get the right Patient back
            resp = await request
                .get('/4_0_0/Task/?_debug=1')
                .set(headers);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedTaskResources);

            resp = await request
                .get('/4_0_0/Task/Task1?_debug=1')
                .set(headers);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedTask1);

            resp = await request
                .get('/4_0_0/Task/?id=Task1&_debug=1')
                .set(headers);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedTask1Bundle);
        });
    });
});
