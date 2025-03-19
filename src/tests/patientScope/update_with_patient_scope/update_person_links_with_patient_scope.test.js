// test file
const clientPersonResource = require('./fixtures/Person/person1.json');
const clientPerson2Resource = require('./fixtures/Person/person2.json');
const clientPerson3Resource = require('./fixtures/Person/person3.json');
const clientPerson4Resource = require('./fixtures/Person/person4.json');
const clientPerson5Resource = require('./fixtures/Person/person5.json');
const clientPerson6Resource = require('./fixtures/Person/person6.json');
const clientPerson7Resource = require('./fixtures/Person/person7.json');

const clientPatient2Resource = require('./fixtures/Patient/patient2.json');

// expected
const expectedResponse1 = require('./fixtures/Expected/expectedResponse1.json');
const expectedResponse2 = require('./fixtures/Expected/expectedResponse2.json');
const expectedResponse3 = require('./fixtures/Expected/expectedResponse3.json');
const expectedForbiddenErrorResponse = require('./fixtures/Expected/expectedForbiddenErrorResponse.json');
const expectedPatientRefErrorResponse = require('./fixtures/Expected/expectedPatientRefErrorResponse.json');

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

            // No error received when links are not updated, but other field is updated
            resp = await request
                .put('/4_0_0/Person/7b99904f-2f85-51a3-9398-e2eed6854639')
                .send(clientPerson3Resource)
                .set(headers);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResponse2);

            // error is received when trying to add a new link to person using patient scope
            resp = await request
                .put('/4_0_0/Person/7b99904f-2f85-51a3-9398-e2eed6854639')
                .send(clientPerson7Resource)
                .set(headers);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPatientRefErrorResponse);

            // But if using non user/patient scope, links should be updated
            resp = await request
                .put('/4_0_0/Person/7b99904f-2f85-51a3-9398-e2eed6854639')
                .send(clientPerson2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResponse3);
        });

        test('Case when provided clientfhirperson has linked patient with same uuid as of person/some other resource in links', async () => {
            let request = await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManager());
                return c;
            });

            // add the person resource
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([clientPerson4Resource, clientPatient2Resource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            let jwt_payload = {
                scope: 'patient/*.* user/*.* access/*.*',
                username: 'test',
                client_id: 'client-1',
                clientFhirPersonId: 'aa178075-c5d3-5de4-98d0-8d8e58df5231',
                clientFhirPatientId: 'clientFhirPatient',
                bwellFhirPersonId: 'bwellFhirPersonId',
                bwellFhirPatientId: 'bwellFhirPatient',
                token_use: 'access'
            };
            let headers = getHeadersWithCustomPayload(jwt_payload);

            // Trying to create person resource having link to another person resource with same uuid as of
            // patient uuid linked to clientFhirPersonId of jwt
            resp = await request
                .post('/4_0_0/Person/$merge')
                .send(clientPerson5Resource)
                .set(headers);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedForbiddenErrorResponse);

            // New person resource cannot be created using patient scope
            resp = await request
                .post('/4_0_0/Person/$merge')
                .send(clientPerson6Resource)
                .set(headers);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedForbiddenErrorResponse);
        });
    });
});
