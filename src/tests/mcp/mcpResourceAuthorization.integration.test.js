'use strict';

/**
 * Integration tests proving the /mcp endpoint inherits the resource-authorization mechanisms
 * catalogued in docs/resource-authorization.md that are reachable through a read-only search
 * surface. Every mechanism exercised here is already proven correct in isolation by
 * src/tests/unit/resourceAuthorization/ against the real SearchManager/ScopesValidator classes --
 * these tests exist to prove /mcp's OWN wiring (arg parsing, tool schemas, McpToolHandler) reaches
 * that shared code correctly, the same class of regression resource-authorization.md's §12
 * documents once happening for GraphQL (OperationAccessManager.verifyGraphQLReadAccess missing
 * from GraphQL's entry points). See docs/superpowers/plans/2026-08-14-mcp-resource-authorization-test-coverage.md
 * for the full gap analysis, including which mechanisms are deliberately NOT re-tested here.
 */
const { describe, test, expect, beforeEach, afterEach } = require('@jest/globals');
const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getFullAccessToken,
    createTestRequest
} = require('../common');
const {
    callMcpTool,
    bundleFromToolResult,
    idsInBundle,
    minimalSecurity,
    makePatient
} = require('./mcpTestHelpers');

describe('/mcp resource authorization', () => {
    afterEach(async () => {
        await commonAfterEach();
    });

    beforeEach(async () => {
        await commonBeforeEach();
    });

    test('a tenant-scoped token only sees its own tenant\'s resources via /mcp; a wildcard-scoped token sees both (resource-authorization.md §1, §7)', async () => {
        const request = await createTestRequest();
        const tenantAPatientId = 'mcp-sec1-tenantA-patient';
        const tenantBPatientId = 'mcp-sec1-tenantB-patient';

        let resp = await request
            .post(`/4_0_0/Patient/${tenantAPatientId}/$merge?validate=true`)
            .send({
                ...makePatient(tenantAPatientId, { family: 'TenantIsolationFamily', given: 'A', birthDate: '1990-01-01' }),
                meta: { source: 'test', security: minimalSecurity('tenantA') }
            })
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post(`/4_0_0/Patient/${tenantBPatientId}/$merge?validate=true`)
            .send({
                ...makePatient(tenantBPatientId, { family: 'TenantIsolationFamily', given: 'B', birthDate: '1990-01-01' }),
                meta: { source: 'test', security: minimalSecurity('tenantB') }
            })
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        // A plain tenant-scoped token -- NOT access/*.* -- so SecurityTagManager.getSecurityTagsFromScope
        // returns a real, non-empty tag list and the §1 meta.security filter is actually load-bearing
        // (see resource-authorization.md §7 for why access/*.* would instead remove the filter entirely).
        const tenantAToken = getHeaders('user/*.* access/tenantA.*').Authorization.replace(/^Bearer /, '');
        const tenantBToken = getHeaders('user/*.* access/tenantB.*').Authorization.replace(/^Bearer /, '');
        const wildcardToken = getFullAccessToken();

        const { rpc: rpcA } = await callMcpTool(request, tenantAToken, 'search_patient', {
            'family:contains': 'TenantIsolationFamily'
        });
        expect(rpcA.result.isError).toBeUndefined();
        const idsA = idsInBundle(bundleFromToolResult(rpcA));
        expect(idsA).toContain(tenantAPatientId);
        expect(idsA).not.toContain(tenantBPatientId);

        const { rpc: rpcB } = await callMcpTool(request, tenantBToken, 'search_patient', {
            'family:contains': 'TenantIsolationFamily'
        });
        expect(rpcB.result.isError).toBeUndefined();
        const idsB = idsInBundle(bundleFromToolResult(rpcB));
        expect(idsB).toContain(tenantBPatientId);
        expect(idsB).not.toContain(tenantAPatientId);

        // access/*.* removes the meta.security filter entirely (resource-authorization.md §7) --
        // both tenants' resources must be visible to this caller.
        const { rpc: rpcWildcard } = await callMcpTool(request, wildcardToken, 'search_patient', {
            'family:contains': 'TenantIsolationFamily'
        });
        expect(rpcWildcard.result.isError).toBeUndefined();
        const idsWildcard = idsInBundle(bundleFromToolResult(rpcWildcard));
        expect(idsWildcard).toContain(tenantAPatientId);
        expect(idsWildcard).toContain(tenantBPatientId);
    });
});
