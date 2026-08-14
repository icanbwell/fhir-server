# MCP Resource-Authorization Test Coverage Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the gap between what `docs/resource-authorization.md` documents as required security behavior and what is actually exercised end-to-end through the `/mcp` endpoint, adding only the tests that cover ground no existing test (REST, GraphQL, or the shared-code unit tests in `src/tests/unit/resourceAuthorization/`) already proves.

**Architecture:** `/mcp` (`src/mcp/mcpToolHandler.js`) calls the exact same `SearchBundleOperation.searchBundleAsync` → `SearchManager.constructQueryAsync` chain that REST and GraphQL use, so almost every mechanism in `resource-authorization.md` is enforced once, in shared code, regardless of caller. The few mechanisms that live in *caller-specific* code (REST's `fhirOperationsManager.js`, GraphQL's `dataSource.js`/`graphqlv2/dataSource.js`, MCP's own `mcpToolHandler.js` and `src/app.js` router middleware) are the only places a new entry point can silently diverge — this is exactly the failure shape `resource-authorization.md` §12 documents happening once already for GraphQL (`OperationAccessManager.verifyGraphQLReadAccess` missing from GraphQL's root resolvers and DataLoader batch path). This plan adds targeted integration tests through the real `/mcp` HTTP route for every mechanism that (a) is reachable through MCP's read-only search surface and (b) is not yet exercised end-to-end through `/mcp` by an existing test, plus one regression tripwire for a caller-specific gate that is currently absent from MCP but moot only because MCP has no write tools today.

