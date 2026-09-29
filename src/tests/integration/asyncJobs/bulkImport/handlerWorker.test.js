const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../../common');
const { describe, beforeEach, afterEach, test, expect, jest } = require('@jest/globals');
const { trace } = require('@opentelemetry/api');

const makeCloudEvent = (overrides = {}) => {
    const data = {
        taskId: 'import-consumer-001',
        filepath: 's3://allowed-bucket/Patient.ndjson',
        byteRangeStart: 0,
        byteRangeEnd: 104857600,
        rangeIndex: 0,
        totalRanges: 1,
        taskTotalRanges: 1,
        requestId: 'req-001',
        // mergeManager.mergeResourceAsync is now scope-checked the same way $merge's API
        // path is (WriteAllowedByScopesValidator) -- a plain 'user/*.write' scope has no
        // access-tag grant and gets rejected as forbidden, same as it would via $merge.
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

/**
 * Drives a single ImportRangeRequested message through the worker side of
 * handleMessageAsync, then feeds every range-progress CloudEvent the worker published
 * (ImportRangeStarted/ImportRangeCompleted/ImportRangeFailed, via
 * bulkImportEventProducer.publishRangeProgressEventAsync -> kafkaClientV2.sendCloudEventMessageAsync)
 * back through handleMessageAsync again, simulating the second real Kafka hop onto the
 * orchestrator's consumer. The worker no longer reads or writes the Task itself -- only the
 * orchestrator does, upon consuming these events -- so tests that assert on Task state need
 * both hops to actually happen.
 * @param {import('../../../operations/asyncJobs/bulkImport/handler').BulkImportHandler} handler
 * @param {Object} container
 * @param {{ key: string, value: string, headers: Array<{key: string, value: string}> }} message
 * @returns {Promise<void>}
 */
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
    // recordImportSpanAttributes checks trace.getActiveSpan() first -- faking one here means
    // every test observes attributes on a single, easy-to-assert-on span instead of exercising
    // (or needing) the real auto-instrumentation-created span.
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

        await processRangeAsync(handler, container, {
            key: 'import-consumer-001-0-0',
            // totalRanges/taskTotalRanges: 2 so this single range does not also complete
            // the Task — that behavior is covered separately below.
            value: makeCloudEvent({ totalRanges: 2, taskTotalRanges: 2 }),
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

        await processRangeAsync(handler, container, {
            key: 'import-consumer-001-0-0',
            value: makeCloudEvent({ rangeIndex: 0, totalRanges: 2, taskTotalRanges: 2 }),
            headers: []
        });

        let taskResp = await request
            .get('/4_0_0/Task/import-consumer-001')
            .set(getHeaders())
            .expect(200);
        expect(taskResp.body.status).toBe('in-progress');

        await processRangeAsync(handler, container, {
            key: 'import-consumer-001-1',
            value: makeCloudEvent({ rangeIndex: 1, totalRanges: 2, taskTotalRanges: 2 }),
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

    test('handleMessageAsync runs each resource through Base64DataManager before insert', async () => {
        const request = await createTestRequest();

        await request
            .post('/4_0_0/$import')
            .send({ ...validParametersBody, id: 'import-consumer-base64' })
            .set(getHeaders())
            .expect(202);

        const { createTestContainer } = require('../../createTestContainer');
        const container = createTestContainer();
        const handler = container.bulkImportHandler;

        const { BLOB_OP } = require('../../../../constants');
        const transformAsyncSpy = jest.spyOn(container.base64DataManager, 'transformAsync');

        container.s3NdjsonReader.setLinesToYield([
            { resourceType: 'Patient', id: 'bulk-import-base64-1', name: [{ family: 'Externalize' }] }
        ]);

        await handler.handleMessageAsync({
            key: 'import-consumer-base64-0',
            value: makeCloudEvent({ taskId: 'import-consumer-base64' }),
            headers: []
        });

        // Runs unconditionally per resource -- transformAsync itself no-ops when the feature
        // is disabled or the resourceType has no configured paths (see Base64DataManager),
        // so this must be called regardless, the same way create.js/mergeManager.js do it,
        // otherwise a large DocumentReference/Binary attachment would blow MongoDB's 16MB
        // document limit on insert instead of being externalized to cloud storage first.
        expect(transformAsyncSpy).toHaveBeenCalledWith(
            expect.objectContaining({ resourceType: 'Patient', id: 'bulk-import-base64-1' }),
            BLOB_OP.INSERT,
            expect.anything()
        );

        transformAsyncSpy.mockRestore();
    });

    test('handleMessageAsync creates an AuditEvent for a bulk-imported resource', async () => {
        const request = await createTestRequest();

        await request
            .post('/4_0_0/$import')
            .send({ ...validParametersBody, id: 'import-consumer-audit' })
            .set(getHeaders())
            .expect(202);

        // The default test container swaps in a no-op MockAuditLogger (see
        // src/tests/mocks/mockAuditLogger.js) so unrelated tests don't pay for real audit
        // writes -- override it back to the real AuditLogger here, the same way
        // auditLogIsCreated.test.js does, since this test needs to observe real behavior.
        const { AuditLogger } = require('../../../../utils/auditLogger');
        const { createTestContainer } = require('../../createTestContainer');
        const container = createTestContainer((c) => {
            c.register('auditLogger', (cc) => new AuditLogger({
                postRequestProcessor: cc.postRequestProcessor,
                databaseBulkInserter: cc.fastDatabaseBulkInserter,
                preSaveManager: cc.preSaveManager,
                configManager: cc.configManager
            }));
            return c;
        });
        const handler = container.bulkImportHandler;

        container.s3NdjsonReader.setLinesToYield([
            { resourceType: 'Patient', id: 'bulk-import-audit-check', name: [{ family: 'Audited' }] }
        ]);

        await handler.handleMessageAsync({
            key: 'import-consumer-audit-0',
            value: makeCloudEvent({
                taskId: 'import-consumer-audit',
                user: 'bulk-import-service-account',
                scope: 'user/*.write access/*.*',
                alternateUserId: 'bulk-import-alt-id',
                isUser: true,
                remoteIpAddress: '10.0.0.1'
            }),
            headers: []
        });

        await request.get('/4_0_0/Patient/bulk-import-audit-check').set(getHeaders()).expect(200);

        // AuditLogger.logAuditEntryAsync only buffers in-memory; flushAsync() is what
        // actually persists via the bulk inserter. In production this is called explicitly
        // in handleImportRangeRequestedAsync's finally block (no cron runs in this process,
        // unlike the main FHIR server) -- flushing again here is just to be safe against timing.
        await container.auditLogger.flushAsync();

        const auditEventDb = await container.mongoDatabaseManager.getAuditDbAsync();
        const auditEvents = await auditEventDb.collection('AuditEvent_4_0_0').find({}).toArray();

        // entity[].what.reference uses the resource's internal _uuid, not its plain id, so
        // match on the resourceType prefix rather than the exact reference.
        const patientCreateAudit = auditEvents.find((a) =>
            a.action === 'C' &&
            a.entity?.some((e) => e.what?.reference?.startsWith('Patient/'))
        );
        expect(patientCreateAudit).toBeDefined();
        // originalUrl is threaded through as '$import' (there's no real HTTP request for this
        // Kafka-driven write) -- confirms this AuditEvent came from the bulk import path.
        expect(patientCreateAudit.entity[0].detail).toContainEqual(
            { type: 'requestUrl', valueString: '$import' }
        );
        // The requester's identity (alternateUserId/isUser/remoteIpAddress) must be threaded
        // all the way from the ImportRangeRequested event into buildRangeRequestInfo, not
        // hardcoded to null/false -- otherwise every bulk-import AuditEvent would be missing
        // who actually triggered the import.
        expect(patientCreateAudit.agent[0].altId).toBe('bulk-import-alt-id');
        expect(patientCreateAudit.agent[0].network.address).toBe('10.0.0.1');
        expect(patientCreateAudit.agent[0].who.reference).toContain('bulk-import-service-account');
    });

    test('handleMessageAsync creates an error AuditEvent for a per-resource write failure', async () => {
        const request = await createTestRequest();

        await request
            .post('/4_0_0/$import')
            .send({ ...validParametersBody, id: 'import-consumer-audit-error' })
            .set(getHeaders())
            .expect(202);

        const { AuditLogger } = require('../../../../utils/auditLogger');
        const { createTestContainer } = require('../../createTestContainer');
        const container = createTestContainer((c) => {
            c.register('auditLogger', (cc) => new AuditLogger({
                postRequestProcessor: cc.postRequestProcessor,
                databaseBulkInserter: cc.fastDatabaseBulkInserter,
                preSaveManager: cc.preSaveManager,
                configManager: cc.configManager
            }));
            return c;
        });
        const handler = container.bulkImportHandler;

        container.s3NdjsonReader.setLinesToYield([
            { id: 'missing-resource-type' }
        ]);

        await handler.handleMessageAsync({
            key: 'import-consumer-audit-error-0',
            value: makeCloudEvent({ taskId: 'import-consumer-audit-error' }),
            headers: []
        });

        await container.auditLogger.flushAsync();

        const auditEventDb = await container.mongoDatabaseManager.getAuditDbAsync();
        const auditEvents = await auditEventDb.collection('AuditEvent_4_0_0').find({}).toArray();

        // logErrorAuditEntryAsync's AuditEvents use action 'E' (execute) and a
        // "Security Alert"/"RESTful Operation" type rather than entity.what -- see
        // AuditLogger.createErrorAuditEntry.
        const errorAudit = auditEvents.find((a) => a.action === 'E' && a.outcomeDesc?.includes('missing-resource-type'));
        expect(errorAudit).toBeDefined();
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

        await processRangeAsync(handler, container, {
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

        // 1 created, 1 failed -- tagged as span attributes so the failure ratio can be
        // computed externally, grouped by trace ID.
        expect(fakeSpan.setAttributes).toHaveBeenCalledWith({
            'fhir_import.resources_created': 1,
            'fhir_import.resources_updated': 0,
            'fhir_import.resources_failed': 1
        });

        // The line with no resourceType fails before ever reaching the bulk inserter —
        // it must still show up in the error NDJSON and Task.output, not just a log line.
        const writeCalls = container.s3NdjsonReader.getWriteCalls();
        const errorWrite = writeCalls.find((c) => c.filepath.includes('/output/errors/'));
        expect(errorWrite).toBeDefined();
        expect(errorWrite.data).toContain('missing-resource-type');

        const errorOutput = taskResp.body.output.find((o) => o.type.text === 'error');
        expect(errorOutput).toBeDefined();
        expect(errorOutput.valueUri).toBe(errorWrite.filepath);

        // The failing line's OperationOutcome must carry a source-byte-offset extension so a
        // caller can map the error back to the exact position in the original NDJSON input —
        // a byte offset rather than a line number, since large files are split into
        // independently-processed byte ranges and a per-range line counter can't identify a
        // line's true position in the original file once a file has more than one range.
        const errorEntry = JSON.parse(errorWrite.data.trim().split('\n')[0]);
        const extension = errorEntry.operationOutcome.issue[0].extension;
        expect(extension).toEqual([
            { url: 'https://www.icanbwell.com/source-byte-offset', valueInteger: 0 }
        ]);
    });

    test('handleMessageAsync skips an invalid NDJSON line and records it in the error output without failing the range', async () => {
        const request = await createTestRequest();

        await request
            .post('/4_0_0/$import')
            .send({ ...validParametersBody, id: 'import-consumer-bad-line' })
            .set(getHeaders())
            .expect(202);

        const { createTestContainer } = require('../../createTestContainer');
        const container = createTestContainer();
        const handler = container.bulkImportHandler;

        container.s3NdjsonReader.setLinesToYield([
            { resourceType: 'Patient', id: 'bulk-import-before-bad-line', name: [{ family: 'Before' }] },
            { __parseError: 'Invalid JSON at line 2 in "s3://allowed-bucket/Patient.ndjson": Unexpected token' },
            { resourceType: 'Patient', id: 'bulk-import-after-bad-line', name: [{ family: 'After' }] }
        ]);

        await processRangeAsync(handler, container, {
            key: 'import-consumer-bad-line-0',
            value: makeCloudEvent({ taskId: 'import-consumer-bad-line' }),
            headers: []
        });

        // The bad line doesn't abort the range -- both surrounding valid resources are
        // still written.
        await request.get('/4_0_0/Patient/bulk-import-before-bad-line').set(getHeaders()).expect(200);
        await request.get('/4_0_0/Patient/bulk-import-after-bad-line').set(getHeaders()).expect(200);

        const taskResp = await request
            .get('/4_0_0/Task/import-consumer-bad-line')
            .set(getHeaders())
            .expect(200);
        expect(taskResp.body.status).toBe('completed');

        const errorWrite = container.s3NdjsonReader.getWriteCalls()
            .find((c) => c.filepath.includes('/output/errors/'));
        expect(errorWrite).toBeDefined();
        expect(errorWrite.data).toContain('Invalid JSON at line 2');
    });

    test('handleMessageAsync preserves source line order in the result NDJSON even when an error is recorded before later successes flush', async () => {
        const request = await createTestRequest();

        await request
            .post('/4_0_0/$import')
            .send({ ...validParametersBody, id: 'import-consumer-order' })
            .set(getHeaders())
            .expect(202);

        const { createTestContainer } = require('../../createTestContainer');
        const container = createTestContainer();
        const handler = container.bulkImportHandler;

        // A per-line failure is recorded into mergeResultEntries the instant its line is
        // read, but a success is only recorded once its batch flushes -- with the default
        // batch size, all 3 successes below flush together in one batch at the very end of
        // the range, after the error was already recorded. Without restoring source order,
        // the error would end up first in the output instead of third.
        container.s3NdjsonReader.setLinesToYield([
            { resourceType: 'Patient', id: 'bulk-import-order-1', name: [{ family: 'One' }] },
            { resourceType: 'Patient', id: 'bulk-import-order-2', name: [{ family: 'Two' }] },
            { __parseError: 'Invalid JSON at line 3 in "s3://allowed-bucket/Patient.ndjson": Unexpected token' },
            { resourceType: 'Patient', id: 'bulk-import-order-4', name: [{ family: 'Four' }] }
        ]);

        await handler.handleMessageAsync({
            key: 'import-consumer-order-0',
            value: makeCloudEvent({ taskId: 'import-consumer-order' }),
            headers: []
        });

        const resultWrite = container.s3NdjsonReader.getWriteCalls()
            .find((c) => c.filepath.includes('/output/') && !c.filepath.includes('/errors/'));
        expect(resultWrite).toBeDefined();

        const resultLines = resultWrite.data.trim().split('\n').map((line) => JSON.parse(line));
        expect(resultLines.map((entry) => entry.id || entry.operationOutcome?.issue?.[0]?.extension?.[0]?.valueInteger))
            .toEqual([
                'bulk-import-order-1',
                'bulk-import-order-2',
                200, // the error entry's source-byte-offset, positioned between order-2 and order-4
                'bulk-import-order-4'
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

    test('countCompletedRanges counts distinct ranges, ignoring the -result/-error suffix and unrelated output entries', () => {
        const { createTestContainer } = require('../../createTestContainer');
        const container = createTestContainer();
        const stateMachine = container.bulkImportTaskStateMachine;

        // No output at all -- zero ranges completed.
        expect(stateMachine.countCompletedRanges({ output: [] })).toBe(0);

        // A range with BOTH a -result and a -error entry must still count as ONE range.
        expect(stateMachine.countCompletedRanges({
            output: [
                { id: 'bulk-import-range:s3://bucket/a.ndjson#0-result', type: { text: 'result' }, valueUri: 's3://bucket/out/a.ndjson' },
                { id: 'bulk-import-range:s3://bucket/a.ndjson#0-error', type: { text: 'error' }, valueUri: 's3://bucket/out/a-errors.ndjson' }
            ]
        })).toBe(1);

        // Multiple distinct ranges (including an "empty" placeholder entry with no suffix)
        // all count individually.
        expect(stateMachine.countCompletedRanges({
            output: [
                { id: 'bulk-import-range:s3://bucket/a.ndjson#0-result', type: { text: 'result' }, valueUri: 's3://bucket/out/a.ndjson' },
                { id: 'bulk-import-range:s3://bucket/a.ndjson#1-error', type: { text: 'error' }, valueUri: 's3://bucket/out/a-errors.ndjson' },
                { id: 'bulk-import-range:s3://bucket/b.ndjson#0', type: { text: 'empty' } }
            ]
        })).toBe(3);

        // An output entry that doesn't match the "bulk-import-range:" id prefix at all (e.g.
        // a plain error output with no id) must be ignored rather than miscounted.
        expect(stateMachine.countCompletedRanges({
            output: [
                { type: { text: 'error' }, valueUri: 's3://bucket/out/unrelated-errors.ndjson' },
                { id: 'bulk-import-range:s3://bucket/a.ndjson#0-result', type: { text: 'result' }, valueUri: 's3://bucket/out/a.ndjson' }
            ]
        })).toBe(1);
    });

    test('countCompletedRanges does not throw and returns 0 when task.output is missing', () => {
        const { createTestContainer } = require('../../createTestContainer');
        const container = createTestContainer();
        const stateMachine = container.bulkImportTaskStateMachine;

        expect(() => stateMachine.countCompletedRanges({})).not.toThrow();
        expect(stateMachine.countCompletedRanges({})).toBe(0);
        expect(stateMachine.countCompletedRanges({ output: undefined })).toBe(0);
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

        await processRangeAsync(handler, container, {
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
        expect(resultOutput.id).toBe(
            'bulk-import-range:s3://allowed-bucket/Patient.ndjson#0-result'
        );

        // 1 created, 0 failed -- tagged as span attributes.
        expect(fakeSpan.setAttributes).toHaveBeenCalledWith({
            'fhir_import.resources_created': 1,
            'fhir_import.resources_updated': 0,
            'fhir_import.resources_failed': 0
        });
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

    test('readRangeWithRetryAsync retries transient failures and succeeds', async () => {
        const { createTestContainer } = require('../../createTestContainer');
        const container = createTestContainer();
        const handler = container.bulkImportHandler;

        const fn = jest.fn()
            .mockRejectedValueOnce(new Error('transient read failure'))
            .mockResolvedValueOnce(undefined);

        await handler.readRangeWithRetryAsync({ fn, requestId: 'req-retry-success' });

        expect(fn).toHaveBeenCalledTimes(2);
    });

    test('readRangeWithRetryAsync throws after exhausting retries', async () => {
        const { createTestContainer } = require('../../createTestContainer');
        const container = createTestContainer();
        const handler = container.bulkImportHandler;

        const fn = jest.fn().mockRejectedValue(new Error('persistent read failure'));

        await expect(handler.readRangeWithRetryAsync({
            fn,
            requestId: 'req-retry-exhausted',
            attempts: 2
        })).rejects.toThrow('persistent read failure');
        expect(fn).toHaveBeenCalledTimes(2);
    });

    test('readRangeWithRetryAsync clears requestSpecificCache between failed attempts', async () => {
        const { createTestContainer } = require('../../createTestContainer');
        const container = createTestContainer();
        const handler = container.bulkImportHandler;

        const clearSpy = jest.spyOn(container.requestSpecificCache, 'clearAsync');
        const fn = jest.fn()
            .mockRejectedValueOnce(new Error('transient read failure'))
            .mockResolvedValueOnce(undefined);

        await handler.readRangeWithRetryAsync({ fn, requestId: 'req-retry-clears-cache' });

        // Clears the failed attempt's buffered-but-unflushed inserts before retrying with
        // the same requestId, so a partial buffer can't get double-inserted alongside the
        // retry's own.
        expect(clearSpy).toHaveBeenCalledWith({ requestId: 'req-retry-clears-cache' });

        clearSpy.mockRestore();
    });

    test('readRangeWithRetryAsync does not retry once a batch has already been flushed', async () => {
        const { createTestContainer } = require('../../createTestContainer');
        const container = createTestContainer();
        const handler = container.bulkImportHandler;

        const clearSpy = jest.spyOn(container.requestSpecificCache, 'clearAsync');
        const partiallyFlushedError = new Error('mid-stream failure after a flush');
        partiallyFlushedError.bulkImportRangePartiallyFlushed = true;
        const fn = jest.fn().mockRejectedValue(partiallyFlushedError);

        // Not every flushed resourceType is an idempotent Mongo upsert (e.g. ClickHouse/
        // Kafka-ClickPipe sinks do an unconditional insert/produce), so retrying after a
        // flush risks duplicate rows/events -- must fail on the first attempt, not retry.
        await expect(handler.readRangeWithRetryAsync({
            fn,
            requestId: 'req-partially-flushed',
            attempts: 3
        })).rejects.toThrow('mid-stream failure after a flush');

        expect(fn).toHaveBeenCalledTimes(1);
        expect(clearSpy).not.toHaveBeenCalled();

        clearSpy.mockRestore();
    });

    test('readRangeWithRetryAsync does not retry a deterministic (non-retryable) error', async () => {
        const { createTestContainer } = require('../../createTestContainer');
        const container = createTestContainer();
        const handler = container.bulkImportHandler;

        const clearSpy = jest.spyOn(container.requestSpecificCache, 'clearAsync');
        const validationError = new Error('Invalid JSON at line 3');
        validationError.retryable = false;
        const fn = jest.fn().mockRejectedValue(validationError);

        // Fails identically on every attempt -- retrying would just waste time/backoff for
        // the same eventual outcome.
        await expect(handler.readRangeWithRetryAsync({
            fn,
            requestId: 'req-non-retryable',
            attempts: 3
        })).rejects.toThrow('Invalid JSON at line 3');

        expect(fn).toHaveBeenCalledTimes(1);
        expect(clearSpy).not.toHaveBeenCalled();

        clearSpy.mockRestore();
    });

    test('handleMessageAsync marks Task failed without retrying or duplicating already-flushed resources', async () => {
        const request = await createTestRequest();

        await request
            .post('/4_0_0/$import')
            .send({ ...validParametersBody, id: 'import-consumer-partial-flush' })
            .set(getHeaders())
            .expect(202);

        const { createTestContainer } = require('../../createTestContainer');
        const container = createTestContainer();
        const handler = container.bulkImportHandler;

        const originalBatchSize = process.env.BULK_IMPORT_BATCH_SIZE;
        process.env.BULK_IMPORT_BATCH_SIZE = '1';

        container.s3NdjsonReader.setLinesToYield([
            { resourceType: 'Patient', id: 'bulk-import-partial-flush-1', name: [{ family: 'Flushed' }] },
            { resourceType: 'Patient', id: 'bulk-import-partial-flush-2', name: [{ family: 'NeverFlushed' }] }
        ]);
        // First resource flushes (batch size 1) before the stream fails on the second.
        container.s3NdjsonReader.setFailAfterYielding(1);

        try {
            await processRangeAsync(handler, container, {
                key: 'import-consumer-partial-flush-0',
                value: makeCloudEvent({ taskId: 'import-consumer-partial-flush' }),
                headers: []
            });
        } finally {
            if (originalBatchSize === undefined) {
                delete process.env.BULK_IMPORT_BATCH_SIZE;
            } else {
                process.env.BULK_IMPORT_BATCH_SIZE = originalBatchSize;
            }
        }

        // Only one read call -- the partial-flush failure must not trigger a retry.
        expect(container.s3NdjsonReader.getReadCalls()).toHaveLength(1);

        const taskResp = await request
            .get('/4_0_0/Task/import-consumer-partial-flush')
            .set(getHeaders())
            .expect(200);
        expect(taskResp.body.status).toBe('failed');

        // A whole-Task failure, distinct from a partial-failure completion -- tagged as a
        // span attribute so alerts can be built on it, grouped by trace ID.
        expect(fakeSpan.setAttributes).toHaveBeenCalledWith({ 'fhir_import.outcome': 'failed' });

        // The already-flushed resource is durably in Mongo exactly once (not duplicated by
        // a retry that never happened).
        await request
            .get('/4_0_0/Patient/bulk-import-partial-flush-1')
            .set(getHeaders())
            .expect(200);
    });

    test('handleMessageAsync retries a transient S3 read failure and still completes the range', async () => {
        const request = await createTestRequest();

        await request
            .post('/4_0_0/$import')
            .send({ ...validParametersBody, id: 'import-consumer-read-retry' })
            .set(getHeaders())
            .expect(202);

        const { createTestContainer } = require('../../createTestContainer');
        const container = createTestContainer();
        const handler = container.bulkImportHandler;

        container.s3NdjsonReader.setLinesToYield([
            { resourceType: 'Patient', id: 'bulk-import-read-retry', name: [{ family: 'Retry' }] }
        ]);
        container.s3NdjsonReader.setFailNextReads(1);

        await processRangeAsync(handler, container, {
            key: 'import-consumer-read-retry-0',
            value: makeCloudEvent({ taskId: 'import-consumer-read-retry' }),
            headers: []
        });

        await request
            .get('/4_0_0/Patient/bulk-import-read-retry')
            .set(getHeaders())
            .expect(200);

        const taskResp = await request
            .get('/4_0_0/Task/import-consumer-read-retry')
            .set(getHeaders())
            .expect(200);
        expect(taskResp.body.status).toBe('completed');

        // First read call failed, second succeeded -- the whole range is reprocessed from
        // the start on retry, not resumed mid-stream.
        expect(container.s3NdjsonReader.getReadCalls()).toHaveLength(2);
    });

    test('handleMessageAsync marks the Task failed after exhausting S3 read retries', async () => {
        const request = await createTestRequest();

        await request
            .post('/4_0_0/$import')
            .send({ ...validParametersBody, id: 'import-consumer-read-exhausted' })
            .set(getHeaders())
            .expect(202);

        const { createTestContainer } = require('../../createTestContainer');
        const container = createTestContainer();
        const handler = container.bulkImportHandler;

        container.s3NdjsonReader.setLinesToYield([
            { resourceType: 'Patient', id: 'bulk-import-read-exhausted', name: [{ family: 'Exhausted' }] }
        ]);
        container.s3NdjsonReader.setFailNextReads(3);

        await processRangeAsync(handler, container, {
            key: 'import-consumer-read-exhausted-0',
            value: makeCloudEvent({ taskId: 'import-consumer-read-exhausted' }),
            headers: []
        });

        const taskResp = await request
            .get('/4_0_0/Task/import-consumer-read-exhausted')
            .set(getHeaders())
            .expect(200);
        expect(taskResp.body.status).toBe('failed');
        expect(container.s3NdjsonReader.getReadCalls()).toHaveLength(3);
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

        // First delivery: only range, only file -> Task completes (both worker and
        // orchestrator hops).
        await processRangeAsync(handler, container, {
            key: 'import-consumer-no-regress-0',
            value: makeCloudEvent({ taskId: 'import-consumer-no-regress' }),
            headers: []
        });

        let taskResp = await request
            .get('/4_0_0/Task/import-consumer-no-regress')
            .set(getHeaders())
            .expect(200);
        expect(taskResp.body.status).toBe('completed');

        // Kafka redelivers the same range; this time the S3 read hits a transient error on
        // every attempt, so the worker exhausts its retries and publishes ImportRangeFailed
        // unconditionally (it never reads the Task itself). The "must not regress an
        // already-completed Task" guard now lives on the orchestrator's
        // handleRangeFailedAsync, exercised here via the second processRangeAsync hop.
        const readSpy = jest.spyOn(container.s3NdjsonReader, 'readNdjsonAsync')
            // eslint-disable-next-line require-yield -- deliberately throws before ever yielding
            .mockImplementation(async function* () {
                throw new Error('transient S3 read error');
            });

        await processRangeAsync(handler, container, {
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

    test('handleMessageAsync creates a resource from an ifNoneExist-wrapped line when no match exists', async () => {
        const request = await createTestRequest();

        await request
            .post('/4_0_0/$import')
            .send({ ...validParametersBody, id: 'import-consumer-ine-create' })
            .set(getHeaders())
            .expect(202);

        const { createTestContainer } = require('../../createTestContainer');
        const container = createTestContainer();
        const handler = container.bulkImportHandler;

        container.s3NdjsonReader.setLinesToYield([
            {
                ifNoneExist: 'identifier=http://example.com|ine-create-12345',
                resource: {
                    resourceType: 'Patient',
                    id: 'bulk-import-ine-create',
                    identifier: [{ system: 'http://example.com', value: 'ine-create-12345' }],
                    name: [{ family: 'Created' }]
                }
            }
        ]);

        await processRangeAsync(handler, container, {
            key: 'import-consumer-ine-create-0',
            value: makeCloudEvent({ taskId: 'import-consumer-ine-create' }),
            headers: []
        });

        await request
            .get('/4_0_0/Patient/bulk-import-ine-create')
            .set(getHeaders())
            .expect(200)
            .then((res) => {
                expect(res.body.name[0].family).toBe('Created');
            });

        const taskResp = await request
            .get('/4_0_0/Task/import-consumer-ine-create')
            .set(getHeaders())
            .expect(200);
        expect(taskResp.body.status).toBe('completed');
    });

    test('handleMessageAsync skips an ifNoneExist-wrapped line when a matching resource already exists', async () => {
        const request = await createTestRequest();

        const { createTestContainer } = require('../../createTestContainer');
        const container = createTestContainer();
        const handler = container.bulkImportHandler;

        // Pre-existing resource with the identifier the bulk-imported line's ifNoneExist
        // query will match against. Created via a separate bulk-import task (rather than
        // a plain HTTP PUT) so it doesn't need explicit meta.security tags -- bulk-imported
        // resources get default security tags applied by the handler itself.
        await request
            .post('/4_0_0/$import')
            .send({ ...validParametersBody, id: 'import-consumer-ine-preexisting' })
            .set(getHeaders())
            .expect(202);

        container.s3NdjsonReader.setLinesToYield([
            {
                resourceType: 'Patient',
                id: 'bulk-import-ine-preexisting',
                identifier: [{ system: 'http://example.com', value: 'ine-skip-98765' }],
                name: [{ family: 'PreExisting' }]
            }
        ]);

        await handler.handleMessageAsync({
            key: 'import-consumer-ine-preexisting-0',
            value: makeCloudEvent({ taskId: 'import-consumer-ine-preexisting' }),
            headers: []
        });

        await request
            .post('/4_0_0/$import')
            .send({ ...validParametersBody, id: 'import-consumer-ine-skip' })
            .set(getHeaders())
            .expect(202);

        container.s3NdjsonReader.setLinesToYield([
            {
                ifNoneExist: 'identifier=http://example.com|ine-skip-98765',
                resource: {
                    resourceType: 'Patient',
                    id: 'bulk-import-ine-should-not-be-created',
                    identifier: [{ system: 'http://example.com', value: 'ine-skip-98765' }],
                    name: [{ family: 'ShouldNotBeCreated' }]
                }
            }
        ]);

        await processRangeAsync(handler, container, {
            key: 'import-consumer-ine-skip-0',
            value: makeCloudEvent({ taskId: 'import-consumer-ine-skip' }),
            headers: []
        });

        // The wrapped resource's own id must NOT have been created -- ifNoneExist matched
        // the pre-existing resource, so the write was skipped.
        await request
            .get('/4_0_0/Patient/bulk-import-ine-should-not-be-created')
            .set(getHeaders())
            .expect(404);

        // The pre-existing resource is unaffected.
        await request
            .get('/4_0_0/Patient/bulk-import-ine-preexisting')
            .set(getHeaders())
            .expect(200)
            .then((res) => {
                expect(res.body.name[0].family).toBe('PreExisting');
            });

        const taskResp = await request
            .get('/4_0_0/Task/import-consumer-ine-skip')
            .set(getHeaders())
            .expect(200);
        expect(taskResp.body.status).toBe('completed');
    });

    test('handleMessageAsync creates a resource from an ifNoneExist-wrapped line when the only identifier match belongs to a different tenant', async () => {
        const request = await createTestRequest();

        const { createTestContainer } = require('../../createTestContainer');
        const container = createTestContainer();
        const handler = container.bulkImportHandler;

        // Pre-existing resource with the same identifier, but owned by a different tenant.
        await request
            .post('/4_0_0/$import')
            .send({ ...validParametersBody, id: 'import-consumer-ine-other-tenant-setup' })
            .set(getHeaders())
            .expect(202);

        container.s3NdjsonReader.setLinesToYield([
            {
                resourceType: 'Patient',
                id: 'bulk-import-ine-other-tenant',
                meta: { security: [{ system: 'https://www.icanbwell.com/owner', code: 'clientA' }] },
                identifier: [{ system: 'http://example.com', value: 'ine-cross-tenant-55555' }],
                name: [{ family: 'OtherTenant' }]
            }
        ]);

        await handler.handleMessageAsync({
            key: 'import-consumer-ine-other-tenant-setup-0',
            value: makeCloudEvent({ taskId: 'import-consumer-ine-other-tenant-setup' }),
            headers: []
        });

        // Own-tenant import whose ifNoneExist query matches only the other tenant's resource
        // above. The existence check must not consider that cross-tenant match, so this
        // resource should still be created rather than skipped.
        await request
            .post('/4_0_0/$import')
            .send({ ...validParametersBody, id: 'import-consumer-ine-own-tenant' })
            .set(getHeaders())
            .expect(202);

        container.s3NdjsonReader.setLinesToYield([
            {
                ifNoneExist: 'identifier=http://example.com|ine-cross-tenant-55555',
                resource: {
                    resourceType: 'Patient',
                    id: 'bulk-import-ine-own-tenant',
                    meta: { security: [{ system: 'https://www.icanbwell.com/owner', code: 'clientB' }] },
                    identifier: [{ system: 'http://example.com', value: 'ine-cross-tenant-55555' }],
                    name: [{ family: 'OwnTenant' }]
                }
            }
        ]);

        await handler.handleMessageAsync({
            key: 'import-consumer-ine-own-tenant-0',
            value: makeCloudEvent({ taskId: 'import-consumer-ine-own-tenant' }),
            headers: []
        });

        await request
            .get('/4_0_0/Patient/bulk-import-ine-own-tenant')
            .set(getHeaders())
            .expect(200)
            .then((res) => {
                expect(res.body.name[0].family).toBe('OwnTenant');
            });
    });

    test('handleMessageAsync fails (does not skip or create) an ifNoneExist-wrapped line referencing an unrecognized search parameter', async () => {
        const request = await createTestRequest();

        await request
            .post('/4_0_0/$import')
            .send({ ...validParametersBody, id: 'import-consumer-ine-bad-param' })
            .set(getHeaders())
            .expect(202);

        const { createTestContainer } = require('../../createTestContainer');
        const container = createTestContainer();
        const handler = container.bulkImportHandler;

        container.s3NdjsonReader.setLinesToYield([
            {
                // "identifer" is a typo of "identifier" -- an unrecognized search parameter
                // must fail the line rather than silently matching every Patient for this
                // tenant (which would wrongly skip the create).
                ifNoneExist: 'identifer=http://example.com|ine-bad-param-11111',
                resource: {
                    resourceType: 'Patient',
                    id: 'bulk-import-ine-bad-param',
                    identifier: [{ system: 'http://example.com', value: 'ine-bad-param-11111' }],
                    name: [{ family: 'BadParam' }]
                }
            }
        ]);

        await processRangeAsync(handler, container, {
            key: 'import-consumer-ine-bad-param-0',
            value: makeCloudEvent({ taskId: 'import-consumer-ine-bad-param' }),
            headers: []
        });

        // Not created -- the ifNoneExist check errored out rather than silently succeeding.
        await request
            .get('/4_0_0/Patient/bulk-import-ine-bad-param')
            .set(getHeaders())
            .expect(404);

        const taskResp = await request
            .get('/4_0_0/Task/import-consumer-ine-bad-param')
            .set(getHeaders())
            .expect(200);
        // The bad line is recorded as a per-resource failure, not silently dropped.
        expect(taskResp.body.output.some((o) => o.type?.text === 'error')).toBe(true);
    });

    test('handleMessageAsync skips an ifNoneExist-wrapped line with only an access tag when a same-owner match exists', async () => {
        const request = await createTestRequest();

        const { createTestContainer } = require('../../createTestContainer');
        const container = createTestContainer();
        const handler = container.bulkImportHandler;

        // Pre-existing resource owned by "clientC" (the owner tag OwnerColumnHandler would
        // derive from an access-tag-only resource's first access code).
        await request
            .post('/4_0_0/$import')
            .send({ ...validParametersBody, id: 'import-consumer-ine-access-only-setup' })
            .set(getHeaders())
            .expect(202);

        container.s3NdjsonReader.setLinesToYield([
            {
                resourceType: 'Patient',
                id: 'bulk-import-ine-access-only-preexisting',
                meta: { security: [{ system: 'https://www.icanbwell.com/owner', code: 'clientC' }] },
                identifier: [{ system: 'http://example.com', value: 'ine-access-only-22222' }],
                name: [{ family: 'AccessOnlyPreExisting' }]
            }
        ]);

        await handler.handleMessageAsync({
            key: 'import-consumer-ine-access-only-setup-0',
            value: makeCloudEvent({ taskId: 'import-consumer-ine-access-only-setup' }),
            headers: []
        });

        await request
            .post('/4_0_0/$import')
            .send({ ...validParametersBody, id: 'import-consumer-ine-access-only' })
            .set(getHeaders())
            .expect(202);

        container.s3NdjsonReader.setLinesToYield([
            {
                ifNoneExist: 'identifier=http://example.com|ine-access-only-22222',
                resource: {
                    resourceType: 'Patient',
                    id: 'bulk-import-ine-access-only-should-not-be-created',
                    // No owner tag -- only an access tag, which OwnerColumnHandler would
                    // normally backfill to an owner tag of "clientC" during preSave (too
                    // late for the ifNoneExist existence check to see it).
                    meta: { security: [{ system: 'https://www.icanbwell.com/access', code: 'clientC' }] },
                    identifier: [{ system: 'http://example.com', value: 'ine-access-only-22222' }],
                    name: [{ family: 'AccessOnlyShouldNotBeCreated' }]
                }
            }
        ]);

        await handler.handleMessageAsync({
            key: 'import-consumer-ine-access-only-0',
            value: makeCloudEvent({ taskId: 'import-consumer-ine-access-only' }),
            headers: []
        });

        await request
            .get('/4_0_0/Patient/bulk-import-ine-access-only-should-not-be-created')
            .set(getHeaders())
            .expect(404);
    });

    test('handleMessageAsync only creates one resource when two ifNoneExist-wrapped lines with the same criteria land in the same unflushed batch', async () => {
        const request = await createTestRequest();

        await request
            .post('/4_0_0/$import')
            .send({ ...validParametersBody, id: 'import-consumer-ine-same-batch' })
            .set(getHeaders())
            .expect(202);

        const { createTestContainer } = require('../../createTestContainer');
        const container = createTestContainer();
        const handler = container.bulkImportHandler;

        // Both lines share the same ifNoneExist criteria and land in the same batch (default
        // BULK_IMPORT_BATCH_SIZE is well above 2), so the second one is only in memory --
        // not yet committed to Mongo -- when its own existence check would otherwise run.
        container.s3NdjsonReader.setLinesToYield([
            {
                ifNoneExist: 'identifier=http://example.com|ine-same-batch-33333',
                resource: {
                    resourceType: 'Patient',
                    id: 'bulk-import-ine-same-batch-first',
                    identifier: [{ system: 'http://example.com', value: 'ine-same-batch-33333' }],
                    name: [{ family: 'SameBatchFirst' }]
                }
            },
            {
                ifNoneExist: 'identifier=http://example.com|ine-same-batch-33333',
                resource: {
                    resourceType: 'Patient',
                    id: 'bulk-import-ine-same-batch-second',
                    identifier: [{ system: 'http://example.com', value: 'ine-same-batch-33333' }],
                    name: [{ family: 'SameBatchSecond' }]
                }
            }
        ]);

        await handler.handleMessageAsync({
            key: 'import-consumer-ine-same-batch-0',
            value: makeCloudEvent({ taskId: 'import-consumer-ine-same-batch' }),
            headers: []
        });

        await request
            .get('/4_0_0/Patient/bulk-import-ine-same-batch-first')
            .set(getHeaders())
            .expect(200);

        // The second line claimed the same criteria while the first was still buffered
        // in-memory (not yet committed), so it must be skipped rather than also created.
        await request
            .get('/4_0_0/Patient/bulk-import-ine-same-batch-second')
            .set(getHeaders())
            .expect(404);
    });

    test('handleMessageAsync completes the range and clears the request cache even when AuditLogger.flushAsync throws', async () => {
        const request = await createTestRequest();

        await request
            .post('/4_0_0/$import')
            .send({ ...validParametersBody, id: 'import-consumer-audit-flush-error' })
            .set(getHeaders())
            .expect(202);

        const { createTestContainer } = require('../../createTestContainer');
        const container = createTestContainer();
        const handler = container.bulkImportHandler;

        jest.spyOn(container.auditLogger, 'flushAsync').mockRejectedValueOnce(
            new Error('Simulated transient AuditEvent flush failure')
        );
        const clearAsyncSpy = jest.spyOn(container.requestSpecificCache, 'clearAsync');

        container.s3NdjsonReader.setLinesToYield([
            { resourceType: 'Patient', id: 'bulk-import-audit-flush-error', name: [{ family: 'Flushed' }] }
        ]);

        await processRangeAsync(handler, container, {
            key: 'import-consumer-audit-flush-error-0',
            value: makeCloudEvent({ taskId: 'import-consumer-audit-flush-error' }),
            headers: []
        });

        // A transient audit-flush failure must not be mistaken for the range itself failing --
        // the resource write and Task completion already succeeded by the time flushAsync runs.
        await request
            .get('/4_0_0/Patient/bulk-import-audit-flush-error')
            .set(getHeaders())
            .expect(200);

        const taskResp = await request
            .get('/4_0_0/Task/import-consumer-audit-flush-error')
            .set(getHeaders())
            .expect(200);
        expect(taskResp.body.status).toBe('completed');

        // Cache cleanup must still run after the guarded flushAsync rejection, not get skipped.
        expect(clearAsyncSpy).toHaveBeenCalled();
    });

    test('handleMessageAsync still logs an AuditEvent for the already-flushed resource when a later batch fails the range', async () => {
        const request = await createTestRequest();

        await request
            .post('/4_0_0/$import')
            .send({ ...validParametersBody, id: 'import-consumer-audit-partial-flush' })
            .set(getHeaders())
            .expect(202);

        const { AuditLogger } = require('../../../../utils/auditLogger');
        const { createTestContainer } = require('../../createTestContainer');
        const container = createTestContainer((c) => {
            c.register('auditLogger', (cc) => new AuditLogger({
                postRequestProcessor: cc.postRequestProcessor,
                databaseBulkInserter: cc.fastDatabaseBulkInserter,
                preSaveManager: cc.preSaveManager,
                configManager: cc.configManager
            }));
            return c;
        });
        const handler = container.bulkImportHandler;

        const originalBatchSize = process.env.BULK_IMPORT_BATCH_SIZE;
        process.env.BULK_IMPORT_BATCH_SIZE = '1';

        container.s3NdjsonReader.setLinesToYield([
            { resourceType: 'Patient', id: 'bulk-import-audit-partial-flush', name: [{ family: 'Flushed' }] },
            { resourceType: 'Patient', id: 'bulk-import-audit-partial-flush-2', name: [{ family: 'NeverFlushed' }] }
        ]);
        // First resource flushes (batch size 1) before the stream fails on the second --
        // mirrors the "marks Task failed without retrying or duplicating already-flushed
        // resources" scenario above, but here asserting the AuditEvent side effect.
        container.s3NdjsonReader.setFailAfterYielding(1);

        try {
            await processRangeAsync(handler, container, {
                key: 'import-consumer-audit-partial-flush-0',
                value: makeCloudEvent({ taskId: 'import-consumer-audit-partial-flush' }),
                headers: []
            });
        } finally {
            if (originalBatchSize === undefined) {
                delete process.env.BULK_IMPORT_BATCH_SIZE;
            } else {
                process.env.BULK_IMPORT_BATCH_SIZE = originalBatchSize;
            }
        }

        const taskResp = await request
            .get('/4_0_0/Task/import-consumer-audit-partial-flush')
            .set(getHeaders())
            .expect(200);
        expect(taskResp.body.status).toBe('failed');

        await container.auditLogger.flushAsync();

        const auditEventDb = await container.mongoDatabaseManager.getAuditDbAsync();
        const auditEvents = await auditEventDb.collection('AuditEvent_4_0_0').find({}).toArray();

        // The resource that was already durably committed before the stream failed must
        // still get an AuditEvent -- this range will never be redelivered once the Task is
        // 'failed', so this is the only chance to record it.
        const patientCreateAudit = auditEvents.find((a) =>
            a.action === 'C' &&
            a.entity?.some((e) => e.what?.reference?.startsWith('Patient/'))
        );
        expect(patientCreateAudit).toBeDefined();
    });
});
