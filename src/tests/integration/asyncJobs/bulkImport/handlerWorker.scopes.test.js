const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../../common');
const { describe, beforeEach, afterEach, test, expect, jest } = require('@jest/globals');
const { trace } = require('@opentelemetry/api');

const makeCloudEvent = ({ taskId, scope }) => JSON.stringify({
    specversion: '1.0',
    id: `evt-${taskId}`,
    source: 'https://www.icanbwell.com/fhir-server',
    type: 'ImportRangeRequested',
    datacontenttype: 'application/json',
    data: {
        taskId,
        filepath: 's3://allowed-bucket/Patient.ndjson',
        byteRangeStart: 0,
        byteRangeEnd: 104857600,
        rangeIndex: 0,
        totalRanges: 1,
        taskTotalRanges: 1,
        requestId: `req-${taskId}`,
        scope,
        user: 'test-user'
    }
});

async function processRangeAsync (handler, container, message) {
    const sendSpy = jest.spyOn(container.kafkaClientV2, 'sendCloudEventMessageAsync');
    const callsBefore = sendSpy.mock.calls.length;

    await handler.handleMessageAsync(message);

    const newCalls = sendSpy.mock.calls.slice(callsBefore);
    sendSpy.mockRestore();

    for (const [{ messages }] of newCalls) {
        for (const msg of messages) {
            await handler.handleMessageAsync({ key: msg.key, value: msg.value, headers: [] });
        }
    }
}

const securityTags = [
    { system: 'https://www.icanbwell.com/owner', code: 'client-a' },
    { system: 'https://www.icanbwell.com/access', code: 'client-a' },
    { system: 'https://www.icanbwell.com/sourceAssigningAuthority', code: 'client-a' }
];

const patient = (id) => ({ resourceType: 'Patient', id, meta: { source: 'test', security: securityTags }, name: [{ family: 'Imported' }] });
const observation = (id) => ({
    resourceType: 'Observation',
    id,
    meta: { source: 'test', security: securityTags },
    status: 'final',
    code: { coding: [{ system: 'http://loinc.org', code: '29463-7' }] }
});

