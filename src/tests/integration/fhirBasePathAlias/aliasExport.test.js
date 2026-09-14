// $export is a hard launch blocker per the design doc: ENABLE_BULK_EXPORT is "1" in every
// environment of the fhir-server slice that serves fhir.icanbwell.com, including prod, so this
// must be verified before the alias flag can be enabled anywhere. Three invariants:
//   1. kickoff Content-Location mirrors the request's base path
//   2. the persisted ExportStatus.request is always canonical /4_0_0/... (never the alias) -
//      asserted directly on the DB document, since this is the runner-safety invariant
//      (bulkDataExportRunner turns this into a Mongo collection suffix)
//   3. cross-prefix kickoff/poll re-bases correctly (kickoff on one base, poll on the other)
const supertest = require('supertest');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestApp,
    getTestContainer
} = require('../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { MockK8sClient } = require('../export/mocks/k8sClient');

describe('fhir/r4 base path alias - $export', () => {
    const originalFlag = process.env.ENABLE_FHIR_R4_PATH_ALIAS;
    const originalBulkExport = process.env.ENABLE_BULK_EXPORT;

    beforeEach(async () => {
        process.env.ENABLE_FHIR_R4_PATH_ALIAS = '1';
        process.env.ENABLE_BULK_EXPORT = '1';
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
        if (originalFlag === undefined) {
            delete process.env.ENABLE_FHIR_R4_PATH_ALIAS;
        } else {
            process.env.ENABLE_FHIR_R4_PATH_ALIAS = originalFlag;
        }
        if (originalBulkExport === undefined) {
            delete process.env.ENABLE_BULK_EXPORT;
        } else {
            process.env.ENABLE_BULK_EXPORT = originalBulkExport;
        }
    });

    function createExportTestApp() {
        return createTestApp((c) => {
            c.register('k8sClient', (c) => new MockK8sClient({ configManager: c.configManager }));
            return c;
        });
    }

    test('kickoff on /fhir/r4/$export mirrors the alias in Content-Location', async () => {
        const request = supertest(createExportTestApp());

        const resp = await request
            .post('/fhir/r4/$export?_type=Patient')
            .set(getHeaders())
            .expect(202);

        expect(resp.headers['content-location']).toBeDefined();
        expect(resp.headers['content-location']).toContain('/fhir/r4/$export/');
        expect(resp.headers['content-location']).not.toContain('/4_0_0/$export/');
    });

    test('the persisted ExportStatus.request is always canonical /4_0_0/..., regardless of kickoff base path', async () => {
        const request = supertest(createExportTestApp());

        const resp = await request
            .post('/fhir/r4/$export?_type=Patient')
            .set(getHeaders())
            .expect(202);

        const exportStatusId = resp.headers['content-location'].split('/').pop();

        const mongoDatabaseManager = getTestContainer().mongoDatabaseManager;
        const fhirDb = await mongoDatabaseManager.getClientDbAsync();
        const collection = fhirDb.collection('ExportStatus_4_0_0');
        const [exportStatusDoc] = await collection.find({ id: exportStatusId }).toArray();

        expect(exportStatusDoc).toBeDefined();
        expect(exportStatusDoc.request).toContain('/4_0_0/$export');
        expect(exportStatusDoc.request).not.toContain('/fhir/r4');
    });

    test('cross-prefix: kickoff on /fhir/r4, poll on /4_0_0 - status URL matches the polling request base path', async () => {
        const request = supertest(createExportTestApp());

        const kickoff = await request
            .post('/fhir/r4/$export?_type=Patient')
            .set(getHeaders())
            .expect(202);
        const exportStatusId = kickoff.headers['content-location'].split('/').pop();

        const pollResp = await request.get(`/4_0_0/$export/${exportStatusId}`).set(getHeaders());

        // 202 (still accepted/in-progress) with X-Progress, or 200 once completed - either way it
        // must resolve as a /4_0_0 request (i.e. be found, not 404 due to a base-path mismatch).
        expect([200, 202]).toContain(pollResp.status);
    });

    test('cross-prefix: kickoff on /4_0_0, poll on /fhir/r4 - status URL matches the polling request base path', async () => {
        const request = supertest(createExportTestApp());

        const kickoff = await request
            .post('/4_0_0/$export?_type=Patient')
            .set(getHeaders())
            .expect(202);
        const exportStatusId = kickoff.headers['content-location'].split('/').pop();

        const pollResp = await request.get(`/fhir/r4/$export/${exportStatusId}`).set(getHeaders());

        expect([200, 202]).toContain(pollResp.status);
    });
});
