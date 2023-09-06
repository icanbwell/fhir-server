const commonOrg = require('./fixtures/common-organization.json');
const endpoint = require('./fixtures/endpoint.json');
const practitioner1 = require('./fixtures/practitioner1.json');
const practitioner2 = require('./fixtures/practitioner2.json');
const practitionerRole1 = require('./fixtures/practitionerRole1.json');
const practitionerRole2 = require('./fixtures/practitionerRole2.json');
const graphDefinition = require('./fixtures/graphDefinitionResource.json');
const expectedResponse = require('./fixtures/expected/graph_result.json');
const expectedWithSingleId = require('./fixtures/expected/graph_single_result.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
} = require('../../common');
const {describe, beforeEach, afterEach, expect, test} = require('@jest/globals');

describe('Graphs with nested links Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('Graph contained with single ids and nested links should not return duplicate contained resources', async () => {
        const request = await createTestRequest();

        // add the resources to FHIR server
        let resp = await request
            .post('/4_0_0/Practitioner/1/$merge?validate=true')
            .send([practitioner1, practitionerRole1, practitioner2, practitionerRole2, commonOrg, endpoint])
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({created: true});
        resp = await request
            .post('/4_0_0/Practitioner/$graph?contained=true&id=1003369042')
            .set(getHeaders())
            .send(graphDefinition);

        // response should not have duplicate contained resources
        expect(resp).toHaveResponse(expectedWithSingleId);
    });

    test('Graph contained with multiple ids and nested links should not return duplicate contained resources', async () => {
        const request = await createTestRequest();

        // add the resources to FHIR server
        let resp = await request
            .post('/4_0_0/Practitioner/1/$merge?validate=true')
            .send([practitioner1, practitionerRole1, practitioner2, practitionerRole2, commonOrg, endpoint])
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({created: true});
        resp = await request
            .post('/4_0_0/Practitioner/$graph?contained=true&id=1003369042,1013973049')
            .set(getHeaders())
            .send(graphDefinition);

        // response should not have duplicate contained resources
        expect(resp).toHaveResponse(expectedResponse);
    });
});
