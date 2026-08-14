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
const { describe, test, expect, beforeEach, afterEach, jest } = require('@jest/globals');
const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getFullAccessToken,
    createTestRequest,
    getHeadersWithCustomPayload
} = require('../common');
const {
    callMcpTool,
    bundleFromToolResult,
    idsInBundle,
    minimalSecurity,
    makePatient,
    makeObservation,
    makePerson
} = require('./mcpTestHelpers');
const { DatabaseCursor } = require('../../dataLayer/databaseCursor');

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

    test('a delegated actor using /mcp is subject to the same consent gate and sensitivity denylist as REST (resource-authorization.md §6c, §10)', async () => {
        const ENABLE_DELEGATED_ACCESS_DETECTION = process.env.ENABLE_DELEGATED_ACCESS_DETECTION;
        process.env.ENABLE_DELEGATED_ACCESS_DETECTION = 'true';
        // DelegatedAccessRulesManager.fetchConsentResourcesAsync (src/utils/delegatedAccessRulesManager.js)
        // hints the Consent query at the 'consent_of_linked_person' named index (see
        // src/indexes/customIndexes.js) -- that index only exists once the custom-index migration
        // has run against a real deployment; the ephemeral jest MongoMemoryServer never runs it, so
        // the real DatabaseCursor.hint() would throw "hint provided does not correspond to an
        // existing index" the moment the cursor executes, which surfaces as a denial regardless of
        // whether a matching Consent exists. Mock it out, mirroring
        // src/tests/patientScope/search_with_delegated_access/search_with_delegated_access.test.js.
        const cursorHintSpy = jest.spyOn(DatabaseCursor.prototype, 'hint').mockReturnThis();
        try {
            const request = await createTestRequest();
            const grantorPersonId = 'mcp-sec2-grantor-person';
            const grantorPatientId = 'mcp-sec2-grantor-patient';
            const actorRelatedPersonId = 'mcp-sec2-actor-related-person';
            const allowedObservationId = 'mcp-sec2-obs-allowed';
            const deniedObservationId = 'mcp-sec2-obs-denied-mental-health';

            let resp = await request
                .post(`/4_0_0/Person/${grantorPersonId}/$merge?validate=true`)
                .send(makePerson(grantorPersonId, [grantorPatientId]))
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });
            const grantorPersonUuid = resp.body.uuid;

            resp = await request
                .post(`/4_0_0/Patient/${grantorPatientId}/$merge?validate=true`)
                .send(makePatient(grantorPatientId, { family: 'DelegatedFamily', given: 'Grantor', birthDate: '1980-01-01' }))
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post(`/4_0_0/Observation/${allowedObservationId}/$merge?validate=true`)
                .send(makeObservation(allowedObservationId, { patientId: grantorPatientId, system: 'http://loinc.org', code: '1111-1' }))
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            // Tagged with a sensitivity-category the delegated actor's Consent below will deny.
            resp = await request
                .post(`/4_0_0/Observation/${deniedObservationId}/$merge?validate=true`)
                .send({
                    ...makeObservation(deniedObservationId, { patientId: grantorPatientId, system: 'http://loinc.org', code: '2222-2' }),
                    meta: {
                        source: 'test',
                        security: [
                            ...minimalSecurity(),
                            { system: 'https://www.icanbwell.com/sensitivity-category', code: 'MENTAL_HEALTH' }
                        ]
                    }
                })
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            // AuthService.processForDelegatedActor (src/strategies/authService.js) reads jwt_payload.act
            // as an object with `reference` (must start with 'RelatedPerson/') and `sub` fields -- mirrors
            // src/tests/patientScope/search_with_delegated_access/search_with_delegated_access.test.js's
            // delegatedPayload shape.
            const delegatedToken = getHeadersWithCustomPayload({
                scope: 'patient/*.read user/*.* access/*.*',
                username: 'delegated-actor@example.com',
                clientFhirPersonId: grantorPersonUuid,
                clientFhirPatientId: 'clientFhirPatient',
                bwellFhirPersonId: grantorPersonUuid,
                bwellFhirPatientId: 'bwellFhirPatient',
                token_use: 'access',
                act: { reference: `RelatedPerson/${actorRelatedPersonId}`, sub: 'delegated-sub-mcp-sec2' }
            }).Authorization.replace(/^Bearer /, '');

            // No Consent authorizing this actor yet -- DelegatedAccessRulesManager.hasValidConsentAsync
            // (called from inside ScopesValidator.isScopesValidAsync, shared by every entry point) must
            // deny before any query is built.
            const { rpc: deniedRpc } = await callMcpTool(request, delegatedToken, 'search_observation', {
                patient: `Patient/${grantorPatientId}`
            });
            expect(deniedRpc.result.isError).toBe(true);

            // Grantor-to-actor Consent, permit-type, with a deny sub-provision for MENTAL_HEALTH --
            // mirrors fixtures/Consent/consentWithSensitiveCategoriesExcluded.json from
            // search_with_delegated_access.test.js. Wide period bounds so this test isn't coupled to
            // whatever date it happens to run on.
            const consentResource = {
                resourceType: 'Consent',
                id: 'mcp-sec2-consent',
                meta: { source: 'test', security: minimalSecurity() },
                status: 'active',
                category: [{ coding: [{ system: 'http://www.icanbwell.com/consent-category', code: 'dataSharingAccess' }] }],
                extension: [{
                    url: 'https://www.icanbwell.com/fhir/extension/grantee-reference',
                    valueReference: { reference: `RelatedPerson/${actorRelatedPersonId}`, display: 'Data sharing relationship grantee' }
                }],
                scope: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/consentscope', code: 'patient-privacy' }] },
                patient: { reference: `Patient/person.${grantorPersonUuid}`, display: 'Data sharing relationship grantor' },
                provision: {
                    type: 'permit',
                    period: { start: '2020-01-01T00:00:00.000Z', end: '2030-01-01T00:00:00.000Z' },
                    actor: [{
                        role: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-ParticipationType', code: 'IRCP' }] },
                        reference: { reference: `RelatedPerson/${actorRelatedPersonId}`, display: 'Data sharing relationship grantee' }
                    }],
                    action: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/consentaction', code: 'access' }] }],
                    class: [{ system: 'http://hl7.org/fhir/resource-types', code: 'Observation' }],
                    provision: [
                        { type: 'deny', securityLabel: [{ system: 'https://www.icanbwell.com/sensitivity-category', code: 'MENTAL_HEALTH' }] }
                    ]
                }
            };
            resp = await request
                .post('/4_0_0/Consent/mcp-sec2-consent/$merge?validate=true')
                .send(consentResource)
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            const { rpc } = await callMcpTool(request, delegatedToken, 'search_observation', {
                patient: `Patient/${grantorPatientId}`
            });
            expect(rpc.result.isError).toBeUndefined();
            const ids = idsInBundle(bundleFromToolResult(rpc));
            expect(ids).toContain(allowedObservationId);
            expect(ids).not.toContain(deniedObservationId);
        } finally {
            cursorHintSpy.mockRestore();
            process.env.ENABLE_DELEGATED_ACCESS_DETECTION = ENABLE_DELEGATED_ACCESS_DETECTION;
        }
    });
});
