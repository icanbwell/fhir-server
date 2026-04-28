const { describe, test, expect, jest, beforeEach } = require('@jest/globals');
const { AdminAccessLogClickHouseManager } = require('../../admin/adminAccessLogClickHouseManager');
const { ClickHouseClientManager } = require('../../utils/clickHouseClientManager');
const { TABLES } = require('../../constants/clickHouseConstants');

describe('AdminAccessLogClickHouseManager', () => {
    let mockClient;

    beforeEach(() => {
        mockClient = Object.create(ClickHouseClientManager.prototype);
        mockClient.queryAsync = jest.fn();
    });

    test('queries fhir.AccessLog by request_id with parameterized id', async () => {
        mockClient.queryAsync.mockResolvedValue([]);
        const manager = new AdminAccessLogClickHouseManager({ clickHouseClientManager: mockClient });

        await manager.getLogAsync('req-xyz');

        expect(mockClient.queryAsync).toHaveBeenCalledTimes(1);
        const call = mockClient.queryAsync.mock.calls[0][0];
        expect(call.query).toContain(`FROM ${TABLES.ACCESS_LOG}`);
        expect(call.query).toContain('WHERE request_id = {id:String}');
        expect(call.query).toContain('ORDER BY timestamp DESC');
        expect(call.query).toContain('LIMIT 100');
        expect(call.query_params).toEqual({ id: 'req-xyz' });
    });

    test('reassembles rows into the admin response envelope', async () => {
        mockClient.queryAsync.mockResolvedValue([
            {
                timestamp: '2024-06-15 10:30:00.000',
                outcome_desc: 'Success',
                agent: { altId: 'user-1', scopes: ['user/*.read'] },
                details: { originService: 'svc', host: 'fhir.example.com' },
                request: { id: 'req-xyz', method: 'GET' }
            }
        ]);
        const manager = new AdminAccessLogClickHouseManager({ clickHouseClientManager: mockClient });

        const result = await manager.getLogAsync('req-xyz');

        expect(result).toEqual([
            {
                timestamp: '2024-06-15 10:30:00.000',
                outcomeDesc: 'Success',
                agent: { altId: 'user-1', scopes: ['user/*.read'] },
                details: { originService: 'svc', host: 'fhir.example.com' },
                request: { id: 'req-xyz', method: 'GET' }
            }
        ]);
    });

    test('returns empty array when the client throws', async () => {
        mockClient.queryAsync.mockRejectedValue(new Error('boom'));
        const manager = new AdminAccessLogClickHouseManager({ clickHouseClientManager: mockClient });

        const result = await manager.getLogAsync('req-xyz');

        expect(result).toEqual([]);
    });
});
