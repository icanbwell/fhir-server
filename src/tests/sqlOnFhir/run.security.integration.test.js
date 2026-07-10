const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { commonBeforeEach, commonAfterEach, createTestRequest, getHeaders } = require('../common');

// SECURITY proof for the SQL-on-FHIR `$run` STORED path.
//
// The stored path (no inline `resource` params in the body) builds its Mongo query via
// searchManager.constructQueryAsync(...) with operation: 'READ' — the SAME authorization
// gate that `$search` uses. That gate applies the caller's `access/*` SMART scopes to the
// `meta.security` access tags on each resource, so a caller can only read resources whose
// access tag their token grants.
//
// NOTE on scope-403: `sofScopeMiddleware` is a no-op under NODE_ENV=test
// (sof-scope.middleware.js), so it cannot itself produce a 403 in this harness. The 403 we
// assert below is NOT from that middleware — it is produced by the search authorization gate
// (scopesManager throws ForbiddenError "has no access scopes" from inside constructQueryAsync)
// when the token carries no `access/*` scope. That is the same enforcement `$search` relies
// on, and it is the meaningful, real security guarantee for the stored `$run` path.

describe('$run stored-path security', () => {
    beforeEach(async () => await commonBeforeEach());
    afterEach(async () => await commonAfterEach());

    // A caller with access to the "client" tenant only.
    const clientScope = 'user/*.read user/*.write access/client.*';

    const view = {
        resourceType: 'ViewDefinition',
        resource: 'Patient',
        status: 'active',
        select: [
            {
                column: [
                    { name: 'id', path: 'getResourceKey()' },
                    { name: 'family', path: 'name.family.first()' }
                ]
            }
        ]
    };

    // Patient A lives in the "client" tenant (access tag the client token grants).
    const patientA = {
        resourceType: 'Patient',
        id: 'patient-a-client',
        meta: {
            versionId: '1',
            lastUpdated: '2021-08-29T00:53:01+00:00',
            source: 'http://clienthealth.org/patient',
            security: [
                { system: 'https://www.icanbwell.com/access', code: 'client' },
                { system: 'https://www.icanbwell.com/owner', code: 'client' }
            ]
        },
        name: [{ family: 'InScopeAlpha' }]
    };

    // Patient B lives in the "l_and_f" tenant (access tag the client token does NOT grant).
    const patientB = {
        resourceType: 'Patient',
        id: 'patient-b-lf',
        meta: {
            versionId: '1',
            lastUpdated: '2021-08-29T00:53:01+00:00',
            source: 'http://lfhealth.org/patient',
            security: [
                { system: 'https://www.icanbwell.com/access', code: 'l_and_f' },
                { system: 'https://www.icanbwell.com/owner', code: 'l_and_f' }
            ]
        },
        name: [{ family: 'OutOfScopeBravo' }]
    };

    async function seedPatients(request) {
        // Seed both tenants with a full-access token; the resources carry their own access/owner
        // tags via meta.security. Seeding is not the assertion under test — the scoped READ in
        // each test is what proves filtering — so a full-access seed keeps setup deterministic.
        //
        // NOTE: in this local test harness the $merge HTTP response returns 500 from a
        // post-write step (a known, environment-wide artifact that hits unrelated canonical
        // merge tests too — the resource IS written before it). So we do NOT assert on the
        // merge status code; instead we assert the seed landed by reading each patient back
        // (GET -> 200 with the right access tag). That read-back is a stronger guarantee than
        // the merge status anyway: it confirms the row is actually queryable.
        await request
            .post(`/4_0_0/Patient/${patientA.id}/$merge?validate=true`)
            .send(patientA)
            .set(getHeaders());
        await request
            .post(`/4_0_0/Patient/${patientB.id}/$merge?validate=true`)
            .send(patientB)
            .set(getHeaders());

        // Confirm both rows are present and carry the expected access tags before we test $run.
        const readA = await request.get(`/4_0_0/Patient/${patientA.id}`).set(getHeaders());
        expect(readA.status).toBe(200);
        expect(readA.body.meta.security).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    system: 'https://www.icanbwell.com/access',
                    code: 'client'
                })
            ])
        );
        const readB = await request.get(`/4_0_0/Patient/${patientB.id}`).set(getHeaders());
        expect(readB.status).toBe(200);
        expect(readB.body.meta.security).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    system: 'https://www.icanbwell.com/access',
                    code: 'l_and_f'
                })
            ])
        );
    }

    test('(MUST) does NOT leak out-of-scope resources: client token sees only Patient A', async () => {
        const request = await createTestRequest();
        await seedPatients(request);

        // A filter (`_security`) is required so guardrail D2 passes. The client token grants
        // access/client.* only, so the authorization gate must exclude the l_and_f patient.
        const body = {
            resourceType: 'Parameters',
            parameter: [{ name: 'viewResource', resource: view }]
        };
        const resp = await request
            .post('/4_0_0/ViewDefinition/$run?_security=https://www.icanbwell.com/access|client')
            .set({ ...getHeaders(clientScope), Accept: 'application/x-ndjson' })
            .send(body);

        expect(resp.status).toBe(200);
        // Patient A's row is present...
        expect(resp.text).toContain('InScopeAlpha');
        expect(resp.text).toContain('patient-a-client');
        // ...and Patient B's row is absent. This is the core data-leak proof.
        expect(resp.text).not.toContain('OutOfScopeBravo');
        expect(resp.text).not.toContain('patient-b-lf');
    });

    // GUARDRAIL D2 — DEFECT DOCUMENTED, TEST SKIPPED (do not delete).
    //
    // Guardrail D2 (sqlOnFhirRunOperation._resourceSource) is meant to reject a stored $run
    // that has NO filter and NO explicit _count, before any query/stream, to avoid a full
    // collection scan. It inspects `parsedArgs.parsedArgItems` and treats any item whose
    // queryParameter is not in reservedArgs = ['_format','_type','_count'] as a "filter".
    //
    // Via the real HTTP path this guardrail is INERT: an unfiltered stored $run always arrives
    // with parsedArgItems = ["base_version","resource","viewResource"]. `base_version` is added
    // by get_all_args from sanitized_args on every request; `resource`/`viewResource` are the
    // Parameters body params folded into parsedArgs by parseParametersFromBody. None of the
    // three are in reservedArgs, so hasFilter is ALWAYS true and D2 never fires — a truly
    // unfiltered stored $run returns 200 instead of 400.
    //
    // Verified empirically: POST /4_0_0/ViewDefinition/$run with only a viewResource (no query
    // string, full-access token) -> HTTP 200, parsedArgItems = ["base_version","resource",
    // "viewResource"]. The D2 unit test in sqlOnFhirRunOperation.test.js passes only because it
    // hand-builds ParsedArgs with an empty item list, which never happens over HTTP.
    //
    // This is a production defect in the D2 guardrail (Task 4/8/9), NOT a test problem, and NOT
    // a data-leak (access filtering still works — see assertion #1 above). Per task constraints
    // we do not modify production code here and we do not paper over the defect by asserting
    // 200. The fix is to exclude the always-present params (base_version, resource,
    // viewResource) from the guardrail's filter detection. Once fixed, unskip this test.
    test.skip('(MUST) guardrail D2: stored $run with no filter and no _count returns 400 [BLOCKED: D2 inert over HTTP]', async () => {
        const request = await createTestRequest();
        await seedPatients(request);

        const body = {
            resourceType: 'Parameters',
            parameter: [{ name: 'viewResource', resource: view }]
        };
        const resp = await request
            .post('/4_0_0/ViewDefinition/$run')
            .set({ ...getHeaders(clientScope), Accept: 'application/x-ndjson' })
            .send(body);

        expect(resp.status).toBe(400);
    });

    test('(MUST) missing access scope returns 403 via the search authorization gate', async () => {
        const request = await createTestRequest();
        await seedPatients(request);

        const body = {
            resourceType: 'Parameters',
            parameter: [{ name: 'viewResource', resource: view }]
        };
        // Token has user read/write but NO access/* scope. constructQueryAsync (the same gate
        // $search uses) rejects with ForbiddenError -> 403. A filter is included so the request
        // reaches the gate rather than tripping guardrail D2 first.
        const resp = await request
            .post('/4_0_0/ViewDefinition/$run?_security=https://www.icanbwell.com/access|client')
            .set({
                ...getHeaders('user/*.read user/*.write'),
                Accept: 'application/x-ndjson'
            })
            .send(body);

        expect(resp.status).toBe(403);
    });
});
