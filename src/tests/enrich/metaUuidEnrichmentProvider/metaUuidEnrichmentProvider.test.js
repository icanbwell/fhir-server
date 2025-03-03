// test file
const practitioner1Resource = require('./fixtures/Practitioner/practitioner1.json');
const practitioner2Resource = require('./fixtures/Practitioner/practitioner2.json');

// expected
const expectedPractitionerByIdResource = require('./fixtures/expected/expected_practitioner_by_id.json');
const expectedPractitionerMultipleResources = require('./fixtures/expected/expected_practitioner_multiple.json');

const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('Practitioner with meta uuid tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('search by id works with meta uuid enricher', async () => {
        const request = await createTestRequest();
        // ARRANGE
        // add the resources to FHIR server
        let resp = await request.post('/4_0_0/Practitioner/1/$merge?validate=true').send(practitioner1Resource).set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        // ACT & ASSERT
        // search by token system and code and make sure we get the right Practitioner back
        resp = await request.get('/4_0_0/Practitioner/1679033641?_metaUuid=1').set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedPractitionerByIdResource);
    });
    test('search works with meta uuid enricher', async () => {
        const request = await createTestRequest();
        // ARRANGE
        // add the resources to FHIR server
        let resp = await request.post('/4_0_0/Practitioner/1/$merge?validate=true').send(practitioner1Resource).set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request.post('/4_0_0/Practitioner/1/$merge?validate=true').send(practitioner2Resource).set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        // ACT & ASSERT
        resp = await request.get(`/4_0_0/Practitioner?_metaUuid=1&_bundle=1`).set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedPractitionerMultipleResources);
    });
});
