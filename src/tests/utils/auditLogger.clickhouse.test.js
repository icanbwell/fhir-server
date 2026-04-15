const { describe, test, expect, jest, beforeEach, afterEach } = require('@jest/globals');
const { AuditLogger } = require('../../utils/auditLogger');
const { PostRequestProcessor } = require('../../utils/postRequestProcessor');
const { DatabaseBulkInserter } = require('../../dataLayer/databaseBulkInserter');
const { PreSaveManager } = require('../../preSaveHandlers/preSave');
const { ConfigManager } = require('../../utils/configManager');
const { AuditEventClickHouseWriter } = require('../../utils/auditEventClickHouseWriter');
const AuditEvent = require('../../fhir/classes/4_0_0/resources/auditEvent');
const Meta = require('../../fhir/classes/4_0_0/complex_types/meta');
const Coding = require('../../fhir/classes/4_0_0/complex_types/coding');
const Reference = require('../../fhir/classes/4_0_0/complex_types/reference');
const AuditEventAgent = require('../../fhir/classes/4_0_0/backbone_elements/auditEventAgent');
const AuditEventSource = require('../../fhir/classes/4_0_0/backbone_elements/auditEventSource');

/**
 * Creates a minimal AuditEvent resource for testing
 */
function createTestAuditEvent (id) {
    return new AuditEvent({
        id,
        _uuid: `AuditEvent/${id}`,
        _sourceId: id,
        _sourceAssigningAuthority: 'bwell',
        meta: new Meta({
            versionId: '1',
            lastUpdated: new Date('2024-06-15T10:30:00.000Z'),
            security: [
                new Coding({ system: 'https://www.icanbwell.com/owner', code: 'bwell' }),
                new Coding({ system: 'https://www.icanbwell.com/access', code: 'bwell' })
            ]
        }),
        recorded: new Date('2024-06-15T10:30:00.000Z'),
        type: new Coding({ system: 'http://dicom.nema.org/resources/ontology/DCM', code: '110112' }),
        action: 'R',
        agent: [
            new AuditEventAgent({
                who: new Reference({ reference: 'Person/test-user' }),
                requestor: true
            })
        ],
        source: new AuditEventSource({
            observer: new Reference({ reference: 'Person/test-user' })
        })
    });
}