**Tech Stack:** Jest, supertest (via `src/tests/common.js`'s `createTestRequest`), MongoDB Memory Server, the existing `src/tests/mcp/mcpTestHelpers.js` fixture/SSE-parsing helpers.

**Spec:** `docs/resource-authorization.md` (security mechanism catalog, §1–§12) and `docs/mcp-endpoint.md` (MCP endpoint architecture and existing test inventory) — both at repo root's `docs/`.

## Global Constraints

- Per `CLAUDE.md`'s security-sensitive-changes rule, this plan touches resource search/read — every task's diff must be checked against `review.md` before being considered done (Task 8 does this explicitly for the whole plan).
- Test file naming/location follows this repo's existing convention: full-stack `/mcp` integration tests live in `src/tests/mcp/*.integration.test.js` (see `mcpEndpoint.integration.test.js`); this plan adds a sibling file rather than growing that 763-line file further, mirroring how `src/tests/unit/resourceAuthorization/` splits one file per numbered section of `resource-authorization.md`.
- Every new full-stack test must use the real, un-mocked `SearchBundleOperation`/`SearchManager`/`McpToolHandler` wiring (via `createTestRequest`), not a mocked tool handler — matching every existing file under `src/tests/mcp/`.
- Run tests with `nvm use && node node_modules/.bin/jest <path>` per `CLAUDE.md`; do not run the full suite for every task, only the file(s) touched.
- No production code changes are anticipated by this plan. If any new test in Tasks 2–6 unexpectedly **fails**, stop immediately — do not "fix" the test to make it pass. A failure here means a real security gap in production code, not a test bug, and must be reported/escalated before continuing (see each task's step 2).

---

## Why these tasks and not others (gap analysis)

Read this before starting — it's the reasoning that determined which sections of `resource-authorization.md` get a new test and which are deliberately skipped, verified directly against the current state of `src/operations/search/searchManager.js` and `src/operations/search/searchBundle.js` (not assumed from the docs, which have at least one confirmed stale spot — see the PROA note below).

**Confirmed already covered end-to-end through `/mcp` — no new test needed:**
- §4 CMS-partner allowlist — `mcpEndpoint.integration.test.js:321` ("a CMS-partner-user token is blocked from /mcp entirely").
- §5 patient-scope + `Person.link` expansion (single hop) — `mcpEndpoint.integration.test.js:285` already links a Person to a Patient and proves scope isolation through that link.
- §6d patient-data-view-control consent — `mcpEndpoint.integration.test.js:360` and `:436` (enrolled and not-enrolled cases).
- Query rewriters (proxy-patient, `id|sourceAssigningAuthority`) — `mcpEndpoint.integration.test.js:516`.
- Audit-log flush, per-request isolation, unauthenticated rejection — `mcpEndpoint.integration.test.js:582,688,744`.

**Confirmed inherited from shared code (proven correct in isolation by `src/tests/unit/resourceAuthorization/`) but never exercised through the actual `/mcp` route by any test — this plan adds that missing end-to-end proof:**
- §1 access tags / §7 admin-wildcard bypass — Task 2.
- §6c/§10 delegated-actor consent gate + sensitivity-category denylist — Task 3.
- §8 hidden-tag default exclusion — Task 4.
- §9 confidentiality-`R` tag exclusion for patient-scoped callers — Task 5.
- §3 `AuditEvent` required-filters gate — Task 6.

**Confirmed inapplicable to MCP — no test added, and why:**
- **§6a PROA/IAS consent-driven data sharing is NOT reachable through `/mcp` at all, or through plain REST/GraphQL search either.** `resource-authorization.md`'s §6a text describes it as applying generally ("OR's a connection-type-filtered query branch onto the search"), but this is now stale: as of the recent `DCON-4962` change (`4f6e2221d`, already on `main`), `SearchManager.constructQueryAsync`'s `allowConsentedProaDataAccess` parameter defaults to `false` (`searchManager.js:226`) and is gated on `resourceType === 'Patient' && userType === cmsPartnerUser` for the CMS branch or the flag for the PROA branch (`searchManager.js:302,324`). Tracing every call site of `constructQueryAsync` in production code confirms **only** `everythingHelper.js` (lines 1246, 1520) ever passes `allowConsentedProaDataAccess: true`, and even there it's `Boolean(isPersonEverything)` — `false` for Patient/proxy-patient `$everything`. `searchBundle.js:192` (what MCP and REST plain search both call) never mentions the parameter at all, so it's always `false` there. Since MCP v1 deliberately has no `$everything` tool (`docs/mcp-endpoint.md`'s "Known limitations"), §6a is out of scope for MCP by construction, not a gap. **Task 7 updates `resource-authorization.md` §6a to note this narrowing**, since leaving it undocumented would mislead the next person reading that doc into thinking a `/mcp` PROA test is missing.
- §2 owner tags — not part of the bulk search-query filter per the doc itself ("not part of the bulk search-query filter... used in narrower [single-resource/write] checks"); MCP is read-only search-only, so the write-time owner-tag checks this section describes don't apply to it, and search-time tenant visibility is already covered by the §1 access-tag test (Task 2).
- §6b CMS-partner consent — moot; CMS-partner callers are blocked outright at the MCP router (already tested, see above), so `DataSharingManager.updateQueryConsideringCmsDataSharing`'s branch can never execute for an MCP caller.
- §10 step 6, delegated-actor `Composition` section-filtering — this is enrichment-pipeline-level (`SearchManager.readResourcesFromCursorAsync`, called from inside `searchBundleAsync` itself, `searchBundle.js:307-318`), universally shared with no caller-specific code in `McpToolHandler` at all (it forwards the returned bundle straight through via `JSON.stringify`). Low marginal risk, but Task 3's delegated-actor test is extended to touch a `Composition` too, so this is folded in rather than given its own task.
- Admin/debug query-param gate (`_explain`/`_debug`/`_setIndexHint`, the other half of §7) — the strip-unless-admin-scope check is `searchBundleAsync`'s own code (`searchBundle.js:146-155`), runs unconditionally before `constructQueryAsync`, and cannot be bypassed by any caller-specific arg shape. Already covered at the unit level by `07_adminScopeAndWildcardBypass.test.js`. Skipped here as genuinely zero marginal risk — every caller of `searchBundleAsync` gets this identically, and MCP has no code path that reaches `constructQueryAsync` any other way.

**Confirmed a real (but currently harmless) caller-specific gap — given a regression tripwire instead of a behavioral test:**
- Delegated-actor **operation-name allowlist** (`DelegatedAccessManager.verifyAccess`, restricting delegated actors to `search`/`searchById`/`everything`/`graph` and rejecting any write operation with a 403 *before parsing args*) is REST-specific (`fhirOperationsManager.js`) and is *not* called anywhere under `src/mcp/`. This is harmless today only because MCP has zero write-capable tools — every registered MCP tool resolves to `handleSearchToolCall`/`handleGenericSearchToolCall`, both read-only. If a future change ever adds a write tool to MCP without also wiring this check (or `OperationAccessManager.verifyAccess` generally), a delegated actor would be able to write through MCP with no operation-type gate at all — the exact shape of bug §12 already found once for GraphQL. Task 9 adds a tripwire unit test that fails the moment a second handler method appears on `McpToolHandler`, forcing whoever adds write support to consciously address this gate rather than silently inheriting the gap.

---

## File Structure

- **Modify:** `src/tests/mcp/mcpTestHelpers.js` — hoist the `patientScopedToken` helper (currently duplicated implicitly by being local to one file) so the new test file can reuse it.
- **Modify:** `src/tests/mcp/mcpEndpoint.integration.test.js` — switch its local `patientScopedToken` definition to import from `mcpTestHelpers.js` instead (no behavior change).
- **Create:** `src/tests/mcp/mcpResourceAuthorization.integration.test.js` — the new test file, one `describe` per mechanism, holding Tasks 2–6's tests.
- **Modify:** `src/tests/unit/mcp/mcpToolHandler.test.js` — add the Task 9 tripwire test.
- **Modify:** `docs/resource-authorization.md` — Task 7's one-paragraph §6a correction.
- **Modify:** `docs/mcp-endpoint.md` — Task 10 updates the "Testing" section to list the new file.

---

### Task 1: Hoist `patientScopedToken` into `mcpTestHelpers.js`

**Files:**
- Modify: `src/tests/mcp/mcpTestHelpers.js`
- Modify: `src/tests/mcp/mcpEndpoint.integration.test.js`

**Interfaces:**
- Produces: `patientScopedToken(personId, overrides = {})` exported from `mcpTestHelpers.js`, returning a raw bearer-token string (no `Bearer ` prefix) for a patient-scoped caller whose `clientFhirPersonId`/`bwellFhirPersonId` is `personUuid(personId)`. Task 5 (and any future test file) imports this directly.

- [ ] **Step 1: Move the helper**

In `src/tests/mcp/mcpTestHelpers.js`, add near the top (after the `generateUUIDv5` import, since it depends on `personUuid` defined just below it in the same file):

```js
/**
 * A patient-scoped JWT payload whose clientFhirPersonId/bwellFhirPersonId is the given
 * personId's Person._uuid (SEC-1580 IDG-5, #2481, tightened this to an exact _uuid match with
 * no _sourceId fallback -- see personUuid's doc comment above). Full user/access grants are
 * included alongside the patient scope so that scope *narrowing* (not an outright access
 * denial) is what's under test -- mirrors src/tests/graphqlv2/observation/observation.test.js's
 * getGraphQLHeadersWithPerson usage and src/tests/patientScope/search_with_clientfhirpersonid's
 * jwt_payload shape.
 * @param {string} personId
 * @param {Object} [overrides]
 * @returns {string} raw bearer token (no 'Bearer ' prefix)
 */
function patientScopedToken (personId, overrides = {}) {
    // eslint-disable-next-line global-require -- avoids a require cycle at module load time,
    // since common.js pulls in the full app/container graph and this helper module is required
    // very early by every /mcp test file.
    const { getHeadersWithCustomPayload } = require('../common');
    return getHeadersWithCustomPayload({
        scope: 'patient/*.read user/*.* access/*.*',
        username: `${personId}@example.com`,
        clientFhirPersonId: personUuid(personId),
        clientFhirPatientId: 'clientFhirPatient',
        bwellFhirPersonId: personUuid(personId),
        bwellFhirPatientId: 'bwellFhirPatient',
        token_use: 'access',
        ...overrides
    }).Authorization.replace(/^Bearer /, '');
}
```

Add `patientScopedToken` to the `module.exports` block at the bottom of the file.

- [ ] **Step 2: Update `mcpEndpoint.integration.test.js` to import instead of define**

Remove the local `function patientScopedToken (personId, overrides = {}) { ... }` definition (currently right after the imports, before `function registerRealAuditLogger`). Add `patientScopedToken` to the existing destructured `require('./mcpTestHelpers')` import list.

- [ ] **Step 3: Run the existing MCP suite to confirm no behavior change**

Run: `nvm use && node node_modules/.bin/jest src/tests/mcp/mcpEndpoint.integration.test.js`
Expected: PASS, same test count as before this change.

- [ ] **Step 4: Commit**

```bash
git add src/tests/mcp/mcpTestHelpers.js src/tests/mcp/mcpEndpoint.integration.test.js
git commit -m "test: hoist patientScopedToken into shared mcpTestHelpers"
```

---

### Task 2: §1 access-tag tenant isolation + §7 admin/wildcard bypass, through `/mcp`

**Files:**
- Create: `src/tests/mcp/mcpResourceAuthorization.integration.test.js`
- Test: same file (this is the first test in it)

**Interfaces:**
- Consumes: `commonBeforeEach`, `commonAfterEach`, `getHeaders`, `getFullAccessToken`, `createTestRequest` from `../common`; `callMcpTool`, `bundleFromToolResult`, `idsInBundle`, `minimalSecurity`, `makePatient` from `./mcpTestHelpers`.
- Produces: the file's `describe('/mcp resource authorization', ...)` block and `beforeEach`/`afterEach` scaffolding that Tasks 3–6 add their own `test(...)` blocks into.

- [ ] **Step 1: Create the file with scaffolding and this test**

```js
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
    getHeadersWithCustomPayload,
    createTestRequest
} = require('../common');
const {
    callMcpTool,
    bundleFromToolResult,
    idsInBundle,
    minimalSecurity,
    makePatient,
    makeObservation,
    makePerson,
    patientScopedToken
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
```

- [ ] **Step 2: Run it and confirm it PASSES**

Run: `nvm use && node node_modules/.bin/jest src/tests/mcp/mcpResourceAuthorization.integration.test.js -t "tenant-scoped token"`
Expected: PASS. If it FAILS, stop — per this plan's Global Constraints, that means `/mcp` is leaking cross-tenant data or the wildcard bypass isn't wired through MCP's search path; escalate rather than editing the test to match the wrong behavior.

- [ ] **Step 3: Commit**

```bash
git add src/tests/mcp/mcpResourceAuthorization.integration.test.js
git commit -m "test: prove /mcp inherits access-tag tenant isolation and admin wildcard bypass"
```

---

### Task 3: §6c/§10 delegated-actor consent gate + sensitivity denylist, through `/mcp`

**Files:**
- Modify: `src/tests/mcp/mcpResourceAuthorization.integration.test.js` (add one test inside the existing `describe` block)

**Interfaces:**
- Consumes: `AUTH_USER_TYPES` not needed here (the delegated-user path is driven by the JWT `act` claim, not a `user_type` claim — see `AuthService.processForDelegatedActor`, `src/strategies/authService.js`). Uses `getHeadersWithCustomPayload` (already imported in Task 2) and `makeObservation`/`makePerson`/`makePatient`/`minimalSecurity` (already imported).

- [ ] **Step 1: Add the test**

```js
    test('a delegated actor using /mcp is subject to the same consent gate and sensitivity denylist as REST (resource-authorization.md §6c, §10)', async () => {
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
            scope: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/consentscope', code: 'patient-privacy' }] },
            patient: { reference: `Patient/person.${grantorPersonUuid}`, display: 'Data sharing relationship grantor' },
            provision: {
                type: 'permit',
                period: { start: '2020-01-01T00:00:00.000Z', end: '2030-01-01T00:00:00.000Z' },
                actor: [{
                    role: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-ParticipationType', code: 'IRCP' }] },
                    reference: { reference: `RelatedPerson/${actorRelatedPersonId}` }
                }],
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
    });
```

- [ ] **Step 2: Run it and confirm it PASSES**

Run: `nvm use && node node_modules/.bin/jest src/tests/mcp/mcpResourceAuthorization.integration.test.js -t "delegated actor"`
Expected: PASS. If the first assertion (`deniedRpc.result.isError` toBe `true`) fails, the delegated-access consent gate isn't firing for `/mcp` — stop and escalate. If the second call includes `deniedObservationId`, the sensitivity denylist isn't wired through `/mcp` — stop and escalate.

- [ ] **Step 3: Commit**

```bash
git add src/tests/mcp/mcpResourceAuthorization.integration.test.js
git commit -m "test: prove /mcp enforces delegated-actor consent gate and sensitivity denylist"
```

---

### Task 4: §8 hidden-tag default exclusion + `_includeHidden` passthrough, through `/mcp`

**Files:**
- Modify: `src/tests/mcp/mcpResourceAuthorization.integration.test.js`

- [ ] **Step 1: Add the test**

```js
    test('a hidden-tagged resource is excluded from /mcp search by default, and included when _includeHidden=true is passed (resource-authorization.md §8)', async () => {
        const request = await createTestRequest();
        const visibleId = 'mcp-sec3-visible';
        const hiddenId = 'mcp-sec3-hidden';

        let resp = await request
            .post(`/4_0_0/Patient/${visibleId}/$merge?validate=true`)
            .send(makePatient(visibleId, { family: 'HiddenTagFamily', given: 'Visible', birthDate: '1990-01-01' }))
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post(`/4_0_0/Patient/${hiddenId}/$merge?validate=true`)
            .send({
                ...makePatient(hiddenId, { family: 'HiddenTagFamily', given: 'Hidden', birthDate: '1990-01-01' }),
                meta: {
                    source: 'test',
                    security: minimalSecurity(),
                    tag: [{ system: 'https://fhir.icanbwell.com/4_0_0/CodeSystem/server-behavior', code: 'hidden' }]
                }
            })
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        const { rpc: defaultRpc } = await callMcpTool(request, getFullAccessToken(), 'search_patient', {
            'family:contains': 'HiddenTagFamily'
        });
        expect(defaultRpc.result.isError).toBeUndefined();
        const defaultIds = idsInBundle(bundleFromToolResult(defaultRpc));
        expect(defaultIds).toContain(visibleId);
        expect(defaultIds).not.toContain(hiddenId);

        // _includeHidden isn't a declared field on search_patient's zod schema, but the schema is
        // .passthrough()-enabled (src/mcp/tools/patient.tool.js) and R4ArgsParser.parseArgs adds any
        // unrecognized truthy-valued arg as a live ParsedArgsItem in the default (lenient) handling
        // mode -- so this proves that path actually reaches R4SearchQueryCreator's hidden-tag check
        // (src/operations/query/r4.js), matching REST's equally-undocumented-in-schema-terms behavior.
        const { rpc: includeHiddenRpc } = await callMcpTool(request, getFullAccessToken(), 'search_patient', {
            'family:contains': 'HiddenTagFamily',
            _includeHidden: 'true'
        });
        expect(includeHiddenRpc.result.isError).toBeUndefined();
        const includeHiddenIds = idsInBundle(bundleFromToolResult(includeHiddenRpc));
        expect(includeHiddenIds).toContain(visibleId);
        expect(includeHiddenIds).toContain(hiddenId);
    });
```

- [ ] **Step 2: Run it and confirm it PASSES**

Run: `nvm use && node node_modules/.bin/jest src/tests/mcp/mcpResourceAuthorization.integration.test.js -t "hidden-tagged resource"`
Expected: PASS. If `defaultIds` contains `hiddenId`, the hidden-tag filter isn't applying to MCP searches — stop and escalate (this would mean any MCP caller can already see resources REST/GraphQL both hide by default).

- [ ] **Step 3: Commit**

```bash
git add src/tests/mcp/mcpResourceAuthorization.integration.test.js
git commit -m "test: prove /mcp respects the hidden-tag default exclusion and _includeHidden override"
```

---

### Task 5: §9 confidentiality-`R` sensitivity-tag exclusion for patient-scoped callers, through `/mcp`

**Files:**
- Modify: `src/tests/mcp/mcpResourceAuthorization.integration.test.js`

- [ ] **Step 1: Add the test**

```js
    test('a confidentiality-R restricted resource is excluded from a patient-scoped caller\'s /mcp search (resource-authorization.md §9)', async () => {
        const request = await createTestRequest();
        const personId = 'mcp-sec4-person';
        const patientId = 'mcp-sec4-patient';
        const visibleObservationId = 'mcp-sec4-obs-visible';
        const restrictedObservationId = 'mcp-sec4-obs-restricted';

        let resp = await request
            .post(`/4_0_0/Person/${personId}/$merge?validate=true`)
            .send(makePerson(personId, [patientId]))
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post(`/4_0_0/Patient/${patientId}/$merge?validate=true`)
            .send(makePatient(patientId, { family: 'RestrictedTagFamily', given: 'Test', birthDate: '1985-01-01' }))
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post(`/4_0_0/Observation/${visibleObservationId}/$merge?validate=true`)
            .send(makeObservation(visibleObservationId, { patientId, system: 'http://loinc.org', code: '1111-1' }))
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        // Confidentiality-R tag shape from src/tests/confidential/restricted_resources/fixtures/Observation/observation2.json.
        resp = await request
            .post(`/4_0_0/Observation/${restrictedObservationId}/$merge?validate=true`)
            .send({
                ...makeObservation(restrictedObservationId, { patientId, system: 'http://loinc.org', code: '2222-2' }),
                meta: {
                    source: 'test',
                    security: [
                        ...minimalSecurity(),
                        {
                            id: 'Confidentiality',
                            system: 'http://terminology.hl7.org/CodeSystem/v3-Confidentiality',
                            code: 'R',
                            display: 'Restricted'
                        }
                    ]
                }
            })
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        const { rpc } = await callMcpTool(request, patientScopedToken(personId), 'search_observation', {
            patient: `Patient/${patientId}`
        });
        expect(rpc.result.isError).toBeUndefined();
        const ids = idsInBundle(bundleFromToolResult(rpc));
        expect(ids).toContain(visibleObservationId);
        expect(ids).not.toContain(restrictedObservationId);
    });
```

- [ ] **Step 2: Run it and confirm it PASSES**

Run: `nvm use && node node_modules/.bin/jest src/tests/mcp/mcpResourceAuthorization.integration.test.js -t "confidentiality-R"`
Expected: PASS. If `ids` contains `restrictedObservationId`, the confidentiality restriction isn't applying to MCP's patient-scope branch — stop and escalate.

- [ ] **Step 3: Commit**

```bash
git add src/tests/mcp/mcpResourceAuthorization.integration.test.js
git commit -m "test: prove /mcp excludes confidentiality-R resources for patient-scoped callers"
```

---

### Task 6: §3 `AuditEvent` required-filters gate, through `/mcp`'s generic tool

**Files:**
- Modify: `src/tests/mcp/mcpResourceAuthorization.integration.test.js`

`AuditEvent` has no dedicated MCP tool (it isn't in `generatorScripts/mcp/commonly_used_resources.json`), so this must go through `fhir_search`. Test-env config (`jest/setEnvVars.js:26-27`) sets `REQUIRED_AUDIT_EVENT_FILTERS=date` and `AUDIT_EVENT_MAX_RANGE_PERIOD=240`, matching the real REST regression test at `src/tests/searchParameters/audit_event_search_filter/audit_event_search_filter.test.js`.

- [ ] **Step 1: Add the test**

```js
    test('a fhir_search AuditEvent query without required date filters is rejected via /mcp the same way REST rejects it (resource-authorization.md §3)', async () => {
        const request = await createTestRequest();

        const { rpc } = await callMcpTool(request, getFullAccessToken(), 'fhir_search', {
            resourceType: 'AuditEvent',
            filters: {}
        });

        expect(rpc.result.isError).toBe(true);
        const operationOutcome = JSON.parse(rpc.result.content[0].text);
        expect(operationOutcome.resourceType).toBe('OperationOutcome');
        expect(operationOutcome.issue[0].details.text).toContain(
            'One of the filters [date] is required to query AuditEvent'
        );
    });
});
```

(Note the trailing `});` — this is the last test in the file, closing the outer `describe`.)

- [ ] **Step 2: Run it and confirm it PASSES**

Run: `nvm use && node node_modules/.bin/jest src/tests/mcp/mcpResourceAuthorization.integration.test.js -t "AuditEvent query without required"`
Expected: PASS. If `rpc.result.isError` is falsy, MCP's generic tool can be used to bypass a cost/query-shape guard REST enforces (not a tenant-isolation bug, but still a behavioral divergence worth escalating rather than silently accepting).

- [ ] **Step 3: Run the full new file together**

Run: `nvm use && node node_modules/.bin/jest src/tests/mcp/mcpResourceAuthorization.integration.test.js`
Expected: PASS, 5 tests (Tasks 2–6).

- [ ] **Step 4: Commit**

```bash
git add src/tests/mcp/mcpResourceAuthorization.integration.test.js
git commit -m "test: prove /mcp enforces the AuditEvent required-filters gate"
```

---

### Task 7: Correct `docs/resource-authorization.md` §6a for the `Person $everything`-only narrowing

**Files:**
- Modify: `docs/resource-authorization.md`

**Interfaces:** none (docs-only).

- [ ] **Step 1: Add the correction**

In `docs/resource-authorization.md`, find section `## 6. Consent`, subsection `**a. PROA/IAS data-sharing consent**`. After the existing paragraph (ending `...OR's a connection-type-filtered query branch onto the search.`), add:

```markdown
As of `DCON-4962` (#2511), this expansion is scoped to genuine `Person $everything` requests
only: `SearchManager.constructQueryAsync`'s `allowConsentedProaDataAccess` parameter defaults to
`false` and is set to `true` only by `everythingHelper.js`, and only when
`isPersonEverything` is true (`Boolean(isPersonEverything)` — explicitly `false` for
Patient/proxy-patient `$everything`). Plain search, `searchById`, `history`, `$graph`, and both
GraphQL APIs never set it, so this mechanism does not apply to them regardless of caller type —
this is why the MCP endpoint (`docs/mcp-endpoint.md`), which has no `$everything` tool, has no
PROA-consent test: the mechanism is unreachable from its surface by construction, not an
untested gap.
```

- [ ] **Step 2: Commit**

```bash
git add docs/resource-authorization.md
git commit -m "docs: correct resource-authorization.md §6a for the Person-\$everything-only PROA narrowing"
```

---

### Task 8: Update `docs/mcp-endpoint.md`'s Testing section

**Files:**
- Modify: `docs/mcp-endpoint.md`

- [ ] **Step 1: Add the new file to the list**

In `docs/mcp-endpoint.md`'s `## Testing` section, after the existing bullet for `src/tests/mcp/mcpEndpoint.integration.test.js`, add:

```markdown
- `src/tests/mcp/mcpResourceAuthorization.integration.test.js` — end-to-end proof, through the
  real `/mcp` route, that every `docs/resource-authorization.md` mechanism reachable from a
  read-only search surface is actually enforced when driven by MCP's tool-call argument shape:
  access-tag tenant isolation and the admin/wildcard bypass (§1, §7), delegated-actor consent gate
  and sensitivity denylist (§6c, §10), hidden-tag default exclusion (§8), confidentiality-`R`
  exclusion for patient-scoped callers (§9), and the `AuditEvent` required-filters gate (§3). See
  `docs/superpowers/plans/2026-08-14-mcp-resource-authorization-test-coverage.md` for why other
  sections of that doc (§2, §4, §6a, §6b, admin/debug params) don't need their own MCP-level test.
```

- [ ] **Step 2: Commit**

```bash
git add docs/mcp-endpoint.md
git commit -m "docs: list the new resource-authorization coverage test file"
```

---

### Task 9: Tripwire against a future MCP write tool silently skipping the delegated-actor operation allowlist

**Files:**
- Modify: `src/tests/unit/mcp/mcpToolHandler.test.js`

**Interfaces:**
- Consumes: `McpToolHandler` from `src/mcp/mcpToolHandler.js` (already imported in this test file).

- [ ] **Step 1: Add the tripwire test**

Add to `src/tests/unit/mcp/mcpToolHandler.test.js` (inside its existing top-level `describe` block, or as a new one):

```js
describe('McpToolHandler write-tool tripwire', () => {
    test('McpToolHandler exposes exactly its two known read-only handlers -- see plan note before adding a third', () => {
        // resource-authorization.md documents DelegatedAccessManager.verifyAccess (the operation-name
        // allowlist restricting delegated actors to search/searchById/everything/graph, rejecting any
        // write with a 403 before args are even parsed) as REST-specific -- it is not called anywhere
        // under src/mcp/. This is harmless today ONLY because every registered MCP tool resolves to
        // one of the two handlers below, both read-only (McpToolHandler.registerTools,
        // src/mcp/mcpToolHandler.js). If a third handler method appears here, it means a write-capable
        // MCP tool is being added, and per
        // docs/superpowers/plans/2026-08-14-mcp-resource-authorization-test-coverage.md's Task 9 note,
        // whoever adds it must also wire in an equivalent to DelegatedAccessManager.verifyAccess /
        // OperationAccessManager.verifyAccess before this assertion is updated -- not after.
        const handlerMethodNames = Object.getOwnPropertyNames(McpToolHandler.prototype)
            .filter((name) => name !== 'constructor' && name !== 'registerTools');
        expect(handlerMethodNames.sort()).toEqual(['handleGenericSearchToolCall', 'handleSearchToolCall']);
    });
});
```

- [ ] **Step 2: Run it and confirm it PASSES**

Run: `nvm use && node node_modules/.bin/jest src/tests/unit/mcp/mcpToolHandler.test.js -t "write-tool tripwire"`
Expected: PASS today (only two handler methods exist). If it fails, one of two things is true: either the method names in `McpToolHandler` genuinely changed (update the expected array after confirming the new method is read-only), or a write-capable tool was added without the operation-allowlist gate (fix that first, then update this test).

- [ ] **Step 3: Commit**

```bash
git add src/tests/unit/mcp/mcpToolHandler.test.js
git commit -m "test: tripwire McpToolHandler against a write tool skipping the delegated-actor allowlist"
```

---

## Self-Review

**Spec coverage** — every mechanism in `resource-authorization.md` §1–§10 that resource-authorization.md's own composition rule (§11) says gates search-result inclusion has been placed into exactly one bucket: already-covered-through-MCP, newly-covered-by-this-plan (Tasks 2–6), or confirmed-inapplicable-with-reasoning (the gap-analysis section above). §12 (Known Gaps) is a historical log, not a live requirement, so it needed no new task beyond the PROA staleness note (Task 7) surfaced while verifying §6a.

**Placeholder scan** — every test in Tasks 2–6 and the Task 9 tripwire is complete, runnable code with concrete fixture values, not pseudocode; every doc edit (Tasks 7–8) is the literal text to insert.

**Type/name consistency** — `patientScopedToken` (Task 1) is defined once and consumed identically in Task 5; `minimalSecurity`, `makePatient`, `makeObservation`, `makePerson`, `callMcpTool`, `bundleFromToolResult`, `idsInBundle` are all pre-existing exports from `mcpTestHelpers.js` used with their real signatures (verified by reading the file directly, not assumed); `getHeaders`, `getHeadersWithCustomPayload`, `getFullAccessToken`, `createTestRequest` are pre-existing exports from `src/tests/common.js` used exactly as the existing `mcpEndpoint.integration.test.js` file already uses them.
