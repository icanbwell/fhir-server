const { describe, test, expect, jest, beforeEach } = require('@jest/globals');
const { AccessLogger } = require('../../utils/accessLogger');
const { AccessLogClickHouseWriter } = require('../../utils/accessLogClickHouseWriter');
const { AccessLogsEventProducer } = require('../../utils/accessLogsEventProducer');
const { DatabaseBulkInserter } = require('../../dataLayer/databaseBulkInserter');
const { ConfigManager } = require('../../utils/configManager');
const { ScopesManager } = require('../../operations/security/scopesManager');
const { FhirOperationsManager } = require('../../operations/fhirOperationsManager');

function makeConfig ({
    kafka = false,
    mongo = false,
    clickHouse = true
} = {}) {
    const cm = Object.create(ConfigManager.prototype);
    Object.defineProperty(cm, 'kafkaEnableAccessLogsEvent', { get: () => kafka });
    Object.defineProperty(cm, 'enableAccessLogsMiddleware', { get: () => mongo });
    Object.defineProperty(cm, 'enableAccessLogsClickHouse', { get: () => clickHouse });
    return cm;
}

function makeLogEntry (id) {
    return {
        timestamp: new Date('2024-06-15T10:30:00.000Z'),
        outcomeDesc: 'Success',
        agent: { altId: 'user-1', networkAddress: '10.0.0.1', scopes: 'user/*.read' },
        details: { host: 'fhir.example.com', originService: 'svc' },
        request: { id, resourceType: 'Patient', operation: 'read', method: 'GET' }
    };
}

function makeLogger ({ configManager, writer }) {
    const scopesManager = Object.create(ScopesManager.prototype);
    const fhirOperationsManager = Object.create(FhirOperationsManager.prototype);
    const databaseBulkInserter = Object.create(DatabaseBulkInserter.prototype);
    databaseBulkInserter.getOperationForResourceAsync = jest.fn().mockReturnValue({});
    databaseBulkInserter.executeAsync = jest.fn().mockResolvedValue([]);
    const accessLogsEventProducer = Object.create(AccessLogsEventProducer.prototype);
    accessLogsEventProducer.produce = jest.fn().mockResolvedValue(undefined);

    return new AccessLogger({
        scopesManager,
        fhirOperationsManager,
        imageVersion: 'test',
        configManager,
        databaseBulkInserter,
        accessLogsEventProducer,
        accessLogClickHouseWriter: writer
    });
}

describe('AccessLogger ClickHouse integration', () => {
    let writer;

    beforeEach(() => {
        writer = Object.create(AccessLogClickHouseWriter.prototype);
        writer.writeBatchAsync = jest.fn().mockResolvedValue({ inserted: 1, skipped: 0 });
    });

    test('routes queued docs to the ClickHouse writer when enabled', async () => {
        const logger = makeLogger({ configManager: makeConfig(), writer });
        logger.queue.push({ doc: makeLogEntry('req-1'), requestInfo: { requestId: 'req-1' } });

        await logger.flushAsync();

        expect(writer.writeBatchAsync).toHaveBeenCalledTimes(1);
        const docs = writer.writeBatchAsync.mock.calls[0][0];
        expect(docs).toHaveLength(1);
        expect(docs[0].request.id).toBe('req-1');
    });

    test('batches multiple queued docs into a single writeBatchAsync call', async () => {
        const logger = makeLogger({ configManager: makeConfig(), writer });
        logger.queue.push(
            { doc: makeLogEntry('req-a'), requestInfo: { requestId: 'req-a' } },
            { doc: makeLogEntry('req-b'), requestInfo: { requestId: 'req-b' } }
        );

        await logger.flushAsync();

        expect(writer.writeBatchAsync).toHaveBeenCalledTimes(1);
        expect(writer.writeBatchAsync.mock.calls[0][0]).toHaveLength(2);
    });

    test('does not call writer when ClickHouse flag is disabled', async () => {
        const logger = makeLogger({ configManager: makeConfig({ clickHouse: false, mongo: true }), writer });
        logger.queue.push({ doc: makeLogEntry('req-2'), requestInfo: { requestId: 'req-2' } });

        await logger.flushAsync();

        expect(writer.writeBatchAsync).not.toHaveBeenCalled();
    });

    test('does not call writer when writer is null', async () => {
        const logger = makeLogger({ configManager: makeConfig(), writer: null });
        logger.queue.push({ doc: makeLogEntry('req-3'), requestInfo: { requestId: 'req-3' } });

        await expect(logger.flushAsync()).resolves.toBeUndefined();
    });

    test('swallows writer failures — a CH outage must not break the request cycle', async () => {
        writer.writeBatchAsync.mockResolvedValue({ inserted: 0, skipped: 1 });
        const logger = makeLogger({ configManager: makeConfig(), writer });
        logger.queue.push({ doc: makeLogEntry('req-4'), requestInfo: { requestId: 'req-4' } });

        await expect(logger.flushAsync()).resolves.toBeUndefined();
        expect(writer.writeBatchAsync).toHaveBeenCalledTimes(1);
    });

    test('runs Kafka, Mongo, and ClickHouse branches together when all enabled', async () => {
        const logger = makeLogger({
            configManager: makeConfig({ kafka: true, mongo: true, clickHouse: true }),
            writer
        });
        logger.queue.push({ doc: makeLogEntry('req-5'), requestInfo: { requestId: 'req-5' } });

        await logger.flushAsync();

        expect(writer.writeBatchAsync).toHaveBeenCalledTimes(1);
        expect(logger.accessLogsEventProducer.produce).toHaveBeenCalledTimes(1);
        expect(logger.databaseBulkInserter.executeAsync).toHaveBeenCalledTimes(1);
    });
});
