// test file
const env = require('var');

const clientPersonResource = require('./fixtures/Person/person1.json');
const clientPerson2Resource = require('./fixtures/Person/person2.json');
const clientPerson3Resource = require('./fixtures/Person/person3.json');

// expected
const expectedResponse1 = require('./fixtures/Expected/expectedResponse1.json');
const expectedResponse2 = require('./fixtures/Expected/expectedResponse2.json');

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
}

describe('Person Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Persons links update with clientFhirPersonId Tests', () => {
        test('Using patient/user JWT, client person links cannot be updated', async () => {
            let request = await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManager());
                return c;
            });

            // add the person resource
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send(clientPersonResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            env.USE_CLIENT_FHIR_PERSON_ID = '1';

            let jwt_payload = {
                scope: 'patient/*.* user/*.* access/*.*',
                username: 'test',
                client_id: 'client-1',
                clientFhirPersonId: '7b99904f-2f85-51a3-9398-e2eed6854639',
                clientFhirPatientId: 'clientFhirPatient',
                bwellFhirPersonId: 'bwellFhirPersonId',
                bwellFhirPatientId: 'bwellFhirPatient',
                token_use: 'access'
            };
            let headers = getHeadersWithCustomPayload(jwt_payload);

            // Trying to update the person links with patient scope, operation outcome is expected
            resp = await request
                .put('/4_0_0/Person/7b99904f-2f85-51a3-9398-e2eed6854639')
                .send(clientPerson2Resource)
                .set(headers);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResponse1);

            // No error received when links are not updated
            resp = await request
                .put('/4_0_0/Person/7b99904f-2f85-51a3-9398-e2eed6854639')
                .send(clientPerson3Resource)
                .set(headers);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResponse2);
        });
    });
});
