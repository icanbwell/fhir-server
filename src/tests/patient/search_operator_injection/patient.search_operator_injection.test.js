const patient1Resource = require('./fixtures/patient/patient1.json');
const patient2Resource = require('./fixtures/patient/patient2.json');

const expectedSearch1 = require('./fixtures/expected/expected_search1.json');
const expectedSearch2 = require('./fixtures/expected/expected_search2.json');
const expectedSearch3 = require('./fixtures/expected/expected_search3.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getHeadersWithAdmin,
    getFullAccessTokenWithAdmin,
    createTestRequest
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const deepcopy = require('deepcopy');

// Composed for this test: application/x-www-form-urlencoded (so bracket-notation bodies
// like `identifier[$gt]=` parse through qs the same way a real POST _search body does)
const getHeadersFormUrlEncodedWithAdmin = () => ({
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/fhir+json',
    Authorization: `Bearer ${getFullAccessTokenWithAdmin()}`,
    Host: 'localhost:3000'
});

describe('Search operator injection', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Patient POST _search with MongoDB operator objects', () => {
        test('_search with correct values builds the normal equality filter', async () => {
            const request = await createTestRequest();

            for (const resource of [patient1Resource, patient2Resource]) {
                const resp = await request
                    .post('/4_0_0/Patient/$merge')
                    .send(resource)
                    .set(getHeaders());
                // noinspection JSUnresolvedFunction
                expect(resp).toHaveMergeResponse({ created: true });
            }

            const resp = await request
                .post('/4_0_0/Patient/_search?_debug=1&_bundle=1')
                .send('identifier=MRN-AAA111')
                .set(getHeadersFormUrlEncodedWithAdmin());

            const expected1 = deepcopy(expectedSearch1);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMongoQuery(expected1);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expected1);
        });

        test('_search with a malformed/injected query drops the operator object instead of erroring', async () => {
            const request = await createTestRequest();

            for (const resource of [patient1Resource, patient2Resource]) {
                const resp = await request
                    .post('/4_0_0/Patient/$merge')
                    .send(resource)
                    .set(getHeaders());
                // noinspection JSUnresolvedFunction
                expect(resp).toHaveMergeResponse({ created: true });
            }

            // express.urlencoded({extended:true}) + qs parses this body into
            // { identifier: { $gt: '' } } -- the exact operator-injection shape.
            let resp = await request
                .post('/4_0_0/Patient/_search?_debug=1&_bundle=1')
                .send('identifier[$gt]=')
                .set(getHeadersFormUrlEncodedWithAdmin());

            const expected2 = deepcopy(expectedSearch2);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMongoQuery(expected2);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expected2);

            // qs parses this form-urlencoded body into { 'identifier[$gt]': '' } -- extended
            // was removed from express.urlencoded's config, so the bracket key is flattened
            // to a literal string that never matches the real 'identifier' search parameter.
            resp = await request
                .post('/4_0_0/Patient/_search?_debug=1&_bundle=1')
                .send('birthdate[0][0][$gt]=')
                .set(getHeadersFormUrlEncodedWithAdmin());

            const expected3 = deepcopy(expectedSearch3);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMongoQuery(expected3);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expected3);
        });
    });

    describe('Patient GET _sort allowlist', () => {
        test('_sort=gender is a real search-parameter field, so it is applied', async () => {
            const request = await createTestRequest();

            for (const resource of [patient1Resource, patient2Resource]) {
                const resp = await request
                    .post('/4_0_0/Patient/$merge')
                    .send(resource)
                    .set(getHeaders());
                // noinspection JSUnresolvedFunction
                expect(resp).toHaveMergeResponse({ created: true });
            }

            // patient1Resource is male, patient2Resource is female (see fixtures)
            const response = await request
                .get('/4_0_0/Patient?_sort=gender')
                .set(getHeaders());

            expect(response.status).toBe(200);
            const genders = response.body.entry
                .map(e => e.resource.gender)
                .filter(g => g === 'male' || g === 'female');
            expect(genders).toEqual(['female', 'male']);
        });

        test('_sort=maritalStatus is not a registered search-parameter field, so it is dropped instead of rejecting the request', async () => {
            const request = await createTestRequest();

            for (const resource of [patient1Resource, patient2Resource]) {
                const resp = await request
                    .post('/4_0_0/Patient/$merge')
                    .send(resource)
                    .set(getHeaders());
                // noinspection JSUnresolvedFunction
                expect(resp).toHaveMergeResponse({ created: true });
            }

            const response = await request
                .get('/4_0_0/Patient?_sort=maritalStatus&_bundle=1')
                .set(getHeaders());

            expect(response.status).toBe(200);
            expect(response.body.entry.length).toBe(2);
        });

        test('_sort=$$$ (malformed value) is dropped instead of crashing or rejecting the request (SEC-1580 SAE-4)', async () => {
            const request = await createTestRequest();

            const resp = await request
                .post('/4_0_0/Patient/$merge')
                .send(patient1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            const response = await request
                .get('/4_0_0/Patient?_sort=$$$&_bundle=1')
                .set(getHeaders());

            expect(response.status).toBe(200);
            expect(response.body.entry.length).toBe(1);
        });
    });
});
