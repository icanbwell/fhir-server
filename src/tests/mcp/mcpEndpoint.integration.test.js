'use strict';

/**
 * Integration tests for the /mcp endpoint (Task 10 of the MCP endpoint plan).
 *
 * These exercise the real, wired-up /mcp route (src/app.js, gated by configManager.enableMcp --
 * enabled in tests via jest/setEnvVars.js's ENABLE_MCP=1), the real McpServer route handler
 * (src/routeHandlers/mcpServer.js), and the real McpToolHandler (src/mcp/mcpToolHandler.js)
 * bridging into SearchBundleOperation/R4ArgsParser -- the same data-access code REST and GraphQL
 * use. No direct Mongo access and no mocked tool handler: everything here goes through the app's
 * real create/merge endpoint and the real /mcp HTTP route, mirroring this repo's existing
 * REST/GraphQL integration test patterns (see e.g. src/tests/patient/search_by_id,
 * src/tests/graphqlv2/observation, src/tests/everything/person_or_patient_audit).
 *
 * Wire format: confirmed against the real @modelcontextprotocol SDK via a throwaway spike test
 * (src/tests/mcp/_spike.test.js) rather than assumed -- /mcp responds over SSE
 * ("event: message\ndata: {...}\n\n"), NOT a plain JSON body, whenever authentication/tool
 * dispatch succeeds. Auth/authorization failures (401/403) short-circuit before the MCP SDK
 * handler runs and are plain JSON OperationOutcomes, same as REST/GraphQL.
 */
const { describe, test, expect, beforeEach, afterEach, jest: jestGlobal } = require('@jest/globals');
const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getFullAccessToken,
    getHeadersWithCustomPayload,
    createTestRequest,
    getTestContainer,
    mockHttpContext
} = require('../common');
const { AUTH_USER_TYPES } = require('../../constants');
const { AuditLogger } = require('../../utils/auditLogger');

/**
 * Extracts the JSON-RPC envelope out of an MCP SSE response body
 * (`event: message\ndata: {...}\n\n`). supertest does not parse SSE into `resp.body`, so the
 * envelope must be pulled out of `resp.text` by hand.
 * @param {import('supertest').Response} resp
 * @returns {{jsonrpc: string, id: number, result?: Object, error?: Object}}
 */
function parseMcpRpcResponse (resp) {
    const match = resp.text && resp.text.match(/^data: (.+)$/m);
    if (!match) {
        throw new Error(
            `Expected an SSE 'data:' line in the /mcp response but found none. status=${resp.status} text=${resp.text}`
        );
    }
    return JSON.parse(match[1]);
}

/**
 * Issues a JSON-RPC tools/call request against /mcp and returns both the raw supertest response
 * and the parsed JSON-RPC envelope.
 * @param {import('supertest').Test} request
 * @param {string} bearerToken
 * @param {string} name
 * @param {Object} [args]
 * @returns {Promise<{resp: import('supertest').Response, rpc: Object}>}
 */
async function callMcpTool (request, bearerToken, name, args) {
    const resp = await request
        .post('/mcp')
        .set({
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            Authorization: `Bearer ${bearerToken}`
        })
        .send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args || {} } });
    return { resp, rpc: parseMcpRpcResponse(resp) };
}

/**
 * Parses the FHIR Bundle a tool call result carries as JSON text in content[0].text.
 * @param {Object} rpc parsed JSON-RPC envelope from parseMcpRpcResponse
 * @returns {Object} FHIR Bundle
 */
function bundleFromToolResult (rpc) {
    return JSON.parse(rpc.result.content[0].text);
}

/**
 * @param {Object} bundle FHIR searchset Bundle
 * @returns {string[]} ids of every resource in the bundle
 */
function idsInBundle (bundle) {
    return (bundle.entry || []).map((e) => e.resource.id);
}

function minimalSecurity (owner = 'client') {
    return [
        { system: 'https://www.icanbwell.com/access', code: owner },
        { system: 'https://www.icanbwell.com/owner', code: owner }
    ];
}

