const { describe, test, expect, jest, beforeEach } = require('@jest/globals');
const { AuditEventClickHouseWriter } = require('../../utils/auditEventClickHouseWriter');
const { AuditEventClickHouseRepository } = require('../../dataLayer/repositories/auditEventClickHouseRepository');
const { AuditEventTransformer } = require('../../dataLayer/clickHouse/auditEventTransformer');
const deepcopy = require('deepcopy');
const auditEventSample = require('../scripts/fixtures/audit_event_sample.json');

describe('AuditEventClickHouseWriter', () => {
    let mockRepository;
    let transformer;
    let writer;

    beforeEach(() => {
        mockRepository = Object.create(AuditEventClickHouseRepository.prototype);
        mockRepository.insertBatchAsync = jest.fn().mockResolvedValue(undefined);

        transformer = new AuditEventTransformer();
        writer = new AuditEventClickHouseWriter({
            auditEventClickHouseRepository: mockRepository,
            auditEventTransformer: transformer
        });
    });

    test('transforms and inserts a batch of documents', async () => {
        const docs = [deepcopy(auditEventSample), deepcopy(auditEventSample)];
        docs[1].id = 'audit-002';
        docs[1]._uuid = 'audit-uuid-002';

        const result = await writer.writeBatchAsync(docs);

        expect(result.inserted).toBe(2);
        expect(result.skipped).toBe(0);
        expect(mockRepository.insertBatchAsync).toHaveBeenCalledTimes(1);
        const insertedRows = mockRepository.insertBatchAsync.mock.calls[0][0];
        expect(insertedRows).toHaveLength(2);
        expect(insertedRows[0]._uuid).toBe('audit-uuid-001');
        expect(insertedRows[1]._uuid).toBe('audit-uuid-002');
    });

    test('skips malformed documents and inserts valid ones', async () => {
        const validDoc = deepcopy(auditEventSample);
        const malformedDoc = deepcopy(auditEventSample);
        delete malformedDoc._uuid; // transformer returns null for missing _uuid

        const result = await writer.writeBatchAsync([malformedDoc, validDoc]);

        expect(result.inserted).toBe(1);
        expect(result.skipped).toBe(1);
        expect(mockRepository.insertBatchAsync).toHaveBeenCalledTimes(1);
        const insertedRows = mockRepository.insertBatchAsync.mock.calls[0][0];
        expect(insertedRows).toHaveLength(1);
    });

    test('returns zeros for empty input', async () => {
        const result = await writer.writeBatchAsync([]);

        expect(result.inserted).toBe(0);
        expect(result.skipped).toBe(0);
        expect(mockRepository.insertBatchAsync).not.toHaveBeenCalled();
    });

    test('returns zeros for null input', async () => {
        const result = await writer.writeBatchAsync(null);

        expect(result.inserted).toBe(0);
        expect(result.skipped).toBe(0);
        expect(mockRepository.insertBatchAsync).not.toHaveBeenCalled();
    });

    test('returns zeros when all documents are malformed', async () => {
        const doc1 = deepcopy(auditEventSample);
        const doc2 = deepcopy(auditEventSample);
        delete doc1._uuid;
        delete doc2._uuid;

        const result = await writer.writeBatchAsync([doc1, doc2]);

        expect(result.inserted).toBe(0);
        expect(result.skipped).toBe(2);
        expect(mockRepository.insertBatchAsync).not.toHaveBeenCalled();
    });

    test('logs error and re-throws when repository fails', async () => {
        const insertError = new Error('ClickHouse connection failed');
        mockRepository.insertBatchAsync.mockRejectedValue(insertError);

        const doc = deepcopy(auditEventSample);

        await expect(writer.writeBatchAsync([doc])).rejects.toThrow('ClickHouse connection failed');
        expect(mockRepository.insertBatchAsync).toHaveBeenCalledTimes(1);
    });
});
