/**
 * Unit tests for AdminAccessLogClickHouseManager
 * Tests: constructor validation, getLogAsync success/error paths, row mapping
 */
const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

jestObj.mock('../../../utils/assertType', () => ({
    assertTypeEquals: jestObj.fn(),
    assertIsValid: jestObj.fn()
}));

jestObj.mock('../../../operations/common/logging', () => ({
    logInfo: jestObj.fn(),
    logDebug: jestObj.fn(),
    logError: jestObj.fn(),
    logWarn: jestObj.fn()
}));

jestObj.mock('../../../utils/clickHouseClientManager', () => {
    class ClickHouseClientManager {
        async queryAsync() { return []; }
    }
    return { ClickHouseClientManager };
});

const { AdminAccessLogClickHouseManager } = require('../../../admin/adminAccessLogClickHouseManager');
const { ClickHouseClientManager } = require('../../../utils/clickHouseClientManager');
const { logError } = require('../../../operations/common/logging');
const { TABLES } = require('../../../constants/clickHouseConstants');

function createMockInstance(ClassType) {
    return Object.create(ClassType.prototype);
}

describe('AdminAccessLogClickHouseManager', () => {
    let manager;
    let mockClickHouseClientManager;

    beforeEach(() => {
        jestObj.clearAllMocks();

        mockClickHouseClientManager = createMockInstance(ClickHouseClientManager);
        mockClickHouseClientManager.queryAsync = jestObj.fn().mockResolvedValue([]);

        manager = new AdminAccessLogClickHouseManager({
            clickHouseClientManager: mockClickHouseClientManager
        });
    });

    describe('constructor', () => {
        test('assigns clickHouseClientManager property', () => {
            expect(manager.clickHouseClientManager).toBe(mockClickHouseClientManager);
        });

        test('calls assertTypeEquals with clickHouseClientManager', () => {
            const { assertTypeEquals } = require('../../../utils/assertType');
            expect(assertTypeEquals).toHaveBeenCalledWith(
                mockClickHouseClientManager,
                ClickHouseClientManager
            );
        });
    });

    describe('getLogAsync', () => {
        test('returns empty array when no rows are found', async () => {
            mockClickHouseClientManager.queryAsync.mockResolvedValue([]);

            const result = await manager.getLogAsync('request-123');

            expect(result).toEqual([]);
        });

        test('passes correct query and params to clickHouseClientManager', async () => {
            mockClickHouseClientManager.queryAsync.mockResolvedValue([]);

            await manager.getLogAsync('my-request-id');

            expect(mockClickHouseClientManager.queryAsync).toHaveBeenCalledWith({
                query: expect.stringContaining(`FROM ${TABLES.ACCESS_LOG}`),
                query_params: { id: 'my-request-id' }
            });
        });

        test('query includes WHERE clause filtering by request_id', async () => {
            mockClickHouseClientManager.queryAsync.mockResolvedValue([]);

            await manager.getLogAsync('test-id');

            const callArgs = mockClickHouseClientManager.queryAsync.mock.calls[0][0];
            expect(callArgs.query).toContain('WHERE request_id = {id:String}');
        });

        test('query includes ORDER BY timestamp DESC', async () => {
            mockClickHouseClientManager.queryAsync.mockResolvedValue([]);

            await manager.getLogAsync('test-id');

            const callArgs = mockClickHouseClientManager.queryAsync.mock.calls[0][0];
            expect(callArgs.query).toContain('ORDER BY timestamp DESC');
        });

        test('query includes LIMIT 100', async () => {
            mockClickHouseClientManager.queryAsync.mockResolvedValue([]);

            await manager.getLogAsync('test-id');

            const callArgs = mockClickHouseClientManager.queryAsync.mock.calls[0][0];
            expect(callArgs.query).toContain('LIMIT 100');
        });

        test('maps single row correctly from ClickHouse format to envelope shape', async () => {
            const clickHouseRow = {
                timestamp: '2024-01-15T10:30:00.000Z',
                outcome_desc: 'Success',
                agent: { type: 'system', who: 'service-1' },
                details: { method: 'GET', path: '/Patient' },
                request: { id: 'req-123', url: '/Patient/1' }
            };
            mockClickHouseClientManager.queryAsync.mockResolvedValue([clickHouseRow]);

            const result = await manager.getLogAsync('req-123');

            expect(result).toHaveLength(1);
            expect(result[0]).toEqual({
                timestamp: '2024-01-15T10:30:00.000Z',
                outcomeDesc: 'Success',
                agent: { type: 'system', who: 'service-1' },
                details: { method: 'GET', path: '/Patient' },
                request: { id: 'req-123', url: '/Patient/1' }
            });
        });

        test('maps outcome_desc to outcomeDesc (camelCase conversion)', async () => {
            const clickHouseRow = {
                timestamp: '2024-01-15T10:30:00.000Z',
                outcome_desc: 'Forbidden',
                agent: null,
                details: null,
                request: null
            };
            mockClickHouseClientManager.queryAsync.mockResolvedValue([clickHouseRow]);

            const result = await manager.getLogAsync('req-456');

            expect(result[0].outcomeDesc).toBe('Forbidden');
            // Ensure snake_case key is not present
            expect(result[0].outcome_desc).toBeUndefined();
        });

        test('maps multiple rows correctly', async () => {
            const rows = [
                {
                    timestamp: '2024-01-15T10:30:00.000Z',
                    outcome_desc: 'Success',
                    agent: { who: 'user-1' },
                    details: { method: 'GET' },
                    request: { id: 'req-1' }
                },
                {
                    timestamp: '2024-01-15T10:29:00.000Z',
                    outcome_desc: 'Error',
                    agent: { who: 'user-2' },
                    details: { method: 'POST' },
                    request: { id: 'req-2' }
                },
                {
                    timestamp: '2024-01-15T10:28:00.000Z',
                    outcome_desc: 'NotFound',
                    agent: { who: 'user-3' },
                    details: { method: 'DELETE' },
                    request: { id: 'req-3' }
                }
            ];
            mockClickHouseClientManager.queryAsync.mockResolvedValue(rows);

            const result = await manager.getLogAsync('req-multi');

            expect(result).toHaveLength(3);
            expect(result[0].outcomeDesc).toBe('Success');
            expect(result[1].outcomeDesc).toBe('Error');
            expect(result[2].outcomeDesc).toBe('NotFound');
        });

        test('returns empty array when queryAsync throws an error', async () => {
            mockClickHouseClientManager.queryAsync.mockRejectedValue(
                new Error('ClickHouse connection timeout')
            );

            const result = await manager.getLogAsync('req-err');

            expect(result).toEqual([]);
        });

        test('logs error when queryAsync throws', async () => {
            const error = new Error('ClickHouse unavailable');
            mockClickHouseClientManager.queryAsync.mockRejectedValue(error);

            await manager.getLogAsync('req-err');

            expect(logError).toHaveBeenCalledWith(
                'ClickHouse unavailable',
                { error }
            );
        });

        test('handles rows with null/undefined field values', async () => {
            const clickHouseRow = {
                timestamp: null,
                outcome_desc: undefined,
                agent: null,
                details: undefined,
                request: null
            };
            mockClickHouseClientManager.queryAsync.mockResolvedValue([clickHouseRow]);

            const result = await manager.getLogAsync('req-nulls');

            expect(result).toHaveLength(1);
            expect(result[0]).toEqual({
                timestamp: null,
                outcomeDesc: undefined,
                agent: null,
                details: undefined,
                request: null
            });
        });

        test('handles empty string id parameter', async () => {
            mockClickHouseClientManager.queryAsync.mockResolvedValue([]);

            const result = await manager.getLogAsync('');

            expect(mockClickHouseClientManager.queryAsync).toHaveBeenCalledWith({
                query: expect.any(String),
                query_params: { id: '' }
            });
            expect(result).toEqual([]);
        });

        test('does not throw for undefined id parameter', async () => {
            mockClickHouseClientManager.queryAsync.mockResolvedValue([]);

            const result = await manager.getLogAsync(undefined);

            expect(mockClickHouseClientManager.queryAsync).toHaveBeenCalledWith({
                query: expect.any(String),
                query_params: { id: undefined }
            });
            expect(result).toEqual([]);
        });

        test('preserves complex nested objects in agent, details, and request fields', async () => {
            const complexRow = {
                timestamp: '2024-06-01T00:00:00.000Z',
                outcome_desc: 'OK',
                agent: {
                    type: 'human',
                    who: { reference: 'Practitioner/123' },
                    roles: ['admin', 'reader']
                },
                details: {
                    method: 'POST',
                    path: '/Patient/$everything',
                    query: { _count: '10', _since: '2024-01-01' },
                    headers: { authorization: 'Bearer token' }
                },
                request: {
                    id: 'complex-req',
                    url: '/Patient/$everything',
                    body: { resourceType: 'Parameters' }
                }
            };
            mockClickHouseClientManager.queryAsync.mockResolvedValue([complexRow]);

            const result = await manager.getLogAsync('complex-req');

            expect(result[0].agent.roles).toEqual(['admin', 'reader']);
            expect(result[0].details.query._count).toBe('10');
            expect(result[0].request.body.resourceType).toBe('Parameters');
        });

        test('does not include extra fields from ClickHouse row in result', async () => {
            const rowWithExtraFields = {
                timestamp: '2024-01-15T10:30:00.000Z',
                outcome_desc: 'Success',
                agent: {},
                details: {},
                request: {},
                // Extra fields that might exist in ClickHouse but should not be in output
                request_id: 'req-123',
                extra_column: 'should-not-appear'
            };
            mockClickHouseClientManager.queryAsync.mockResolvedValue([rowWithExtraFields]);

            const result = await manager.getLogAsync('req-123');

            expect(result[0]).toEqual({
                timestamp: '2024-01-15T10:30:00.000Z',
                outcomeDesc: 'Success',
                agent: {},
                details: {},
                request: {}
            });
            expect(result[0].request_id).toBeUndefined();
            expect(result[0].extra_column).toBeUndefined();
        });

        test('query selects only the expected columns', async () => {
            mockClickHouseClientManager.queryAsync.mockResolvedValue([]);

            await manager.getLogAsync('test-id');

            const callArgs = mockClickHouseClientManager.queryAsync.mock.calls[0][0];
            expect(callArgs.query).toContain('SELECT timestamp, outcome_desc, agent, details, request');
        });
    });
});
