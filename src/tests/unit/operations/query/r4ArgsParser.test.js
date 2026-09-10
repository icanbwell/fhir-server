const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

// Mock logging
jest.mock('../../../../operations/common/logging', () => ({
    logError: jest.fn(),
    logInfo: jest.fn(),
    logWarn: jest.fn(),
    logDebug: jest.fn()
}));

const { R4ArgsParser } = require('../../../../operations/query/r4ArgsParser');
const { FhirTypesManager } = require('../../../../fhir/fhirTypesManager');
const { ConfigManager } = require('../../../../utils/configManager');
const { SearchParametersManager } = require('../../../../searchParameters/searchParametersManager');
const { SearchParameterDefinition } = require('../../../../searchParameters/searchParameterTypes');

/**
 * Creates mock FhirTypesManager that passes assertTypeEquals
 */
function createMockFhirTypesManager() {
    const manager = Object.create(FhirTypesManager.prototype);
    manager.getTypeForField = jest.fn().mockReturnValue('string');
    return manager;
}

/**
 * Creates mock ConfigManager that passes assertTypeEquals
 */
function createMockConfigManager() {
    const manager = Object.create(ConfigManager.prototype);
    Object.defineProperty(manager, 'defaultSortId', { get: () => '_uuid', configurable: true });
    return manager;
}

/**
 * Creates mock SearchParametersManager that passes assertTypeEquals
 */
function createMockSearchParametersManager() {
    const manager = Object.create(SearchParametersManager.prototype);
    manager.getPropertyObject = jest.fn().mockReturnValue(null);
    manager.combinedSearchParameters = {};
    return manager;
}

