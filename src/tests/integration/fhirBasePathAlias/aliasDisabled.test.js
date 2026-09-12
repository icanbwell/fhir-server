// With the flag off, /fhir/r4 must not be routable at all - and specifically must 404, not 500.
// This exercises the error-swallow path at src/routeHandlers/fhirServer.js:~282 (fhirErrorHandler
// checks isValidVersion(base) and 404s rather than re-throwing) to make sure an unrecognized first
// path segment still degrades the same way it always has. Also confirms the exact-path /fhir OAuth
// route (src/app.js) is unaffected by this feature either way.
const supertest = require('supertest');

const { commonBeforeEach, commonAfterEach, getHeaders, createTestApp } = require('../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('fhir/r4 base path alias - disabled (default off)', () => {
    const originalFlag = process.env.ENABLE_FHIR_R4_PATH_ALIAS;

    beforeEach(async () => {
        delete process.env.ENABLE_FHIR_R4_PATH_ALIAS;
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

    test('/fhir/r4/Patient 404s (not 500) when the flag is off', async () => {
        const request = supertest(createTestApp());

        const resp = await request.get('/fhir/r4/Patient').set(getHeaders());

        expect(resp.status).toBe(404);
    });

    test('/fhir?resource=x still 302s to the OAuth login flow when the flag is off', async () => {
        const request = supertest(createTestApp());

        const resp = await request.get('/fhir?resource=x');

        expect(resp.status).toBe(302);
    });

    test('an explicit "0" also leaves the alias disabled', async () => {
        process.env.ENABLE_FHIR_R4_PATH_ALIAS = '0';
        const request = supertest(createTestApp());

        const resp = await request.get('/fhir/r4/Patient').set(getHeaders());

        expect(resp.status).toBe(404);
    });
});
