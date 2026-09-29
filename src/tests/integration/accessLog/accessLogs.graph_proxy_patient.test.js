// Regression test for a production incident: any request whose URL contains "$graph"
// (this matches BOTH the REST $graph operation AND the /4_0_0/$graphqlv2 endpoint, since
// String.prototype.includes('$graph') is a substring match) is classified as a READ operation
// by AccessLogger.logAccessLogAsync, which re-parses the request's own args a second time --
// independently of the real request handling -- to populate the access log's `details.params`.
// That re-parse calls fhirOperationsManager.getParsedArgsAsync() without threading requestInfo
// through, even though logAccessLogAsync already computes it a few lines earlier. When the
// request carries a `person.<id>` proxy-patient value anywhere in its args, this reaches
// PatientProxyQueryRewriter -> PersonToPatientIdsExpander.getPatientProxyIdsAsync(), which
// asserts requestInfo is defined (see src/utils/personToPatientIdsExpander.js) and throws.
//
// Because AccessLogger.logAccessLogAsync is invoked fire-and-forget from a res.on('finish')
// handler (src/app.js), the real request still succeeds -- but the access log entry for it is
// silently dropped (the throw happens before the entry is pushed onto AccessLogger's queue), and
// the rejection escapes as an unhandled promise rejection in production.
//
// This test proves the regression the way it's externally observable: after a $graph request
// filtered by a person.<id> proxy id, the corresponding access log entry must actually exist.
const {
    commonBeforeEach,
    commonAfterEach,
    getHeadersWithAdmin,
    getJsonHeadersWithAdminToken,
    createTestRequest,
    getTestContainer
} = require('../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { AccessLogger } = require('../../../utils/accessLogger');

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
const graphDefinition = {
    resourceType: 'GraphDefinition',
    id: 'o',
    name: 'patient_references',
    status: 'active',
    start: 'Patient',
    link: [{ target: [{ type: 'Observation', params: 'patient={ref}' }] }]
};

describe('AccessLogs $graph with proxy patient id Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('access log entry for a $graph request filtered by a person.<id> proxy id is not silently dropped', async () => {
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

        let resp = await request.post('/4_0_0/Person/1/$merge').send(Person1).set(getHeadersWithAdmin());
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request.post('/4_0_0/Patient/1/$merge').send(Patient1).set(getHeadersWithAdmin());
        expect(resp).toHaveMergeResponse({ created: true });

        // the request itself succeeds regardless of the bug -- $graph's own requestInfo
        // threading (fhirOperationsManager.js's graph()) was already correct
        resp = await request
            .post('/4_0_0/Patient/$graph?id=person.person1')
            .set({ ...getHeadersWithAdmin(), 'x-request-id': 'graph-proxy-patient-request-id' })
            .send(graphDefinition);
        expect(resp.statusCode).toBe(200);

        // flush AccessLogger's in-memory queue to the store queryable via /admin/searchLogResults.
        // If logAccessLogAsync threw while re-parsing this request's args, no entry was ever
        // pushed onto the queue in the first place -- flushAsync has nothing to flush for it.
        await accessLogger.flushAsync();

        const logsResp = await request
            .get('/admin/searchLogResults?id=graph-proxy-patient-request-id')
            .set(getJsonHeadersWithAdminToken());

        expect(logsResp.statusCode).toBe(200);
        expect(logsResp.body).toHaveLength(1);
        expect(logsResp.body[0].request.url).toBe('/4_0_0/Patient/$graph?id=person.person1');
        expect(logsResp.body[0].request.operation).toBe('READ');
        // proves getParsedArgsAsync ran end-to-end (through PatientProxyQueryRewriter) instead
        // of throwing before ever reaching the point where these params are recorded
        expect(logsResp.body[0].details.params).toBeDefined();
    });
});