function makePatient (id, { family, given, birthDate }) {
    return {
        resourceType: 'Patient',
        id,
        meta: { source: 'test', security: minimalSecurity() },
        name: [{ use: 'official', family, given: [given] }],
        birthDate,
        gender: 'unknown'
    };
}

function makeLocation (id, name) {
    return {
        resourceType: 'Location',
        id,
        meta: { source: 'test', security: minimalSecurity() },
        status: 'active',
        name
    };
}

function makeObservation (id, { patientId, system, code }) {
    return {
        resourceType: 'Observation',
        id,
        meta: { source: 'test', security: minimalSecurity() },
        status: 'final',
        code: { coding: [{ system, code, display: 'Test code' }] },
        subject: { reference: `Patient/${patientId}` }
    };
}

function makePerson (id, linkedPatientIds) {
    return {
        resourceType: 'Person',
        id,
        meta: { source: 'test', security: minimalSecurity() },
        active: true,
        link: linkedPatientIds.map((patientId) => ({ target: { reference: `Patient/${patientId}` } }))
    };
}

/**
 * A patient-scoped JWT payload whose clientFhirPersonId/bwellFhirPersonId is the given
 * personId. Full user/access grants are included alongside the patient scope so that scope
 * *narrowing* (not an outright access denial) is what's under test -- mirrors
 * src/tests/graphqlv2/observation/observation.test.js's getGraphQLHeadersWithPerson usage and
 * src/tests/patientScope/search_with_clientfhirpersonid's jwt_payload shape.
 */
function patientScopedToken (personId, overrides = {}) {
    return getHeadersWithCustomPayload({
        scope: 'patient/*.read user/*.* access/*.*',
        username: `${personId}@example.com`,
        clientFhirPersonId: personId,
        clientFhirPatientId: 'clientFhirPatient',
        bwellFhirPersonId: personId,
        bwellFhirPatientId: 'bwellFhirPatient',
        token_use: 'access',
        ...overrides
    }).Authorization.replace(/^Bearer /, '');
}

/**
 * createTestRequest's fnUpdateContainer callback only has an effect on the *first* call to
 * createTestRequest in a given test file: src/tests/common.js caches the built app in a
 * module-level `app` variable and only rebuilds it while that variable is still falsy, so any
 * override supplied on a later call is silently ignored for the rest of the file. Every test in
 * this file must therefore pass this same override so it is guaranteed to be in effect no matter
 * which test happens to run (and call createTestRequest) first.
 *
 * Swaps in the real AuditLogger for createTestContainer's default 'auditLogger' registration
 * (MockAuditLogger, src/tests/mocks/mockAuditLogger.js), whose logAuditEntryAsync is a deliberate
 * no-op -- needed so every other integration test in this repo doesn't pay for real audit-log
 * writes. This file's audit-log test needs the real thing; mirrors
 * src/tests/internalAuditLogs/auditLogIsCreated/auditLogIsCreated.test.js's own override.
 * @param {SimpleContainer} container
 * @returns {SimpleContainer}
 */
function registerRealAuditLogger (container) {
    container.register(
        'auditLogger',
        (c) =>
            new AuditLogger({
                postRequestProcessor: c.postRequestProcessor,
                databaseBulkInserter: c.fastDatabaseBulkInserter,
                preSaveManager: c.preSaveManager,
                configManager: c.configManager
            })
    );
    return container;
}