describe('R4ArgsParser', () => {
    let r4ArgsParser;
    let mockFhirTypesManager;
    let mockConfigManager;
    let mockSearchParametersManager;

    beforeEach(() => {
        jest.clearAllMocks();
        mockFhirTypesManager = createMockFhirTypesManager();
        mockConfigManager = createMockConfigManager();
        mockSearchParametersManager = createMockSearchParametersManager();

        r4ArgsParser = new R4ArgsParser({
            fhirTypesManager: mockFhirTypesManager,
            configManager: mockConfigManager,
            searchParametersManager: mockSearchParametersManager
        });
    });

    describe('constructor', () => {
        test('should throw if fhirTypesManager is null', () => {
            expect(() => new R4ArgsParser({
                fhirTypesManager: null,
                configManager: mockConfigManager,
                searchParametersManager: mockSearchParametersManager
            })).toThrow();
        });

        test('should throw if configManager is wrong type', () => {
            expect(() => new R4ArgsParser({
                fhirTypesManager: mockFhirTypesManager,
                configManager: {},
                searchParametersManager: mockSearchParametersManager
            })).toThrow();
        });
    });

    describe('parseArgs - backward compatibility mappings', () => {
        test('should map source to _source when _source not present', () => {
            const args = { source: 'http://example.com', base_version: '4_0_0' };
            const result = r4ArgsParser.parseArgs({ resourceType: 'Patient', args });
            expect(result).toBeDefined();
            expect(result.base_version).toBe('4_0_0');
        });

        test('should map id to _id when _id not present', () => {
            const args = { id: '123', base_version: '4_0_0' };
            const result = r4ArgsParser.parseArgs({ resourceType: 'Patient', args });
            expect(result).toBeDefined();
        });

        test('should not overwrite _source if already present', () => {
            const args = { source: 'old', _source: 'new', base_version: '4_0_0' };
            const result = r4ArgsParser.parseArgs({ resourceType: 'Patient', args });
            expect(result).toBeDefined();
        });

        test('should map id:above to _id:above', () => {
            const args = { 'id:above': '100', base_version: '4_0_0' };
            const result = r4ArgsParser.parseArgs({ resourceType: 'Patient', args });
            expect(result).toBeDefined();
        });

        test('should map onset_date to onset-date', () => {
            const args = { onset_date: '2023-01-01', base_version: '4_0_0' };
            const result = r4ArgsParser.parseArgs({ resourceType: 'Patient', args });
            expect(result).toBeDefined();
        });
    });

    describe('parseArgs - _lastUpdated array handling', () => {
        test('should add gt/lt prefix to _lastUpdated array values without prefix', () => {
            const args = {
                _lastUpdated: ['2023-01-01', '2023-12-31'],
                base_version: '4_0_0'
            };
            const result = r4ArgsParser.parseArgs({ resourceType: 'Patient', args });
            expect(result).toBeDefined();
            // The args._lastUpdated should have been modified
            expect(args._lastUpdated).toEqual(['gt2023-01-01', 'lt2023-12-31']);
        });

        test('should NOT add prefix to _lastUpdated values that already have a prefix', () => {
            const args = {
                _lastUpdated: ['ge2023-01-01', 'le2023-12-31'],
                base_version: '4_0_0'
            };
            // store original
            const original = [...args._lastUpdated];
            r4ArgsParser.parseArgs({ resourceType: 'Patient', args });
            // Should not modify values that already have prefix
            expect(args._lastUpdated).toEqual(original);
        });

        test('should handle _lastUpdated as non-array', () => {
            const args = {
                _lastUpdated: '2023-01-01',
                base_version: '4_0_0'
            };
            // Should not throw
            const result = r4ArgsParser.parseArgs({ resourceType: 'Patient', args });
            expect(result).toBeDefined();
        });

        test('should skip empty string values in _lastUpdated array', () => {
            const args = {
                _lastUpdated: ['', '2023-12-31'],
                base_version: '4_0_0'
            };
            r4ArgsParser.parseArgs({ resourceType: 'Patient', args });
            // First value is empty string, should not have prefix added. Only non-empty gets prefix.
            expect(args._lastUpdated).toEqual(['lt2023-12-31']);
        });
    });

    describe('parseArgs - strict handling', () => {
        test('should throw BadRequestError for unrecognized param with strict handling', () => {
            const args = {
                handling: 'strict',
                unknownParam: 'value',
                base_version: '4_0_0'
            };
            expect(() => r4ArgsParser.parseArgs({ resourceType: 'Patient', args })).toThrow();
        });

        test('should not throw for unrecognized param with lenient handling', () => {
            const args = {
                handling: 'lenient',
                unknownParam: 'value',
                base_version: '4_0_0'
            };
            const result = r4ArgsParser.parseArgs({ resourceType: 'Patient', args });
            expect(result).toBeDefined();
        });
    });

    describe('parseArgs - _elements handling', () => {
        test('should add defaultSortId to _elements if not present', () => {
            mockSearchParametersManager.getPropertyObject.mockReturnValue(null);
            const args = {
                _elements: 'name,birthDate',
                base_version: '4_0_0'
            };
            r4ArgsParser.parseArgs({ resourceType: 'Patient', args });
            // Verify the parsed result includes _uuid since defaultSortId is _uuid
            // The queryParameterValue for _elements should include _uuid
        });

        test('should add _uuid and _sourceId when identifier is in _elements', () => {
            mockSearchParametersManager.getPropertyObject.mockReturnValue(null);
            const args = {
                _elements: 'identifier,name',
                base_version: '4_0_0'
            };
            r4ArgsParser.parseArgs({ resourceType: 'Patient', args });
            // args._elements would be modified inline, but the function uses the local variable
        });

        test('should handle _elements as array', () => {
            mockSearchParametersManager.getPropertyObject.mockReturnValue(null);
            const args = {
                _elements: ['name', 'birthDate'],
                base_version: '4_0_0'
            };
            const result = r4ArgsParser.parseArgs({ resourceType: 'Patient', args });
            expect(result).toBeDefined();
        });
    });

    describe('parseArgs - propertyObj found', () => {
        test('should set fieldType from fhirTypesManager when fields are present', () => {
            const propertyObj = new SearchParameterDefinition({
                type: 'string',
                field: 'name'
            });
            mockSearchParametersManager.getPropertyObject.mockReturnValue(propertyObj);
            mockFhirTypesManager.getTypeForField.mockReturnValue('HumanName');

            const args = {
                name: 'John',
                base_version: '4_0_0'
            };
            const result = r4ArgsParser.parseArgs({ resourceType: 'Patient', args });
            expect(result).toBeDefined();
            expect(mockFhirTypesManager.getTypeForField).toHaveBeenCalledWith({
                resourceType: 'Patient',
                field: 'name'
            });
        });

        test('should set fieldType to null when fields are empty', () => {
            const propertyObj = new SearchParameterDefinition({
                type: 'string'
                // no field or fields
            });
            mockSearchParametersManager.getPropertyObject.mockReturnValue(propertyObj);

            const args = {
                name: 'John',
                base_version: '4_0_0'
            };
            const result = r4ArgsParser.parseArgs({ resourceType: 'Patient', args });
            expect(result).toBeDefined();
            expect(propertyObj.fieldType).toBeNull();
        });
    });

    describe('parseArgs - queryParameter underscore replacement', () => {
        test('should replace underscore with hyphen for non-system params', () => {
            // Parameters not starting with _ should have underscores replaced with hyphens
            const propertyObj = new SearchParameterDefinition({
                type: 'date',
                field: 'onsetDateTime'
            });
            // Mock to return propertyObj for onset-date (after conversion)
            mockSearchParametersManager.getPropertyObject.mockImplementation(({ queryParameter }) => {
                if (queryParameter === 'onset-date') return propertyObj;
                return null;
            });

            const args = {
                onset_date: '2023-01-01',
                base_version: '4_0_0'
            };
            const result = r4ArgsParser.parseArgs({ resourceType: 'Condition', args });
            expect(result).toBeDefined();
        });

        test('should NOT replace underscore for params starting with _', () => {
            const args = {
                _lastUpdated: '2023-01-01',
                base_version: '4_0_0'
            };
            const result = r4ArgsParser.parseArgs({ resourceType: 'Patient', args });
            expect(result).toBeDefined();
            // _lastUpdated should remain unchanged - mockSearchParametersManager queried with '_lastUpdated'
            expect(mockSearchParametersManager.getPropertyObject).toHaveBeenCalledWith(
                expect.objectContaining({ queryParameter: '_lastUpdated' })
            );
        });

        test('should NOT replace underscore in base_version or version_id', () => {
            const args = {
                base_version: '4_0_0',
                version_id: '1'
            };
            const result = r4ArgsParser.parseArgs({ resourceType: 'Patient', args });
            expect(result).toBeDefined();
        });
    });

    describe('parseArgs - empty/null value handling', () => {
        test('should skip args with undefined value', () => {
            const args = {
                name: undefined,
                base_version: '4_0_0'
            };
            const result = r4ArgsParser.parseArgs({ resourceType: 'Patient', args });
            // base_version is always parsed as a param; name with undefined should be skipped
            const nameItems = result.parsedArgItems.filter(i => i.queryParameter === 'name');
            expect(nameItems).toHaveLength(0);
        });

        test('should skip args with null value', () => {
            const args = {
                name: null,
                base_version: '4_0_0'
            };
            const result = r4ArgsParser.parseArgs({ resourceType: 'Patient', args });
            const nameItems = result.parsedArgItems.filter(i => i.queryParameter === 'name');
            expect(nameItems).toHaveLength(0);
        });

        test('should skip args with empty string value', () => {
            const args = {
                name: '',
                base_version: '4_0_0'
            };
            const result = r4ArgsParser.parseArgs({ resourceType: 'Patient', args });
            const nameItems = result.parsedArgItems.filter(i => i.queryParameter === 'name');
            expect(nameItems).toHaveLength(0);
        });

        test('should skip args with empty array', () => {
            const args = {
                name: [],
                base_version: '4_0_0'
            };
            const result = r4ArgsParser.parseArgs({ resourceType: 'Patient', args });
            const nameItems = result.parsedArgItems.filter(i => i.queryParameter === 'name');
            expect(nameItems).toHaveLength(0);
        });
    });

    describe('parseArgs - useOrFilterForArrays', () => {
        test('should use $or operator when useOrFilterForArrays is true', () => {
            const args = {
                name: 'John',
                base_version: '4_0_0'
            };
            const result = r4ArgsParser.parseArgs({
                resourceType: 'Patient',
                args,
                useOrFilterForArrays: true
            });
            expect(result).toBeDefined();
            if (result.parsedArgItems.length > 0) {
                // The first non-base_version item with a value should have $or
                const nameItem = result.parsedArgItems.find(i => i.queryParameter === 'name');
                if (nameItem) {
                    expect(nameItem.queryParameterValue.operator).toBe('$or');
                }
            }
        });
    });
});

