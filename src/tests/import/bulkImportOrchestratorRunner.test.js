const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { BulkImportOrchestratorRunner } = require('../../operations/import/bulkImportOrchestratorRunner');

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

describe('BulkImportOrchestratorRunner', () => {
    let originalHeadS3FilesAsync;

    beforeEach(async () => {
        process.env.ENABLE_BULK_IMPORT = '1';
        process.env.BULK_IMPORT_ALLOWED_S3_BUCKETS = 'allowed-bucket';
        process.env.ENABLE_EVENTS_KAFKA_V2 = '1';
        originalHeadS3FilesAsync = BulkImportOrchestratorRunner.prototype.headS3FilesAsync;
        BulkImportOrchestratorRunner.prototype.headS3FilesAsync = async (inputs) =>
            inputs.map((i) => ({ url: i.url, fileSize: 100 * 1024 * 1024 }));
        await commonBeforeEach();
    });

    afterEach(async () => {
        BulkImportOrchestratorRunner.prototype.headS3FilesAsync = originalHeadS3FilesAsync;
        delete process.env.ENABLE_BULK_IMPORT;
        delete process.env.BULK_IMPORT_ALLOWED_S3_BUCKETS;
        delete process.env.ENABLE_EVENTS_KAFKA_V2;
        await commonAfterEach();
    });

    test('parseCloudEvent extracts data from valid TaskCreated message', () => {
        const { createTestContainer } = require('../createTestContainer');
        const container = createTestContainer();
        const runner = container.bulkImportOrchestratorRunner;

        const data = runner.parseCloudEvent(makeTaskCreatedEvent());
        expect(data.taskId).toBe('import-orch-001');
        expect(data.inputs).toEqual([{ url: 's3://allowed-bucket/Patient.ndjson' }]);
        expect(data.requestId).toBe('req-001');
    });

    test('parseCloudEvent rejects wrong event type', () => {
        const { createTestContainer } = require('../createTestContainer');
        const container = createTestContainer();
        const runner = container.bulkImportOrchestratorRunner;

        const badEvent = JSON.stringify({
            type: 'SomethingElse',
            data: { taskId: 'x' }
        });
        expect(() => runner.parseCloudEvent(badEvent)).toThrow('Unexpected event type');
    });

    test('parseCloudEvent rejects missing taskId', () => {
        const { createTestContainer } = require('../createTestContainer');
        const container = createTestContainer();
        const runner = container.bulkImportOrchestratorRunner;

        const badEvent = JSON.stringify({
            type: 'TaskCreated',
            data: {}
        });
        expect(() => runner.parseCloudEvent(badEvent)).toThrow('missing taskId');
    });

    test('handleMessageAsync publishes byte-range messages after S3 HEAD', async () => {
        const request = await createTestRequest();

        await request
            .post('/4_0_0/$import')
            .send(validParametersBody)
            .set(getHeaders())
            .expect(202);

        const { createTestContainer } = require('../createTestContainer');
        const container = createTestContainer();
        const runner = container.bulkImportOrchestratorRunner;

        container.kafkaClientV2.clear();

        await runner.handleMessageAsync({
            key: 'import-orch-001',
            value: makeTaskCreatedEvent(),
            headers: []
        });

        const messages = container.kafkaClientV2.getCloudEventMessages();
        expect(messages.length).toBeGreaterThan(0);
        const parsed = JSON.parse(messages[0].value);
        expect(parsed.type).toBe('ImportRangeRequested');
        expect(parsed.data.taskId).toBe('import-orch-001');
    });

    test('handleMessageAsync sets Task to failed on S3 error', async () => {
        const request = await createTestRequest();

        await request
            .post('/4_0_0/$import')
            .send(validParametersBody)
            .set(getHeaders())
            .expect(202);

        BulkImportOrchestratorRunner.prototype.headS3FilesAsync = async () => {
            throw new Error('Cannot access S3 file "s3://allowed-bucket/Patient.ndjson": NoSuchKey');
        };

        const { createTestContainer } = require('../createTestContainer');
        const container = createTestContainer();
        const runner = container.bulkImportOrchestratorRunner;

        await runner.handleMessageAsync({
            key: 'import-orch-001',
            value: makeTaskCreatedEvent(),
            headers: []
        });

        const taskResp = await request
            .get('/4_0_0/Task/import-orch-001')
            .set(getHeaders())
            .expect(200);
        expect(taskResp.body.status).toBe('failed');
        expect(taskResp.body.statusReason.text).toContain('Cannot access S3 file');
    });

    test('handleMessageAsync sets Task to failed on file too small', async () => {
        const request = await createTestRequest();

        await request
            .post('/4_0_0/$import')
            .send(validParametersBody)
            .set(getHeaders())
            .expect(202);

        BulkImportOrchestratorRunner.prototype.headS3FilesAsync = async () => {
            throw new Error('File "s3://allowed-bucket/Patient.ndjson" is 1.0 MB, below the minimum of 50 MB');
        };

        const { createTestContainer } = require('../createTestContainer');
        const container = createTestContainer();
        const runner = container.bulkImportOrchestratorRunner;

        await runner.handleMessageAsync({
            key: 'import-orch-001',
            value: makeTaskCreatedEvent(),
            headers: []
        });

        const taskResp = await request
            .get('/4_0_0/Task/import-orch-001')
            .set(getHeaders())
            .expect(200);
        expect(taskResp.body.status).toBe('failed');
        expect(taskResp.body.statusReason.text).toContain('below the minimum');
    });

    test('handleMessageAsync skips if Task not found', async () => {
        const { createTestContainer } = require('../createTestContainer');
        const container = createTestContainer();
        const runner = container.bulkImportOrchestratorRunner;

        await runner.handleMessageAsync({
            key: 'nonexistent-task',
            value: makeTaskCreatedEvent({ taskId: 'nonexistent-task' }),
            headers: []
        });

        const messages = container.kafkaClientV2.getCloudEventMessages();
        expect(messages.length).toBe(0);
    });

    test('handleMessageAsync ignores malformed messages', async () => {
        const { createTestContainer } = require('../createTestContainer');
        const container = createTestContainer();
        const runner = container.bulkImportOrchestratorRunner;

        await runner.handleMessageAsync({
            key: 'bad-message',
            value: 'not-valid-json{{{',
            headers: []
        });
    });
});
