/**
 * Unit tests for EverythingRelatedResourcesMapper
 * Tests: null safety, unsupported resource types, empty/null filter sets
 */
const { describe, test, expect, beforeEach } = require('@jest/globals');

const { EverythingRelatedResourcesMapper } = require('../../../../operations/everything/everythingRelatedResourcesMapper');

describe('EverythingRelatedResourcesMapper', () => {
    let mapper;

    beforeEach(() => {
        mapper = new EverythingRelatedResourcesMapper();
    });

    describe('relatedResources', () => {
        test('should return all related resources for Patient when no filter is provided', () => {
            const result = mapper.relatedResources('Patient', null);
            expect(result).toBeDefined();
            expect(Array.isArray(result)).toBe(true);
            expect(result.length).toBeGreaterThan(0);
            // Should contain known resource types
            const types = result.map(r => r.type);
            expect(types).toContain('Observation');
            expect(types).toContain('Encounter');
            expect(types).toContain('Condition');
        });

        test('should throw error for unsupported resource type', () => {
            expect(() => mapper.relatedResources('Unsupported', null)).toThrow(
                "EverythingRelatedResourcesMapper doesn't support Unsupported resource"
            );
        });

        test('should throw error for null resource type', () => {
            expect(() => mapper.relatedResources(null, null)).toThrow();
        });

        test('should throw error for undefined resource type', () => {
            expect(() => mapper.relatedResources(undefined, null)).toThrow();
        });

        test('should filter resources when specificReltedResourceTypeSet is provided', () => {
            const filterSet = new Set(['Observation', 'Condition']);
            const result = mapper.relatedResources('Patient', filterSet);
            expect(result.length).toBe(2);
            const types = result.map(r => r.type);
            expect(types).toContain('Observation');
            expect(types).toContain('Condition');
            expect(types).not.toContain('Encounter');
        });

        test('should return empty array when filter set contains no matching types', () => {
            const filterSet = new Set(['NonexistentType']);
            const result = mapper.relatedResources('Patient', filterSet);
            expect(result).toEqual([]);
        });

        test('should return empty array when filter set is empty', () => {
            const filterSet = new Set();
            const result = mapper.relatedResources('Patient', filterSet);
            expect(result).toEqual([]);
        });

        test('should not filter when specificReltedResourceTypeSet is undefined', () => {
            const result = mapper.relatedResources('Patient', undefined);
            expect(result.length).toBeGreaterThan(0);
        });

        test('should not filter when specificReltedResourceTypeSet is falsy (0)', () => {
            // Testing that falsy values other than null/undefined also skip filtering
            const result = mapper.relatedResources('Patient', 0);
            expect(result.length).toBeGreaterThan(0);
        });

        test('should handle resources with customQuery (no params field)', () => {
            const result = mapper.relatedResources('Patient', null);
            const subscription = result.find(r => r.type === 'Subscription');
            expect(subscription).toBeDefined();
            expect(subscription.params).toBeUndefined();
            expect(subscription.customQuery).toBeDefined();
            expect(subscription.customQuery.query).toBeDefined();
            expect(subscription.customQuery.requiredValues).toBeDefined();
            expect(subscription.customQuery.fieldForParentLookup).toBeDefined();
        });

        test('should have correct structure for BiologicallyDerivedProduct with proxy patient', () => {
            const result = mapper.relatedResources('Patient', null);
            const bio = result.find(r => r.type === 'BiologicallyDerivedProduct');
            expect(bio).toBeDefined();
            expect(bio.customQuery).toBeDefined();
            expect(bio.customQuery.includeProxyPatient).toBe(true);
            expect(bio.customQuery.proxyPatientQuery).toBeDefined();
            expect(bio.customQuery.proxyPatientRequiredValues).toBeDefined();
        });

        test('should have all entries with indexHintName except Linkage and PaymentNotice', () => {
            const result = mapper.relatedResources('Patient', null);
            const withoutHint = result.filter(r => !r.indexHintName);
            const typesWithoutHint = withoutHint.map(r => r.type);
            expect(typesWithoutHint).toContain('Linkage');
            expect(typesWithoutHint).toContain('PaymentNotice');
            expect(typesWithoutHint.length).toBe(2);
        });

        test('fieldForParentLookup for BiologicallyDerivedProduct is a string not array', () => {
            // The typedef says fieldForParentLookup should be string[]
            // but BiologicallyDerivedProduct has it as a plain string "collection.source"
            // This is a potential bug if consuming code expects an array
            const result = mapper.relatedResources('Patient', null);
            const bio = result.find(r => r.type === 'BiologicallyDerivedProduct');
            // This test documents the current behavior - fieldForParentLookup is a string, not array
            expect(typeof bio.customQuery.fieldForParentLookup).toBe('string');
            expect(bio.customQuery.fieldForParentLookup).toBe('collection.source');
        });

        test('fieldForParentLookup for Subscription is a string not array', () => {
            // The typedef says fieldForParentLookup: string[] but actual is string
            const result = mapper.relatedResources('Patient', null);
            const sub = result.find(r => r.type === 'Subscription');
            expect(typeof sub.customQuery.fieldForParentLookup).toBe('string');
        });

        test('should handle filter with a Set that has only one matching type', () => {
            const filterSet = new Set(['Patient']);
            const result = mapper.relatedResources('Patient', filterSet);
            expect(result.length).toBe(1);
            expect(result[0].type).toBe('Patient');
        });
    });
});
