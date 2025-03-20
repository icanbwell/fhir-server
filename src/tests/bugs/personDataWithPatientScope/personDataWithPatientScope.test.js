const fs = require('fs');
const path = require('path');

const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getHeadersWithCustomPayload,
    getCustomGraphQLHeaders
} = require('../../common');
const { ConfigManager } = require('../../../utils/configManager');

// test file
const masterPersonResource = require('./fixtures/person/masterperson.json');
const masterPatientResource = require('./fixtures/patient/masterpatient.json');

const clientPersonResourceA = require('./fixtures/person/clientpersonA.json');
const clientPatientResourceA = require('./fixtures/patient/clientpatientA.json');

const clientPersonResourceB = require('./fixtures/person/clientpersonB.json');
const clientPatientResourceB = require('./fixtures/patient/clientpatientB.json');

const commonPROAPatientResource = require('./fixtures/patient/commonPROAPatient.json');

const observationAResource = require('./fixtures/observation/observationA.json');
const observationBResource = require('./fixtures/observation/observationB.json');
const observationPROAResource = require('./fixtures/observation/observationProa.json');

const personQueryV1 = fs.readFileSync(path.resolve(__dirname, './fixtures/personQuery.graphql'), 'utf8');
const personQueryV2 = fs.readFileSync(path.resolve(__dirname, './fixtures/personQueryV2.graphql'), 'utf8');

const patientToPersonGraph = require('./fixtures/patientToPersonGraph.json');

// expected
const expectedResponseClientPersonA = require('./fixtures/expected/expectedResponseClientPersonA.json');
const expectedResponseClientPersonB = require('./fixtures/expected/expectedResponseClientPersonB.json');

const expectedGraphQLClientPersonA = require('./fixtures/expected/expectedGraphQLClientPersonA.json');
const expectedGraphQLv2ClientPersonA = require('./fixtures/expected/expectedGraphQLv2ClientPersonA.json');

const expectedEverythingClientPatientA = require('./fixtures/expected/expectedEverythingClientPatientA.json');
const expectedEverythingClientPersonA = require('./fixtures/expected/expectedEverythingClientPersonA.json');
const expectedEverythingCommonProaPatient = require('./fixtures/expected/expectedEverythingCommonProaPatient.json');

const expectedClientPatientAGraph = require('./fixtures/expected/expectedClientPatientAGraph.json');
const expectedCommonProaPatientGraph = require('./fixtures/expected/expectedCommonProaPatientGraph.json');

class MockConfigManager extends ConfigManager {
    get enableReturnBundle() {
        return true;
    }
}

describe('Client person access test using patient scope', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('Only Client person in jwt is accessible even when a common PROA patient is present', async () => {
        let request = await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManager());
            return c;
        });

        // add the required resources
        let resp = await request
            .post('/4_0_0/Person/1/$merge')
            .send([
                masterPersonResource,
                masterPatientResource,
                clientPersonResourceA,
                clientPatientResourceA,
                clientPersonResourceB,
                clientPatientResourceB,
                commonPROAPatientResource,
                observationAResource,
                observationBResource,
                observationPROAResource
            ])
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        let jwtPayloadClientA = {
            scope: 'patient/*.* user/*.* access/*.*',
            username: 'test',
            client_id: 'client',
            clientFhirPersonId: 'a26bc9e7-1f3c-4c85-b8d3-ca7355f4f1f0',
            clientFhirPatientId: '27f4a58a-ebc1-4855-91d1-c6234a7d40bc',
            bwellFhirPersonId: '08f1b73a-e27c-456d-8a61-277f164a9a57',
            bwellFhirPatientId: '31de42ef-6268-5786-966b-fe18f1efaf63',
            token_use: 'access'
        };

        let jwtPayloadClientB = {
            scope: 'patient/*.* user/*.* access/*.*',
            username: 'test',
            client_id: 'client',
            clientFhirPersonId: 'b83b2b9a-a454-4b64-aae6-583ec758abeb',
            clientFhirPatientId: '48e6dd68-4e3e-4246-8b2e-23539782722a',
            bwellFhirPersonId: '08f1b73a-e27c-456d-8a61-277f164a9a57',
            bwellFhirPatientId: '31de42ef-6268-5786-966b-fe18f1efaf63',
            token_use: 'access'
        };
        let headersClientA = getHeadersWithCustomPayload(jwtPayloadClientA);
        let headersClientB = getHeadersWithCustomPayload(jwtPayloadClientB);

        // Only single client person is fetched
        resp = await request.get('/4_0_0/Person?_debug=1').set(headersClientA);
        expect(resp).toHaveResponse(expectedResponseClientPersonA);

        resp = await request.get('/4_0_0/Person?_debug=1').set(headersClientB);
        expect(resp).toHaveResponse(expectedResponseClientPersonB);

        // only single client person is fetched in graphql v1
        let graphqlQueryText = personQueryV1.replace(/\\n/g, '');
        resp = await request
            .post('/$graphql')
            .send({
                operationName: null,
                variables: {},
                query: graphqlQueryText
            })
            .set(getCustomGraphQLHeaders(jwtPayloadClientA));
        expect(resp).toHaveResponse(expectedGraphQLClientPersonA);

        graphqlQueryText = personQueryV2.replace(/\\n/g, '');
        resp = await request
            .post('/4_0_0/$graphqlv2')
            .send({
                operationName: null,
                variables: {},
                query: graphqlQueryText
            })
            .set(getCustomGraphQLHeaders(jwtPayloadClientA));
        expect(resp).toHaveResponse(expectedGraphQLv2ClientPersonA);

        // patient everything for client patient A using client patient A token
        resp = await request.get('/4_0_0/Patient/27f4a58a-ebc1-4855-91d1-c6234a7d40bc/$everything?_debug=1&_explain=0').set(headersClientA);
        expect(resp).toHaveResponse(expectedEverythingClientPatientA);

        // patient everything for common proa patient using client patient A token
        resp = await request.get('/4_0_0/Patient/e5ec316c-6c24-4e3e-b93a-e352cdb3d1d6/$everything?_debug=1').set(headersClientA);
        expect(resp).toHaveResponse(expectedEverythingCommonProaPatient);

        // person everything for client person A using client patient A token
        resp = await request.get('/4_0_0/Person/a26bc9e7-1f3c-4c85-b8d3-ca7355f4f1f0/$everything?_debug=1').set(headersClientA);
        expect(resp).toHaveResponse(expectedEverythingClientPersonA);

        // patient to person graph test, starting from client patient A
        resp = await request
            .post(
                '/4_0_0/Patient/$graph?id=27f4a58a-ebc1-4855-91d1-c6234a7d40bc&_debug=true'
            )
            .set(headersClientA)
            .send(patientToPersonGraph);
        expect(resp).toHaveResponse(expectedClientPatientAGraph);

        // patient to person graph test, starting from common PROA patient
        resp = await request
            .post(
                '/4_0_0/Patient/$graph?id=e5ec316c-6c24-4e3e-b93a-e352cdb3d1d6&_debug=true'
            )
            .set(headersClientA)
            .send(patientToPersonGraph);
        expect(resp).toHaveResponse(expectedCommonProaPatientGraph);
    });
});
