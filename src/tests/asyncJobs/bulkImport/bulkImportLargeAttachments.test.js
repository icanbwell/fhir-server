const {
    afterEach,
    beforeEach,
    describe,
    expect,
    jest,
    test
} = require('@jest/globals');

const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../../common');
const { createTestContainer } = require('../../createTestContainer');

// Bulk import must externalize large attachments the same way create/update/$merge
// already do -- otherwise a >16MB attachment blows MongoDB's own 16MB/document BSON limit on
// insert regardless of bulkImportMaxLineSizeMb. Two separate, pre-existing mechanisms cover
// this depending on resourceType (see handler.js's comment at the call site):
// - DocumentReference.content[].attachment.data -> MongoDB GridFS (`_file_id`), enabled by
//   default in tests via jest/setEnvVars.js's GRIDFS_RESOURCES=DocumentReference.
// - Binary.data -> cloud storage (`_blobMeta`), gated behind BASE64_FIELD_CLOUD_STORAGE_ENABLED
//   (off by default in tests) -- covered separately by
//   src/tests/binary/blobStorage/blobStorage.test.js, which already exercises create/update/
//   $merge; this file only needs to confirm the bulk-import call site reaches it (see
//   handlerWorker.test.js's "runs each resource through Base64DataManager before insert" test).

const LARGE_DATA = 'A'.repeat(80 * 1024);

const validParametersBody = {
    resourceType: 'Parameters',
    id: 'import-large-attachment',
    parameter: [
        { name: 'input', valueUri: 's3://allowed-bucket/DocumentReference.ndjson' }
    ]
};

const makeCloudEvent = (overrides = {}) => {
    const data = {
        taskId: 'import-large-attachment',
        filepath: 's3://allowed-bucket/DocumentReference.ndjson',
        byteRangeStart: 0,
        byteRangeEnd: 104857600,
        rangeIndex: 0,
        totalRanges: 1,
        taskTotalRanges: 1,
        requestId: 'req-001',
        scope: 'user/*.write access/*.*',
        user: 'test-user',
        ...overrides
    };

    return JSON.stringify({
        specversion: '1.0',
        id: 'evt-001',
        source: 'https://www.icanbwell.com/fhir-server',
        type: 'ImportRangeRequested',
        datacontenttype: 'application/json',
        data
    });
};

