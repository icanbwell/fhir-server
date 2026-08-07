const patient1Resource = require('./fixtures/patient/patient1.json');
const patient2Resource = require('./fixtures/patient/patient2.json');

const expectedSearch1 = require('./fixtures/expected/expected_search1.json');
const expectedSearch2 = require('./fixtures/expected/expected_search2.json');
const expectedSearch3 = require('./fixtures/expected/expected_search3.json');
const expectedSearch4 = require('./fixtures/expected/expected_search4.json');
const expectedSearch5 = require('./fixtures/expected/expected_search5.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
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

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMongoQuery(deepcopy(expectedSearch1));
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(deepcopy(expectedSearch1));
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

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMongoQuery(deepcopy(expectedSearch2));
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(deepcopy(expectedSearch2));

            // qs parses this into { birthdate: [ [ { $gt: '' } ] ] } -- the doubly-nested
            // array case a shallow strip check would miss, reaching FilterByDateTime and
            // throwing TypeError: value.match is not a function.
            resp = await request
                .post('/4_0_0/Patient/_search?_debug=1&_bundle=1')
                .send('birthdate[0][0][$gt]=')
                .set(getHeadersFormUrlEncodedWithAdmin());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMongoQuery(deepcopy(expectedSearch3));
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(deepcopy(expectedSearch3));
        });

        test('_lastUpdated works for both a legitimate range and a malformed nested value', async () => {
            const request = await createTestRequest();

            for (const resource of [patient1Resource, patient2Resource]) {
                const resp = await request
                    .post('/4_0_0/Patient/$merge')
                    .send(resource)
                    .set(getHeaders());
                // noinspection JSUnresolvedFunction
                expect(resp).toHaveMergeResponse({ created: true });
            }

            // the search-form two-value convention: index 0 becomes the gt bound, index 1
            // becomes the lt bound
            let resp = await request
                .post('/4_0_0/Patient/_search?_debug=1&_bundle=1')
                .send('_lastUpdated=2020-01-01&_lastUpdated=2020-02-01')
                .set(getHeadersFormUrlEncodedWithAdmin());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMongoQuery(deepcopy(expectedSearch4));
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(deepcopy(expectedSearch4));

            resp = await request
                .post('/4_0_0/Patient/_search?_debug=1&_bundle=1')
                .send('_lastUpdated[0][$gt]=2020-01-01')
                .set(getHeadersFormUrlEncodedWithAdmin());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMongoQuery(deepcopy(expectedSearch5));
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(deepcopy(expectedSearch5));
        });
    });
});
