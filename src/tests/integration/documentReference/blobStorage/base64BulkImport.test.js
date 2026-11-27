'use strict';

const { afterEach, beforeEach, describe, expect, jest, test } = require('@jest/globals');
const { commonAfterEach, commonBeforeEach, getHeaders } = require('../../common');
const { createTestContainer } = require('../../createTestContainer');
const {
    ENV_FLAG_OFF, ENV_ON, LARGE_DATA, SMALL_DATA, WRITE_MODES,
    applyWriteMode, createRequestAsync, registerMockClients, restoreEnv, saveEnv
} = require('./blobStorageTestSupport');

const IMPORT_ENV_KEYS = ['ENABLE_BULK_IMPORT', 'BULK_IMPORT_ALLOWED_S3_BUCKETS', 'ENABLE_EVENTS_KAFKA_V2'];
const DOC_ID = 'bulk-import-idempotent';

const parametersBody = (taskId) => ({
    resourceType: 'Parameters',
    id: taskId,
    parameter: [{ name: 'input', valueUri: 's3://allowed-bucket/DocumentReference.ndjson' }]
});

const cloudEvent = ({ taskId, requestId }) => JSON.stringify({
    specversion: '1.0',
    id: `evt-${taskId}`,
    source: 'https://www.icanbwell.com/fhir-server',
    type: 'ImportRangeRequested',
    datacontenttype: 'application/json',
    data: {
        taskId,
        filepath: 's3://allowed-bucket/DocumentReference.ndjson',
        byteRangeStart: 0,
        byteRangeEnd: 104857600,
        rangeIndex: 0,
        totalRanges: 1,
        taskTotalRanges: 1,
        requestId,
        scope: 'user/*.write access/*.*',
        user: 'test-user'
    }
});

// The line the file holds; a fresh object each time, because the handler changes what it reads
const line = (data) => ({
    resourceType: 'DocumentReference',
    id: DOC_ID,
    status: 'current',
    content: [{ attachment: { contentType: 'application/pdf', data } }]
});

// Handles the range message, then the follow-up messages it sends (as the bulk import test does)
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

// Bulk import has two write paths. With `import` in WRITE_PIPELINE_OPERATIONS a flush runs on the
// write pipeline; without it the worker calls mergeManager.mergeResourceAsync per line. Both go
// through the same merge, so the result is expected to be the same in both modes.
describe.each(WRITE_MODES)(
    'DocumentReference bulk import of an attachment, imported twice [%s]',
    (_mode, operations) => {
        let savedEnv;
        let savedImportEnv;

        beforeEach(async () => {
            savedEnv = saveEnv();
            savedImportEnv = Object.fromEntries(IMPORT_ENV_KEYS.map((key) => [key, process.env[key]]));
            applyWriteMode(operations);
            process.env.ENABLE_BULK_IMPORT = '1';
            process.env.BULK_IMPORT_ALLOWED_S3_BUCKETS = 'allowed-bucket';
            process.env.ENABLE_EVENTS_KAFKA_V2 = '1';
            await commonBeforeEach();
        });

        afterEach(async () => {
            await commonAfterEach();
            restoreEnv(savedEnv);
            for (const [key, value] of Object.entries(savedImportEnv)) {
                if (value === undefined) {
                    delete process.env[key];
                } else {
                    process.env[key] = value;
                }
            }
        });

        test.each([
            ['above the threshold (S3)', ENV_ON, LARGE_DATA, 's3'],
            ['below the threshold (inline)', ENV_ON, SMALL_DATA, 'inline'],
            ['with the DocumentReference flag off (GridFS)', ENV_FLAG_OFF, LARGE_DATA, 'gridfs']
        ])('an attachment %s: a second import of the same body changes nothing', async (_name, env, data, kind) => {
            const request = await createRequestAsync(env);
            // one handler container for both imports: its mock S3 must keep the first import's object
            const container = createTestContainer(registerMockClients);
            const db = await container.mongoDatabaseManager.getClientDbAsync();

            const snapshot = async () => ({
                doc: await db.collection('DocumentReference_4_0_0').findOne({ id: DOC_ID }),
                s3Objects: Object.keys(container.base64FieldCloudStorageClient.uploadedData).length,
                gridFsFiles: await db.collection('fs.files').countDocuments({})
            });
            // each import has its own Task and request id (request-scoped caches are shared per id)
            const importOnce = async (taskId, requestId) => {
                await request.post('/4_0_0/$import').send(parametersBody(taskId)).set(getHeaders()).expect(202);
                container.s3NdjsonReader.setLinesToYield([line(data)]);
                await processRangeAsync(container.bulkImportHandler, container, {
                    key: `${taskId}-0`, value: cloudEvent({ taskId, requestId }), headers: []
                });
                const task = await request.get(`/4_0_0/Task/${taskId}`).set(getHeaders()).expect(200);
                expect(task.body.status).toBe('completed');
                const errorWrite = container.s3NdjsonReader.getWriteCalls()
                    .find((call) => call.filepath.includes('/output/errors/'));
                expect(errorWrite).toBeUndefined();
                return await snapshot();
            };

            const first = await importOnce('import-first', 'req-import-first');
            expect(first.doc.meta.versionId).toBe('1');
            expect(first.doc.content).toHaveLength(1);
            const stored = first.doc.content[0].attachment;
            if (kind === 's3') {
                expect(stored._blobMeta).toBeDefined();
                expect(first.s3Objects).toBe(1);
            } else if (kind === 'inline') {
                expect(stored.data).toBe(data);
                expect(first.s3Objects).toBe(0);
            } else {
                expect(stored._file_id).toBeDefined();
                expect(first.gridFsFiles).toBe(1);
            }

            const second = await importOnce('import-second', 'req-import-second');

            expect(second.doc.meta.versionId).toBe(first.doc.meta.versionId);
            expect(second.doc.content).toHaveLength(1);
            expect(second.s3Objects).toBe(first.s3Objects);
            expect(second.gridFsFiles).toBe(first.gridFsFiles);
        });
    }
);
