const { describe, expect, test } = require('@jest/globals');
const { assertNoConflictingInstanceIdArgs } = require('../../../../operations/history/historyClickHouseGuards');

const UUID = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

describe('assertNoConflictingInstanceIdArgs', () => {
    test.each([
        ['only the URL id', { id: UUID, _count: '10', _metaUuid: '1' }],
        ['a query _id that repeats the URL id', { id: UUID, _id: UUID }]
    ])('accepts %s', (_name, args) => {
        expect(() => assertNoConflictingInstanceIdArgs(args)).not.toThrow();
    });

    test.each([
        ['a different _id', { id: UUID, _id: OTHER }],
        ['_id:not', { id: UUID, '_id:not': UUID }],
        ['_id:above', { id: UUID, '_id:above': OTHER }],
        ['id:below', { id: UUID, 'id:below': OTHER }]
    ])('rejects %s', (_name, args) => {
        expect(() => assertNoConflictingInstanceIdArgs(args)).toThrow(/not supported when history is read from ClickHouse/);
    });
});
