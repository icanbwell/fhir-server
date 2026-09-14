// /fhir/r4/metadata routes with no changes to route.config.js (it normalizes to /4_0_0/metadata
// before any route matching); implementation.url gives a machine-readable answer to "which base
// am I on" now that two spellings are live simultaneously.
const supertest = require('supertest');

const { commonBeforeEach, commonAfterEach, getHeaders, createTestApp } = require('../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('fhir/r4 base path alias - metadata', () => {
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

    test('/fhir/r4/metadata returns 200 with implementation.url ending /fhir/r4', async () => {
        const request = supertest(createTestApp());

        const resp = await request.get('/fhir/r4/metadata').set(getHeaders());

        expect(resp).toHaveStatusCode(200);
        expect(resp.body.resourceType).toBe('CapabilityStatement');
        expect(resp.body.implementation).toBeDefined();
        expect(resp.body.implementation.url).toEndWith('/fhir/r4');
    });

    test('/4_0_0/metadata (same app) still ends /4_0_0', async () => {
        const request = supertest(createTestApp());

        const resp = await request.get('/4_0_0/metadata').set(getHeaders());

        expect(resp).toHaveStatusCode(200);
        expect(resp.body.implementation.url).toEndWith('/4_0_0');
        expect(resp.body.implementation.url).not.toContain('/fhir/r4');
    });
});
