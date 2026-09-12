// Proves the rewrite precedes the later-tick GraphQLv2 mount at src/app.js (registered inside
// Promise.all().then(...), which the design doc's ordering analysis says still runs strictly after
// anything registered synchronously in createApp, including normalizeFhirBasePath). The
// /4_0_0/$graphqlv2 route itself is a hardcoded literal path segment, not parameterized by
// :base_version, so this is the one route family that would silently 404 forever on the alias if
// the ordering were ever wrong - a brittle app._router.stack assertion wouldn't catch that.
const supertest = require('supertest');

const {
    commonBeforeEach,
    commonAfterEach,
    getGraphQLHeaders,
    createTestApp
} = require('../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('fhir/r4 base path alias - graphqlv2', () => {
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

    test('/fhir/r4/$graphqlv2 is reachable (normalizes to /4_0_0/$graphqlv2 before route matching)', async () => {
        const request = supertest(createTestApp());

        const resp = await request
            .post('/fhir/r4/$graphqlv2')
            .send({
                operationName: null,
                variables: {},
                // A bare `{ __typename }` query trips a pre-existing, unrelated Apollo Server
                // quirk in this schema ("Cannot create property 'meta' on string 'Query'") on
                // both /4_0_0 and /fhir/r4 - not an alias regression. Query a real root field
                // instead so a routing-ordering failure (this test's actual concern) can't be
                // masked by that unrelated 500.
                query: 'query { patients { entry { resource { resourceType } } } }'
            })
            .set(getGraphQLHeaders());

        // A 404 here would mean normalizeFhirBasePath ran too late relative to the
        // Promise.all().then(...) graphqlv2 mount - the exact ordering risk this test guards.
        expect(resp.status).not.toBe(404);
        expect(resp.body.errors).toBeUndefined();
        expect(resp.body.data.patients).toBeDefined();
    });
});
