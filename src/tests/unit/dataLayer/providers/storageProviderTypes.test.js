'use strict';

const { describe, test, expect } = require('@jest/globals');
const { STORAGE_PROVIDER_TYPES } = require('../../../../dataLayer/providers/storageProviderTypes');

describe('storageProviderTypes', () => {
    test('MONGO is the default MongoDB storage type', () => {
        expect(STORAGE_PROVIDER_TYPES.MONGO).toBe('mongo');
    });

    test('MONGO_WITH_CLICKHOUSE is dual-write storage', () => {
        expect(STORAGE_PROVIDER_TYPES.MONGO_WITH_CLICKHOUSE).toBe('mongo-with-clickhouse');
    });

    test('CLICKHOUSE is append-only analytical storage', () => {
        expect(STORAGE_PROVIDER_TYPES.CLICKHOUSE).toBe('clickhouse');
    });

    test('has exactly 3 provider types', () => {
        expect(Object.keys(STORAGE_PROVIDER_TYPES)).toHaveLength(3);
    });

    test('all values are lowercase kebab-case strings', () => {
        Object.values(STORAGE_PROVIDER_TYPES).forEach(value => {
            expect(typeof value).toBe('string');
            expect(value).toMatch(/^[a-z]+(-[a-z]+)*$/);
        });
    });
});
