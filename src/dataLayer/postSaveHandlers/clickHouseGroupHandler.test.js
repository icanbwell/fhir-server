const { describe, test, expect, beforeEach, jest } = require('@jest/globals');
const { ClickHouseGroupHandler } = require('./clickHouseGroupHandler');
const { OPERATION_TYPES } = require('../../constants/clickHouseConstants');
const httpContext = require('express-http-context');

// Mock httpContext
jest.mock('express-http-context', () => ({
    get: jest.fn(),
    set: jest.fn()
}));

describe('ClickHouseGroupHandler', () => {
    let handler;
    let mockClickHouseClientManager;
    let mockConfigManager;
    let mockGroupMemberRepository;

    beforeEach(() => {
        // Clear httpContext mocks
        jest.clearAllMocks();

        mockClickHouseClientManager = {
            queryAsync: jest.fn(),
            insertAsync: jest.fn()
        };

        mockConfigManager = {
            enableClickHouse: true,
            mongoWithClickHouseResources: ['Group']
        };

        mockGroupMemberRepository = {
            appendEvents: jest.fn().mockResolvedValue({ success: true })
        };

        handler = new ClickHouseGroupHandler({
            clickHouseClientManager: mockClickHouseClientManager,
            configManager: mockConfigManager,
            groupMemberRepository: mockGroupMemberRepository
        });
    });

    describe('afterSaveAsync', () => {
        test('should skip processing when ClickHouse is disabled', async () => {
            mockConfigManager.enableClickHouse = false;

            await handler.afterSaveAsync({
                requestId: 'req-1',
                eventType: OPERATION_TYPES.CREATE,
                resourceType: 'Group',
                doc: { id: 'group-1' }
            });

            expect(mockClickHouseClientManager.queryAsync).not.toHaveBeenCalled();
            expect(mockClickHouseClientManager.insertAsync).not.toHaveBeenCalled();
        });

        test('should skip processing when Group is not in enabled resources', async () => {
            mockConfigManager.mongoWithClickHouseResources = ['Patient'];

            await handler.afterSaveAsync({
                requestId: 'req-1',
                eventType: OPERATION_TYPES.CREATE,
                resourceType: 'Group',
                doc: { id: 'group-1' }
            });

            expect(mockClickHouseClientManager.queryAsync).not.toHaveBeenCalled();
            expect(mockClickHouseClientManager.insertAsync).not.toHaveBeenCalled();
        });

        test('should skip processing for non-Group resources', async () => {
            await handler.afterSaveAsync({
                requestId: 'req-1',
                eventType: OPERATION_TYPES.CREATE,
                resourceType: 'Patient',
                doc: { id: 'patient-1' }
            });

            expect(mockClickHouseClientManager.queryAsync).not.toHaveBeenCalled();
            expect(mockClickHouseClientManager.insertAsync).not.toHaveBeenCalled();
        });

        test('should process Group save when configured', async () => {
            const groupId = 'group-1';
            const members = [{
                entity: { reference: 'Patient/patient-1' }
            }];

            // Mock httpContext to return members (simulating what databaseBulkInserter does)
            httpContext.get = jest.fn((key) => {
                if (key === `group-members-${groupId}`) {
                    return members;
                }
                return undefined;
            });

            await handler.afterSaveAsync({
                requestId: 'req-1',
                eventType: OPERATION_TYPES.CREATE,
                resourceType: 'Group',
                doc: {
                    id: 'group-1',
                    _uuid: 'uuid-1',
                    member: members,
                    meta: {
                        security: [
                            { system: 'https://www.icanbwell.com/owner', code: 'owner1' },
                            { system: 'https://www.icanbwell.com/access', code: 'access1' }
                        ],
                        versionId: '1',
                        lastUpdated: '2024-01-01T00:00:00Z'
                    }
                }
            });

            expect(mockGroupMemberRepository.appendEvents).toHaveBeenCalled();
        });

        test('should propagate errors from ClickHouse', async () => {
            const groupId = 'group-1';
            const members = [{
                entity: { reference: 'Patient/test' }
            }];

            // Mock httpContext to return members
            httpContext.get = jest.fn((key) => {
                if (key === `group-members-${groupId}`) {
                    return members;
                }
                return undefined;
            });

            // Mock appendEvents to reject with error
            mockGroupMemberRepository.appendEvents.mockRejectedValue(new Error('ClickHouse connection error'));

            // Handler should propagate errors to fail the API request
            await expect(handler.afterSaveAsync({
                requestId: 'req-1',
                eventType: OPERATION_TYPES.CREATE,
                resourceType: 'Group',
                doc: {
                    id: groupId,
                    _uuid: 'uuid-1',
                    member: members,
                    meta: {
                        security: [],
                        versionId: '1',
                        lastUpdated: '2024-01-01T00:00:00Z'
                    }
                }
            })).rejects.toThrow();
        });
    });

    describe('Write consistency modes', () => {
        beforeEach(() => {
        });

        test('shouldBlockForResource returns true in sync mode by default', () => {
            expect(handler.shouldBlockForResource('Group')).toBe(true);
        });

        test('shouldBlockForResource always returns true for Group', () => {
            // Group membership writes are always synchronous
            // ClickHouse is the source of truth for member state
            // Note: Async mode can be added if another resource uses ClickHouse
            expect(handler.shouldBlockForResource('Group')).toBe(true);
        });

        test('shouldBlockForResource returns false for non-Group resources', () => {
            expect(handler.shouldBlockForResource('Patient')).toBe(false);
            expect(handler.shouldBlockForResource('Observation')).toBe(false);
        });

        test('afterSaveAsync always blocks for Group writes', async () => {
            const groupId = 'group-1';
            const members = [{ entity: { reference: 'Patient/1' } }];

            // Mock httpContext to return members
            httpContext.get = jest.fn((key) => {
                if (key === `group-members-${groupId}`) {
                    return members;
                }
                return undefined;
            });

            let writeCompleted = false;
            mockGroupMemberRepository.appendEvents.mockImplementation(async () => {
                const WRITE_DELAY_MS = 100;
                await new Promise(resolve => setTimeout(resolve, WRITE_DELAY_MS));
                writeCompleted = true;
            });

            await handler.afterSaveAsync({
                requestId: 'req-1',
                eventType: 'C',
                resourceType: 'Group',
                doc: {
                    id: groupId,
                    _uuid: 'uuid-1',
                    member: members,
                    meta: { security: [], versionId: '1', lastUpdated: '2024-01-01T00:00:00Z' }
                }
            });

            expect(writeCompleted).toBe(true);
        });
    });

    describe('canHandle', () => {
        test('returns true for Group when ClickHouse enabled', () => {
            expect(handler.canHandle('Group')).toBe(true);
        });

        test('returns false when ClickHouse disabled', () => {
            mockConfigManager.enableClickHouse = false;
            expect(handler.canHandle('Group')).toBe(false);
        });

        test('returns false for non-enabled resources', () => {
            expect(handler.canHandle('Patient')).toBe(false);
        });
    });

    describe('DELETE operations', () => {
        test('should not write ClickHouse events when Group deleted', async () => {
            mockConfigManager.enableClickHouse = true;
            mockConfigManager.mongoWithClickHouseResources = ['Group'];

            await handler.afterSaveAsync({
                requestId: 'req-1',
                eventType: OPERATION_TYPES.DELETE,
                resourceType: 'Group',
                doc: {
                    id: 'group-1',
                    _uuid: 'group-uuid-1',
                    meta: { versionId: '1', security: [] }
                }
            });

            // DELETE operations skip ClickHouse writes - event log retained for audit
            expect(mockClickHouseClientManager.queryAsync).not.toHaveBeenCalled();
            expect(mockClickHouseClientManager.insertAsync).not.toHaveBeenCalled();
        });

        test('should handle deletion of Group with ClickHouse disabled', async () => {
            mockConfigManager.enableClickHouse = false;

            await handler.afterSaveAsync({
                requestId: 'req-1',
                eventType: OPERATION_TYPES.DELETE,
                resourceType: 'Group',
                doc: { id: 'group-1', _uuid: 'group-uuid-1', meta: { security: [] } }
            });

            expect(mockClickHouseClientManager.queryAsync).not.toHaveBeenCalled();
            expect(mockClickHouseClientManager.insertAsync).not.toHaveBeenCalled();
        });
    });
});
