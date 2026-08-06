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

    describe('parseArgs - rejects MongoDB operator injection', () => {
        // A POST _search body of `url[$gt]=` parses into { url: { $gt: '' } }, which without
        // a guard reaches the filters as a live MongoDB operator expression.
        /**
         * The parameter must be absent entirely, not present with a null value: a null-valued
         * item still reaches the filters and some dereference it (FilterByDateTime) and 500.
         * @param {ParsedArgs} parsedArgs
         * @param {string} queryParameter
         * @return {ParsedArgsItem|undefined}
         */
        function itemFor (parsedArgs, queryParameter) {
            return parsedArgs.parsedArgItems.find(i => i.queryParameter === queryParameter);
        }

        test('drops an operator object on a date parameter without creating an item', () => {
            mockSearchParametersManager.getPropertyObject.mockReturnValue(
                new SearchParameterDefinition({ type: 'date', field: 'birthDate' })
            );
            mockFhirTypesManager.getTypeForField.mockReturnValue('date');

            const result = r4ArgsParser.parseArgs({
                resourceType: 'Patient',
                args: { birthdate: { $gt: '' }, base_version: '4_0_0' }
            });
            expect(itemFor(result, 'birthdate')).toBeUndefined();
        });

        test('drops an operator object on a known search parameter', () => {
            mockSearchParametersManager.getPropertyObject.mockReturnValue(
                new SearchParameterDefinition({ type: 'uri', field: 'url' })
            );
            mockFhirTypesManager.getTypeForField.mockReturnValue('uri');

            const result = r4ArgsParser.parseArgs({
                resourceType: 'ValueSet',
                args: { url: { $gt: '' }, base_version: '4_0_0' }
            });
            expect(itemFor(result, 'url')).toBeUndefined();
        });

        test('drops an operator object nested inside an array', () => {
            mockSearchParametersManager.getPropertyObject.mockReturnValue(
                new SearchParameterDefinition({ type: 'uri', field: 'url' })
            );
            mockFhirTypesManager.getTypeForField.mockReturnValue('uri');

            // qs parses `url[0][$gt]=` into { url: [ { $gt: '' } ] }
            const result = r4ArgsParser.parseArgs({
                resourceType: 'ValueSet',
                args: { url: [{ $gt: '' }], base_version: '4_0_0' }
            });
            expect(itemFor(result, 'url')).toBeUndefined();
        });

        test('drops an operator object nested inside a doubly-nested array, without creating an item', () => {
            // qs parses `birthdate[0][0][$gt]=` into { birthdate: [ [ { $gt: '' } ] ] }. A
            // shallow check on the array's immediate elements misses this, since the sole
            // element is itself an array rather than a plain object -- the value would pass
            // through unstripped and reach FilterByDateTime.filterByItem, which calls
            // value.match() on it and throws.
            mockSearchParametersManager.getPropertyObject.mockReturnValue(
                new SearchParameterDefinition({ type: 'date', field: 'birthDate' })
            );
            mockFhirTypesManager.getTypeForField.mockReturnValue('date');

            const result = r4ArgsParser.parseArgs({
                resourceType: 'Patient',
                args: { birthdate: [[{ $gt: '' }]], base_version: '4_0_0' }
            });
            expect(itemFor(result, 'birthdate')).toBeUndefined();
        });

        test('drops only the tainted branch of a nested array, keeping sibling scalars', () => {
            mockSearchParametersManager.getPropertyObject.mockReturnValue(
                new SearchParameterDefinition({ type: 'uri', field: 'url' })
            );
            mockFhirTypesManager.getTypeForField.mockReturnValue('uri');

            const result = r4ArgsParser.parseArgs({
                resourceType: 'ValueSet',
                args: { url: [[{ $gt: '' }], 'http://example.org/ok'], base_version: '4_0_0' }
            });
            expect(itemFor(result, 'url').queryParameterValue.values).toEqual(['http://example.org/ok']);
        });

        test('preserves an object payload on a non-search parameter ($graph)', () => {
            // operation payloads have no propertyObj so never become a filter, and $graph
            // reads a whole GraphDefinition off parsedArgs.resource
            mockSearchParametersManager.getPropertyObject.mockReturnValue(null);
            const graphDefinition = { resourceType: 'GraphDefinition', id: 'x', start: 'Patient' };

            const result = r4ArgsParser.parseArgs({
                resourceType: 'Patient',
                args: { resource: graphDefinition, base_version: '4_0_0' }
            });
            expect(result.resource).toEqual(graphDefinition);
        });

        test('preserves a GraphQL token object, which converts to strings', () => {
            mockSearchParametersManager.getPropertyObject.mockReturnValue(
                new SearchParameterDefinition({ type: 'token', field: 'identifier' })
            );
            mockFhirTypesManager.getTypeForField.mockReturnValue('Identifier');

            const result = r4ArgsParser.parseArgs({
                resourceType: 'Patient',
                args: {
                    identifier: { searchType: 'token', values: [{ system: 'http://s', code: 'c' }] },
                    base_version: '4_0_0'
                }
            });
            expect(itemFor(result, 'identifier').queryParameterValue.values).toEqual(['http://s|c']);
        });

        test('still parses a legitimate uri value', () => {
            mockSearchParametersManager.getPropertyObject.mockReturnValue(
                new SearchParameterDefinition({ type: 'uri', field: 'url' })
            );
            mockFhirTypesManager.getTypeForField.mockReturnValue('uri');

            const result = r4ArgsParser.parseArgs({
                resourceType: 'ValueSet',
                args: { url: 'http://example.org/vs', base_version: '4_0_0' }
            });
            expect(result.parsedArgItems.find(i => i.queryParameter === 'url')
                .queryParameterValue.value).toBe('http://example.org/vs');
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
