'use strict';

const { describe, test, expect, jest: jestObj, beforeEach } = require('@jest/globals');

jestObj.mock('../../../../operations/common/logging', () => ({
    logDebug: jestObj.fn(),
    logError: jestObj.fn(),
    logInfo: jestObj.fn(),
    logWarn: jestObj.fn()
}));
jestObj.mock('../../../../utils/assertType', () => ({
    assertTypeEquals: jestObj.fn(),
    assertIsValid: jestObj.fn((condition, message) => {
        if (!condition) {
            throw new Error(message);
        }
    })
}));
jestObj.mock('../../../../utils/metrics', () => ({
    recordHistoryClickHouseRead: jestObj.fn()
}));

const { HistoryClickHouseRepository } = require('../../../../dataLayer/repositories/historyClickHouseRepository');
const metrics = require('../../../../utils/metrics');

const row = (versionNumber, recordedMs, raw = { id: `entry-${versionNumber}` }) => ({
    raw,
    recorded_ms: String(recordedMs),
    version_number: String(versionNumber)
});

describe('HistoryClickHouseRepository', () => {
    let repo;
    let queryAsync;

    beforeEach(() => {
        jestObj.clearAllMocks();
        queryAsync = jestObj.fn().mockResolvedValue([]);
        repo = new HistoryClickHouseRepository({
            clickHouseClientManager: { queryAsync }
        });
    });

    describe('cursor', () => {
        test('round-trips a position', () => {
            const position = { recordedMs: 1761640215123, versionNumber: 7 };
            const token = HistoryClickHouseRepository.encodeCursor(position);
            expect(HistoryClickHouseRepository.decodeCursor(token)).toEqual(position);
        });

        test('round-trips a type-level position that carries the resource uuid', () => {
            const position = { recordedMs: 1761640215123, versionNumber: 7, uuid: 'u9' };
            const token = HistoryClickHouseRepository.encodeCursor(position);
            expect(HistoryClickHouseRepository.decodeCursor(token)).toEqual(position);
        });

        test.each([
            ['not base64 json', '%%%'],
            ['json without fields', Buffer.from('{}').toString('base64url')],
            ['non-numeric field', Buffer.from('{"r":"x","v":1}').toString('base64url')],
            ['non-string uuid', Buffer.from('{"r":1,"v":1,"u":5}').toString('base64url')],
            ['negative version', Buffer.from('{"r":1,"v":-1}').toString('base64url')]
        ])('rejects a cursor that is %s', (_name, token) => {
            expect(() => HistoryClickHouseRepository.decodeCursor(token)).toThrow('_historyCursor is not valid');
        });
    });

    describe('findPageAsync', () => {
        test('queries by resource type and _uuid with FINAL and ordering', async () => {
            await repo.findPageAsync({ resourceType: 'Patient', uuid: 'u1', limit: 10 });

            const { query, query_params } = queryAsync.mock.calls[0][0];
            expect(query).toContain('fhir.Resource_4_0_0_History FINAL');
            expect(query).toContain('resource_type = {resource_type:String}');
            expect(query).toContain('_uuid = {uuid:String}');
            expect(query).toContain('ORDER BY _recorded DESC, toUInt64OrZero(version_id) DESC');
            expect(query).not.toContain('(_recorded, toUInt64OrZero(version_id)) <');
            expect(query_params).toEqual({ resource_type: 'Patient', uuid: 'u1', limit: 11 });
            expect(queryAsync.mock.calls[0][0].clickhouse_settings).toEqual({ output_format_json_quote_64bit_integers: 0 });
        });

        test('returns a next cursor from the last returned row when more rows exist', async () => {
            queryAsync.mockResolvedValue([row(3, 3000), row(2, 2000), row(1, 1000)]);

            const { entries, nextCursor } = await repo.findPageAsync({ resourceType: 'Patient', uuid: 'u1', limit: 2 });

            expect(entries).toEqual([{ id: 'entry-3' }, { id: 'entry-2' }]);
            expect(HistoryClickHouseRepository.decodeCursor(nextCursor)).toEqual({ recordedMs: 2000, versionNumber: 2 });
        });

        test('returns no cursor on the last page', async () => {
            queryAsync.mockResolvedValue([row(2, 2000), row(1, 1000)]);

            const { entries, nextCursor } = await repo.findPageAsync({ resourceType: 'Patient', uuid: 'u1', limit: 2 });

            expect(entries).toHaveLength(2);
            expect(nextCursor).toBeNull();
        });

        test('continues strictly after the cursor position', async () => {
            const cursor = HistoryClickHouseRepository.encodeCursor({ recordedMs: 2000, versionNumber: 2 });

            await repo.findPageAsync({ resourceType: 'Patient', uuid: 'u1', limit: 2, cursor });

            const { query, query_params } = queryAsync.mock.calls[0][0];
            expect(query).toContain('(_recorded, toUInt64OrZero(version_id)) <');
            expect(query_params).toMatchObject({ recorded_ms: 2000, version_number: 2 });
        });

        test('rejects an invalid cursor before querying', async () => {
            await expect(
                repo.findPageAsync({ resourceType: 'Patient', uuid: 'u1', limit: 2, cursor: 'garbage' })
            ).rejects.toThrow('_historyCursor is not valid');
            expect(queryAsync).not.toHaveBeenCalled();
        });

        test.each([
            ['resource type', { resourceType: '', uuid: 'u1', limit: 1 }],
            ['positive limit', { resourceType: 'Patient', uuid: 'u1', limit: 0 }]
        ])('requires %s', async (_name, args) => {
            await expect(repo.findPageAsync(args)).rejects.toThrow();
            expect(queryAsync).not.toHaveBeenCalled();
        });

        test('parses a raw value that arrives as a JSON string', async () => {
            queryAsync.mockResolvedValue([row(1, 1000, '{"id":"from-string"}')]);

            const { entries } = await repo.findPageAsync({ resourceType: 'Patient', uuid: 'u1', limit: 5 });

            expect(entries).toEqual([{ id: 'from-string' }]);
        });

        test('records success metrics', async () => {
            queryAsync.mockResolvedValue([row(1, 1000)]);

            await repo.findPageAsync({ resourceType: 'Patient', uuid: 'u1', limit: 5 });

            expect(metrics.recordHistoryClickHouseRead).toHaveBeenCalledWith('Patient', true, 1, expect.any(Number));
        });

        test('records an error metric and throws when ClickHouse fails or times out', async () => {
            queryAsync.mockRejectedValue(new Error('timeout exceeded'));

            await expect(
                repo.findPageAsync({ resourceType: 'Patient', uuid: 'u1', limit: 5 })
            ).rejects.toThrow('Error reading history from ClickHouse');
            expect(metrics.recordHistoryClickHouseRead).toHaveBeenCalledWith('Patient', false, 0, expect.any(Number));
        });
    });

    describe('findPageAsync, type level (no _uuid)', () => {
        test('filters on resource type only and orders by _recorded, _uuid, version', async () => {
            await repo.findPageAsync({ resourceType: 'Patient', limit: 10 });

            const { query, query_params } = queryAsync.mock.calls[0][0];
            expect(query).not.toContain('_uuid = {uuid:String}');
            expect(query).toContain('ORDER BY _recorded DESC, _uuid DESC, toUInt64OrZero(version_id) DESC');
            expect(query_params).toEqual({ resource_type: 'Patient', limit: 11 });
        });

        test('continues strictly after the (recorded, uuid, version) cursor', async () => {
            const cursor = HistoryClickHouseRepository.encodeCursor({ recordedMs: 2000, versionNumber: 2, uuid: 'u2' });

            await repo.findPageAsync({ resourceType: 'Patient', limit: 2, cursor });

            const { query, query_params } = queryAsync.mock.calls[0][0];
            expect(query).toContain('(_recorded, _uuid, toUInt64OrZero(version_id)) <');
            expect(query_params).toMatchObject({ recorded_ms: 2000, version_number: 2, cursor_uuid: 'u2' });
        });

        test('next cursor carries the uuid of the last row', async () => {
            queryAsync.mockResolvedValue([
                { ...row(3, 3000), row_uuid: 'ua' }, { ...row(2, 2000), row_uuid: 'ub' }, { ...row(1, 1000), row_uuid: 'uc' }
            ]);

            const { nextCursor } = await repo.findPageAsync({ resourceType: 'Patient', limit: 2 });

            expect(HistoryClickHouseRepository.decodeCursor(nextCursor)).toEqual({ recordedMs: 2000, versionNumber: 2, uuid: 'ub' });
        });

        test('rejects an instance-style cursor without a uuid', async () => {
            const cursor = HistoryClickHouseRepository.encodeCursor({ recordedMs: 2000, versionNumber: 2 });

            await expect(repo.findPageAsync({ resourceType: 'Patient', limit: 2, cursor }))
                .rejects.toThrow('_historyCursor is not valid');
            expect(queryAsync).not.toHaveBeenCalled();
        });
    });

    describe('findPageAsync with _since', () => {
        test.each([
            ['instance', { uuid: 'u1' }],
            ['type-level', {}]
        ])('adds a _recorded lower bound for a %s read', async (_name, extra) => {
            await repo.findPageAsync({ resourceType: 'Patient', limit: 5, sinceMs: 1761640215123, ...extra });

            const { query, query_params } = queryAsync.mock.calls[0][0];
            expect(query).toContain('_recorded >= fromUnixTimestamp64Milli({since_ms:Int64}');
            expect(query_params.since_ms).toBe(1761640215123);
        });

        test('adds no lower bound without _since', async () => {
            await repo.findPageAsync({ resourceType: 'Patient', limit: 5 });

            expect(queryAsync.mock.calls[0][0].query).not.toContain('since_ms');
        });
    });

    describe('findVersionAsync', () => {
        test('looks up one version by resource type, _uuid and version_id', async () => {
            queryAsync.mockResolvedValue([{ raw: { id: 'entry-2' } }]);

            const result = await repo.findVersionAsync({ resourceType: 'Patient', uuid: 'u1', versionId: '2' });

            const { query, query_params } = queryAsync.mock.calls[0][0];
            expect(query).toContain('FINAL');
            expect(query).toContain('version_id = {version_id:String}');
            expect(query_params).toEqual({ resource_type: 'Patient', uuid: 'u1', version_id: '2' });
            expect(result).toEqual({ id: 'entry-2' });
        });

        test('returns null when the version is not in ClickHouse', async () => {
            const result = await repo.findVersionAsync({ resourceType: 'Patient', uuid: 'u1', versionId: '9' });

            expect(result).toBeNull();
        });

        test.each([
            ['resource type', { resourceType: '', uuid: 'u1', versionId: '1' }],
            ['_uuid', { resourceType: 'Patient', uuid: '', versionId: '1' }],
            ['version id', { resourceType: 'Patient', uuid: 'u1', versionId: '' }]
        ])('requires %s', async (_name, args) => {
            await expect(repo.findVersionAsync(args)).rejects.toThrow();
            expect(queryAsync).not.toHaveBeenCalled();
        });
    });
});
