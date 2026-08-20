const crypto = require('crypto');
const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { BulkImportHandler } = require('../../../operations/asyncJobs/bulkImport/handler');
const { ConfigManager } = require('../../../utils/configManager');

const TEST_WORKER_SECRET = 'test-worker-secret';

// Mirrors BulkImportEventProducer.signRangeProgressPayload -- these tests build
// ImportRangeStarted/ImportRangeCompleted/ImportRangeFailed messages by hand (rather than via
// the real producer) so they need to sign the payload themselves the same way.
const signRangeProgressPayload = (data) =>
    crypto.createHmac('sha256', TEST_WORKER_SECRET).update(JSON.stringify(data)).digest('hex');

const makeRangeProgressEvent = (type, overrides = {}) => {
    const data = {
        taskId: 'import-orch-001',
        filepath: 's3://allowed-bucket/Patient.ndjson',
        rangeIndex: 0,
        taskTotalRanges: 1,
        ...overrides
    };
    data.signature = signRangeProgressPayload(data);

    return JSON.stringify({
        specversion: '1.0',
        id: 'evt-range-001',
        source: 'https://www.icanbwell.com/fhir-server',
        type,
        datacontenttype: 'application/json',
        data
    });
};

const makeTaskCreatedEvent = (overrides = {}) => {
    const data = {
        taskId: 'import-orch-001',
        inputs: [{ url: 's3://allowed-bucket/Patient.ndjson' }],
        requestId: 'req-001',
        scope: 'user/*.write',
        user: 'test-user',
        ...overrides
    };

    return JSON.stringify({
        specversion: '1.0',
        id: 'evt-001',
        source: 'https://www.icanbwell.com/fhir-server',
        type: 'TaskCreated',
        datacontenttype: 'application/json',
        data
    });
};

const validParametersBody = {
    resourceType: 'Parameters',
    id: 'import-orch-001',
    parameter: [
        {
            name: 'input',
            valueUri: 's3://allowed-bucket/Patient.ndjson'
        }
    ]
};

describe('BulkImportHandler - TaskCreated (orchestrator)', () => {
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

    test('parseTaskCreatedEvent extracts data from valid TaskCreated message', () => {
        const { createTestContainer } = require('../../createTestContainer');
        const container = createTestContainer();
        const handler = container.bulkImportHandler;

        const data = handler.parseTaskCreatedEvent(makeTaskCreatedEvent());
        expect(data.taskId).toBe('import-orch-001');
        expect(data.inputs).toEqual([{ url: 's3://allowed-bucket/Patient.ndjson' }]);
        expect(data.requestId).toBe('req-001');
    });

    test('parseTaskCreatedEvent rejects wrong event type', () => {
        const { createTestContainer } = require('../../createTestContainer');
        const container = createTestContainer();
        const handler = container.bulkImportHandler;

        const badEvent = JSON.stringify({
            type: 'SomethingElse',
            data: { taskId: 'x' }
        });
        expect(() => handler.parseTaskCreatedEvent(badEvent)).toThrow('Unexpected event type');
    });

    test('parseTaskCreatedEvent rejects missing taskId', () => {
        const { createTestContainer } = require('../../createTestContainer');
        const container = createTestContainer();
        const handler = container.bulkImportHandler;

        const badEvent = JSON.stringify({
            type: 'TaskCreated',
            data: {}
        });
        expect(() => handler.parseTaskCreatedEvent(badEvent)).toThrow('missing taskId');
    });

    test('handleMessageAsync logs event without errors', async () => {
        const { createTestContainer } = require('../../createTestContainer');
        const container = createTestContainer();
        const handler = container.bulkImportHandler;

        await handler.handleMessageAsync({
            key: 'import-orch-001',
            value: makeTaskCreatedEvent(),
            headers: []
        });
    });

    test('handleMessageAsync ignores malformed messages', async () => {
        const { createTestContainer } = require('../../createTestContainer');
        const container = createTestContainer();
        const handler = container.bulkImportHandler;

        await handler.handleMessageAsync({
            key: 'bad-message',
            value: 'not-valid-json{{{',
            headers: []
        });
    });
});

