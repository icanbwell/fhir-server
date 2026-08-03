'use strict';

const { describe, test, beforeEach, expect, jest: jestObj } = require('@jest/globals');

// Mock assertType before importing
jestObj.mock('../../../utils/assertType', () => ({
    assertTypeEquals: jestObj.fn(),
    assertIsValid: jestObj.fn()
}));

// Mock logging
jestObj.mock('../../../operations/common/logging', () => ({
    logError: jestObj.fn()
}));

const { AdminLogManager } = require('../../../admin/adminLogManager');
const { logError } = require('../../../operations/common/logging');

describe('AdminLogManager', () => {
    let adminLogManager;
    let mockMongoDatabaseManager;
    let mockCollection;
    let mockAccessLogsDb;

    beforeEach(() => {
        mockCollection = {
            find: jestObj.fn()
        };
        mockAccessLogsDb = {
            collection: jestObj.fn().mockReturnValue(mockCollection)
        };
        mockMongoDatabaseManager = {
            getAccessLogsDbAsync: jestObj.fn().mockResolvedValue(mockAccessLogsDb)
        };
        adminLogManager = new AdminLogManager({
            mongoDatabaseManager: mockMongoDatabaseManager
        });
    });

    describe('constructor', () => {
        test('assigns mongoDatabaseManager', () => {
            expect(adminLogManager.mongoDatabaseManager).toBe(mockMongoDatabaseManager);
        });
    });

    describe('getLogAsync', () => {
        test('returns logs matching the given request id', async () => {
            const expectedLogs = [
                { request: { id: 'req-1' }, timestamp: '2024-01-01' },
                { request: { id: 'req-1' }, timestamp: '2024-01-02' }
            ];
            mockCollection.find.mockReturnValue({
                toArray: jestObj.fn().mockResolvedValue(expectedLogs)
            });

            const result = await adminLogManager.getLogAsync('req-1');

            expect(mockMongoDatabaseManager.getAccessLogsDbAsync).toHaveBeenCalled();
            expect(mockAccessLogsDb.collection).toHaveBeenCalledWith('access-logs');
            expect(mockCollection.find).toHaveBeenCalledWith({ 'request.id': 'req-1' });
            expect(result).toEqual(expectedLogs);
        });

        test('returns empty array when no logs found', async () => {
            mockCollection.find.mockReturnValue({
                toArray: jestObj.fn().mockResolvedValue([])
            });

            const result = await adminLogManager.getLogAsync('non-existent');

            expect(result).toEqual([]);
        });

        test('returns empty array and logs error when database throws', async () => {
            const dbError = new Error('Connection failed');
            mockMongoDatabaseManager.getAccessLogsDbAsync.mockRejectedValue(dbError);

            const result = await adminLogManager.getLogAsync('req-1');

            expect(result).toEqual([]);
            expect(logError).toHaveBeenCalledWith('Connection failed', { error: dbError });
        });

        test('returns empty array and logs error when collection.find throws', async () => {
            const findError = new Error('Query timeout');
            mockCollection.find.mockImplementation(() => { throw findError; });

            const result = await adminLogManager.getLogAsync('req-1');

            expect(result).toEqual([]);
            expect(logError).toHaveBeenCalledWith('Query timeout', { error: findError });
        });

        test('passes the id parameter correctly to the query', async () => {
            mockCollection.find.mockReturnValue({
                toArray: jestObj.fn().mockResolvedValue([])
            });

            await adminLogManager.getLogAsync('special-request-id-123');

            expect(mockCollection.find).toHaveBeenCalledWith({ 'request.id': 'special-request-id-123' });
        });
    });
});
