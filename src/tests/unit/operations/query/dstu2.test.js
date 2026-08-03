'use strict';

const { describe, test, expect } = require('@jest/globals');
const { buildDstu2SearchQuery } = require('../../../../operations/query/dstu2');

describe('buildDstu2SearchQuery', () => {
    test('returns empty query for no params', () => {
        const result = buildDstu2SearchQuery({});
        expect(result).toEqual({});
    });

    test('includes id when provided', () => {
        const result = buildDstu2SearchQuery({ id: 'patient-123' });
        expect(result.id).toBe('patient-123');
    });

    test('converts active "true" to boolean true', () => {
        const result = buildDstu2SearchQuery({ active: 'true' });
        expect(result.active).toBe(true);
    });

    test('converts active "false" to boolean false', () => {
        const result = buildDstu2SearchQuery({ active: 'false' });
        expect(result.active).toBe(false);
    });

    test('includes both id and active', () => {
        const result = buildDstu2SearchQuery({ id: 'p1', active: 'true' });
        expect(result.id).toBe('p1');
        expect(result.active).toBe(true);
    });
});
