'use strict';

const { describe, test, expect } = require('@jest/globals');
const { graphqlFieldsToMongoProjection } = require('../../../utils/graphqlFieldsProjection');

describe('graphqlFieldsToMongoProjection', () => {
    test('converts null values to 1', () => {
        const obj = { name: null, id: null };
        const result = graphqlFieldsToMongoProjection(obj);
        expect(result.name).toBe(1);
        expect(result.id).toBe(1);
    });

    test('converts undefined values to 1', () => {
        const obj = { name: undefined };
        const result = graphqlFieldsToMongoProjection(obj);
        expect(result.name).toBe(1);
    });

    test('converts empty object values to 1', () => {
        const obj = { meta: {} };
        const result = graphqlFieldsToMongoProjection(obj);
        expect(result.meta).toBe(1);
    });

    test('converts empty array values to 1', () => {
        const obj = { identifier: [] };
        const result = graphqlFieldsToMongoProjection(obj);
        expect(result.identifier).toBe(1);
    });

    test('recursively processes nested objects', () => {
        const obj = { meta: { versionId: null, lastUpdated: null } };
        const result = graphqlFieldsToMongoProjection(obj);
        expect(result.meta.versionId).toBe(1);
        expect(result.meta.lastUpdated).toBe(1);
    });

    test('preserves non-empty nested objects after recursion', () => {
        const obj = { meta: { security: { system: null, code: null } } };
        const result = graphqlFieldsToMongoProjection(obj);
        expect(result.meta.security.system).toBe(1);
        expect(result.meta.security.code).toBe(1);
        expect(typeof result.meta.security).toBe('object');
    });

    test('does not modify string values', () => {
        const obj = { name: 'keep' };
        const result = graphqlFieldsToMongoProjection(obj);
        expect(result.name).toBe('keep');
    });

    test('does not modify numeric values', () => {
        const obj = { count: 5 };
        const result = graphqlFieldsToMongoProjection(obj);
        expect(result.count).toBe(5);
    });

    test('mutates and returns the same object', () => {
        const obj = { a: null };
        const result = graphqlFieldsToMongoProjection(obj);
        expect(result).toBe(obj);
    });
});
