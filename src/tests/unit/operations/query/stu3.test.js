'use strict';

const { describe, test, expect } = require('@jest/globals');
const { buildStu3SearchQuery } = require('../../../../operations/query/stu3');

describe('buildStu3SearchQuery', () => {
    test('returns empty query for no params', () => {
        const result = buildStu3SearchQuery({});
        expect(result).toEqual({});
    });

    test('includes id when provided', () => {
        const result = buildStu3SearchQuery({ id: 'obs-456' });
        expect(result.id).toBe('obs-456');
    });

    test('converts active "true" to boolean true', () => {
        const result = buildStu3SearchQuery({ active: 'true' });
        expect(result.active).toBe(true);
    });

    test('converts active "false" to boolean false', () => {
        const result = buildStu3SearchQuery({ active: 'false' });
        expect(result.active).toBe(false);
    });

    test('omits active when not provided', () => {
        const result = buildStu3SearchQuery({ id: 'x' });
        expect(result.active).toBeUndefined();
    });
});
