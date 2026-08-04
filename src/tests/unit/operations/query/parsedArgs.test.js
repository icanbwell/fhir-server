'use strict';

const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

// Mock dependencies before requiring the module
jestObj.mock('../../../../utils/assertType', () => ({
    assertIsValid: jestObj.fn((value, message) => {
        if (!value) {
            throw new Error(message || 'Assertion failed');
        }
    })
}));

jestObj.mock('../../../../utils/nullRemover', () => ({
    removeNull: jestObj.fn((obj) => {
        if (!obj || typeof obj !== 'object') return obj;
        const result = {};
        for (const [key, value] of Object.entries(obj)) {
            if (value !== null && value !== undefined) {
                result[key] = value;
            }
        }
        return result;
    })
}));

const { ParsedArgs } = require('../../../../operations/query/parsedArgs');
const { assertIsValid } = require('../../../../utils/assertType');

/**
 * Creates a mock ParsedArgsItem for testing
 */
function createMockParsedArgsItem ({
    queryParameter,
    value = 'test-value',
    modifiers = [],
    propertyObj = undefined
} = {}) {
    const queryParameterValue = {
        get value () { return this._value; },
        set value (v) { this._value = v; },
        _value: value
    };

    const item = {
        queryParameter,
        queryParameterValue,
        _queryParameterValue: queryParameterValue,
        modifiers,
        propertyObj
    };

    item.clone = jestObj.fn(() => {
        return createMockParsedArgsItem({
            queryParameter: item.queryParameter,
            value: item.queryParameterValue.value,
            modifiers: [...item.modifiers],
            propertyObj: item.propertyObj
        });
    });

    item.toJSON = jestObj.fn(() => {
        return {
            queryParameter: item.queryParameter,
            value: item.queryParameterValue.value,
            modifiers: item.modifiers
        };
    });

    return item;
}

