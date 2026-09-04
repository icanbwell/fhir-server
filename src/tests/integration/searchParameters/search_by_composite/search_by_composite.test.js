// provider file
const observation1Resource = require('./fixtures/observation/observation1.json');
const observation2Resource = require('./fixtures/observation/observation2.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getHeadersWithAdmin,
    getFullAccessToken,
    createTestRequest
} = require('../../common');
const { callMcpTool, bundleFromToolResult, idsInBundle } = require('../../mcp/mcpTestHelpers');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('Composite search parameter tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    async function createBothObservations (request) {
        let resp = await request
            .post('/4_0_0/Observation/1/$merge?validate=true')
            .send(observation1Resource)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/Observation/1/$merge?validate=true')
            .send(observation2Resource)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });
    }

    test('component-code-value-quantity ($elemMatch) narrows by pairing, not independent fields', async () => {
        const request = await createTestRequest();
        await createBothObservations(request);

        const resp = await request
            .get('/4_0_0/Observation?component-code-value-quantity=8480-6$ge140&_bundle=1')
            .set(getHeadersWithAdmin());
        expect(resp.statusCode).toBe(200);
        const ids = (resp.body.entry || []).map((e) => e.resource.id);
        expect(ids).toEqual(['composite-search-obs-1']);
    });

    test('code-value-quantity (root AND) matches on the top-level code+value pair', async () => {
        const request = await createTestRequest();
        await createBothObservations(request);

        // Neither fixture has a top-level valueQuantity, so a root-scope match requires adding
        // one to a third fixture-like payload inline here rather than reusing observation1/2
        // (which are built specifically to exercise the $elemMatch pairing test above).
        const rootObservation = {
            ...observation1Resource,
            id: 'composite-search-obs-root',
            component: undefined,
            valueQuantity: {
                value: 200,
                unit: 'mm[Hg]',
                system: 'http://unitsofmeasure.org',
                code: 'mm[Hg]'
            }
        };
        let resp = await request
            .post('/4_0_0/Observation/1/$merge?validate=true')
            .send(rootObservation)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .get('/4_0_0/Observation?code-value-quantity=55284-4$ge140&_bundle=1')
            .set(getHeadersWithAdmin());
        const ids = (resp.body.entry || []).map((e) => e.resource.id);
        expect(ids).toEqual(['composite-search-obs-root']);
    });

    test('regression: composite param actually filters (old behavior silently returned everything)', async () => {
        const request = await createTestRequest();
        await createBothObservations(request);

        // A value that matches NEITHER observation's component pairing must return zero results.
        // Before this feature, composite params were silently dropped from the query entirely,
        // so this would have returned both observations regardless of the value.
        const resp = await request
            .get('/4_0_0/Observation?component-code-value-quantity=8480-6$ge9999&_bundle=1')
            .set(getHeadersWithAdmin());
        expect(resp.body.entry || []).toHaveLength(0);
    });

    test('MCP search_observation tool applies composite filtering with zero tool-specific code', async () => {
        const request = await createTestRequest();
        await createBothObservations(request);
        const bearerToken = await getFullAccessToken();

        const { rpc } = await callMcpTool(request, bearerToken, 'search_observation', {
            'component-code-value-quantity': '8480-6$ge140'
        });
        const bundle = bundleFromToolResult(rpc);
        expect(idsInBundle(bundle)).toEqual(['composite-search-obs-1']);
    });

    test('rejected modifier on a composite param returns 400, not a silent empty/wrong result', async () => {
        const request = await createTestRequest();
        await createBothObservations(request);

        const resp = await request
            .get('/4_0_0/Observation?component-code-value-quantity:contains=8480-6$ge140&_bundle=1')
            .set(getHeadersWithAdmin());
        expect(resp.statusCode).toBe(400);
    });
});
