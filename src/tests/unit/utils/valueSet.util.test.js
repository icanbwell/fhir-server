'use strict';

const { describe, test, expect, jest: jestObj, beforeEach } = require('@jest/globals');

jestObj.mock('../../../utils/assertType', () => ({
    assertTypeEquals: jestObj.fn()
}));

jestObj.mock('../../../dataLayer/databaseQueryFactory', () => ({
    DatabaseQueryFactory: class DatabaseQueryFactory {}
}));

const { ValueSetManager } = require('../../../utils/valueSet.util');

describe('ValueSetManager', () => {
    let manager;
    let mockDatabaseQueryFactory;
    let mockQueryManager;

    beforeEach(() => {
        mockQueryManager = {
            findOneAsync: jestObj.fn()
        };
        mockDatabaseQueryFactory = {
            createQuery: jestObj.fn(() => mockQueryManager)
        };
        manager = new ValueSetManager({ databaseQueryFactory: mockDatabaseQueryFactory });
    });

    test('constructor stores databaseQueryFactory', () => {
        expect(manager.databaseQueryFactory).toBe(mockDatabaseQueryFactory);
    });

    test('createConcept returns correct structure', () => {
        const concept = manager.createConcept('http://loinc.org', '2.72', '12345-6', 'Test');
        expect(concept).toEqual({
            system: 'http://loinc.org',
            version: '2.72',
            code: '12345-6',
            display: 'Test'
        });
    });

    test('getValueSetConceptsAsync returns expansion.contains when present', async () => {
        const resource = {
            expansion: {
                contains: [
                    { system: 'http://loinc.org', code: '1', display: 'One' }
                ]
            }
        };

        const result = await manager.getValueSetConceptsAsync('ValueSet', '4_0_0', resource);
        expect(result).toHaveLength(1);
        expect(result[0].code).toBe('1');
    });

    test('getValueSetConceptsAsync expands compose.include with system', async () => {
        const resource = {
            compose: {
                include: [{
                    system: 'http://snomed.info/sct',
                    version: '2023',
                    concept: [
                        { code: '123', display: 'Concept A' },
                        { code: '456', display: 'Concept B' }
                    ]
                }]
            }
        };

        const result = await manager.getValueSetConceptsAsync('ValueSet', '4_0_0', resource);
        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({
            system: 'http://snomed.info/sct',
            version: '2023',
            code: '123',
            display: 'Concept A'
        });
    });

    test('getValueSetConceptsAsync combines expansion and compose', async () => {
        const resource = {
            expansion: {
                contains: [{ system: 's', code: 'existing', display: 'E' }]
            },
            compose: {
                include: [{
                    system: 'http://loinc.org',
                    version: '1',
                    concept: [{ code: 'new', display: 'N' }]
                }]
            }
        };

        const result = await manager.getValueSetConceptsAsync('ValueSet', '4_0_0', resource);
        expect(result).toHaveLength(2);
    });

    test('getIncludeAsync with valueSet recursively fetches', async () => {
        mockQueryManager.findOneAsync.mockResolvedValue({
            compose: {
                include: [{
                    system: 'http://nested.org',
                    version: '1',
                    concept: [{ code: 'nested', display: 'Nested' }]
                }]
            }
        });

        const include = { valueSet: ['http://example.org/ValueSet/test'] };
        const result = await manager.getIncludeAsync('ValueSet', '4_0_0', include);
        expect(result).toHaveLength(1);
        expect(result[0].code).toBe('nested');
    });

    test('getExpandedValueSetAsync sets expansion and removes compose', async () => {
        const resource = {
            compose: {
                include: [{
                    system: 'http://loinc.org',
                    version: '1',
                    concept: [{ code: 'A', display: 'Alpha' }]
                }]
            }
        };

        const result = await manager.getExpandedValueSetAsync('ValueSet', '4_0_0', resource);
        expect(result.expansion.contains).toHaveLength(1);
        expect(result.expansion.total).toBe(1);
        expect(result.expansion.offset).toBe(0);
        expect(result.compose).toBeUndefined();
    });
});
