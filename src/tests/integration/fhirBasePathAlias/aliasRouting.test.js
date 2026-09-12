// Verifies /fhir/r4/... is accepted for the same request shapes /4_0_0/... already is:
// GET/POST/PUT/DELETE, _search, _history, $merge, $everything, $graph. Also pins the
// case-insensitive match (/fhir/R4), the segment-boundary rejection (/fhir/r4x), and a real
// coverage gap that exists today regardless of this feature (/9_9_9/Patient -> 404).
const supertest = require('supertest');

const patient1Resource = require('./fixtures/patient1.json');
const graphDefinitionResource = require('./fixtures/graphSimple.json');

const { commonBeforeEach, commonAfterEach, getHeaders, createTestApp } = require('../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('fhir/r4 base path alias - routing', () => {
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

    test('POST /fhir/r4/Patient/:id/$merge creates a resource', async () => {
        const request = supertest(createTestApp());
        const resp = await request
            .post('/fhir/r4/Patient/aliasp1/$merge')
            .send(patient1Resource)
            .set(getHeaders());

        expect(resp).toHaveMergeResponse({ created: true });
    });

    test('GET /fhir/r4/Patient/:id reads a resource', async () => {
        const request = supertest(createTestApp());
        await request
            .post('/fhir/r4/Patient/aliasp1/$merge')
            .send(patient1Resource)
            .set(getHeaders());

        const resp = await request.get('/fhir/r4/Patient/aliasp1').set(getHeaders());

        expect(resp).toHaveStatusCode(200);
        expect(resp.body.id).toBe('aliasp1');
    });

    test('PUT /fhir/r4/Patient/:id updates a resource', async () => {
        const request = supertest(createTestApp());
        await request
            .post('/fhir/r4/Patient/aliasp1/$merge')
            .send(patient1Resource)
            .set(getHeaders());

        const updated = { ...patient1Resource, gender: 'other' };
        const resp = await request.put('/fhir/r4/Patient/aliasp1').send(updated).set(getHeaders());

        expect([200, 201]).toContain(resp.status);
    });

    test('DELETE /fhir/r4/Patient/:id removes a resource', async () => {
        const request = supertest(createTestApp());
        await request
            .post('/fhir/r4/Patient/aliasp1/$merge')
            .send(patient1Resource)
            .set(getHeaders());

        const resp = await request.delete('/fhir/r4/Patient/aliasp1').set(getHeaders());

        expect(resp).toHaveStatusCode(204);
    });

    test('GET /fhir/r4/Patient (_search) works', async () => {
        const request = supertest(createTestApp());
        await request
            .post('/fhir/r4/Patient/aliasp1/$merge')
            .send(patient1Resource)
            .set(getHeaders());

        const resp = await request.get('/fhir/r4/Patient?_bundle=1').set(getHeaders());

        expect(resp).toHaveStatusCode(200);
        expect(resp.body.resourceType).toBe('Bundle');
    });

    test('POST /fhir/r4/Patient/_search works', async () => {
        const request = supertest(createTestApp());
        await request
            .post('/fhir/r4/Patient/aliasp1/$merge')
            .send(patient1Resource)
            .set(getHeaders());

        const resp = await request
            .post('/fhir/r4/Patient/_search')
            .send({ id: 'aliasp1' })
            .set(getHeaders());

        expect(resp).toHaveStatusCode(200);
    });

    test('GET /fhir/r4/Patient/:id/_history works', async () => {
        const request = supertest(createTestApp());
        await request
            .post('/fhir/r4/Patient/aliasp1/$merge')
            .send(patient1Resource)
            .set(getHeaders());

        const resp = await request.get('/fhir/r4/Patient/aliasp1/_history').set(getHeaders());

        expect(resp).toHaveStatusCode(200);
        expect(resp.body.resourceType).toBe('Bundle');
    });

    test('GET /fhir/r4/Patient/:id/$everything works', async () => {
        const request = supertest(createTestApp());
        await request
            .post('/fhir/r4/Patient/aliasp1/$merge')
            .send(patient1Resource)
            .set(getHeaders());

        const resp = await request.get('/fhir/r4/Patient/aliasp1/$everything').set(getHeaders());

        expect(resp).toHaveStatusCode(200);
    });

    test('POST /fhir/r4/Patient/$graph works', async () => {
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
    });

    test('responds with application/fhir+json content type on the alias', async () => {
        const request = supertest(createTestApp());
        await request
            .post('/fhir/r4/Patient/aliasp1/$merge')
            .send(patient1Resource)
            .set(getHeaders());

        const resp = await request.get('/fhir/r4/Patient/aliasp1').set(getHeaders());

        expect(resp.headers['content-type']).toContain('application/fhir+json');
    });

    test('/fhir/R4 matches case-insensitively', async () => {
        const request = supertest(createTestApp());
        await request
            .post('/fhir/r4/Patient/aliasp1/$merge')
            .send(patient1Resource)
            .set(getHeaders());

        const resp = await request.get('/fhir/R4/Patient/aliasp1').set(getHeaders());

        expect(resp).toHaveStatusCode(200);
    });

    test('/fhir/r4x does not match the alias (segment-boundary guard) - 404', async () => {
        const request = supertest(createTestApp());

        const resp = await request.get('/fhir/r4x/Patient').set(getHeaders());

        expect(resp).toHaveStatusCode(404);
    });

    test('an unknown base_version segment still 404s (pre-existing gap, not this feature) - /9_9_9/Patient', async () => {
        const request = supertest(createTestApp());

        const resp = await request.get('/9_9_9/Patient').set(getHeaders());

        expect(resp).toHaveStatusCode(404);
    });
});