describe('/mcp endpoint', () => {
    afterEach(async () => {
        // mockHttpContext() (used by the audit-log test below) replaces httpContext.get/set with
        // jest spies for the duration of a test. Restoring here -- rather than trusting each test
        // to clean up after itself -- guarantees no mocked httpContext state can leak into the
        // concurrency test, which must run against the real per-request express-http-context
        // store to be a meaningful regression test.
        jestGlobal.restoreAllMocks();
        await commonAfterEach();
    });

    beforeEach(async () => {
        await commonBeforeEach();
    });

    test('search_patient tool returns the same Patient a REST search would return', async () => {
        const request = await createTestRequest(registerRealAuditLogger);
        const patientId = 'mcp-t1-patient';

        let resp = await request
            .post(`/4_0_0/Patient/${patientId}/$merge?validate=true`)
            .send(makePatient(patientId, { family: 'McpSearchTest', given: 'Alpha', birthDate: '1990-01-01' }))
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        const { rpc } = await callMcpTool(request, getFullAccessToken(), 'search_patient', {
            name: 'McpSearchTest'
        });

        expect(rpc.result.isError).toBeUndefined();
        const bundle = bundleFromToolResult(rpc);
        expect(bundle.resourceType).toBe('Bundle');
        expect(idsInBundle(bundle)).toContain(patientId);
    });

    test('fhir_search tool works for a resource type with no dedicated tool (e.g. Location)', async () => {
        // Location has no dedicated search_<resource> tool (see src/mcp/tools/index.js's
        // mcpToolsByResourceType) -- this proves the generic fhir_search plumbing itself works,
        // not just the code-generated dedicated tools.
        const request = await createTestRequest(registerRealAuditLogger);
        const locationId = 'mcp-t2-location';

        let resp = await request
            .post(`/4_0_0/Location/${locationId}/$merge?validate=true`)
            .send(makeLocation(locationId, 'Mcp Generic Tool Test Location'))
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        const { rpc } = await callMcpTool(request, getFullAccessToken(), 'fhir_search', {
            resourceType: 'Location',
            filters: { name: 'Mcp Generic Tool Test Location' }
        });

        expect(rpc.result.isError).toBeUndefined();
        const bundle = bundleFromToolResult(rpc);
        expect(idsInBundle(bundle)).toContain(locationId);
    });

    test('search_patient supports a date-comparator value combined with a string modifier key (design doc §8.3)', async () => {
        const request = await createTestRequest(registerRealAuditLogger);
        const inRangeId = 'mcp-t3-patient-in-range';
        const outOfRangeId = 'mcp-t3-patient-out-of-range';
        const inRangeOtherFamilyId = 'mcp-t3-patient-in-range-other-family';

        let resp = await request
            .post(`/4_0_0/Patient/${inRangeId}/$merge?validate=true`)
            .send(makePatient(inRangeId, { family: 'ComboSyntaxFamily', given: 'InRange', birthDate: '2016-06-01' }))
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post(`/4_0_0/Patient/${outOfRangeId}/$merge?validate=true`)
            .send(makePatient(outOfRangeId, { family: 'ComboSyntaxFamily', given: 'OutOfRange', birthDate: '2010-06-01' }))
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        // Same birthdate range as inRangeId, but a DIFFERENT family name -- makes the
        // 'family:contains' filter load-bearing. Without this third Patient, the 'birthdate'
        // filter alone would already produce the same pass/fail split as the assertions below, so
        // a regression that silently dropped 'family:contains' entirely (e.g. removing
        // .passthrough() from patient.tool.js, which makes zod strip unknown keys rather than
        // error) would not have been caught.
        resp = await request
            .post(`/4_0_0/Patient/${inRangeOtherFamilyId}/$merge?validate=true`)
            .send(makePatient(inRangeOtherFamilyId, { family: 'UnrelatedFamily', given: 'InRangeOtherFamily', birthDate: '2016-06-01' }))
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        // All three patients could satisfy one filter or the other individually; only inRangeId
        // satisfies BOTH the 'ge' date-comparator prefix on birthdate AND the ':contains' string
        // filter. Uses 'family' rather than 'name' here: 'name' is a composite HumanName search
        // parameter whose ':contains' handling (src/operations/query/filters/contains.js's generic
        // non-token branch, which regexes against the raw field path) is a pre-existing bug
        // unrelated to /mcp -- it regexes against the top-level 'name' array-of-objects field
        // directly instead of the family/given/text sub-paths FilterByString's nameQueryBuilder
        // uses for the unmodified 'name' parameter, so 'name:contains' always matches zero
        // documents regardless of data. 'family:contains' exercises the exact same
        // date-comparator + string-modifier combination this test is a regression test for,
        // without tripping over that separate, pre-existing bug.
        const { rpc } = await callMcpTool(request, getFullAccessToken(), 'search_patient', {
            birthdate: 'ge2015-01-01',
            'family:contains': 'ComboSyntaxFamily'
        });

        expect(rpc.result.isError).toBeUndefined();
        const ids = idsInBundle(bundleFromToolResult(rpc));
        expect(ids).toContain(inRangeId);
        expect(ids).not.toContain(outOfRangeId);
        expect(ids).not.toContain(inRangeOtherFamilyId);
    });

    test('search_observation supports token (system|code) and reference (ResourceType/id) filter values (design doc §8.4)', async () => {
        const request = await createTestRequest(registerRealAuditLogger);
        const patientId = 'mcp-t4-patient';
        const otherPatientId = 'mcp-t4-other-patient';
        const observationId = 'mcp-t4-observation';
        const otherObservationId = 'mcp-t4-other-observation';
        const loincSystem = 'http://loinc.org';
        const loincCode = '55284-4';

        let resp = await request
            .post(`/4_0_0/Patient/${patientId}/$merge?validate=true`)
            .send(makePatient(patientId, { family: 'TokenRefFamily', given: 'Test', birthDate: '1980-01-01' }))
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        // A second Patient purely so the distractor Observation below can have a genuinely
        // different subject -- the 'patient' reference filter can only be proven load-bearing
        // against a distractor that shares the *code* but not the *patient*.
        resp = await request
            .post(`/4_0_0/Patient/${otherPatientId}/$merge?validate=true`)
            .send(makePatient(otherPatientId, { family: 'TokenRefOtherFamily', given: 'Other', birthDate: '1980-01-01' }))
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post(`/4_0_0/Observation/${observationId}/$merge?validate=true`)
            .send(makeObservation(observationId, { patientId, system: loincSystem, code: loincCode }))
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        // A distractor Observation with the SAME code but a DIFFERENT subject, so the 'patient'
        // reference filter in the tool call below is actually load-bearing: an implementation that
        // silently ignored 'patient' and matched on 'code' alone would still incorrectly include
        // this Observation, and this assertion would catch that.
        resp = await request
            .post(`/4_0_0/Observation/${otherObservationId}/$merge?validate=true`)
            .send(makeObservation(otherObservationId, { patientId: otherPatientId, system: loincSystem, code: loincCode }))
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        const { rpc } = await callMcpTool(request, getFullAccessToken(), 'search_observation', {
            code: `${loincSystem}|${loincCode}`,
            patient: `Patient/${patientId}`
        });

        expect(rpc.result.isError).toBeUndefined();
        const ids = idsInBundle(bundleFromToolResult(rpc));
        expect(ids).toContain(observationId);
        expect(ids).not.toContain(otherObservationId);
    });

    test('fhir_search rejects a resourceType that has a dedicated tool', async () => {
        const request = await createTestRequest(registerRealAuditLogger);

        const { rpc } = await callMcpTool(request, getFullAccessToken(), 'fhir_search', {
            resourceType: 'Patient'
        });

        expect(rpc.result.isError).toBe(true);
        expect(rpc.result.content[0].text).toMatch(/search_patient/);
    });

    test('a patient-scoped token only sees data in scope, matching REST/GraphQL behavior', async () => {
        const request = await createTestRequest(registerRealAuditLogger);
        const personId = 'mcp-t6-person';
        const inScopePatientId = 'mcp-t6-patient-in-scope';
        const outOfScopePatientId = 'mcp-t6-patient-out-of-scope';

        let resp = await request
            .post(`/4_0_0/Person/${personId}/$merge?validate=true`)
            .send(makePerson(personId, [inScopePatientId]))
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post(`/4_0_0/Patient/${inScopePatientId}/$merge?validate=true`)
            .send(makePatient(inScopePatientId, { family: 'ScopeIsolationFamily', given: 'InScope', birthDate: '1975-01-01' }))
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post(`/4_0_0/Patient/${outOfScopePatientId}/$merge?validate=true`)
            .send(makePatient(outOfScopePatientId, { family: 'ScopeIsolationFamily', given: 'OutOfScope', birthDate: '1975-01-01' }))
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        // 'family' rather than 'name' -- see the comment on the date-comparator/modifier-combo test
        // above for why 'name:contains' always returns zero results regardless of data.
        const { rpc } = await callMcpTool(request, patientScopedToken(personId), 'search_patient', {
            'family:contains': 'ScopeIsolationFamily'
        });

        expect(rpc.result.isError).toBeUndefined();
        const ids = idsInBundle(bundleFromToolResult(rpc));
        expect(ids).toContain(inScopePatientId);
        expect(ids).not.toContain(outOfScopePatientId);
    });

    test('a CMS-partner-user token is blocked from /mcp entirely, matching GraphQL behavior', async () => {
        const request = await createTestRequest(registerRealAuditLogger);

        // A patient-scoped token (isUser must be true for AuthService to honor the user_type
        // claim at all -- see src/strategies/authService.js) carrying user_type: 'cms-partner'.
        // forbidForUserTypes([AUTH_USER_TYPES.cmsPartnerUser]) (src/app.js) must reject this
        // before any tool handler runs -- there is no data to seed for this test because a real
        // McpToolHandler call should never happen.
        const cmsPartnerToken = getHeadersWithCustomPayload({
            scope: 'patient/*.read user/*.* access/*.*',
            username: 'cms-partner@example.com',
            clientFhirPersonId: 'mcp-t7-cms-person',
            clientFhirPatientId: 'clientFhirPatient',
            bwellFhirPersonId: 'mcp-t7-cms-person',
            bwellFhirPatientId: 'bwellFhirPatient',
            user_type: AUTH_USER_TYPES.cmsPartnerUser,
            token_use: 'access'
        }).Authorization.replace(/^Bearer /, '');

        const resp = await request
            .post('/mcp')
            .set({
                'Content-Type': 'application/json',
                Accept: 'application/json, text/event-stream',
                Authorization: `Bearer ${cmsPartnerToken}`
            })
            .send({
                jsonrpc: '2.0',
                id: 1,
                method: 'tools/call',
                params: { name: 'search_patient', arguments: {} }
            });

        // forbidForUserTypes runs before express.json()/the MCP SDK handler in the /mcp router
        // (src/app.js), so this is a plain JSON 403 OperationOutcome, not an SSE tool response.
        expect(resp.status).toBe(403);
        expect(resp.body.resourceType).toBe('OperationOutcome');
    });

    test('a patient-scoped caller does not see a resource hidden via data-connection-view-control consent', async () => {
        const CLIENTS_WITH_DATA_CONNECTION_VIEW_CONTROL = process.env.CLIENTS_WITH_DATA_CONNECTION_VIEW_CONTROL;
        process.env.CLIENTS_WITH_DATA_CONNECTION_VIEW_CONTROL = 'client';
        try {
            const request = await createTestRequest(registerRealAuditLogger);
            const personId = 'mcp-t8-person';
            const patientId = 'mcp-t8-patient';
            const visibleObservationId = 'mcp-t8-obs-visible';
            const hiddenObservationId = 'mcp-t8-obs-hidden';

            let resp = await request
                .post(`/4_0_0/Person/${personId}/$merge?validate=true`)
                .send(makePerson(personId, [patientId]))
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post(`/4_0_0/Patient/${patientId}/$merge?validate=true`)
                .send(makePatient(patientId, { family: 'ConsentFamily', given: 'Test', birthDate: '1985-01-01' }))
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post(`/4_0_0/Observation/${visibleObservationId}/$merge?validate=true`)
                .send(makeObservation(visibleObservationId, { patientId, system: 'http://loinc.org', code: '1111-1' }))
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post(`/4_0_0/Observation/${hiddenObservationId}/$merge?validate=true`)
                .send(makeObservation(hiddenObservationId, { patientId, system: 'http://loinc.org', code: '2222-2' }))
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            // A data-connection-view-control Consent hiding the "hidden" Observation from this
            // person, mirroring src/tests/graphqlv2/observation/observation.test.js's
            // "GraphQL id equals and not equals test with patient data view control" and the
            // exact reference format PatientDataViewControlManager.getConsentAsync
            // (src/utils/patientDataViewController.js) expects: `Patient/person.<personId>`.
            const consentResource = {
                resourceType: 'Consent',
                id: 'mcp-t8-consent',
                meta: { source: 'test', security: minimalSecurity() },
                status: 'active',
                scope: {
                    coding: [{ system: 'http://terminology.hl7.org/CodeSystem/consentscope', code: 'patient-privacy' }]
                },
                category: [
                    { coding: [{ system: 'http://www.icanbwell.com/consent-category', code: 'dataConnectionViewControl' }] }
                ],
                patient: { reference: `Patient/person.${personId}` },
                // 'meaning' is required by the Consent schema on every provision.data entry (FHIR
                // R4 Consent.provision.data.meaning is 1..1) -- mirrors
                // src/tests/graphqlv2/observation/fixtures/consent/consent1.json.
                provision: { data: [{ meaning: 'instance', reference: { reference: `Observation/${hiddenObservationId}` } }] }
            };
            resp = await request
                .post('/4_0_0/Consent/mcp-t8-consent/$merge?validate=true')
                .send(consentResource)
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            const { rpc } = await callMcpTool(request, patientScopedToken(personId), 'search_observation', {
                patient: `Patient/${patientId}`
            });

            expect(rpc.result.isError).toBeUndefined();
            const ids = idsInBundle(bundleFromToolResult(rpc));
            expect(ids).toContain(visibleObservationId);
            expect(ids).not.toContain(hiddenObservationId);
        } finally {
            process.env.CLIENTS_WITH_DATA_CONNECTION_VIEW_CONTROL = CLIENTS_WITH_DATA_CONNECTION_VIEW_CONTROL;
        }
    });

    test('a PHI read via /mcp is written to the audit log the same way REST/GraphQL reads are', async () => {
        const requestId = mockHttpContext();
        // This is the test registerRealAuditLogger exists for: proving a real audit entry actually
        // gets persisted (createTestContainer's default MockAuditLogger's logAuditEntryAsync is a
        // deliberate no-op). Every test in this file passes the same override -- see
        // registerRealAuditLogger's doc comment for why it can't just be applied here alone.
        const request = await createTestRequest(registerRealAuditLogger);
        const container = getTestContainer();
        /** @type {PostRequestProcessor} */
        const postRequestProcessor = container.postRequestProcessor;
        /** @type {import('../../utils/auditLogger').AuditLogger} */
        const auditLogger = container.auditLogger;
        /** @type {MongoDatabaseManager} */
        const mongoDatabaseManager = container.mongoDatabaseManager;
        const auditEventDb = await mongoDatabaseManager.getAuditDbAsync();
        const auditEventCollection = auditEventDb.collection('AuditEvent_4_0_0');

        /**
         * SearchBundleOperation queues its audit-log write as a task on postRequestProcessor whose
         * body itself just fires a bare (un-awaited) setImmediate() to do the actual
         * auditLogger.logAuditEntryAsync() call (src/operations/search/searchBundle.js, deliberately
         * deferred "to prevent logging audit entry in MicroTask just after graphql request"). That
         * setImmediate only pushes onto AuditLogger's own in-memory queue -- flushAsync() is what
         * actually persists it to Mongo (mirrors production's cron-based flush in
         * cronTasksProcessor.js, not the per-request mcpRequestCleanup middleware). Deliberately
         * does NOT call postRequestProcessor.waitTillDoneAsync() here: read
         * PostRequestProcessor.waitTillDoneAsync (src/utils/postRequestProcessor.js) -- if no
         * execution is already running for the given requestId it calls executeAsync() itself,
         * which would drain the very postRequestProcessor queue that mcpRequestCleanup is
         * responsible for draining, making this helper self-heal a missing mcpRequestCleanup and
         * defeating the regression test below. This helper only polls the *persisted* AuditEvent
         * count, waiting out the setImmediate's incidental event-loop delay with a real timer tick.
         * @returns {Promise<number>}
         */
        async function waitForAuditFlushAsync () {
            for (let attempt = 0; attempt < 20; attempt++) {
                await auditLogger.flushAsync();
                const count = await auditEventCollection.countDocuments();
                if (count > 0) {
                    return count;
                }
                await new Promise((resolve) => setTimeout(resolve, 50));
            }
            return auditEventCollection.countDocuments();
        }

        const patientId = 'mcp-t9-patient';
        let resp = await request
            .post(`/4_0_0/Patient/${patientId}/$merge?validate=true`)
            .send(makePatient(patientId, { family: 'AuditLogFamily', given: 'Test', birthDate: '1995-01-01' }))
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });
        // AuditEvent.entity[].what.reference is keyed by the resource's internal bwell uuid
        // (e.g. 'Patient/02fa3e02-...'), not by the literal sourceId used in the merge URL --
        // mirrors src/tests/internalAuditLogs/auditLogIsCreated/fixtures/expected/expected_audit_events_1.json.
        const patientUuid = resp.body.uuid;
        expect(patientUuid).toEqual(expect.any(String));

        // Drain the SETUP merge's own audit-queue task before clearing the collection, so only the
        // /mcp read's audit entry is left to inspect below. This is a REST request, not the /mcp
        // response under test -- REST has its own equivalent post-response cleanup (independent of
        // mcpRequestCleanup), so calling waitTillDoneAsync here is ordinary test bookkeeping, not a
        // stand-in for the thing being regression-tested (see waitForAuditFlushAsync's doc comment
        // for why that call is deliberately avoided for the /mcp response itself, below).
        await postRequestProcessor.waitTillDoneAsync({ requestId });
        await waitForAuditFlushAsync();
        await auditEventCollection.deleteMany({});

        const { rpc } = await callMcpTool(request, getFullAccessToken(), 'search_patient', {
            name: 'AuditLogFamily'
        });
        expect(rpc.result.isError).toBeUndefined();
        expect(idsInBundle(bundleFromToolResult(rpc))).toContain(patientId);

        // Positive proof that Task 9's mcpRequestCleanup middleware (src/app.js) actually ran and
        // drained postRequestProcessor's queue for this exact request -- checked BEFORE calling
        // auditLogger.flushAsync() below, and without ever calling
        // postRequestProcessor.waitTillDoneAsync() ourselves (see waitForAuditFlushAsync's doc
        // comment for why that would self-heal a missing mcpRequestCleanup). SearchBundleOperation
        // queues exactly one task per non-empty, non-AuditEvent read; nothing else drains the
        // /mcp route's queue for this requestId (unlike REST, which has its own equivalent
        // cleanup for REST requests only). If mcpRequestCleanup were removed from app.js, this
        // queue would still contain that task here, and this assertion would fail.
        expect(postRequestProcessor.getQueue({ requestId }).length).toBe(0);

        // The audit entry itself is written to AuditLogger's queue via a setImmediate inside the
        // task mcpRequestCleanup just drained (see waitForAuditFlushAsync's doc comment) and only
        // reaches Mongo once flushed -- poll for it rather than asserting after a single flush.
        const auditLogCount = await waitForAuditFlushAsync();
        expect(auditLogCount).toBeGreaterThan(0);

        const auditLogs = await auditEventCollection.find({}).toArray();
        const allReferences = auditLogs.flatMap(
            (log) => (log.entity || []).map((entity) => entity.what && entity.what.reference)
        );
        expect(allReferences.some((ref) => ref && ref.includes(patientUuid))).toBe(true);
        // Also confirm the audit entry is attributable to the /mcp route specifically (not some
        // other read path that happened to touch the same patient).
        const allRequestUrls = auditLogs.flatMap(
            (log) => (log.entity || []).flatMap(
                (entity) => (entity.detail || []).filter((d) => d.type === 'requestUrl').map((d) => d.valueString)
            )
        );
        expect(allRequestUrls).toContain('/mcp');
    });

    test('two concurrent /mcp requests from different scoped tokens never cross-see each other\'s FhirRequestInfo', async () => {
        const request = await createTestRequest(registerRealAuditLogger);
        const personAId = 'mcp-t10-person-a';
        const personBId = 'mcp-t10-person-b';
        const patientAId = 'mcp-t10-patient-a';
        const patientBId = 'mcp-t10-patient-b';

        let resp = await request
            .post(`/4_0_0/Person/${personAId}/$merge?validate=true`)
            .send(makePerson(personAId, [patientAId]))
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post(`/4_0_0/Person/${personBId}/$merge?validate=true`)
            .send(makePerson(personBId, [patientBId]))
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post(`/4_0_0/Patient/${patientAId}/$merge?validate=true`)
            .send(makePatient(patientAId, { family: 'ConcurrencyFamily', given: 'CallerA', birthDate: '1970-01-01' }))
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post(`/4_0_0/Patient/${patientBId}/$merge?validate=true`)
            .send(makePatient(patientBId, { family: 'ConcurrencyFamily', given: 'CallerB', birthDate: '1970-01-01' }))
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        const tokenA = patientScopedToken(personAId);
        const tokenB = patientScopedToken(personBId);

        // Fired concurrently (not awaited sequentially) so any request-scoped state leaking
        // through the process-wide McpToolHandler singleton or the httpContext-based
        // FhirRequestInfo bridge (Task 9) would show up as caller A seeing caller B's data or
        // vice versa. review.md Section D's exact concern.
        // 'family' rather than 'name' -- see the comment on the date-comparator/modifier-combo test
        // above for why 'name:contains' always returns zero results regardless of data.
        const [{ rpc: rpcA }, { rpc: rpcB }] = await Promise.all([
            callMcpTool(request, tokenA, 'search_patient', { 'family:contains': 'ConcurrencyFamily' }),
            callMcpTool(request, tokenB, 'search_patient', { 'family:contains': 'ConcurrencyFamily' })
        ]);

        expect(rpcA.result.isError).toBeUndefined();
        expect(rpcB.result.isError).toBeUndefined();
        const idsA = idsInBundle(bundleFromToolResult(rpcA));
        const idsB = idsInBundle(bundleFromToolResult(rpcB));

        expect(idsA).toContain(patientAId);
        expect(idsA).not.toContain(patientBId);
        expect(idsB).toContain(patientBId);
        expect(idsB).not.toContain(patientAId);
    });

    test('an unauthenticated request to /mcp is rejected the same way /4_0_0/$graphqlv2 is', async () => {
        const request = await createTestRequest(registerRealAuditLogger);

        const resp = await request
            .post('/mcp')
            .set({
                'Content-Type': 'application/json',
                Accept: 'application/json, text/event-stream'
            })
            .send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'search_patient', arguments: {} } });

        // Matches authenticateWithJsonFailure's sendUnauthorizedJson -- a plain JSON
        // OperationOutcome, the same shape REST/GraphQL return for a missing/invalid token.
        expect(resp.status).toBe(401);
        expect(resp.body).toEqual({
            resourceType: 'OperationOutcome',
            issue: [{ severity: 'error', code: 'security', diagnostics: 'Authentication failed' }]
        });
    });
});
