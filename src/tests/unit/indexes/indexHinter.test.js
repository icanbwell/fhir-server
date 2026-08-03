'use strict';

const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

jestObj.mock('../../../utils/assertType', () => ({
    assertTypeEquals: jestObj.fn(),
    assertIsValid: jestObj.fn()
}));

const { IndexHinter } = require('../../../indexes/indexHinter');

describe('IndexHinter', () => {
    let indexHinter;
    let mockIndexProvider;

    beforeEach(() => {
        mockIndexProvider = {
            getIndexes: jestObj.fn()
        };
        indexHinter = new IndexHinter({ indexProvider: mockIndexProvider });
    });

    describe('constructor', () => {
        test('stores indexProvider', () => {
            expect(indexHinter.indexProvider).toBe(mockIndexProvider);
        });
    });

    describe('eqSet', () => {
        test('returns true for identical sets', () => {
            const a = new Set(['x', 'y', 'z']);
            const b = new Set(['x', 'y', 'z']);
            expect(indexHinter.eqSet(a, b)).toBe(true);
        });

        test('returns true for same elements in different order', () => {
            const a = new Set(['a', 'b', 'c']);
            const b = new Set(['c', 'a', 'b']);
            expect(indexHinter.eqSet(a, b)).toBe(true);
        });

        test('returns false when sizes differ', () => {
            const a = new Set(['a', 'b']);
            const b = new Set(['a', 'b', 'c']);
            expect(indexHinter.eqSet(a, b)).toBe(false);
        });

        test('returns false when first set has element not in second', () => {
            const a = new Set(['a', 'b', 'x']);
            const b = new Set(['a', 'b', 'c']);
            expect(indexHinter.eqSet(a, b)).toBe(false);
        });

        test('returns false when second set has element not in first', () => {
            const a = new Set(['a', 'b', 'c']);
            const b = new Set(['a', 'b', 'x']);
            expect(indexHinter.eqSet(a, b)).toBe(false);
        });

        test('returns true for two empty sets', () => {
            expect(indexHinter.eqSet(new Set(), new Set())).toBe(true);
        });

        test('returns true for single element sets that match', () => {
            expect(indexHinter.eqSet(new Set(['x']), new Set(['x']))).toBe(true);
        });

        test('returns false for single element sets that differ', () => {
            expect(indexHinter.eqSet(new Set(['x']), new Set(['y']))).toBe(false);
        });
    });

    describe('findIndexForFields', () => {
        test('returns null when fields is null', () => {
            expect(indexHinter.findIndexForFields('Patient_4_0_0', null, undefined)).toBeNull();
        });

        test('returns null when fields is empty array', () => {
            expect(indexHinter.findIndexForFields('Patient_4_0_0', [], undefined)).toBeNull();
        });

        test('returns null for history collections', () => {
            mockIndexProvider.getIndexes.mockReturnValue({});
            expect(indexHinter.findIndexForFields('Patient_4_0_0_History', ['id'], undefined)).toBeNull();
        });

        test('matches index by field set on wildcard (*) collection', () => {
            mockIndexProvider.getIndexes.mockReturnValue({
                '*': [
                    {
                        keys: { 'meta.source': 1, _uuid: 1 },
                        options: { name: 'meta.source_1' }
                    }
                ]
            });
            const result = indexHinter.findIndexForFields('Patient_4_0_0', ['meta.source', '_uuid'], undefined);
            expect(result).toBe('meta.source_1');
        });

        test('matches index by field set on specific collection', () => {
            mockIndexProvider.getIndexes.mockReturnValue({
                Patient_4_0_0: [
                    {
                        keys: { name: 1, birthDate: 1 },
                        options: { name: 'name_birthDate_1' }
                    }
                ]
            });
            const result = indexHinter.findIndexForFields('Patient_4_0_0', ['name', 'birthDate'], undefined);
            expect(result).toBe('name_birthDate_1');
        });

        test('returns null when fields do not match any index', () => {
            mockIndexProvider.getIndexes.mockReturnValue({
                '*': [
                    {
                        keys: { 'meta.source': 1 },
                        options: { name: 'meta.source_1' }
                    }
                ]
            });
            const result = indexHinter.findIndexForFields('Patient_4_0_0', ['status'], undefined);
            expect(result).toBeNull();
        });

        test('respects exclude list on index config', () => {
            mockIndexProvider.getIndexes.mockReturnValue({
                '*': [
                    {
                        keys: { 'meta.source': 1 },
                        options: { name: 'meta.source_1' },
                        exclude: ['AuditEvent_4_0_0']
                    }
                ]
            });
            const result = indexHinter.findIndexForFields('AuditEvent_4_0_0', ['meta.source'], undefined);
            expect(result).toBeNull();
        });

        test('respects include list on index config', () => {
            mockIndexProvider.getIndexes.mockReturnValue({
                '*': [
                    {
                        keys: { 'meta.security.system': 1 },
                        options: { name: 'security_system_1' },
                        include: ['Person_4_0_0']
                    }
                ]
            });
            // Patient is not in include list
            const result = indexHinter.findIndexForFields('Patient_4_0_0', ['meta.security.system'], undefined);
            expect(result).toBeNull();
        });

        test('matches when collection is in include list', () => {
            mockIndexProvider.getIndexes.mockReturnValue({
                '*': [
                    {
                        keys: { 'meta.security.system': 1 },
                        options: { name: 'security_system_1' },
                        include: ['Person_4_0_0']
                    }
                ]
            });
            const result = indexHinter.findIndexForFields('Person_4_0_0', ['meta.security.system'], undefined);
            expect(result).toBe('security_system_1');
        });

        test('matches index by name when indexName is provided', () => {
            mockIndexProvider.getIndexes.mockReturnValue({
                '*': [
                    {
                        keys: { 'meta.source': 1 },
                        options: { name: 'meta.source_1' }
                    }
                ]
            });
            const result = indexHinter.findIndexForFields('Patient_4_0_0', ['anything'], 'meta.source_1');
            expect(result).toBe('meta.source_1');
        });

        test('returns null when indexName does not match', () => {
            mockIndexProvider.getIndexes.mockReturnValue({
                '*': [
                    {
                        keys: { 'meta.source': 1 },
                        options: { name: 'meta.source_1' }
                    }
                ]
            });
            const result = indexHinter.findIndexForFields('Patient_4_0_0', ['anything'], 'nonexistent_index');
            expect(result).toBeNull();
        });

        test('treats indexName "true" as not an index name (uses field matching)', () => {
            mockIndexProvider.getIndexes.mockReturnValue({
                '*': [
                    {
                        keys: { status: 1 },
                        options: { name: 'status_1' }
                    }
                ]
            });
            const result = indexHinter.findIndexForFields('Patient_4_0_0', ['status'], 'true');
            expect(result).toBe('status_1');
        });

        test('treats indexName "1" as not an index name (uses field matching)', () => {
            mockIndexProvider.getIndexes.mockReturnValue({
                '*': [
                    {
                        keys: { status: 1 },
                        options: { name: 'status_1' }
                    }
                ]
            });
            const result = indexHinter.findIndexForFields('Patient_4_0_0', ['status'], '1');
            expect(result).toBe('status_1');
        });

        test('handles collection name with suffix after _4_0_0', () => {
            mockIndexProvider.getIndexes.mockReturnValue({
                Patient_4_0_0: [
                    {
                        keys: { name: 1 },
                        options: { name: 'name_1' }
                    }
                ]
            });
            // e.g., "Patient_4_0_0_somePartition"
            const result = indexHinter.findIndexForFields('Patient_4_0_0_shard1', ['name'], undefined);
            expect(result).toBe('name_1');
        });

        test('does not match index from a different collection', () => {
            mockIndexProvider.getIndexes.mockReturnValue({
                Observation_4_0_0: [
                    {
                        keys: { status: 1 },
                        options: { name: 'status_1' }
                    }
                ]
            });
            const result = indexHinter.findIndexForFields('Patient_4_0_0', ['status'], undefined);
            expect(result).toBeNull();
        });

        test('collection ending with _4_0_0 uses itself as baseCollectionName', () => {
            mockIndexProvider.getIndexes.mockReturnValue({
                Patient_4_0_0: [
                    {
                        keys: { active: 1 },
                        options: { name: 'active_1' }
                    }
                ]
            });
            const result = indexHinter.findIndexForFields('Patient_4_0_0', ['active'], undefined);
            expect(result).toBe('active_1');
        });

        test('skips excluded collection even when fields match', () => {
            mockIndexProvider.getIndexes.mockReturnValue({
                '*': [
                    {
                        keys: { _uuid: 1, status: 1 },
                        options: { name: 'uuid_status_1' },
                        exclude: ['Patient_4_0_0']
                    }
                ]
            });
            const result = indexHinter.findIndexForFields('Patient_4_0_0', ['_uuid', 'status'], undefined);
            expect(result).toBeNull();
        });

        test('matches first matching index when multiple indexes exist', () => {
            mockIndexProvider.getIndexes.mockReturnValue({
                '*': [
                    {
                        keys: { status: 1 },
                        options: { name: 'first_index' }
                    },
                    {
                        keys: { status: 1 },
                        options: { name: 'second_index' }
                    }
                ]
            });
            const result = indexHinter.findIndexForFields('Patient_4_0_0', ['status'], undefined);
            expect(result).toBe('first_index');
        });
    });
});
