// Regression test for a two-step production incident in AccessLogger's re-parse of a request's
// own args for the access log's details.params field:
//
// 1. AccessLogger originally called fhirOperationsManager.getParsedArgsAsync() without
//    threading requestInfo through (see accessLogs.graph_proxy_patient.test.js), which crashed
//    for a $graph/$graphqlv2 request filtered by a person.<id> proxy id.
// 2. Passing requestInfo through "fixed" the crash but surfaced a second bug: doing so let this
//    re-parse run all the way through PatientProxyQueryRewriter for PROA-eligible $everything
//    GETs, and writeProaSafeCache unconditionally recreates a RequestSpecificCache.mapCache
//    entry keyed by that request's requestId
//    (src/queryRewriters/rewriters/patientProxyQueryRewriter.js). AccessLogger runs from
//    res.on('finish') in src/app.js, AFTER the real handler's own finally block
//    (src/middleware/fhir/4_0_0/controllers/operations.controller.js) already called
//    requestSpecificCache.clearAsync({requestId}) for that (never-reused) request id.
//    Recreating the entry after that point means nothing will ever clear it again -- an
//    unbounded, process-lifetime memory leak for every matching service-account PROA
//    $everything request.
//
// The actual fix: AccessLogger no longer calls getParsedArgsAsync at all -- it logs the raw,
// unrewritten args directly, so it never touches the query-rewriter pipeline (or any of its side
// effects) in the first place. This test guards against that call being reintroduced.
const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getTestContainer
} = require('../common');
const { describe, beforeEach, afterEach, test, expect, jest } = require('@jest/globals');
const { AccessLogger } = require('../../utils/accessLogger');

const Person1 = {
    id: 'person1',
    resourceType: 'Person',
    meta: {
        source: 'test',
        security: [{ system: 'https://www.icanbwell.com/owner', code: 'client' }]
    },
    link: [{ target: { reference: 'Patient/patient1' } }]
};
const Patient1 = {
    id: 'patient1',
    resourceType: 'Patient',
    meta: {
        source: 'test',
        security: [{ system: 'https://www.icanbwell.com/owner', code: 'client' }]
    }
};

describe('AccessLogs $everything proxy patient RequestSpecificCache leak Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('does not recreate a RequestSpecificCache entry for an already-completed PROA-eligible $everything GET', async () => {
        // registers the real AccessLogger (createTestRequest's default container uses
        // MockAccessLogger, a no-op stub, so this test would trivially pass against it)
        const request = await createTestRequest((container) => {
            container.register('accessLogger', (c) => new AccessLogger({
                scopesManager: c.scopesManager,
                fhirOperationsManager: c.fhirOperationsManager,
                configManager: c.configManager,
                databaseBulkInserter: c.databaseBulkInserter
            }));
            return container;
        });

        const container = await getTestContainer();
        /** @type {AccessLogger} */
        const accessLogger = container.accessLogger;
        const requestSpecificCache = container.requestSpecificCache;

        let resp = await request.post('/4_0_0/Person/1/$merge').send(Person1).set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request.post('/4_0_0/Patient/1/$merge').send(Patient1).set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        // capture the exact requestId the real request's own controller clears in its finally
        // block, so we can assert on that same id after AccessLogger's re-parse settles -- set up
        // after the merges above so this spy only sees the $everything call below
        let clearedRequestId;
        const clearAsyncSpy = jest.spyOn(requestSpecificCache, 'clearAsync');
        const logAccessLogAsyncSpy = jest.spyOn(accessLogger, 'logAccessLogAsync');

        // GET $everything (READ, PatientProxyQueryRewriter's isProaCacheEligibleRequest also
        // requires the request NOT be user/patient-scoped -- getHeaders()'s default full-access
        // token is a service-account-style scope) on the person.<id> proxy id, so
        // PatientProxyQueryRewriter's proxy-patient branch actually runs. app.js only fires
        // AccessLogger at all when req.body is truthy (or ACCESS_LOGS_ENTRY_DATA/a 401 auth-log
        // is set, neither of which applies to a plain GET) -- a bare supertest .get() leaves
        // req.body undefined, so .send({}) forces a real (empty) JSON body, matching a client
        // that sends `Content-Type: application/fhir+json` with a body on every request
        // regardless of method.
        resp = await request
            .get('/4_0_0/Patient/person.person1/$everything')
            .send({})
            .set(getHeaders());
        expect(resp.statusCode).toBe(200);

        // the real handler's own controller must have cleared its requestId by now (it happens
        // synchronously as part of the request/response cycle, well before res.on('finish'))
        expect(clearAsyncSpy).toHaveBeenCalled();
        clearedRequestId = clearAsyncSpy.mock.calls[clearAsyncSpy.mock.calls.length - 1][0].requestId;
        expect(clearedRequestId).toBeTruthy();
        expect(requestSpecificCache.mapCache.has(clearedRequestId)).toBe(false);

        // wait for the fire-and-forget res.on('finish') -> logAccessLogAsync(...) call to settle
        expect(logAccessLogAsyncSpy).toHaveBeenCalledTimes(1);
        await logAccessLogAsyncSpy.mock.results[0].value;

        // the leak: if AccessLogger still ran this request's args through getParsedArgsAsync
        // (and therefore PatientProxyQueryRewriter), writeProaSafeCache's
        // requestSpecificCache.getMap(...) call would recreate mapCache's entry for the
        // already-cleared requestId, and nothing would ever clear it again
        expect(requestSpecificCache.mapCache.has(clearedRequestId)).toBe(false);
    });
});