describe('BulkImportHandler - ImportRangeStarted/ImportRangeCompleted/ImportRangeFailed (orchestrator)', () => {
    beforeEach(async () => {
        process.env.ENABLE_BULK_IMPORT = '1';
        process.env.BULK_IMPORT_ALLOWED_S3_BUCKETS = 'allowed-bucket';
        process.env.ENABLE_EVENTS_KAFKA_V2 = '1';
        process.env.BULK_IMPORT_WORKER_SECRET = TEST_WORKER_SECRET;
        await commonBeforeEach();
    });

    afterEach(async () => {
        delete process.env.ENABLE_BULK_IMPORT;
        delete process.env.BULK_IMPORT_ALLOWED_S3_BUCKETS;
        delete process.env.ENABLE_EVENTS_KAFKA_V2;
        delete process.env.BULK_IMPORT_WORKER_SECRET;
        await commonAfterEach();
    });

    test('ImportRangeStarted flips a requested Task to in-progress', async () => {
        const request = await createTestRequest();
        await request
            .post('/4_0_0/$import')
            .send({ ...validParametersBody, id: 'import-orch-started' })
            .set(getHeaders())
            .expect(202);

        const { createTestContainer } = require('../../createTestContainer');
        const container = createTestContainer();
        const handler = container.bulkImportHandler;

        await handler.handleMessageAsync({
            key: 'import-orch-started-0',
            value: makeRangeProgressEvent('ImportRangeStarted', { taskId: 'import-orch-started' }),
            headers: []
        });

        const taskResp = await request
            .get('/4_0_0/Task/import-orch-started')
            .set(getHeaders())
            .expect(200);
        expect(taskResp.body.status).toBe('in-progress');
    });

    test('ImportRangeFailed marks the Task failed with the reported error message', async () => {
        const request = await createTestRequest();
        await request
            .post('/4_0_0/$import')
            .send({ ...validParametersBody, id: 'import-orch-failed' })
            .set(getHeaders())
            .expect(202);

        const { createTestContainer } = require('../../createTestContainer');
        const container = createTestContainer();
        const handler = container.bulkImportHandler;

        await handler.handleMessageAsync({
            key: 'import-orch-failed-0',
            value: makeRangeProgressEvent('ImportRangeFailed', {
                taskId: 'import-orch-failed',
                errorMessage: 'S3 read timed out'
            }),
            headers: []
        });

        const taskResp = await request
            .get('/4_0_0/Task/import-orch-failed')
            .set(getHeaders())
            .expect(200);
        expect(taskResp.body.status).toBe('failed');
        expect(taskResp.body.statusReason.text).toBe('S3 read timed out');
    });

    test('ImportRangeCompleted appends Task.output and completes the Task once every range has reported', async () => {
        const request = await createTestRequest();
        await request
            .post('/4_0_0/$import')
            .send({ ...validParametersBody, id: 'import-orch-completed' })
            .set(getHeaders())
            .expect(202);

        const { createTestContainer } = require('../../createTestContainer');
        const container = createTestContainer();
        const handler = container.bulkImportHandler;

        await handler.handleMessageAsync({
            key: 'import-orch-completed-0',
            value: makeRangeProgressEvent('ImportRangeCompleted', {
                taskId: 'import-orch-completed',
                rangeIndex: 0,
                taskTotalRanges: 1,
                resultUri: 's3://allowed-bucket/output/Patient-001.ndjson',
                errorUri: null
            }),
            headers: []
        });

        const taskResp = await request
            .get('/4_0_0/Task/import-orch-completed')
            .set(getHeaders())
            .expect(200);
        expect(taskResp.body.status).toBe('completed');
        const resultOutput = taskResp.body.output.find((o) => o.type.text === 'result');
        expect(resultOutput.valueUri).toBe('s3://allowed-bucket/output/Patient-001.ndjson');
    });

    test('ImportRangeCompleted does not complete the Task until every range has reported', async () => {
        const request = await createTestRequest();
        await request
            .post('/4_0_0/$import')
            .send({ ...validParametersBody, id: 'import-orch-partial' })
            .set(getHeaders())
            .expect(202);

        const { createTestContainer } = require('../../createTestContainer');
        const container = createTestContainer();
        const handler = container.bulkImportHandler;

        await handler.handleMessageAsync({
            key: 'import-orch-partial-0',
            value: makeRangeProgressEvent('ImportRangeCompleted', {
                taskId: 'import-orch-partial',
                rangeIndex: 0,
                taskTotalRanges: 2,
                resultUri: 's3://allowed-bucket/output/Patient-001.ndjson',
                errorUri: null
            }),
            headers: []
        });

        let taskResp = await request
            .get('/4_0_0/Task/import-orch-partial')
            .set(getHeaders())
            .expect(200);
        expect(taskResp.body.status).not.toBe('completed');

        await handler.handleMessageAsync({
            key: 'import-orch-partial-1',
            value: makeRangeProgressEvent('ImportRangeCompleted', {
                taskId: 'import-orch-partial',
                rangeIndex: 1,
                taskTotalRanges: 2,
                resultUri: 's3://allowed-bucket/output/Patient-002.ndjson',
                errorUri: null
            }),
            headers: []
        });

        taskResp = await request
            .get('/4_0_0/Task/import-orch-partial')
            .set(getHeaders())
            .expect(200);
        expect(taskResp.body.status).toBe('completed');
        expect(taskResp.body.output).toHaveLength(2);
    });

    test('handleMessageAsync ignores malformed range-progress messages', async () => {
        const { createTestContainer } = require('../../createTestContainer');
        const container = createTestContainer();
        const handler = container.bulkImportHandler;

        await handler.handleMessageAsync({
            key: 'bad-message',
            value: 'not-valid-json{{{',
            headers: []
        });
    });

    // IDOR: without signature verification, anyone able to publish onto
    // kafkaBulkImportRangeProgressTopic could forge a message with an arbitrary taskId and
    // manipulate any Task's status/output. handleMessageAsync must reject rather than act on
    // an unsigned/mis-signed message instead of silently trusting it.
    test('handleMessageAsync ignores a range-progress message with no signature', async () => {
        const request = await createTestRequest();
        await request
            .post('/4_0_0/$import')
            .send({ ...validParametersBody, id: 'import-orch-no-sig' })
            .set(getHeaders())
            .expect(202);

        const { createTestContainer } = require('../../createTestContainer');
        const container = createTestContainer();
        const handler = container.bulkImportHandler;

        const unsignedData = { taskId: 'import-orch-no-sig', filepath: 's3://allowed-bucket/Patient.ndjson', rangeIndex: 0, taskTotalRanges: 1 };
        await handler.handleMessageAsync({
            key: 'import-orch-no-sig-0',
            value: JSON.stringify({
                specversion: '1.0', id: 'evt-no-sig', source: 'https://www.icanbwell.com/fhir-server',
                type: 'ImportRangeStarted', datacontenttype: 'application/json', data: unsignedData
            }),
            headers: []
        });

        const taskResp = await request
            .get('/4_0_0/Task/import-orch-no-sig')
            .set(getHeaders())
            .expect(200);
        // Must NOT have been flipped to in-progress -- the unsigned message was rejected.
        expect(taskResp.body.status).toBe('requested');
    });

    test('handleMessageAsync ignores a range-progress message with a tampered payload', async () => {
        const request = await createTestRequest();
        await request
            .post('/4_0_0/$import')
            .send({ ...validParametersBody, id: 'import-orch-tampered' })
            .set(getHeaders())
            .expect(202);

        const { createTestContainer } = require('../../createTestContainer');
        const container = createTestContainer();
        const handler = container.bulkImportHandler;

        // Sign a legitimate payload, then swap in a different taskId after signing -- the
        // signature no longer matches the (tampered) data it's attached to.
        const originalData = { taskId: 'some-other-task', filepath: 's3://allowed-bucket/Patient.ndjson', rangeIndex: 0, taskTotalRanges: 1 };
        const signature = signRangeProgressPayload(originalData);
        const tamperedData = { ...originalData, taskId: 'import-orch-tampered', signature };

        await handler.handleMessageAsync({
            key: 'import-orch-tampered-0',
            value: JSON.stringify({
                specversion: '1.0', id: 'evt-tampered', source: 'https://www.icanbwell.com/fhir-server',
                type: 'ImportRangeStarted', datacontenttype: 'application/json', data: tamperedData
            }),
            headers: []
        });

        const taskResp = await request
            .get('/4_0_0/Task/import-orch-tampered')
            .set(getHeaders())
            .expect(200);
        expect(taskResp.body.status).toBe('requested');
    });

    test('handleMessageAsync ignores a range-progress message when the worker secret is not configured', async () => {
        delete process.env.BULK_IMPORT_WORKER_SECRET;

        const request = await createTestRequest();
        await request
            .post('/4_0_0/$import')
            .send({ ...validParametersBody, id: 'import-orch-no-secret' })
            .set(getHeaders())
            .expect(202);

        const { createTestContainer } = require('../../createTestContainer');
        const container = createTestContainer();
        const handler = container.bulkImportHandler;

        await handler.handleMessageAsync({
            key: 'import-orch-no-secret-0',
            value: makeRangeProgressEvent('ImportRangeStarted', { taskId: 'import-orch-no-secret' }),
            headers: []
        });

        const taskResp = await request
            .get('/4_0_0/Task/import-orch-no-secret')
            .set(getHeaders())
            .expect(200);
        expect(taskResp.body.status).toBe('requested');
    });
});

