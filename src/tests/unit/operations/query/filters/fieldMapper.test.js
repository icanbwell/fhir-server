'use strict';

const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

jestObj.mock('../../../../../utils/uid.util', () => ({
    isUuid: jestObj.fn((text) => text && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text))
}));

const { FieldMapper } = require('../../../../../operations/query/filters/fieldMapper');

describe('FieldMapper', () => {
    describe('constructor', () => {
        test('stores useHistoryTable as true', () => {
            const mapper = new FieldMapper({ useHistoryTable: true });
            expect(mapper.useHistoryTable).toBe(true);
        });

        test('stores useHistoryTable as false', () => {
            const mapper = new FieldMapper({ useHistoryTable: false });
            expect(mapper.useHistoryTable).toBe(false);
        });

        test('stores useHistoryTable as undefined', () => {
            const mapper = new FieldMapper({ useHistoryTable: undefined });
            expect(mapper.useHistoryTable).toBeUndefined();
        });
    });

    describe('getFieldName', () => {
        describe('when useHistoryTable is false', () => {
            let mapper;

            beforeEach(() => {
                mapper = new FieldMapper({ useHistoryTable: false });
            });

            test('returns field unchanged for non-id fields', () => {
                expect(mapper.getFieldName('name', 'John')).toBe('name');
            });

            test('returns _uuid when field is id and value is a UUID', () => {
                const uuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
                expect(mapper.getFieldName('id', uuid)).toBe('_uuid');
            });

            test('returns _sourceId when field is id and value is not a UUID', () => {
                expect(mapper.getFieldName('id', 'patient-123')).toBe('_sourceId');
            });

            test('returns _sourceId when field is id and value is undefined', () => {
                expect(mapper.getFieldName('id', undefined)).toBe('_sourceId');
            });

            test('returns _sourceId when field is id and value is null', () => {
                expect(mapper.getFieldName('id', null)).toBe('_sourceId');
            });

            test('returns _sourceId when field is id and value is empty string', () => {
                expect(mapper.getFieldName('id', '')).toBe('_sourceId');
            });

            test('returns field as-is for dotted paths', () => {
                expect(mapper.getFieldName('meta.lastUpdated', '2023-01-01')).toBe('meta.lastUpdated');
            });

            test('does not modify field when field contains "id" but is not exactly "id"', () => {
                expect(mapper.getFieldName('identifier', 'abc')).toBe('identifier');
            });
        });

        describe('when useHistoryTable is true', () => {
            let mapper;

            beforeEach(() => {
                mapper = new FieldMapper({ useHistoryTable: true });
            });

            test('prepends resource. to non-id fields', () => {
                expect(mapper.getFieldName('name', 'John')).toBe('resource.name');
            });

            test('returns resource._uuid when field is id and value is a UUID', () => {
                const uuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
                expect(mapper.getFieldName('id', uuid)).toBe('resource._uuid');
            });

            test('returns resource._sourceId when field is id and value is not a UUID', () => {
                expect(mapper.getFieldName('id', 'patient-123')).toBe('resource._sourceId');
            });

            test('prepends resource. to dotted paths', () => {
                expect(mapper.getFieldName('meta.source', 'http://example.com')).toBe('resource.meta.source');
            });

            test('returns resource._sourceId when field is id and value is undefined', () => {
                expect(mapper.getFieldName('id', undefined)).toBe('resource._sourceId');
            });
        });

        describe('when useHistoryTable is undefined (falsy)', () => {
            let mapper;

            beforeEach(() => {
                mapper = new FieldMapper({ useHistoryTable: undefined });
            });

            test('does not prepend resource. prefix', () => {
                expect(mapper.getFieldName('name', 'John')).toBe('name');
            });

            test('returns _uuid for UUID id field', () => {
                const uuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
                expect(mapper.getFieldName('id', uuid)).toBe('_uuid');
            });
        });

        describe('edge cases with value parameter', () => {
            let mapper;

            beforeEach(() => {
                mapper = new FieldMapper({ useHistoryTable: false });
            });

            test('non-id field ignores the value parameter', () => {
                const uuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
                expect(mapper.getFieldName('status', uuid)).toBe('status');
            });

            test('value with mixed-case UUID is recognized', () => {
                const uuid = 'A1B2C3D4-E5F6-7890-ABCD-EF1234567890';
                expect(mapper.getFieldName('id', uuid)).toBe('_uuid');
            });
        });
    });
});