describe('AuditLogger ClickHouse Integration', () => {
    let mockPostRequestProcessor;
    let mockDatabaseBulkInserter;
    let mockPreSaveManager;
    let mockConfigManager;
    let mockClickHouseWriter;

    beforeEach(() => {
        mockPostRequestProcessor = Object.create(PostRequestProcessor.prototype);
        mockPostRequestProcessor.add = jest.fn();

        mockDatabaseBulkInserter = Object.create(DatabaseBulkInserter.prototype);
        mockDatabaseBulkInserter.getOperationForResourceAsync = jest.fn().mockReturnValue({});
        mockDatabaseBulkInserter.executeAsync = jest.fn().mockResolvedValue([]);

        mockPreSaveManager = Object.create(PreSaveManager.prototype);
        mockPreSaveManager.preSaveAsync = jest.fn().mockResolvedValue(undefined);

        mockConfigManager = Object.create(ConfigManager.prototype);
        Object.defineProperty(mockConfigManager, 'enableAuditEventMongoDB', { get: () => false });
        Object.defineProperty(mockConfigManager, 'enableAuditEventClickHouse', { get: () => true });
        Object.defineProperty(mockConfigManager, 'maxIdsPerAuditEvent', { get: () => 50 });

        mockClickHouseWriter = Object.create(AuditEventClickHouseWriter.prototype);
        mockClickHouseWriter.writeBatchAsync = jest.fn().mockResolvedValue({ inserted: 1, skipped: 0 });
    });

    function createAuditLogger (overrides = {}) {
        const config = overrides.configManager || mockConfigManager;
        return new AuditLogger({
            postRequestProcessor: mockPostRequestProcessor,
            databaseBulkInserter: mockDatabaseBulkInserter,
            preSaveManager: mockPreSaveManager,
            configManager: config,
            auditEventClickHouseWriter: overrides.auditEventClickHouseWriter !== undefined
                ? overrides.auditEventClickHouseWriter
                : mockClickHouseWriter
        });
    }

    test('writes to ClickHouse when enabled', async () => {
        const logger = createAuditLogger();
        const doc = createTestAuditEvent('test-audit-1');
        logger.queue.push({ doc, requestInfo: { requestId: 'req-1' } });

        await logger.flushAsync();

        expect(mockClickHouseWriter.writeBatchAsync).toHaveBeenCalledTimes(1);
        const docs = mockClickHouseWriter.writeBatchAsync.mock.calls[0][0];
        expect(docs).toHaveLength(1);
        expect(docs[0]._uuid).toBe('AuditEvent/test-audit-1');
    });

    test('does not write to ClickHouse when disabled', async () => {
        const disabledConfig = Object.create(ConfigManager.prototype);
        Object.defineProperty(disabledConfig, 'enableAuditEventMongoDB', { get: () => true });

        Object.defineProperty(disabledConfig, 'enableAuditEventClickHouse', { get: () => false });
        Object.defineProperty(disabledConfig, 'maxIdsPerAuditEvent', { get: () => 50 });

        const logger = createAuditLogger({ configManager: disabledConfig });
        const doc = createTestAuditEvent('test-audit-2');
        logger.queue.push({ doc, requestInfo: { requestId: 'req-2' } });

        await logger.flushAsync();

        expect(mockClickHouseWriter.writeBatchAsync).not.toHaveBeenCalled();
    });

    test('does not write to ClickHouse when writer is null', async () => {
        const logger = createAuditLogger({ auditEventClickHouseWriter: null });
        const doc = createTestAuditEvent('test-audit-3');
        logger.queue.push({ doc, requestInfo: { requestId: 'req-3' } });

        await logger.flushAsync();

        // Should not throw, just skip
        expect(mockClickHouseWriter.writeBatchAsync).not.toHaveBeenCalled();
    });

    test('logs error but does not throw when ClickHouse write fails', async () => {
        mockClickHouseWriter.writeBatchAsync.mockRejectedValue(new Error('ClickHouse down'));

        const logger = createAuditLogger();
        const doc = createTestAuditEvent('test-audit-4');
        logger.queue.push({ doc, requestInfo: { requestId: 'req-4' } });

        // Should not throw
        await expect(logger.flushAsync()).resolves.toBeUndefined();
        expect(mockClickHouseWriter.writeBatchAsync).toHaveBeenCalledTimes(1);
    });

    test('writes to both MongoDB and ClickHouse when both enabled', async () => {
        const bothEnabledConfig = Object.create(ConfigManager.prototype);
        Object.defineProperty(bothEnabledConfig, 'enableAuditEventMongoDB', { get: () => true });

        Object.defineProperty(bothEnabledConfig, 'enableAuditEventClickHouse', { get: () => true });
        Object.defineProperty(bothEnabledConfig, 'maxIdsPerAuditEvent', { get: () => 50 });

        const logger = createAuditLogger({ configManager: bothEnabledConfig });
        const doc = createTestAuditEvent('test-audit-5');
        logger.queue.push({ doc, requestInfo: { requestId: 'req-5' } });

        await logger.flushAsync();

        // ClickHouse write should happen
        expect(mockClickHouseWriter.writeBatchAsync).toHaveBeenCalledTimes(1);
        // MongoDB operations should be created
        expect(mockDatabaseBulkInserter.getOperationForResourceAsync).toHaveBeenCalledTimes(1);
        expect(mockDatabaseBulkInserter.executeAsync).toHaveBeenCalledTimes(1);
    });

    test('writes multiple events in a single batch', async () => {
        const logger = createAuditLogger();
        const doc1 = createTestAuditEvent('test-audit-6a');
        const doc2 = createTestAuditEvent('test-audit-6b');
        logger.queue.push(
            { doc: doc1, requestInfo: { requestId: 'req-6' } },
            { doc: doc2, requestInfo: { requestId: 'req-6' } }
        );

        await logger.flushAsync();

        expect(mockClickHouseWriter.writeBatchAsync).toHaveBeenCalledTimes(1);
        const docs = mockClickHouseWriter.writeBatchAsync.mock.calls[0][0];
        expect(docs).toHaveLength(2);
    });

    test('isAuditEventEnabled is true when only ClickHouse is enabled', () => {
        const chOnlyConfig = Object.create(ConfigManager.prototype);
        Object.defineProperty(chOnlyConfig, 'enableAuditEventMongoDB', { get: () => false });

        Object.defineProperty(chOnlyConfig, 'enableAuditEventClickHouse', { get: () => true });
        Object.defineProperty(chOnlyConfig, 'maxIdsPerAuditEvent', { get: () => 50 });

        const logger = createAuditLogger({ configManager: chOnlyConfig });
        expect(logger.isAuditEventEnabled).toBe(true);
    });
});
