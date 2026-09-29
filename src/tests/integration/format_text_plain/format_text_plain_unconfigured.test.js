// Task 11 review Finding 2(b): `_format=text/plain` on a server where the fhir-notes
// full-text-search feature is not configured (the default in this test environment --
// ENABLE_FULL_TEXT_SEARCH is unset) must fall through to a completely normal FHIR JSON response,
// with no error. Uses the real, unmodified container/config -- no overrides -- so this exercises
// the actual default-configuration behavior.
const documentReference1Resource = require('./fixtures/DocumentReference/documentReference1.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest
} = require('../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('_format=text/plain (unconfigured) Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('GET DocumentReference/{id}?_format=text/plain falls through to normal JSON when not configured', async () => {
        const request = await createTestRequest();

        let resp = await request
            .post('/4_0_0/DocumentReference/1/$merge?validate=true')
            .send(documentReference1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .get('/4_0_0/DocumentReference/1?_format=text/plain')
            .set(getHeaders());

        expect(resp.status).toEqual(200);
        expect(resp.headers['content-type']).toContain('application/fhir+json');
        expect(resp.body.resourceType).toEqual('DocumentReference');
        expect(resp.body.id).toEqual('1');
    });
});
