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

const ownerTags = [
    { system: 'https://www.icanbwell.com/owner', code: 'client-a' },
    { system: 'https://www.icanbwell.com/access', code: 'client-a' },
    { system: 'https://www.icanbwell.com/sourceAssigningAuthority', code: 'client-a' }
];

const patient = (overrides = {}) => ({
    resourceType: 'Patient',
    id: 'import-check-patient',
    meta: { source: 'test', security: ownerTags },
    name: [{ family: 'Imported' }],
    ...overrides
});

// Each imported resource must clear the same pre-merge checks the $merge API applies before it
// is written. These cases cover the checks the worker did not run before: the pipe-in-id rule and
// meta validation (here, more than one owner tag on a new resource). In each case the rejected
// line is recorded in the error output and the rest of the range is still imported.
describe('BulkImportHandler - $merge pre-merge checks in the worker', () => {
    let fakeSpan;
    let activeSpanSpy;

    beforeEach(async () => {
        process.env.ENABLE_BULK_IMPORT = '1';
        process.env.BULK_IMPORT_ALLOWED_S3_BUCKETS = 'allowed-bucket';
        process.env.ENABLE_EVENTS_KAFKA_V2 = '1';
        fakeSpan = { setAttributes: jest.fn() };
        activeSpanSpy = jest.spyOn(trace, 'getActiveSpan').mockReturnValue(fakeSpan);
        await commonBeforeEach();
    });

    afterEach(async () => {
        delete process.env.ENABLE_BULK_IMPORT;
        delete process.env.BULK_IMPORT_ALLOWED_S3_BUCKETS;
        delete process.env.ENABLE_EVENTS_KAFKA_V2;
        activeSpanSpy.mockRestore();
        await commonAfterEach();
    });

    const runImportAsync = async ({ taskId, lines }) => {
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
            value: makeCloudEvent({ taskId, scope: 'user/*.write access/*.*' }),
            headers: []
        });

        const errorWrite = container.s3NdjsonReader.getWriteCalls()
            .find((c) => c.filepath.includes('/output/errors/'));
        return { request, errorWrite };
    };

    test.each([
        ['an id containing a pipe', patient({ id: 'import-check|patient' }), 'Patient', 'Pipe | is not allowed in id field'],
        [
            'more than one owner tag on a new resource',
            patient({
                meta: {
                    source: 'test',
                    security: [...ownerTags, { system: 'https://www.icanbwell.com/owner', code: 'client-b' }]
                }
            }),
            'Patient',
            'owner'
        ]
    ])('a resource with %s is rejected and not written', async (name, resource, resourceType, expectedText) => {
        const { request, errorWrite } = await runImportAsync({
            taskId: 'import-check-rejected',
            lines: [resource, patient({ id: 'import-check-survivor' })]
        });

        expect(errorWrite).toBeDefined();
        expect(errorWrite.data).toContain(expectedText);
        const resp = await request.get(`/4_0_0/${resourceType}/${resource.id}`).set(getHeaders());
        expect(resp.status).not.toBe(200);
        await request.get('/4_0_0/Patient/import-check-survivor').set(getHeaders()).expect(200);
        expect(fakeSpan.setAttributes).toHaveBeenCalledWith({
            'fhir_import.resources_created': 1,
            'fhir_import.resources_updated': 0,
            'fhir_import.resources_failed': 1
        });
    });
});
