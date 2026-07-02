const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { ImportOperation } = require('../../operations/import/import');

const makeCloudEvent = (overrides = {}) => {
    const data = {
        taskId: 'import-consumer-001',
        filepath: 's3://allowed-bucket/Patient.ndjson',
        byteRangeStart: 0,
        byteRangeEnd: 104857600,
        rangeIndex: 0,
        totalRanges: 1,
        requestId: 'req-001',
        scope: 'user/*.write',
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

const validParametersBody = {
    resourceType: 'Parameters',
    id: 'import-consumer-001',
    parameter: [
        {
            name: 'input',
            valueUri: 's3://allowed-bucket/Patient.ndjson'
        }
    ]
};

describe('BulkImportConsumerRunner', () => {
    let originalHeadS3FilesAsync;

    beforeEach(async () => {
        process.env.ENABLE_BULK_IMPORT = '1';
        process.env.ENABLE_EVENTS_KAFKA = '1';
        process.env.BULK_IMPORT_ALLOWED_S3_BUCKETS = 'allowed-bucket';
        originalHeadS3FilesAsync = ImportOperation.prototype.headS3FilesAsync;
        ImportOperation.prototype.headS3FilesAsync = async (inputs) =>
            inputs.map((i) => ({ url: i.url, fileSize: 100 * 1024 * 1024 }));
        await commonBeforeEach();
    });

    afterEach(async () => {
        ImportOperation.prototype.headS3FilesAsync = originalHeadS3FilesAsync;
        delete process.env.ENABLE_BULK_IMPORT;
        delete process.env.ENABLE_EVENTS_KAFKA;
        delete process.env.BULK_IMPORT_ALLOWED_S3_BUCKETS;
        await commonAfterEach();
    });

    test('parseCloudEvent extracts data from valid message', () => {
        const { createTestContainer } = require('../createTestContainer');
        const container = createTestContainer();
        const runner = container.bulkImportConsumerRunner;

        const data = runner.parseCloudEvent(makeCloudEvent());
        expect(data.taskId).toBe('import-consumer-001');
        expect(data.filepath).toBe('s3://allowed-bucket/Patient.ndjson');
        expect(data.byteRangeStart).toBe(0);
        expect(data.byteRangeEnd).toBe(104857600);
        expect(data.rangeIndex).toBe(0);
        expect(data.totalRanges).toBe(1);
    });

    test('parseCloudEvent rejects wrong event type', () => {
        const { createTestContainer } = require('../createTestContainer');
        const container = createTestContainer();
        const runner = container.bulkImportConsumerRunner;

        const badEvent = JSON.stringify({
            type: 'SomethingElse',
            data: { taskId: 'x', filepath: 'y' }
        });
        expect(() => runner.parseCloudEvent(badEvent)).toThrow('Unexpected event type');
    });

    test('handleMessageAsync updates Task status to in-progress', async () => {
        const request = await createTestRequest();

        await request
            .post('/4_0_0/$import')
            .send(validParametersBody)
            .set(getHeaders())
            .expect(202);

        let taskResp = await request
            .get('/4_0_0/Task/import-consumer-001')
            .set(getHeaders())
            .expect(200);
        expect(taskResp.body.status).toBe('requested');

        const { createTestContainer } = require('../createTestContainer');
        const container = createTestContainer();
        const runner = container.bulkImportConsumerRunner;

        await runner.handleMessageAsync({
            key: 'import-consumer-001-0-0',
            value: makeCloudEvent(),
            headers: []
        });

        taskResp = await request
            .get('/4_0_0/Task/import-consumer-001')
            .set(getHeaders())
            .expect(200);
        expect(taskResp.body.status).toBe('in-progress');
    });

    test('handleMessageAsync skips update if Task not found', async () => {
        const { createTestContainer } = require('../createTestContainer');
        const container = createTestContainer();
        const runner = container.bulkImportConsumerRunner;

        await runner.handleMessageAsync({
            key: 'nonexistent-task-0',
            value: makeCloudEvent({ taskId: 'nonexistent-task' }),
            headers: []
        });
    });

    test('handleMessageAsync does not downgrade in-progress to in-progress', async () => {
        const request = await createTestRequest();

        await request
            .post('/4_0_0/$import')
            .send(validParametersBody)
            .set(getHeaders())
            .expect(202);

        const { createTestContainer } = require('../createTestContainer');
        const container = createTestContainer();
        const runner = container.bulkImportConsumerRunner;

        await runner.handleMessageAsync({
            key: 'import-consumer-001-0-0',
            value: makeCloudEvent({ rangeIndex: 0, totalRanges: 2 }),
            headers: []
        });

        await runner.handleMessageAsync({
            key: 'import-consumer-001-1',
            value: makeCloudEvent({ rangeIndex: 1, totalRanges: 2 }),
            headers: []
        });

        const taskResp = await request
            .get('/4_0_0/Task/import-consumer-001')
            .set(getHeaders())
            .expect(200);
        expect(taskResp.body.status).toBe('in-progress');
    });

    test('handleMessageAsync ignores malformed messages', async () => {
        const { createTestContainer } = require('../createTestContainer');
        const container = createTestContainer();
        const runner = container.bulkImportConsumerRunner;

        await runner.handleMessageAsync({
            key: 'bad-message',
            value: 'not-valid-json{{{',
            headers: []
        });
    });
});
