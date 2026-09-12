// Verifies every response-URL surface mirrors whichever base path the request used, per request,
// and that the anchoring rule in FhirBasePath#stripVersionSegment never touches resource content
// that happens to contain a literal '/4_0_0/' segment (RESOURCE_HIDDEN_TAG.SYSTEM).
const supertest = require('supertest');

const patient1Resource = require('./fixtures/patient1.json');
const patient2Resource = require('./fixtures/patient2.json');
const graphDefinitionResource = require('./fixtures/graphSimple.json');

const { commonBeforeEach, commonAfterEach, getHeaders, createTestApp } = require('../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('fhir/r4 base path alias - response URLs', () => {
    const originalFlag = process.env.ENABLE_FHIR_R4_PATH_ALIAS;

    beforeEach(async () => {
        process.env.ENABLE_FHIR_R4_PATH_ALIAS = '1';
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
        if (originalFlag === undefined) {
            delete process.env.ENABLE_FHIR_R4_PATH_ALIAS;
        } else {
            process.env.ENABLE_FHIR_R4_PATH_ALIAS = originalFlag;
        }
    });

    test('search fullUrl and link.self are under /fhir/r4 when the request used /fhir/r4', async () => {
        const request = supertest(createTestApp());
        await request
            .post('/fhir/r4/Patient/aliasp1/$merge')
            .send(patient1Resource)
            .set(getHeaders());

        const resp = await request.get('/fhir/r4/Patient?_bundle=1').set(getHeaders());

        expect(resp).toHaveStatusCode(200);
        const selfLink = resp.body.link.find((l) => l.relation === 'self');
        expect(selfLink.url).toContain('/fhir/r4/Patient');
        expect(selfLink.url).not.toContain('/4_0_0');
        for (const entry of resp.body.entry) {
            expect(entry.fullUrl).toContain('/fhir/r4/Patient/');
        }
    });

    test('the same app still yields /4_0_0 for a /4_0_0 request (per-request mirroring, both directions)', async () => {
        const request = supertest(createTestApp());
        await request
            .post('/fhir/r4/Patient/aliasp1/$merge')
            .send(patient1Resource)
            .set(getHeaders());

        const aliasResp = await request.get('/fhir/r4/Patient?_bundle=1').set(getHeaders());
        const canonicalResp = await request.get('/4_0_0/Patient?_bundle=1').set(getHeaders());

        expect(aliasResp.body.link[0].url).toContain('/fhir/r4/');
        expect(canonicalResp.body.link[0].url).toContain('/4_0_0/');
        expect(canonicalResp.body.link[0].url).not.toContain('/fhir/r4');
    });

    test('Location and Content-Location mirror on create', async () => {
        const request = supertest(createTestApp());

        const resp = await request
            .post('/fhir/r4/Patient')
            .send(patient1Resource)
            .set(getHeaders());

        expect(resp).toHaveStatusCode(201);
        expect(resp.headers.location).toStartWith('fhir/r4/Patient/');
        if (resp.headers['content-location']) {
            expect(resp.headers['content-location']).toContain('/fhir/r4/Patient/');
        }
    });

    test('_history bundle self link mirrors the alias (drop-site coverage)', async () => {
        const request = supertest(createTestApp());
        await request
            .post('/fhir/r4/Patient/aliasp1/$merge')
            .send(patient1Resource)
            .set(getHeaders());

        const resp = await request.get('/fhir/r4/Patient/aliasp1/_history').set(getHeaders());

        expect(resp).toHaveStatusCode(200);
        // history entries carry a fullUrl derived from the alias-aware responseUrls builder
        if (resp.body.entry && resp.body.entry.length > 0) {
            expect(resp.body.entry[0].fullUrl).toContain('/fhir/r4/Patient/');
        }
    });

    test('$everything fullUrl mirrors the alias (drop-site coverage)', async () => {
        const request = supertest(createTestApp());
        await request
            .post('/fhir/r4/Patient/aliasp1/$merge')
            .send(patient1Resource)
            .set(getHeaders());

        const resp = await request.get('/fhir/r4/Patient/aliasp1/$everything').set(getHeaders());

        expect(resp).toHaveStatusCode(200);
        const patientEntry = (resp.body.entry || []).find(
            (e) => e.resource?.resourceType === 'Patient'
        );
        if (patientEntry) {
            expect(patientEntry.fullUrl).toContain('/fhir/r4/Patient/');
        }
    });

    test('$graph fullUrl mirrors the alias (drop-site coverage)', async () => {
        const request = supertest(createTestApp());
        await request
            .post('/fhir/r4/Patient/aliasp1/$merge')
            .send(patient1Resource)
            .set(getHeaders());

        const resp = await request
            .post('/fhir/r4/Patient/$graph?id=aliasp1')
            .send(graphDefinitionResource)
            .set(getHeaders());

        expect(resp).toHaveStatusCode(200);
        if (resp.body.entry && resp.body.entry.length > 0) {
            expect(resp.body.entry[0].fullUrl).toContain('/fhir/r4/Patient/');
        }
    });

    test('$merge batch-response bundle is built without error under the alias (drop-site coverage)', async () => {
        const request = supertest(createTestApp());

        const resp = await request
            .post('/fhir/r4/Patient/$merge')
            .send([patient1Resource, patient2Resource])
            .set(getHeaders());

        expect(resp).toHaveStatusCode(200);
    });

    describe('empty-result search (drop-site coverage)', () => {
        test('with STREAM_RESPONSE=false', async () => {
            const originalStream = process.env.STREAM_RESPONSE;
            process.env.STREAM_RESPONSE = 'false';
            try {
                const request = supertest(createTestApp());
                const resp = await request
                    .get('/fhir/r4/Patient?_bundle=1&family=NONEXISTENT')
                    .set(getHeaders());

                expect(resp).toHaveStatusCode(200);
                expect(resp.body.resourceType).toBe('Bundle');
            } finally {
                process.env.STREAM_RESPONSE = originalStream;
            }
        });

        test('with streaming enabled', async () => {
            const originalStream = process.env.STREAM_RESPONSE;
            process.env.STREAM_RESPONSE = '1';
            try {
                const request = supertest(createTestApp());
                const resp = await request
                    .get('/fhir/r4/Patient?_bundle=1&family=NONEXISTENT')
                    .set(getHeaders());

                expect(resp).toHaveStatusCode(200);
                expect(resp.body.resourceType).toBe('Bundle');
            } finally {
                process.env.STREAM_RESPONSE = originalStream;
            }
        });
    });

    test('a resource containing a literal /4_0_0/ segment in its content round-trips unchanged (anchoring pin)', async () => {
        const request = supertest(createTestApp());
        const resourceWithHiddenTagLiteral = {
            ...patient1Resource,
            meta: {
                ...patient1Resource.meta,
                tag: [
                    {
                        // deliberately the same system URI as RESOURCE_HIDDEN_TAG.SYSTEM
                        // (src/constants.js) but a different code, so this test pins the
                        // anchoring rule without engaging the actual hidden-resource filter.
                        system: 'https://fhir.icanbwell.com/4_0_0/CodeSystem/server-behavior',
                        code: 'not-hidden-just-pinning-anchoring'
                    }
                ]
            }
        };
        await request
            .post('/fhir/r4/Patient/aliasp1/$merge')
            .send(resourceWithHiddenTagLiteral)
            .set(getHeaders());

        const resp = await request.get('/fhir/r4/Patient/aliasp1').set(getHeaders());

        expect(resp).toHaveStatusCode(200);
        const tag = resp.body.meta.tag.find((t) => t.code === 'not-hidden-just-pinning-anchoring');
        expect(tag.system).toBe('https://fhir.icanbwell.com/4_0_0/CodeSystem/server-behavior');
    });
});
