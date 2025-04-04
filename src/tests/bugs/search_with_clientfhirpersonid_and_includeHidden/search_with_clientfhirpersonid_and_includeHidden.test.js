// test file
const masterPersonResource = require('./fixtures/person/masterperson.json');
const masterPatientResource = require('./fixtures/patient/masterpatient.json');

const clientPersonResource = require('./fixtures/person/clientperson.json');
const clientPatientResource = require('./fixtures/patient/clientpatient.json');

const clientPerson1Resource = require('./fixtures/person/clientperson1.json');
const clientPatient1Resource = require('./fixtures/patient/clientpatient1.json');

const observation1Resource = require('./fixtures/observation/observation1.json');
const observation2Resource = require('./fixtures/observation/observation2.json');
const observation3Resource = require('./fixtures/observation/observation3.json');
const observation4Resource = require('./fixtures/observation/observation4.json');
const observation5Resource = require('./fixtures/observation/observation5.json');

// expected
const expectedResponse1 = require('./fixtures/expected/expectedResponse1.json');
const expectedResponse2 = require('./fixtures/expected/expectedResponse2.json');
const expectedResponse3 = require('./fixtures/expected/expectedResponse3.json');
const expectedResponse4 = require('./fixtures/expected/expectedResponse4.json');
const expectedResponse5 = require('./fixtures/expected/expectedResponse5.json');
const expectedResponse6 = require('./fixtures/expected/expectedResponse6.json');

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
    get enableReturnBundle() {
        return true;
    }
}

describe('_includeHidden with Patient scope test', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('_includeHidden should not be ignored with Patient scope', () => {
        test('search by clientFhirPersonId gives resources linked to the specified client person only', async () => {
            let request = await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManager());
                return c;
            });

            // add the required resources
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([
                    masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource,
                    clientPerson1Resource, clientPatient1Resource, observation1Resource, observation2Resource,
                    observation3Resource, observation4Resource, observation5Resource
                ])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            // All observations are returned as currently bwellFhirPersonId is not used to filter here
            resp = await request
                .get('/4_0_0/Observation?_debug=1')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResponse1);

            let jwt_payload = {
                scope: 'patient/*.* user/*.* access/*.*',
                username: 'test',
                client_id: 'client-1',
                clientFhirPersonId: '0893291d-0b0c-55c2-86d5-66bfbb7f34fd',
                clientFhirPatientId: 'clientFhirPatient',
                bwellFhirPersonId: '08f1b73a-e27c-456d-8a61-277f164a9a57',
                bwellFhirPatientId: 'bwellFhirPatient',
                token_use: 'access'
            };
            let headers = getHeadersWithCustomPayload(jwt_payload);

            // Observations linked to client person are returned
            resp = await request
                .get('/4_0_0/Observation?_debug=1&_includeHidden=false')
                .set(headers);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMongoQuery(expectedResponse2);
            expect(resp).toHaveResponse(expectedResponse2);

            jwt_payload.clientFhirPersonId = '98c81eef-dc76-52a0-a6ed-b5569e224f1c';
            headers = getHeadersWithCustomPayload(jwt_payload);

            // Observations linked to client-1 person are returned
            resp = await request
                .get('/4_0_0/Observation?_debug=1&_includeHidden=false')
                .set(headers);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMongoQuery(expectedResponse3);
            expect(resp).toHaveResponse(expectedResponse3);

            // _includeHidden=false tag is not ignored with Patient scope for non-clinical resources too
            resp = await request
                .get('/4_0_0/Practitioner?_debug=1&_includeHidden=false')
                .set(headers);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMongoQuery(expectedResponse4);
            expect(resp).toHaveResponse(expectedResponse4);

            // Observations linked to client-1 person are returned with _includeHidden=true
            resp = await request
                .get('/4_0_0/Observation?_debug=1=1&_includeHidden=true')
                .set(headers);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMongoQuery(expectedResponse5);
            expect(resp).toHaveResponse(expectedResponse5);

            // _includeHidden=true tag is not ignored with Patient scope for non-clinical resources too
            resp = await request
                .get('/4_0_0/Practitioner?_debug=1&_includeHidden=true')
                .set(headers);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMongoQuery(expectedResponse6);
            expect(resp).toHaveResponse(expectedResponse6);
        });
    });
});