// TODO: Uncomment when orchestrator logic is enabled in a follow-up PR.
//
// describe('headS3FilesAsync', () => {
//     const makeMockS3Client = (contentLength) => ({
//         send: jest.fn().mockResolvedValue({ ContentLength: contentLength })
//     });
//
//     const makeHandler = (s3Client, envOverrides = {}) => {
//         process.env.BULK_IMPORT_ALLOWED_S3_BUCKETS = envOverrides.buckets || 'allowed-bucket';
//         process.env.BULK_IMPORT_MIN_FILE_SIZE_MB = envOverrides.minMb || '0';
//         process.env.BULK_IMPORT_MAX_FILE_SIZE_GB = envOverrides.maxGb || '5';
//
//         const { createTestContainer } = require('../../createTestContainer');
//         const container = createTestContainer((c) => {
//             c.register('bulkImportHandler', (cc) => new BulkImportHandler({
//                 configManager: cc.configManager,
//                 kafkaClientV2: cc.kafkaClientV2,
//                 bulkImportEventProducer: cc.bulkImportEventProducer,
//                 databaseQueryFactory: cc.databaseQueryFactory,
//                 databaseUpdateFactory: cc.databaseUpdateFactory,
//                 fastDatabaseBulkInserter: cc.fastDatabaseBulkInserter,
//                 s3NdjsonReader: cc.s3NdjsonReader,
//                 postRequestProcessor: cc.postRequestProcessor,
//                 requestSpecificCache: cc.requestSpecificCache,
//                 s3Client
//             }));
//             return c;
//         });
//         return container.bulkImportHandler;
//     };
//
//     beforeEach(async () => {
//         process.env.ENABLE_BULK_IMPORT = '1';
//         process.env.ENABLE_EVENTS_KAFKA_V2 = '1';
//         await commonBeforeEach();
//     });
//
//     afterEach(async () => {
//         delete process.env.ENABLE_BULK_IMPORT;
//         delete process.env.ENABLE_EVENTS_KAFKA_V2;
//         delete process.env.BULK_IMPORT_ALLOWED_S3_BUCKETS;
//         delete process.env.BULK_IMPORT_MIN_FILE_SIZE_MB;
//         delete process.env.BULK_IMPORT_MAX_FILE_SIZE_GB;
//         await commonAfterEach();
//     });
//
//     test('returns inputs enriched with fileSize on success', async () => {
//         const mockS3 = makeMockS3Client(500 * 1024 * 1024);
//         const handler = makeHandler(mockS3);
//
//         const result = await handler.headS3FilesAsync([
//             { url: 's3://allowed-bucket/Patient.ndjson' }
//         ]);
//
//         expect(result).toEqual([
//             { url: 's3://allowed-bucket/Patient.ndjson', fileSize: 500 * 1024 * 1024 }
//         ]);
//         expect(mockS3.send).toHaveBeenCalledTimes(1);
//     });
//
//     test('throws on disallowed bucket', async () => {
//         const mockS3 = makeMockS3Client(100);
//         const handler = makeHandler(mockS3);
//
//         await expect(handler.headS3FilesAsync([
//             { url: 's3://evil-bucket/data.ndjson' }
//         ])).rejects.toThrow('not in the allowed list');
//         expect(mockS3.send).not.toHaveBeenCalled();
//     });
//
//     test('throws on invalid S3 URI', async () => {
//         const mockS3 = makeMockS3Client(100);
//         const handler = makeHandler(mockS3);
//
//         await expect(handler.headS3FilesAsync([
//             { url: 'https://example.com/file.ndjson' }
//         ])).rejects.toThrow('Invalid S3 URI');
//     });
//
//     test('throws when S3 HEAD fails', async () => {
//         const mockS3 = {
//             send: jest.fn().mockRejectedValue(Object.assign(new Error('Access Denied'), { name: 'AccessDenied' }))
//         };
//         const handler = makeHandler(mockS3);
//
//         await expect(handler.headS3FilesAsync([
//             { url: 's3://allowed-bucket/missing.ndjson' }
//         ])).rejects.toThrow('Cannot access S3 file');
//     });
//
//     test('throws on empty file', async () => {
//         const mockS3 = makeMockS3Client(0);
//         const handler = makeHandler(mockS3);
//
//         await expect(handler.headS3FilesAsync([
//             { url: 's3://allowed-bucket/empty.ndjson' }
//         ])).rejects.toThrow('empty (0 bytes)');
//     });
//
//     test('throws when file is below minimum size', async () => {
//         const mockS3 = makeMockS3Client(1 * 1024 * 1024);
//         const handler = makeHandler(mockS3, { minMb: '50' });
//
//         await expect(handler.headS3FilesAsync([
//             { url: 's3://allowed-bucket/tiny.ndjson' }
//         ])).rejects.toThrow('below the minimum');
//     });
//
//     test('throws when file exceeds maximum size', async () => {
//         const mockS3 = makeMockS3Client(10 * 1024 * 1024 * 1024);
//         const handler = makeHandler(mockS3, { maxGb: '5' });
//
//         await expect(handler.headS3FilesAsync([
//             { url: 's3://allowed-bucket/huge.ndjson' }
//         ])).rejects.toThrow('above the maximum');
//     });
//
//     test('throws when allowlist is empty', async () => {
//         const mockS3 = makeMockS3Client(100);
//         const handler = makeHandler(mockS3, { buckets: '' });
//
//         await expect(handler.headS3FilesAsync([
//             { url: 's3://any-bucket/file.ndjson' }
//         ])).rejects.toThrow('allowlist is not configured');
//     });
//
//     test('handles multiple inputs', async () => {
//         let callCount = 0;
//         const mockS3 = {
//             send: jest.fn().mockImplementation(() => {
//                 callCount++;
//                 return Promise.resolve({ ContentLength: callCount * 100 * 1024 * 1024 });
//             })
//         };
//         const handler = makeHandler(mockS3);
//
//         const result = await handler.headS3FilesAsync([
//             { url: 's3://allowed-bucket/Patient.ndjson' },
//             { url: 's3://allowed-bucket/Observation.ndjson' }
//         ]);
//
//         expect(result).toHaveLength(2);
//         expect(result[0].fileSize).toBe(100 * 1024 * 1024);
//         expect(result[1].fileSize).toBe(200 * 1024 * 1024);
//         expect(mockS3.send).toHaveBeenCalledTimes(2);
//     });
// });