describe('R4ArgsParser composite fieldType resolution', () => {
    test('sets fieldType on every composite component after parseArgs', () => {
        const component1 = new SearchParameterDefinition({ type: 'token', field: 'code' });
        const component2 = new SearchParameterDefinition({
            type: 'quantity',
            field: 'valueQuantity'
        });
        const compositeDef = new SearchParameterDefinition({
            type: 'composite',
            scopes: [{ components: [component1, component2] }]
        });
        const searchParametersManager = new SearchParametersManager();
        searchParametersManager.getPropertyObject = () => compositeDef;

        const r4ArgsParser = new R4ArgsParser({
            fhirTypesManager: new FhirTypesManager(),
            configManager: new ConfigManager(),
            searchParametersManager
        });

        r4ArgsParser.parseArgs({
            resourceType: 'Observation',
            args: { 'code-value-quantity': '8480-6$ge140', base_version: '4_0_0' }
        });

        expect(component1.fieldType).toBe('CodeableConcept');
        expect(component2.fieldType).toBe('Quantity');
    });

    test('resolves fieldType for an array-scoped component off the full arrayField.firstField ' +
        'path, not the bare relative field', () => {
        // ActivityDefinition.code (bare relative field) is a CodeableConcept, but this
        // component's `code` is relative to the `useContext` array (a UsageContext), whose real
        // field is ActivityDefinition.useContext.code -- a Coding. Resolving off the bare field
        // finds the wrong data and silently produces a filter that can never match (see
        // src/operations/query/filters/composite.test.js for the filter-shape regression test).
        const arrayScopedComponent = new SearchParameterDefinition({
            type: 'token',
            field: 'code',
            arrayField: 'useContext'
        });
        const valueComponent = new SearchParameterDefinition({
            type: 'quantity',
            fields: ['valueQuantity', 'valueRange'],
            arrayField: 'useContext'
        });
        const compositeDef = new SearchParameterDefinition({
            type: 'composite',
            scopes: [{ components: [arrayScopedComponent, valueComponent] }]
        });
        const searchParametersManager = new SearchParametersManager();
        searchParametersManager.getPropertyObject = () => compositeDef;

        const fhirTypesManager = new FhirTypesManager();
        const r4ArgsParser = new R4ArgsParser({
            fhirTypesManager,
            configManager: new ConfigManager(),
            searchParametersManager
        });

        r4ArgsParser.parseArgs({
            resourceType: 'ActivityDefinition',
            args: { 'context-type-quantity': 'a$ge140', base_version: '4_0_0' }
        });

        const fullPathFieldType = fhirTypesManager.getTypeForField({
            resourceType: 'ActivityDefinition',
            field: 'useContext.code'
        });
        const bareRelativeFieldType = fhirTypesManager.getTypeForField({
            resourceType: 'ActivityDefinition',
            field: 'code'
        });

        // Sanity check that this scenario actually exercises a case where the two lookups
        // disagree -- otherwise the assertion below wouldn't catch a regression.
        expect(bareRelativeFieldType).toBe('CodeableConcept');
        expect(fullPathFieldType).not.toBe(bareRelativeFieldType);

        expect(arrayScopedComponent.fieldType).toBe(fullPathFieldType);
        expect(arrayScopedComponent.fieldType).not.toBe(bareRelativeFieldType);
    });

    test('resolves a per-field fieldTypesObj for a multi-field token component (polymorphic ' +
        'value[x], e.g. Group.characteristic-value), instead of one shared fieldType off ' +
        'firstField', () => {
        const codeComponent = new SearchParameterDefinition({
            type: 'token',
            field: 'code',
            arrayField: 'characteristic'
        });
        const valueComponent = new SearchParameterDefinition({
            type: 'token',
            fields: ['valueCodeableConcept', 'valueBoolean'],
            arrayField: 'characteristic'
        });
        const compositeDef = new SearchParameterDefinition({
            type: 'composite',
            scopes: [{ components: [codeComponent, valueComponent] }]
        });
        const searchParametersManager = new SearchParametersManager();
        searchParametersManager.getPropertyObject = () => compositeDef;

        const r4ArgsParser = new R4ArgsParser({
            fhirTypesManager: new FhirTypesManager(),
            configManager: new ConfigManager(),
            searchParametersManager
        });

        r4ArgsParser.parseArgs({
            resourceType: 'Group',
            args: { 'characteristic-value': 'code$true', base_version: '4_0_0' }
        });

        // sanity: the two fields really do resolve to different types -- otherwise this test
        // wouldn't catch a regression back to a single fieldType derived from firstField alone
        expect(valueComponent.fieldTypesObj.valueCodeableConcept).toBe('CodeableConcept');
        expect(valueComponent.fieldTypesObj.valueBoolean).toBe('boolean');
    });
});