describe('ParsedArgs', () => {
    beforeEach(() => {
        jestObj.clearAllMocks();
    });

    describe('constructor', () => {
        test('throws without base_version', () => {
            expect(() => new ParsedArgs({})).toThrow();
            expect(assertIsValid).toHaveBeenCalledWith(undefined, 'base_version is missing');
        });

        test('throws when base_version is null', () => {
            expect(() => new ParsedArgs({ base_version: null })).toThrow();
        });

        test('throws when base_version is empty string', () => {
            expect(() => new ParsedArgs({ base_version: '' })).toThrow();
        });

        test('creates instance with valid base_version', () => {
            const args = new ParsedArgs({ base_version: '4_0_0' });
            expect(args.base_version).toBe('4_0_0');
        });

        test('initializes with empty parsedArgItems by default', () => {
            const args = new ParsedArgs({ base_version: '4_0_0' });
            expect(args.parsedArgItems).toEqual([]);
        });

        test('adds all provided parsedArgItems', () => {
            const item1 = createMockParsedArgsItem({ queryParameter: 'name' });
            const item2 = createMockParsedArgsItem({ queryParameter: 'status' });

            const args = new ParsedArgs({
                base_version: '4_0_0',
                parsedArgItems: [item1, item2]
            });

            expect(args.parsedArgItems).toHaveLength(2);
        });

        test('stores headers', () => {
            const headers = { 'x-request-id': '123', accept: 'application/fhir+json' };
            const args = new ParsedArgs({ base_version: '4_0_0', headers });
            expect(args.headers).toBe(headers);
        });

        test('creates originalParsedArgItems as clones of initial items', () => {
            const item = createMockParsedArgsItem({ queryParameter: 'name', value: 'original' });

            const args = new ParsedArgs({
                base_version: '4_0_0',
                parsedArgItems: [item]
            });

            expect(args.originalParsedArgItems).toHaveLength(1);
            // clone was called for originalParsedArgItems
            expect(item.clone).toHaveBeenCalled();
        });
    });

    describe('add()', () => {
        test('creates property accessor on ParsedArgs instance', () => {
            const args = new ParsedArgs({ base_version: '4_0_0' });
            const item = createMockParsedArgsItem({ queryParameter: 'name', value: 'John' });

            args.add(item);

            expect(args.name).toBe('John');
        });

        test('setter updates the queryParameterValue', () => {
            const args = new ParsedArgs({ base_version: '4_0_0' });
            const item = createMockParsedArgsItem({ queryParameter: 'status', value: 'active' });

            args.add(item);
            args.status = 'inactive';

            expect(args.status).toBe('inactive');
            expect(item.queryParameterValue.value).toBe('inactive');
        });

        test('with same queryParameter and same modifiers overwrites existing value', () => {
            const args = new ParsedArgs({ base_version: '4_0_0' });
            const item1 = createMockParsedArgsItem({ queryParameter: 'name', value: 'John', modifiers: [] });
            const item2 = createMockParsedArgsItem({ queryParameter: 'name', value: 'Jane', modifiers: [] });

            args.add(item1);
            args.add(item2);

            // Should still only have one item
            expect(args.parsedArgItems).toHaveLength(1);
            // Value should be updated to item2's value
            expect(args.parsedArgItems[0].queryParameterValue.value).toBe('Jane');
        });

        test('with same queryParameter but different modifiers creates separate entry', () => {
            const args = new ParsedArgs({ base_version: '4_0_0' });
            const item1 = createMockParsedArgsItem({ queryParameter: 'date', value: '2021-01-01', modifiers: ['gt'] });
            const item2 = createMockParsedArgsItem({ queryParameter: 'date', value: '2021-12-31', modifiers: ['lt'] });

            args.add(item1);
            args.add(item2);

            expect(args.parsedArgItems).toHaveLength(2);
        });

        test('creates property with modifier in name when modifiers present', () => {
            const args = new ParsedArgs({ base_version: '4_0_0' });
            const item = createMockParsedArgsItem({ queryParameter: 'date', value: '2021-01-01', modifiers: ['gt'] });

            args.add(item);

            expect(args['date:gt']).toBe('2021-01-01');
        });

        test('creates property with multiple modifiers joined by colon', () => {
            const args = new ParsedArgs({ base_version: '4_0_0' });
            const item = createMockParsedArgsItem({
                queryParameter: 'reference',
                value: 'Patient/123',
                modifiers: ['type', 'exact']
            });

            args.add(item);

            expect(args['reference:type:exact']).toBe('Patient/123');
        });

        test('_id creates id alias property', () => {
            const args = new ParsedArgs({ base_version: '4_0_0' });
            const item = createMockParsedArgsItem({ queryParameter: '_id', value: 'abc-123' });

            args.add(item);

            expect(args._id).toBe('abc-123');
            expect(args.id).toBe('abc-123');
        });

        test('_id alias setter updates the value', () => {
            const args = new ParsedArgs({ base_version: '4_0_0' });
            const item = createMockParsedArgsItem({ queryParameter: '_id', value: 'abc' });

            args.add(item);
            args.id = 'xyz-789';

            expect(args._id).toBe('xyz-789');
            expect(args.id).toBe('xyz-789');
        });

        test('returns this for chaining', () => {
            const args = new ParsedArgs({ base_version: '4_0_0' });
            const item = createMockParsedArgsItem({ queryParameter: 'name' });

            const result = args.add(item);
            expect(result).toBe(args);
        });

        test('overwrites propertyObj and modifiers when overwriting existing item', () => {
            const args = new ParsedArgs({ base_version: '4_0_0' });
            const propertyObj1 = { field: 'name', type: 'string' };
            const propertyObj2 = { field: 'name', type: 'token' };
            const item1 = createMockParsedArgsItem({ queryParameter: 'name', value: 'A', modifiers: [], propertyObj: propertyObj1 });
            const item2 = createMockParsedArgsItem({ queryParameter: 'name', value: 'B', modifiers: [], propertyObj: propertyObj2 });

            args.add(item1);
            args.add(item2);

            expect(args.parsedArgItems[0].propertyObj).toBe(propertyObj2);
        });
    });

    describe('get()', () => {
        test('returns matching item by queryParameter', () => {
            const item = createMockParsedArgsItem({ queryParameter: 'status', value: 'active' });
            const args = new ParsedArgs({ base_version: '4_0_0', parsedArgItems: [item] });

            const found = args.get('status');
            expect(found).toBeDefined();
            expect(found.queryParameter).toBe('status');
        });

        test('returns undefined when item not found', () => {
            const args = new ParsedArgs({ base_version: '4_0_0' });
            expect(args.get('nonexistent')).toBeUndefined();
        });

        test('returns first matching item when multiple items have same queryParameter', () => {
            const item1 = createMockParsedArgsItem({ queryParameter: 'date', value: '2021-01-01', modifiers: ['gt'] });
            const item2 = createMockParsedArgsItem({ queryParameter: 'date', value: '2021-12-31', modifiers: ['lt'] });
            const args = new ParsedArgs({ base_version: '4_0_0', parsedArgItems: [item1, item2] });

            const found = args.get('date');
            expect(found.queryParameterValue.value).toBe('2021-01-01');
        });
    });

    describe('getOriginal()', () => {
        test('returns pre-rewrite version of argument', () => {
            const item = createMockParsedArgsItem({ queryParameter: 'patient', value: 'Patient/original' });
            const args = new ParsedArgs({ base_version: '4_0_0', parsedArgItems: [item] });

            // Mutate current arg
            args.parsedArgItems[0].queryParameterValue.value = 'Patient/rewritten';

            const original = args.getOriginal('patient');
            expect(original).toBeDefined();
            expect(original.queryParameterValue.value).toBe('Patient/original');
        });

        test('returns undefined when original not found', () => {
            const args = new ParsedArgs({ base_version: '4_0_0' });
            expect(args.getOriginal('nonexistent')).toBeUndefined();
        });

        test('mutation isolation: changing original does not affect current', () => {
            const item = createMockParsedArgsItem({ queryParameter: 'name', value: 'Smith' });
            const args = new ParsedArgs({ base_version: '4_0_0', parsedArgItems: [item] });

            const original = args.getOriginal('name');
            original.queryParameterValue.value = 'MUTATED';

            // Current should still be unchanged
            expect(args.parsedArgItems[0].queryParameterValue.value).toBe('Smith');
        });
    });

    describe('remove()', () => {
        test('removes matching items by queryParameter', () => {
            const item1 = createMockParsedArgsItem({ queryParameter: 'name', value: 'John' });
            const item2 = createMockParsedArgsItem({ queryParameter: 'status', value: 'active' });
            const args = new ParsedArgs({ base_version: '4_0_0', parsedArgItems: [item1, item2] });

            args.remove('name');

            expect(args.parsedArgItems).toHaveLength(1);
            expect(args.parsedArgItems[0].queryParameter).toBe('status');
        });

        test('removes ALL items with matching queryParameter', () => {
            const item1 = createMockParsedArgsItem({ queryParameter: 'date', value: '2021-01-01', modifiers: ['gt'] });
            const item2 = createMockParsedArgsItem({ queryParameter: 'date', value: '2021-12-31', modifiers: ['lt'] });
            const item3 = createMockParsedArgsItem({ queryParameter: 'status', value: 'active' });
            const args = new ParsedArgs({ base_version: '4_0_0', parsedArgItems: [item1, item2, item3] });

            args.remove('date');

            expect(args.parsedArgItems).toHaveLength(1);
            expect(args.parsedArgItems[0].queryParameter).toBe('status');
        });

        test('does nothing when argName not found', () => {
            const item = createMockParsedArgsItem({ queryParameter: 'name' });
            const args = new ParsedArgs({ base_version: '4_0_0', parsedArgItems: [item] });

            args.remove('nonexistent');

            expect(args.parsedArgItems).toHaveLength(1);
        });

        test('returns this for chaining', () => {
            const args = new ParsedArgs({ base_version: '4_0_0' });
            const result = args.remove('anything');
            expect(result).toBe(args);
        });
    });

    describe('clone()', () => {
        test('creates independent copy with same base_version', () => {
            const item = createMockParsedArgsItem({ queryParameter: 'name', value: 'John' });
            const args = new ParsedArgs({ base_version: '4_0_0', parsedArgItems: [item] });

            const cloned = args.clone();

            expect(cloned.base_version).toBe('4_0_0');
            expect(cloned).not.toBe(args);
        });

        test('cloned parsedArgItems are independent from original', () => {
            const item = createMockParsedArgsItem({ queryParameter: 'status', value: 'active' });
            const args = new ParsedArgs({ base_version: '4_0_0', parsedArgItems: [item] });

            const cloned = args.clone();

            // Mutate cloned
            cloned.parsedArgItems[0].queryParameterValue.value = 'inactive';

            // Original should be unchanged
            expect(args.parsedArgItems[0].queryParameterValue.value).toBe('active');
        });

        test('preserves headers in clone', () => {
            const headers = { 'x-request-id': 'abc' };
            const args = new ParsedArgs({ base_version: '4_0_0', headers });

            const cloned = args.clone();
            expect(cloned.headers).toBe(headers);
        });

        test('clone has same number of parsedArgItems', () => {
            const item1 = createMockParsedArgsItem({ queryParameter: 'name' });
            const item2 = createMockParsedArgsItem({ queryParameter: 'status' });
            const args = new ParsedArgs({ base_version: '4_0_0', parsedArgItems: [item1, item2] });

            const cloned = args.clone();
            expect(cloned.parsedArgItems).toHaveLength(2);
        });
    });

    describe('getRawArgs()', () => {
        test('returns flat object of queryParameter to value pairs', () => {
            const item1 = createMockParsedArgsItem({ queryParameter: 'name', value: 'John' });
            const item2 = createMockParsedArgsItem({ queryParameter: 'status', value: 'active' });
            const args = new ParsedArgs({ base_version: '4_0_0', parsedArgItems: [item1, item2] });

            const raw = args.getRawArgs();
            expect(raw).toEqual({
                name: 'John',
                status: 'active'
            });
        });

        test('returns empty object when no args', () => {
            const args = new ParsedArgs({ base_version: '4_0_0' });
            expect(args.getRawArgs()).toEqual({});
        });

        test('uses _queryParameterValue.value (internal accessor)', () => {
            const item = createMockParsedArgsItem({ queryParameter: 'test', value: 'raw-value' });
            const args = new ParsedArgs({ base_version: '4_0_0', parsedArgItems: [item] });

            const raw = args.getRawArgs();
            expect(raw.test).toBe('raw-value');
        });

        test('last value wins when multiple items have same queryParameter', () => {
            const item1 = createMockParsedArgsItem({ queryParameter: 'date', value: '2021-01-01', modifiers: ['gt'] });
            const item2 = createMockParsedArgsItem({ queryParameter: 'date', value: '2021-12-31', modifiers: ['lt'] });
            const args = new ParsedArgs({ base_version: '4_0_0', parsedArgItems: [item1, item2] });

            const raw = args.getRawArgs();
            // Since both have same queryParameter key, last one wins in object assignment
            expect(raw.date).toBe('2021-12-31');
        });
    });

    describe('toJSON()', () => {
        test('returns object with base_version and parsedArgItems', () => {
            const item = createMockParsedArgsItem({ queryParameter: 'name', value: 'John' });
            const args = new ParsedArgs({ base_version: '4_0_0', parsedArgItems: [item] });

            const json = args.toJSON();
            expect(json.base_version).toBe('4_0_0');
            expect(json.parsedArgItems).toBeDefined();
        });

        test('includes headers when present', () => {
            const headers = { accept: 'application/fhir+json' };
            const args = new ParsedArgs({ base_version: '4_0_0', headers });

            const json = args.toJSON();
            expect(json.headers).toEqual(headers);
        });

        test('excludes null values via removeNull', () => {
            const args = new ParsedArgs({ base_version: '4_0_0' });

            const json = args.toJSON();
            // headers is undefined so removeNull should strip it
            expect(json.headers).toBeUndefined();
        });
    });
});
