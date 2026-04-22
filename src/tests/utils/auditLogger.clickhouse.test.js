const { describe, test, expect, jest, beforeEach } = require('@jest/globals');
const { AuditLogger } = require('../../utils/auditLogger');
const { PostRequestProcessor } = require('../../utils/postRequestProcessor');
const { DatabaseBulkInserter } = require('../../dataLayer/databaseBulkInserter');
const { PreSaveManager } = require('../../preSaveHandlers/preSave');
const { ConfigManager } = require('../../utils/configManager');
const AuditEvent = require('../../fhir/classes/4_0_0/resources/auditEvent');
const Meta = require('../../fhir/classes/4_0_0/complex_types/meta');
const Coding = require('../../fhir/classes/4_0_0/complex_types/coding');
const Reference = require('../../fhir/classes/4_0_0/complex_types/reference');
const AuditEventAgent = require('../../fhir/classes/4_0_0/backbone_elements/auditEventAgent');
const AuditEventSource = require('../../fhir/classes/4_0_0/backbone_elements/auditEventSource');

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

describe('AuditLogger', () => {
    let mockPostRequestProcessor;
    let mockDatabaseBulkInserter;
    let mockPreSaveManager;
    let mockConfigManager;

    beforeEach(() => {
        mockPostRequestProcessor = Object.create(PostRequestProcessor.prototype);
        mockPostRequestProcessor.add = jest.fn();

        mockDatabaseBulkInserter = Object.create(DatabaseBulkInserter.prototype);
        mockDatabaseBulkInserter.getOperationForResourceAsync = jest.fn().mockReturnValue({});
        mockDatabaseBulkInserter.executeAsync = jest.fn().mockResolvedValue([]);

        mockPreSaveManager = Object.create(PreSaveManager.prototype);
        mockPreSaveManager.preSaveAsync = jest.fn().mockResolvedValue(undefined);

        mockConfigManager = Object.create(ConfigManager.prototype);
        Object.defineProperty(mockConfigManager, 'enableAuditEvent', { get: () => true });
        Object.defineProperty(mockConfigManager, 'maxIdsPerAuditEvent', { get: () => 50 });
    });

    function createAuditLogger (overrides = {}) {
        const config = overrides.configManager || mockConfigManager;
        return new AuditLogger({
            postRequestProcessor: mockPostRequestProcessor,
            databaseBulkInserter: mockDatabaseBulkInserter,
            preSaveManager: mockPreSaveManager,
            configManager: config
        });
    }

    test('sends audit events through databaseBulkInserter', async () => {
        const logger = createAuditLogger();
        const doc = createTestAuditEvent('test-audit-1');
        logger.queue.push({ doc, requestInfo: { requestId: 'req-1' } });

        await logger.flushAsync();

        expect(mockDatabaseBulkInserter.getOperationForResourceAsync).toHaveBeenCalledTimes(1);
        expect(mockDatabaseBulkInserter.executeAsync).toHaveBeenCalledTimes(1);
    });

    test('sends multiple events in a single executeAsync call', async () => {
        const logger = createAuditLogger();
        const doc1 = createTestAuditEvent('test-audit-2a');
        const doc2 = createTestAuditEvent('test-audit-2b');
        const doc3 = createTestAuditEvent('test-audit-2c');
        logger.queue.push(
            { doc: doc1, requestInfo: { requestId: 'req-2' } },
            { doc: doc2, requestInfo: { requestId: 'req-2' } },
            { doc: doc3, requestInfo: { requestId: 'req-2' } }
        );

        await logger.flushAsync();

        expect(mockDatabaseBulkInserter.getOperationForResourceAsync).toHaveBeenCalledTimes(3);
        expect(mockDatabaseBulkInserter.executeAsync).toHaveBeenCalledTimes(1);
    });

    test('does not flush when queue is empty', async () => {
        const logger = createAuditLogger();

        await logger.flushAsync();

        expect(mockDatabaseBulkInserter.executeAsync).not.toHaveBeenCalled();
    });

    test('does not create audit entries when enableAuditEvent is false', async () => {
        const disabledConfig = Object.create(ConfigManager.prototype);
        Object.defineProperty(disabledConfig, 'enableAuditEvent', { get: () => false });
        Object.defineProperty(disabledConfig, 'maxIdsPerAuditEvent', { get: () => 50 });

        const logger = createAuditLogger({ configManager: disabledConfig });

        await logger.logAuditEntryAsync({
            requestInfo: { requestId: 'req-3', user: 'test-user' },
            base_version: '4_0_0',
            resourceType: 'Patient',
            operation: 'read',
            args: {},
            ids: ['patient-1']
        });

        expect(logger.queue).toHaveLength(0);
    });

    test('does not create audit entries for AuditEvent resourceType', async () => {
        const logger = createAuditLogger();

        await logger.logAuditEntryAsync({
            requestInfo: { requestId: 'req-4', user: 'test-user' },
            base_version: '4_0_0',
            resourceType: 'AuditEvent',
            operation: 'read',
            args: {},
            ids: ['audit-1']
        });

        expect(logger.queue).toHaveLength(0);
    });

    test('logs errors from executeAsync but does not throw', async () => {
        mockDatabaseBulkInserter.executeAsync.mockResolvedValue([
            { issue: { severity: 'error', code: 'exception' } }
        ]);

        const logger = createAuditLogger();
        const doc = createTestAuditEvent('test-audit-5');
        logger.queue.push({ doc, requestInfo: { requestId: 'req-5' } });

        await expect(logger.flushAsync()).resolves.toBeUndefined();
        expect(mockDatabaseBulkInserter.executeAsync).toHaveBeenCalledTimes(1);
    });

    test('clears queue after flush', async () => {
        const logger = createAuditLogger();
        const doc = createTestAuditEvent('test-audit-6');
        logger.queue.push({ doc, requestInfo: { requestId: 'req-6' } });

        await logger.flushAsync();

        expect(logger.queue).toHaveLength(0);

        mockDatabaseBulkInserter.executeAsync.mockClear();
        await logger.flushAsync();
        expect(mockDatabaseBulkInserter.executeAsync).not.toHaveBeenCalled();
    });
});
