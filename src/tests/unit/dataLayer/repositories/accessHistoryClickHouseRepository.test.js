'use strict';

const { describe, test, expect, jest: jestObj, beforeEach } = require('@jest/globals');

jestObj.mock('../../../../constants/clickHouseConstants', () => ({
    TABLES: { AUDIT_ACCESS_AGG: 'fhir.AUDIT_ACCESS_AGG' },
    ACCESS_HISTORY_WINDOW_DAYS: 90
}));

jestObj.mock('../../../../utils/assertType', () => ({
    assertIsValid: jestObj.fn((condition, message) => {
        if (!condition) {
            throw new Error(message);
        }
    })
}));

const { AccessHistoryClickHouseRepository } = require('../../../../dataLayer/repositories/accessHistoryClickHouseRepository');
const { assertIsValid } = require('../../../../utils/assertType');

describe('AccessHistoryClickHouseRepository', () => {
    let repo;
    let mockClickHouseClientManager;

    beforeEach(() => {
        jestObj.clearAllMocks();
        mockClickHouseClientManager = {
            queryAsync: jestObj.fn()
        };
        repo = new AccessHistoryClickHouseRepository({
            clickHouseClientManager: mockClickHouseClientManager
        });
    });

    describe('constructor', () => {
        test('stores clickHouseClientManager', () => {
            expect(repo.clickHouseClientManager).toBe(mockClickHouseClientManager);
        });
    });

    describe('getAccessHistoryAsync', () => {
        test('calls queryAsync with correct params for valid entityRefs', async () => {
            const entityRefs = ['Patient/123', 'Patient/456'];
            const expectedRows = [{ accessor_uuid: 'abc', access_count: 5 }];
            mockClickHouseClientManager.queryAsync.mockResolvedValue(expectedRows);

            const result = await repo.getAccessHistoryAsync({ entityRefs });

            expect(mockClickHouseClientManager.queryAsync).toHaveBeenCalledTimes(1);
            const callArgs = mockClickHouseClientManager.queryAsync.mock.calls[0][0];
            expect(callArgs.query).toContain('fhir.AUDIT_ACCESS_AGG');
            expect(callArgs.query).toContain('entity_ref IN {entity_refs:Array(String)}');
            expect(callArgs.query_params).toEqual({ entity_refs: entityRefs });
            expect(result).toEqual({ rows: expectedRows });
        });

        test('throws on empty array via assertIsValid', async () => {
            await expect(repo.getAccessHistoryAsync({ entityRefs: [] }))
                .rejects.toThrow('entityRefs must be a non-empty array');
            expect(assertIsValid).toHaveBeenCalledWith(false, 'entityRefs must be a non-empty array');
        });

        test('throws on non-array via assertIsValid', async () => {
            await expect(repo.getAccessHistoryAsync({ entityRefs: 'not-an-array' }))
                .rejects.toThrow('entityRefs must be a non-empty array');
        });

        test('throws on undefined entityRefs via assertIsValid', async () => {
            await expect(repo.getAccessHistoryAsync({ entityRefs: undefined }))
                .rejects.toThrow('entityRefs must be a non-empty array');
        });

        test('query includes ACCESS_HISTORY_WINDOW_DAYS interval', async () => {
            mockClickHouseClientManager.queryAsync.mockResolvedValue([]);
            await repo.getAccessHistoryAsync({ entityRefs: ['Patient/1'] });
            const callArgs = mockClickHouseClientManager.queryAsync.mock.calls[0][0];
            expect(callArgs.query).toContain('INTERVAL 90 DAY');
        });

        test('returns rows from queryAsync', async () => {
            const mockRows = [
                { accessor_uuid: 'u1', entity_resource_type: 'Patient', access_count: 3 },
                { accessor_uuid: 'u2', entity_resource_type: 'Patient', access_count: 7 }
            ];
            mockClickHouseClientManager.queryAsync.mockResolvedValue(mockRows);

            const result = await repo.getAccessHistoryAsync({ entityRefs: ['Patient/99'] });
            expect(result).toEqual({ rows: mockRows });
        });
    });
});
