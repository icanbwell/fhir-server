'use strict';

const { describe, test, expect, jest: jestObj } = require('@jest/globals');

jestObj.mock('../../../../../utils/uid.util', () => ({
    isUuid: jestObj.fn((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
}));

jestObj.mock('../../../../../utils/idParser', () => ({
    IdParser: {
        parse: jestObj.fn((value) => ({ id: value, resourceType: null }))
    }
}));

const { FilterById } = require('../../../../../operations/query/filters/id');

describe('FilterById', () => {
    describe('getListFilter (static)', () => {
        test('returns empty $in for null values', () => {
            const result = FilterById.getListFilter(null);
            expect(result).toEqual({ _uuid: { $in: [] } });
        });

        test('returns empty $in for empty array', () => {
            const result = FilterById.getListFilter([]);
            expect(result).toEqual({ _uuid: { $in: [] } });
        });

        test('routes UUIDs to _uuid.$in', () => {
            const values = ['a1b2c3d4-e5f6-7890-abcd-ef1234567890'];
            const result = FilterById.getListFilter(values);
            expect(result._uuid).toBeDefined();
            expect(result._uuid.$in).toContain('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
        });

        test('routes non-UUID IDs to _sourceId.$in', () => {
            const values = ['my-simple-id'];
            const result = FilterById.getListFilter(values);
            expect(result._sourceId).toBeDefined();
            expect(result._sourceId.$in).toContain('my-simple-id');
        });

        test('mixed UUIDs and sourceIds produce $or filter', () => {
            const values = [
                'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
                'simple-id'
            ];
            const result = FilterById.getListFilter(values);
            expect(result.$or).toBeDefined();
            expect(result.$or).toHaveLength(2);
            expect(result.$or[0]._uuid.$in).toContain('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
            expect(result.$or[1]._sourceId.$in).toContain('simple-id');
        });

        test('multiple UUIDs coalesce into single $in', () => {
            const values = [
                'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
                'b2c3d4e5-f6a7-8901-bcde-f12345678901'
            ];
            const result = FilterById.getListFilter(values);
            expect(result._uuid.$in).toHaveLength(2);
        });

        test('multiple sourceIds coalesce into single $in', () => {
            const values = ['id-1', 'id-2', 'id-3'];
            const result = FilterById.getListFilter(values);
            expect(result._sourceId.$in).toHaveLength(3);
        });
    });

    describe('filterByItems (static)', () => {
        const { FieldMapper } = require('../../../../../operations/query/filters/fieldMapper');
        const fieldMapper = new FieldMapper({ useHistoryTable: false });

        test('separates UUIDs from sourceIds', () => {
            const values = [
                'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
                'non-uuid-id'
            ];
            const filters = FilterById.filterByItems('id', values, fieldMapper);
            expect(filters).toHaveLength(2);
        });

        test('UUID-only values produce single _uuid filter', () => {
            const values = ['a1b2c3d4-e5f6-7890-abcd-ef1234567890'];
            const filters = FilterById.filterByItems('id', values, fieldMapper);
            expect(filters).toHaveLength(1);
            expect(filters[0]._uuid).toBeDefined();
        });

        test('sourceId-only values produce single _sourceId filter', () => {
            const values = ['simple-1', 'simple-2'];
            const filters = FilterById.filterByItems('id', values, fieldMapper);
            expect(filters).toHaveLength(1);
            expect(filters[0]._sourceId.$in).toEqual(['simple-1', 'simple-2']);
        });

        test('empty values produce empty filters', () => {
            const filters = FilterById.filterByItems('id', [], fieldMapper);
            expect(filters).toHaveLength(0);
        });
    });
});
