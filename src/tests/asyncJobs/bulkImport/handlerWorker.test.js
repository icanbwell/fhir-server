const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../../common');
const { describe, beforeEach, afterEach, test, expect, jest } = require('@jest/globals');

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

describe('BulkImportHandler - ImportRangeRequested (worker)', () => {
    beforeEach(async () => {
        process.env.ENABLE_BULK_IMPORT = '1';
        process.env.BULK_IMPORT_ALLOWED_S3_BUCKETS = 'allowed-bucket';
        await commonBeforeEach();
    });

    afterEach(async () => {
        delete process.env.ENABLE_BULK_IMPORT;
        delete process.env.BULK_IMPORT_ALLOWED_S3_BUCKETS;
        await commonAfterEach();
    });

    test('parseImportRangeRequestedEvent extracts data from valid message', () => {
        const { createTestContainer } = require('../../createTestContainer');
        const container = createTestContainer();
        const handler = container.bulkImportHandler;

        const data = handler.parseImportRangeRequestedEvent(makeCloudEvent());
        expect(data.taskId).toBe('import-consumer-001');
        expect(data.filepath).toBe('s3://allowed-bucket/Patient.ndjson');
        expect(data.byteRangeStart).toBe(0);
        expect(data.byteRangeEnd).toBe(104857600);
        expect(data.rangeIndex).toBe(0);
        expect(data.totalRanges).toBe(1);
    });

    test('parseImportRangeRequestedEvent rejects wrong event type', () => {
        const { createTestContainer } = require('../../createTestContainer');
        const container = createTestContainer();
        const handler = container.bulkImportHandler;

        const badEvent = JSON.stringify({
            type: 'SomethingElse',
            data: { taskId: 'x', filepath: 'y' }
        });
        expect(() => handler.parseImportRangeRequestedEvent(badEvent)).toThrow('Unexpected event type');
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

        const { createTestContainer } = require('../../createTestContainer');
        const container = createTestContainer();
        const handler = container.bulkImportHandler;

        await handler.handleMessageAsync({
            key: 'import-consumer-001-0-0',
            // totalRanges: 2 so this single range does not also complete the Task —
            // that behavior is covered separately below.
            value: makeCloudEvent({ totalRanges: 2 }),
            headers: []
        });

        taskResp = await request
            .get('/4_0_0/Task/import-consumer-001')
            .set(getHeaders())
            .expect(200);
        expect(taskResp.body.status).toBe('in-progress');
    });

    test('handleMessageAsync skips update if Task not found', async () => {
        const { createTestContainer } = require('../../createTestContainer');
        const container = createTestContainer();
        const handler = container.bulkImportHandler;

        await handler.handleMessageAsync({
            key: 'nonexistent-task-0',
            value: makeCloudEvent({ taskId: 'nonexistent-task' }),
            headers: []
        });
    });

    test('handleMessageAsync does not downgrade in-progress, then marks Task completed after the last range', async () => {
        const request = await createTestRequest();

        await request
            .post('/4_0_0/$import')
            .send(validParametersBody)
            .set(getHeaders())
            .expect(202);

        const { createTestContainer } = require('../../createTestContainer');
        const container = createTestContainer();
        const handler = container.bulkImportHandler;

        await handler.handleMessageAsync({
            key: 'import-consumer-001-0-0',
            value: makeCloudEvent({ rangeIndex: 0, totalRanges: 2 }),
            headers: []
        });

        let taskResp = await request
            .get('/4_0_0/Task/import-consumer-001')
            .set(getHeaders())
            .expect(200);
        expect(taskResp.body.status).toBe('in-progress');

        await handler.handleMessageAsync({
            key: 'import-consumer-001-1',
            value: makeCloudEvent({ rangeIndex: 1, totalRanges: 2 }),
            headers: []
        });

        taskResp = await request
            .get('/4_0_0/Task/import-consumer-001')
            .set(getHeaders())
            .expect(200);
        expect(taskResp.body.status).toBe('completed');
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

    test('handleMessageAsync writes valid NDJSON resources to MongoDB', async () => {
        const request = await createTestRequest();

        await request
            .post('/4_0_0/$import')
            .send({ ...validParametersBody, id: 'import-consumer-write' })
            .set(getHeaders())
            .expect(202);

        const { createTestContainer } = require('../../createTestContainer');
        const container = createTestContainer();
        const handler = container.bulkImportHandler;

        container.s3NdjsonReader.setLinesToYield([
            { resourceType: 'Patient', id: 'bulk-import-patient-1', name: [{ family: 'Smith', given: ['John'] }] },
            { resourceType: 'Patient', id: 'bulk-import-patient-2', name: [{ family: 'Jones', given: ['Sarah'] }] }
        ]);

        await handler.handleMessageAsync({
            key: 'import-consumer-write-0',
            value: makeCloudEvent({ taskId: 'import-consumer-write' }),
            headers: []
        });

        await request
            .get('/4_0_0/Patient/bulk-import-patient-1')
            .set(getHeaders())
            .expect(200)
            .then((res) => {
                expect(res.body.name[0].family).toBe('Smith');
            });

        await request
            .get('/4_0_0/Patient/bulk-import-patient-2')
            .set(getHeaders())
            .expect(200)
            .then((res) => {
                expect(res.body.name[0].family).toBe('Jones');
            });
    });

    test('handleMessageAsync flushes across multiple batches without dropping resources', async () => {
        process.env.BULK_IMPORT_BATCH_SIZE = '2';
        const request = await createTestRequest();

        await request
            .post('/4_0_0/$import')
            .send({ ...validParametersBody, id: 'import-consumer-batches' })
            .set(getHeaders())
            .expect(202);

        const { createTestContainer } = require('../../createTestContainer');
        const container = createTestContainer();
        const handler = container.bulkImportHandler;

        container.s3NdjsonReader.setLinesToYield([
            { resourceType: 'Patient', id: 'bulk-import-batch-1', name: [{ family: 'One' }] },
            { resourceType: 'Patient', id: 'bulk-import-batch-2', name: [{ family: 'Two' }] },
            { resourceType: 'Patient', id: 'bulk-import-batch-3', name: [{ family: 'Three' }] },
            { resourceType: 'Patient', id: 'bulk-import-batch-4', name: [{ family: 'Four' }] },
            { resourceType: 'Patient', id: 'bulk-import-batch-5', name: [{ family: 'Five' }] }
        ]);

        try {
            await handler.handleMessageAsync({
                key: 'import-consumer-batches-0',
                value: makeCloudEvent({ taskId: 'import-consumer-batches' }),
                headers: []
            });
        } finally {
            delete process.env.BULK_IMPORT_BATCH_SIZE;
        }

        for (let i = 1; i <= 5; i++) {
            await request
                .get(`/4_0_0/Patient/bulk-import-batch-${i}`)
                .set(getHeaders())
                .expect(200);
        }
    });

    test('handleMessageAsync counts per-resource failures without aborting the range', async () => {
        const request = await createTestRequest();

        await request
            .post('/4_0_0/$import')
            .send({ ...validParametersBody, id: 'import-consumer-partial-fail' })
            .set(getHeaders())
            .expect(202);

        const { createTestContainer } = require('../../createTestContainer');
        const container = createTestContainer();
        const handler = container.bulkImportHandler;

        container.s3NdjsonReader.setLinesToYield([
            { id: 'missing-resource-type' },
            { resourceType: 'Patient', id: 'bulk-import-survivor', name: [{ family: 'Survivor' }] }
        ]);

        await handler.handleMessageAsync({
            key: 'import-consumer-partial-fail-0',
            value: makeCloudEvent({ taskId: 'import-consumer-partial-fail' }),
            headers: []
        });

        await request
            .get('/4_0_0/Patient/bulk-import-survivor')
            .set(getHeaders())
            .expect(200);

        const taskResp = await request
            .get('/4_0_0/Task/import-consumer-partial-fail')
            .set(getHeaders())
            .expect(200);
        // This is the only range for the only input file, so the range finishing
        // (even with a partial failure) completes the whole Task — partial
        // failures are surfaced via the error output file, not a non-completed status.
        expect(taskResp.body.status).toBe('completed');

        // The line with no resourceType fails before ever reaching the bulk inserter —
        // it must still show up in the error NDJSON and Task.output, not just a log line.
        const writeCalls = container.s3NdjsonReader.getWriteCalls();
        const errorWrite = writeCalls.find((c) => c.filepath.includes('/output/errors/'));
        expect(errorWrite).toBeDefined();
        expect(errorWrite.data).toContain('missing-resource-type');

        const errorOutput = taskResp.body.output.find((o) => o.type.text === 'error');
        expect(errorOutput).toBeDefined();
        expect(errorOutput.valueUri).toBe(errorWrite.filepath);

        // The failing line's OperationOutcome must carry a source-line extension so a
        // caller can map the error back to the exact line in the original NDJSON input.
        const errorEntry = JSON.parse(errorWrite.data.trim().split('\n')[0]);
        const extension = errorEntry.operationOutcome.issue[0].extension;
        expect(extension).toEqual([
            { url: 'https://www.icanbwell.com/source-line', valueInteger: 1 }
        ]);
    });

    test('handleMessageAsync flushes postRequestProcessor and clears requestSpecificCache per range', async () => {
        const request = await createTestRequest();

        await request
            .post('/4_0_0/$import')
            .send({ ...validParametersBody, id: 'import-consumer-cleanup' })
            .set(getHeaders())
            .expect(202);

        const { createTestContainer } = require('../../createTestContainer');
        const container = createTestContainer();
        const handler = container.bulkImportHandler;

        container.s3NdjsonReader.setLinesToYield([
            { resourceType: 'Patient', id: 'bulk-import-cleanup-1', name: [{ family: 'Cleanup' }] }
        ]);

        const executeAsyncSpy = jest.spyOn(container.postRequestProcessor, 'executeAsync');
        const clearAsyncSpy = jest.spyOn(container.requestSpecificCache, 'clearAsync');
        const requestIdsBefore = container.requestSpecificCache.getRequestIds().length;

        await handler.handleMessageAsync({
            key: 'import-consumer-cleanup-0',
            value: makeCloudEvent({ taskId: 'import-consumer-cleanup' }),
            headers: []
        });

        expect(executeAsyncSpy).toHaveBeenCalled();
        expect(clearAsyncSpy).toHaveBeenCalled();
        // no leaked requestSpecificCache entry for the per-range requestId
        expect(container.requestSpecificCache.getRequestIds().length).toBe(requestIdsBefore);

        executeAsyncSpy.mockRestore();
        clearAsyncSpy.mockRestore();
    });

    test('buildRangeOutputKeys nests result/error keys under an output/ prefix', () => {
        const { createTestContainer } = require('../../createTestContainer');
        const container = createTestContainer();
        const handler = container.bulkImportHandler;

        const { resultKey, errorKey } = handler.buildRangeOutputKeys({
            key: 'run-20260521/Patient.ndjson',
            rangeIndex: 0
        });
        expect(resultKey).toBe('run-20260521/output/Patient-001.ndjson');
        expect(errorKey).toBe('run-20260521/output/errors/Patient-001-errors.ndjson');
    });

    test('isTaskFullyComplete is false until every range of every input file is marked complete', () => {
        const { createTestContainer } = require('../../createTestContainer');
        const container = createTestContainer();
        const handler = container.bulkImportHandler;

        const marker = (filepath, rangeIndex, totalRanges) => ({
            url: 'https://www.icanbwell.com/bulk-import-range-completed',
            valueString: JSON.stringify({ filepath, rangeIndex, totalRanges })
        });

        expect(handler.isTaskFullyComplete({
            input: [{ valueUri: 's3://bucket/a.ndjson' }],
            extension: []
        })).toBe(false);

        expect(handler.isTaskFullyComplete({
            input: [
                { valueUri: 's3://bucket/a.ndjson' },
                { valueUri: 's3://bucket/b.ndjson' }
            ],
            extension: [
                marker('s3://bucket/a.ndjson', 0, 2),
                marker('s3://bucket/a.ndjson', 1, 2)
            ]
        })).toBe(false); // file "b" hasn't started

        expect(handler.isTaskFullyComplete({
            input: [
                { valueUri: 's3://bucket/a.ndjson' },
                { valueUri: 's3://bucket/b.ndjson' }
            ],
            extension: [
                marker('s3://bucket/a.ndjson', 0, 2),
                marker('s3://bucket/a.ndjson', 1, 2),
                marker('s3://bucket/b.ndjson', 0, 1)
            ]
        })).toBe(true);
    });

    test('handleMessageAsync writes result NDJSON to S3 and records Task.output + completion', async () => {
        const request = await createTestRequest();

        await request
            .post('/4_0_0/$import')
            .send({ ...validParametersBody, id: 'import-consumer-output' })
            .set(getHeaders())
            .expect(202);

        const { createTestContainer } = require('../../createTestContainer');
        const container = createTestContainer();
        const handler = container.bulkImportHandler;

        container.s3NdjsonReader.setLinesToYield([
            { resourceType: 'Patient', id: 'bulk-import-output-1', name: [{ family: 'Output' }] }
        ]);

        await handler.handleMessageAsync({
            key: 'import-consumer-output-0',
            value: makeCloudEvent({ taskId: 'import-consumer-output' }),
            headers: []
        });

        const writeCalls = container.s3NdjsonReader.getWriteCalls();
        expect(writeCalls).toHaveLength(1);
        expect(writeCalls[0].filepath).toBe('s3://allowed-bucket/output/Patient-001.ndjson');
        expect(writeCalls[0].data).toContain('"id":"bulk-import-output-1"');
        expect(writeCalls[0].data).toContain('"created":true');

        const taskResp = await request
            .get('/4_0_0/Task/import-consumer-output')
            .set(getHeaders())
            .expect(200);

        expect(taskResp.body.status).toBe('completed');
        const resultOutput = taskResp.body.output.find((o) => o.type.text === 'result');
        expect(resultOutput.valueUri).toBe('s3://allowed-bucket/output/Patient-001.ndjson');
    });

    test('isTaskFullyComplete ignores an unparseable completion marker rather than throwing', () => {
        const { createTestContainer } = require('../../createTestContainer');
        const container = createTestContainer();
        const handler = container.bulkImportHandler;

        expect(() => handler.isTaskFullyComplete({
            input: [{ valueUri: 's3://bucket/a.ndjson' }],
            extension: [
                { url: 'https://www.icanbwell.com/bulk-import-range-completed', valueString: 'not-json' }
            ]
        })).not.toThrow();
    });

    test('writeNdjsonWithRetryAsync retries transient failures and succeeds', async () => {
        const { createTestContainer } = require('../../createTestContainer');
        const container = createTestContainer();
        const handler = container.bulkImportHandler;

        const writeSpy = jest.spyOn(container.s3NdjsonReader, 'writeNdjsonAsync')
            .mockRejectedValueOnce(new Error('throttled'))
            .mockResolvedValueOnce(undefined);

        await handler.writeNdjsonWithRetryAsync({ filepath: 's3://allowed-bucket/x.ndjson', data: '{}\n' });

        expect(writeSpy).toHaveBeenCalledTimes(2);
        writeSpy.mockRestore();
    });

    test('writeNdjsonWithRetryAsync throws after exhausting retries', async () => {
        const { createTestContainer } = require('../../createTestContainer');
        const container = createTestContainer();
        const handler = container.bulkImportHandler;

        const writeSpy = jest.spyOn(container.s3NdjsonReader, 'writeNdjsonAsync')
            .mockRejectedValue(new Error('persistent S3 failure'));

        await expect(handler.writeNdjsonWithRetryAsync({
            filepath: 's3://allowed-bucket/x.ndjson',
            data: '{}\n',
            attempts: 2
        })).rejects.toThrow('persistent S3 failure');
        expect(writeSpy).toHaveBeenCalledTimes(2);

        writeSpy.mockRestore();
    });

    test('handleMessageAsync propagates a persistent S3 write failure instead of silently dropping the range', async () => {
        const request = await createTestRequest();

        await request
            .post('/4_0_0/$import')
            .send({ ...validParametersBody, id: 'import-consumer-write-fail' })
            .set(getHeaders())
            .expect(202);

        const { createTestContainer } = require('../../createTestContainer');
        const container = createTestContainer();
        const handler = container.bulkImportHandler;

        container.s3NdjsonReader.setLinesToYield([
            { resourceType: 'Patient', id: 'bulk-import-write-fail-1', name: [{ family: 'Fail' }] }
        ]);
        const writeSpy = jest.spyOn(container.s3NdjsonReader, 'writeNdjsonAsync')
            .mockRejectedValue(new Error('persistent S3 failure'));

        await expect(handler.handleMessageAsync({
            key: 'import-consumer-write-fail-0',
            value: makeCloudEvent({ taskId: 'import-consumer-write-fail' }),
            headers: []
        })).rejects.toThrow('persistent S3 failure');

        // The Task never got a completion marker recorded, so it must not be
        // silently stuck reporting a misleadingly "fine" status.
        const taskResp = await request
            .get('/4_0_0/Task/import-consumer-write-fail')
            .set(getHeaders())
            .expect(200);
        expect(taskResp.body.status).not.toBe('completed');

        writeSpy.mockRestore();
    });

    test('handleMessageAsync does not regress a completed Task back to failed on a redelivered range', async () => {
        const request = await createTestRequest();

        await request
            .post('/4_0_0/$import')
            .send({ ...validParametersBody, id: 'import-consumer-no-regress' })
            .set(getHeaders())
            .expect(202);

        const { createTestContainer } = require('../../createTestContainer');
        const container = createTestContainer();
        const handler = container.bulkImportHandler;

        container.s3NdjsonReader.setLinesToYield([
            { resourceType: 'Patient', id: 'bulk-import-no-regress-1', name: [{ family: 'Once' }] }
        ]);

        // First delivery: only range, only file -> Task completes.
        await handler.handleMessageAsync({
            key: 'import-consumer-no-regress-0',
            value: makeCloudEvent({ taskId: 'import-consumer-no-regress' }),
            headers: []
        });

        let taskResp = await request
            .get('/4_0_0/Task/import-consumer-no-regress')
            .set(getHeaders())
            .expect(200);
        expect(taskResp.body.status).toBe('completed');

        // Kafka redelivers the same range; this time the S3 read hits a transient error.
        const readSpy = jest.spyOn(container.s3NdjsonReader, 'readNdjsonAsync')
            // eslint-disable-next-line require-yield -- deliberately throws before ever yielding
            .mockImplementation(async function* () {
                throw new Error('transient S3 read error');
            });

        await handler.handleMessageAsync({
            key: 'import-consumer-no-regress-0-redelivered',
            value: makeCloudEvent({ taskId: 'import-consumer-no-regress' }),
            headers: []
        });

        taskResp = await request
            .get('/4_0_0/Task/import-consumer-no-regress')
            .set(getHeaders())
            .expect(200);
        expect(taskResp.body.status).toBe('completed');

        readSpy.mockRestore();
    });
});
