// Pins the precedence rule: externalReqUrlPrefix wins absolutely over the alias. When a prefix is
// configured, response URLs must show ONLY the prefix - no /fhir/r4 leakage at all - because that
// value asserts "the caller can only reach us through this other host" (e.g. api-gateway).
const supertest = require('supertest');

const patient1Resource = require('./fixtures/patient1.json');

const { commonBeforeEach, commonAfterEach, getHeaders, createTestApp } = require('../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('fhir/r4 base path alias - externalReqUrlPrefix precedence', () => {
    const originalFlag = process.env.ENABLE_FHIR_R4_PATH_ALIAS;
    const originalExternalServices = process.env.EXTERNAL_SERVICES_WITH_REQ_LIMIT;
    const originalStream = process.env.STREAM_RESPONSE;

    beforeEach(async () => {
        process.env.ENABLE_FHIR_R4_PATH_ALIAS = '1';
        // Disable streaming to enable testing of fullUrl - see
        // patientSearchList.test.js's identical comment: the streaming bundle writer never
        // populates per-entry fullUrl, regardless of base path, so this is pre-existing and
        // unrelated to the alias.
        process.env.STREAM_RESPONSE = 'false';
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
        if (originalFlag === undefined) {
            delete process.env.ENABLE_FHIR_R4_PATH_ALIAS;
        } else {
            process.env.ENABLE_FHIR_R4_PATH_ALIAS = originalFlag;
        }
        if (originalExternalServices === undefined) {
            delete process.env.EXTERNAL_SERVICES_WITH_REQ_LIMIT;
        } else {
            process.env.EXTERNAL_SERVICES_WITH_REQ_LIMIT = originalExternalServices;
        }
        if (originalStream === undefined) {
            delete process.env.STREAM_RESPONSE;
        } else {
            process.env.STREAM_RESPONSE = originalStream;
        }
    });

    test('a configured prefix wins absolutely - no /fhir/r4 segment anywhere in the response URLs', async () => {
        process.env.EXTERNAL_SERVICES_WITH_REQ_LIMIT = 'api-gateway|http://example.com';
        const request = supertest(createTestApp());

        await request
            .post('/fhir/r4/Patient/aliasp1/$merge')
            .send(patient1Resource)
            .set(getHeaders());

        const resp = await request
            .get('/fhir/r4/Patient?_bundle=1')
            .set({ ...getHeaders(), 'origin-service': 'api-gateway' });

        expect(resp).toHaveStatusCode(200);
        for (const entry of resp.body.entry) {
            expect(entry.fullUrl).toStartWith('http://example.com/Patient/');
            expect(entry.fullUrl).not.toContain('/fhir/r4');
            expect(entry.fullUrl).not.toContain('/4_0_0');
        }
        const selfLink = resp.body.link.find((l) => l.relation === 'self');
        expect(selfLink.url).toStartWith('http://example.com/');
        expect(selfLink.url).not.toContain('/fhir/r4');
    });

    test('a configured service with a null prefix (no restriction) still mirrors the alias', async () => {
        process.env.EXTERNAL_SERVICES_WITH_REQ_LIMIT = 'api-gateway';
        const request = supertest(createTestApp());

        await request
            .post('/fhir/r4/Patient/aliasp1/$merge')
            .send(patient1Resource)
            .set(getHeaders());

        const resp = await request
            .get('/fhir/r4/Patient?_bundle=1')
            .set({ ...getHeaders(), 'origin-service': 'api-gateway' });

        expect(resp).toHaveStatusCode(200);
        for (const entry of resp.body.entry) {
            expect(entry.fullUrl).toContain('/fhir/r4/Patient/');
        }
    });
});
