// The single most important test in the set (per the design doc): extracts the `next` link from
// an aliased search and re-issues it verbatim. This is the only test that catches a
// non-round-trippable link - e.g. if the alias were mirrored into the fullUrl/self link but not
// consistently into next, a client paginating via /fhir/r4 would silently fall back to /4_0_0
// mid-pagination (or 404, once this middleware becomes the only entry point that understands the
// alias). Mirrors src/tests/integration/searchParameters/search_by_next_link/search_by_next_link.test.js.
const supertest = require('supertest');

const patient1Resource = require('./fixtures/patient1.json');
const patient2Resource = require('./fixtures/patient2.json');

const { commonBeforeEach, commonAfterEach, getHeaders, createTestApp } = require('../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('fhir/r4 base path alias - next link round-trip', () => {
    const originalFlag = process.env.ENABLE_FHIR_R4_PATH_ALIAS;
    const originalSortId = process.env.DEFAULT_SORT_ID;

    beforeEach(async () => {
        process.env.ENABLE_FHIR_R4_PATH_ALIAS = '1';
        process.env.DEFAULT_SORT_ID = '_uuid';
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
        if (originalFlag === undefined) {
            delete process.env.ENABLE_FHIR_R4_PATH_ALIAS;
        } else {
            process.env.ENABLE_FHIR_R4_PATH_ALIAS = originalFlag;
        }
        if (originalSortId === undefined) {
            delete process.env.DEFAULT_SORT_ID;
        } else {
            process.env.DEFAULT_SORT_ID = originalSortId;
        }
    });

    test('a next link issued under /fhir/r4 stays under /fhir/r4 and is re-issuable verbatim', async () => {
        const request = supertest(createTestApp());

        await request
            .post('/fhir/r4/Patient/aliasp1/$merge')
            .send(patient1Resource)
            .set(getHeaders());
        await request
            .post('/fhir/r4/Patient/aliasp2/$merge')
            .send(patient2Resource)
            .set(getHeaders());

        const firstPage = await request
            .get('/fhir/r4/Patient?_count=1&_bundle=1')
            .set(getHeaders());

        expect(firstPage).toHaveStatusCode(200);
        expect(firstPage.body.entry.length).toBe(1);

        const nextLink = firstPage.body.link.find((link) => link.relation === 'next');
        expect(nextLink).toBeDefined();
        expect(nextLink.url).toContain('/fhir/r4/Patient');
        expect(nextLink.url).not.toContain('/4_0_0');

        // Re-issue the returned next link verbatim, exactly as a real client would - strip only
        // the scheme+host (supertest needs a path, not an absolute URL), keep everything else.
        const nextPath = nextLink.url.replace(/^https?:\/\/[^/]+/, '');

        const secondPage = await request.get(nextPath).set(getHeaders());

        expect(secondPage).toHaveStatusCode(200);
        expect(secondPage.body.entry.length).toBe(1);
        // the returned ids differ between the two pages - pagination actually advanced
        expect(secondPage.body.entry[0].resource.id).not.toBe(firstPage.body.entry[0].resource.id);

        // if there's a further next link, it too must stay under /fhir/r4
        const secondNextLink = secondPage.body.link.find((link) => link.relation === 'next');
        if (secondNextLink) {
            expect(secondNextLink.url).toContain('/fhir/r4/Patient');
        }
    });
});