async function processRangeAsync(handler, container, message) {
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

describe('Bulk import — large attachment externalization', () => {
    beforeEach(async () => {
        process.env.ENABLE_BULK_IMPORT = '1';
        process.env.BULK_IMPORT_ALLOWED_S3_BUCKETS = 'allowed-bucket';
        process.env.ENABLE_EVENTS_KAFKA_V2 = '1';
        await commonBeforeEach();
    });

    afterEach(async () => {
        delete process.env.ENABLE_BULK_IMPORT;
        delete process.env.BULK_IMPORT_ALLOWED_S3_BUCKETS;
        delete process.env.ENABLE_EVENTS_KAFKA_V2;
        await commonAfterEach();
    });

    test('handleMessageAsync externalizes a DocumentReference attachment to GridFS instead of failing the line', async () => {
        const request = await createTestRequest();

        await request
            .post('/4_0_0/$import')
            .send(validParametersBody)
            .set(getHeaders())
            .expect(202);

        const container = createTestContainer();
        const handler = container.bulkImportHandler;

        container.s3NdjsonReader.setLinesToYield([
            {
                resourceType: 'DocumentReference',
                id: 'bulk-import-large-doc',
                status: 'current',
                content: [
                    { attachment: { contentType: 'application/pdf', data: LARGE_DATA } }
                ]
            }
        ]);

        await processRangeAsync(handler, container, {
            key: 'import-large-attachment-0',
            value: makeCloudEvent(),
            headers: []
        });

        const taskResp = await request
            .get('/4_0_0/Task/import-large-attachment')
            .set(getHeaders())
            .expect(200);
        expect(taskResp.body.status).toBe('completed');

        // The line must NOT have been rejected as too-large -- no error output written.
        const writeCalls = container.s3NdjsonReader.getWriteCalls();
        const errorWrite = writeCalls.find((c) => c.filepath.includes('/output/errors/'));
        expect(errorWrite).toBeUndefined();

        // Mongo doc should have the attachment externalized: no inline data, a _file_id sidecar.
        const fhirDb = await container.mongoDatabaseManager.getClientDbAsync();
        const mongoDoc = await fhirDb.collection('DocumentReference_4_0_0').findOne({ id: 'bulk-import-large-doc' });
        expect(mongoDoc).toBeDefined();
        expect(mongoDoc.content[0].attachment.data).toBeUndefined();
        expect(typeof mongoDoc.content[0].attachment._file_id).toBe('string');

        // The actual bytes should be retrievable back out of GridFS.
        const gridFSBucket = await container.mongoDatabaseManager.getGridFsBucket();
        const chunks = [];
        await new Promise((resolve, reject) => {
            gridFSBucket.openDownloadStream(new (require('mongodb').ObjectId)(mongoDoc.content[0].attachment._file_id))
                .on('data', (chunk) => chunks.push(chunk))
                .on('error', reject)
                .on('end', resolve);
        });
        expect(Buffer.concat(chunks).toString('utf-8')).toBe(LARGE_DATA);
    });

    test('handleMessageAsync does not upload an attachment for a line skipped via ifNoneExist', async () => {
        const request = await createTestRequest();

        // Pre-existing DocumentReference created via $merge so it is committed and
        // searchable before the bulk-import skip range runs.
        await request
            .post('/4_0_0/$merge')
            .send({
                resourceType: 'DocumentReference',
                id: 'bulk-import-attachment-preexisting',
                meta: { source: 'https://www.icanbwell.com' },
                status: 'current',
                identifier: [{ system: 'http://example.com', value: 'attachment-skip-12345' }],
                content: [{ attachment: { contentType: 'application/pdf' } }]
            })
            .set(getHeaders())
            .expect(200);

        await request
            .post('/4_0_0/$import')
            .send({ ...validParametersBody, id: 'import-large-attachment-skip' })
            .set(getHeaders())
            .expect(202);

        const container = createTestContainer();
        const handler = container.bulkImportHandler;

        const gridFSBucket = await container.mongoDatabaseManager.getGridFsBucket();
        const fhirDb = await container.mongoDatabaseManager.getClientDbAsync();

        // Snapshot GridFS file count before the skip range runs -- the skipped line's attachment
        // must not add any new GridFS entries (uploading then discarding would orphan the bytes
        // permanently since no document ever references the resulting _file_id for cleanup).
        const gridFsFilesBefore = await gridFSBucket.find({}).toArray();

        container.s3NdjsonReader.setLinesToYield([
            {
                ifNoneExist: 'identifier=http://example.com|attachment-skip-12345',
                resource: {
                    resourceType: 'DocumentReference',
                    id: 'bulk-import-attachment-should-not-be-created',
                    status: 'current',
                    identifier: [{ system: 'http://example.com', value: 'attachment-skip-12345' }],
                    content: [
                        { attachment: { contentType: 'application/pdf', data: LARGE_DATA } }
                    ]
                }
            }
        ]);
        await processRangeAsync(handler, container, {
            key: 'import-large-attachment-skip-0',
            value: makeCloudEvent({ taskId: 'import-large-attachment-skip' }),
            headers: []
        });

        const taskResp = await request
            .get('/4_0_0/Task/import-large-attachment-skip')
            .set(getHeaders())
            .expect(200);
        expect(taskResp.body.status).toBe('completed');

        // Skipped resource must not be in MongoDB.
        const skippedDoc = await fhirDb.collection('DocumentReference_4_0_0')
            .findOne({ id: 'bulk-import-attachment-should-not-be-created' });
        expect(skippedDoc).toBeNull();

        // No new GridFS files must have been uploaded for the skipped line.
        const gridFsFilesAfter = await gridFSBucket.find({}).toArray();
        expect(gridFsFilesAfter).toHaveLength(gridFsFilesBefore.length);
    });

    test('handleMessageAsync strips an attacker-supplied _file_id with no data instead of persisting it verbatim', async () => {
        const request = await createTestRequest();

        await request
            .post('/4_0_0/$import')
            .send({ ...validParametersBody, id: 'import-attachment-pointer-injection' })
            .set(getHeaders())
            .expect(202);

        const container = createTestContainer();
        const handler = container.bulkImportHandler;

        // No `data` at all -- only a directly-supplied _file_id, as if crafted to point at
        // another tenant's already-uploaded GridFS content. convertDataToFileId only ever sets
        // _file_id when `data` is present, so an unstripped _file_id here would persist
        // unchanged and later reads would stream back whatever that id actually points to.
        container.s3NdjsonReader.setLinesToYield([
            {
                resourceType: 'DocumentReference',
                id: 'bulk-import-pointer-injection',
                status: 'current',
                content: [
                    { attachment: { contentType: 'application/pdf', _file_id: '000000000000000000000000' } }
                ]
            }
        ]);

        await processRangeAsync(handler, container, {
            key: 'import-attachment-pointer-injection-0',
            value: makeCloudEvent({ taskId: 'import-attachment-pointer-injection' }),
            headers: []
        });

        const taskResp = await request
            .get('/4_0_0/Task/import-attachment-pointer-injection')
            .set(getHeaders())
            .expect(200);
        expect(taskResp.body.status).toBe('completed');

        const fhirDb = await container.mongoDatabaseManager.getClientDbAsync();
        const mongoDoc = await fhirDb.collection('DocumentReference_4_0_0')
            .findOne({ id: 'bulk-import-pointer-injection' });
        expect(mongoDoc).toBeDefined();
        expect(mongoDoc.content[0].attachment._file_id).toBeUndefined();
    });
});