// The import worker writes each resource with the requester's own scope, so each resource must
// pass both gates $merge applies: `u` on its resource type (resource gate) and `u` on its access
// tags (access gate). These cases drive the real worker directly, bypassing the $import request
// gate, so they prove the worker enforces both gates on its own.
describe('BulkImportHandler - per-resource scope enforcement in the worker', () => {
    let fakeSpan;
    let activeSpanSpy;
    let originalFlag;

    beforeEach(async () => {
        process.env.ENABLE_BULK_IMPORT = '1';
        process.env.BULK_IMPORT_ALLOWED_S3_BUCKETS = 'allowed-bucket';
        process.env.ENABLE_EVENTS_KAFKA_V2 = '1';
        originalFlag = process.env.ENABLE_SMART_V2_CRUDS_SCOPES;
        fakeSpan = { setAttributes: jest.fn() };
        activeSpanSpy = jest.spyOn(trace, 'getActiveSpan').mockReturnValue(fakeSpan);
        await commonBeforeEach();
    });

    afterEach(async () => {
        delete process.env.ENABLE_BULK_IMPORT;
        delete process.env.BULK_IMPORT_ALLOWED_S3_BUCKETS;
        delete process.env.ENABLE_EVENTS_KAFKA_V2;
        if (originalFlag === undefined) {
            delete process.env.ENABLE_SMART_V2_CRUDS_SCOPES;
        } else {
            process.env.ENABLE_SMART_V2_CRUDS_SCOPES = originalFlag;
        }
        activeSpanSpy.mockRestore();
        await commonAfterEach();
    });

    const runImportAsync = async ({ taskId, scope, lines, enableV2 }) => {
        if (enableV2) {
            process.env.ENABLE_SMART_V2_CRUDS_SCOPES = '1';
        }
        const request = await createTestRequest();
        await request
            .post('/4_0_0/$import')
            .send({
                resourceType: 'Parameters',
                id: taskId,
                parameter: [{ name: 'input', valueUri: 's3://allowed-bucket/Patient.ndjson' }]
            })
            .set(getHeaders())
            .expect(202);

        const { createTestContainer } = require('../../createTestContainer');
        const container = createTestContainer();
        container.s3NdjsonReader.setLinesToYield(lines);

        await processRangeAsync(container.bulkImportHandler, container, {
            key: `${taskId}-0`,
            value: makeCloudEvent({ taskId, scope }),
            headers: []
        });

        const errorWrite = container.s3NdjsonReader.getWriteCalls()
            .find((c) => c.filepath.includes('/output/errors/'));
        return { request, errorWrite };
    };

    const statusOfAsync = async (request, path) => {
        const resp = await request.get(`/4_0_0/${path}`).set(getHeaders());
        return resp.status;
    };

    const expectRejected = (errorWrite, id, byteOffset = 0) => {
        expect(errorWrite).toBeDefined();
        const entry = errorWrite.data.trim().split('\n').map((line) => JSON.parse(line)).find((e) => e.id === id);
        expect(entry).toBeDefined();
        expect(entry.operationOutcome.issue[0].code).toBe('forbidden');
        expect(entry.operationOutcome.issue[0].extension).toEqual([
            { url: 'https://www.icanbwell.com/source-byte-offset', valueInteger: byteOffset }
        ]);
    };

    test.each([
        ['a v1 read-only scope', 'user/*.read access/client-a.read', false],
        ['a v2 scope without u at the resource gate', 'user/Patient.c access/client-a.cu', true],
        ['a v2 scope without u at the access gate', 'user/Patient.u access/client-a.c', true]
    ])('%s cannot import a resource', async (name, scope, enableV2) => {
        const { request, errorWrite } = await runImportAsync({
            taskId: 'import-scope-denied',
            scope,
            lines: [patient('import-scope-patient')],
            enableV2
        });

        expect(await statusOfAsync(request, 'Patient/import-scope-patient')).toBe(404);
        expectRejected(errorWrite, 'import-scope-patient');
        expect(fakeSpan.setAttributes).toHaveBeenCalledWith({
            'fhir_import.resources_created': 0,
            'fhir_import.resources_updated': 0,
            'fhir_import.resources_failed': 1
        });
    });

    test('a v2 scope with u at both gates imports the resource', async () => {
        const { request, errorWrite } = await runImportAsync({
            taskId: 'import-scope-allowed',
            scope: 'user/Patient.u access/client-a.u',
            lines: [patient('import-scope-patient')],
            enableV2: true
        });

        expect(await statusOfAsync(request, 'Patient/import-scope-patient')).toBe(200);
        expect(errorWrite).toBeUndefined();
    });

    test('only the resource types the caller holds u on are imported', async () => {
        const { request, errorWrite } = await runImportAsync({
            taskId: 'import-scope-mixed',
            scope: 'user/Patient.u user/Observation.rs access/client-a.u',
            lines: [patient('import-scope-patient'), observation('import-scope-observation')],
            enableV2: true
        });

        expect(await statusOfAsync(request, 'Patient/import-scope-patient')).toBe(200);
        expect(await statusOfAsync(request, 'Observation/import-scope-observation')).toBe(404);
        expectRejected(errorWrite, 'import-scope-observation', 100);
        expect(fakeSpan.setAttributes).toHaveBeenCalledWith({
            'fhir_import.resources_created': 1,
            'fhir_import.resources_updated': 0,
            'fhir_import.resources_failed': 1
        });
    });

    test('a resource whose access tag the caller lacks u on is rejected at its own byte offset', async () => {
        const otherTenantTags = securityTags.map((t) => ({ ...t, code: 'client-b' }));
        const { request, errorWrite } = await runImportAsync({
            taskId: 'import-scope-access-gate-offset',
            scope: 'user/Patient.u access/client-a.u',
            lines: [patient('import-scope-patient'), { ...patient('import-scope-other-tenant'), meta: { source: 'test', security: otherTenantTags } }],
            enableV2: true
        });

        expect(await statusOfAsync(request, 'Patient/import-scope-patient')).toBe(200);
        expect(await statusOfAsync(request, 'Patient/import-scope-other-tenant')).toBe(404);
        expectRejected(errorWrite, 'import-scope-other-tenant', 100);
    });
});
