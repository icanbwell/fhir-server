const { describe, test, expect, jest, beforeEach } = require('@jest/globals');

// Mock logging
jest.mock('../../../../operations/common/logging', () => ({
    logError: jest.fn(),
    logInfo: jest.fn(),
    logWarn: jest.fn(),
    logDebug: jest.fn()
}));

const { R4SearchQueryCreator } = require('../../../../operations/query/r4');
const { ConfigManager } = require('../../../../utils/configManager');
const { AccessIndexManager } = require('../../../../operations/common/accessIndexManager');
const { R4ArgsParser } = require('../../../../operations/query/r4ArgsParser');
const { ParsedArgs } = require('../../../../operations/query/parsedArgs');
const { ParsedArgsItem } = require('../../../../operations/query/parsedArgsItem');
const { QueryParameterValue } = require('../../../../operations/query/queryParameterValue');
const { SearchParameterDefinition } = require('../../../../searchParameters/searchParameterTypes');
const { IndexProvider } = require('../../../../indexes/indexProvider');

/**
 * Creates mock ConfigManager that passes assertTypeEquals
 */
function createMockConfigManager() {
    const manager = Object.create(ConfigManager.prototype);
    Object.defineProperty(manager, 'useAccessIndex', { get: () => false, configurable: true });
    return manager;
}

/**
 * Creates mock IndexProvider
 */
function createMockIndexProvider() {
    const provider = Object.create(IndexProvider.prototype);
    provider.hasIndexForAccessCodes = jest.fn().mockReturnValue(false);
    return provider;
}

/**
 * Creates mock AccessIndexManager
 */
function createMockAccessIndexManager() {
    const manager = Object.create(AccessIndexManager.prototype);
    manager.configManager = createMockConfigManager();
    manager.indexProvider = createMockIndexProvider();
    manager.resourceHasAccessIndexForAccessCodes = jest.fn().mockReturnValue(false);
    return manager;
}

/**
 * Creates mock R4ArgsParser
 */
function createMockR4ArgsParser() {
    const parser = Object.create(R4ArgsParser.prototype);
    return parser;
}

/**
 * Creates a ParsedArgs with given parsedArgItems
 */
function createParsedArgs(parsedArgItems = []) {
    return new ParsedArgs({
        base_version: '4_0_0',
        parsedArgItems
    });
}

/**
 * Creates a ParsedArgsItem
 */
function createParsedArgsItem({ queryParameter, value, type, field, fields, target, modifiers = [] }) {
    const propertyObj = new SearchParameterDefinition({
        type,
        field,
        fields,
        target
    });

    const queryParameterValue = new QueryParameterValue({
        value,
        operator: '$and'
    });

    return new ParsedArgsItem({
        queryParameter,
        queryParameterValue,
        propertyObj,
        modifiers
    });
}

describe('R4SearchQueryCreator', () => {
    let creator;
    let configManager;
    let accessIndexManager;
    let r4ArgsParser;

    beforeEach(() => {
        configManager = createMockConfigManager();
        accessIndexManager = createMockAccessIndexManager();
        r4ArgsParser = createMockR4ArgsParser();
        creator = new R4SearchQueryCreator({
            configManager,
            accessIndexManager,
            r4ArgsParser
        });
    });

    describe('buildR4SearchQuery', () => {
        test('returns query with hidden tag filter when no parsedArgItems', () => {
            const parsedArgs = createParsedArgs([]);
            const result = creator.buildR4SearchQuery({
                resourceType: 'Patient',
                parsedArgs,
                useHistoryTable: false,
                operation: 'READ',
                isUser: false
            });
            // Should include hidden tag filter for non-AuditEvent, non-id, non-delete queries
            // The simplifier unwraps single-element $and into flat query
            expect(result.query).toBeDefined();
            expect(result.query['meta.tag']).toBeDefined();
            expect(result.query['meta.tag'].$not.$elemMatch).toBeDefined();
        });

        test('skips hidden tag filter for AuditEvent resourceType', () => {
            const parsedArgs = createParsedArgs([]);
            const result = creator.buildR4SearchQuery({
                resourceType: 'AuditEvent',
                parsedArgs,
                useHistoryTable: false,
                operation: 'READ',
                isUser: false
            });
            expect(result.query).toEqual({});
        });

        test('skips hidden tag filter for DELETE operation', () => {
            const parsedArgs = createParsedArgs([]);
            const result = creator.buildR4SearchQuery({
                resourceType: 'Patient',
                parsedArgs,
                useHistoryTable: false,
                operation: 'DELETE',
                isUser: false
            });
            expect(result.query).toEqual({});
        });

        test('skips hidden tag filter when useHistoryTable is true', () => {
            const parsedArgs = createParsedArgs([]);
            const result = creator.buildR4SearchQuery({
                resourceType: 'Patient',
                parsedArgs,
                useHistoryTable: true,
                operation: 'READ',
                isUser: false
            });
            expect(result.query).toEqual({});
        });

        test('builds query with string filter', () => {
            const parsedArgsItem = createParsedArgsItem({
                queryParameter: 'name',
                value: 'Smith',
                type: 'string',
                field: 'name'
            });
            const parsedArgs = createParsedArgs([parsedArgsItem]);

            const result = creator.buildR4SearchQuery({
                resourceType: 'Patient',
                parsedArgs,
                useHistoryTable: false,
                operation: 'READ',
                isUser: false
            });

            expect(result.query.$and).toBeDefined();
            expect(result.query.$and.length).toBeGreaterThan(0);
        });

        test('builds query with token filter', () => {
            const parsedArgsItem = createParsedArgsItem({
                queryParameter: 'status',
                value: 'active',
                type: 'token',
                field: 'status'
            });
            const parsedArgs = createParsedArgs([parsedArgsItem]);

            const result = creator.buildR4SearchQuery({
                resourceType: 'Patient',
                parsedArgs,
                useHistoryTable: false,
                operation: 'READ',
                isUser: false
            });

            expect(result.query.$and).toBeDefined();
            expect(result.query.$and.length).toBeGreaterThan(0);
        });

        test('applies not modifier correctly', () => {
            const parsedArgsItem = createParsedArgsItem({
                queryParameter: 'status',
                value: 'active',
                type: 'token',
                field: 'status',
                modifiers: ['not']
            });
            const parsedArgs = createParsedArgs([parsedArgsItem]);

            const result = creator.buildR4SearchQuery({
                resourceType: 'Patient',
                parsedArgs,
                useHistoryTable: false,
                operation: 'READ',
                isUser: false
            });

            // Should have $nor wrapping
            const querySegments = result.query.$and;
            const norSegment = querySegments.find(s => s.$nor);
            expect(norSegment).toBeDefined();
        });

        test('handles _id parameter with FilterById', () => {
            const parsedArgsItem = createParsedArgsItem({
                queryParameter: '_id',
                value: 'test-id-123',
                type: 'token',
                field: 'id',
                fields: ['id']
            });
            const parsedArgs = createParsedArgs([parsedArgsItem]);

            const result = creator.buildR4SearchQuery({
                resourceType: 'Patient',
                parsedArgs,
                useHistoryTable: false,
                operation: 'READ',
                isUser: false
            });

            // When _id is set, parsedArgs.id is truthy so hidden tag filter is skipped
            // The simplifier unwraps the single $and element
            expect(result.query).toBeDefined();
            expect(result.query._sourceId || result.query._uuid || result.query.$or).toBeDefined();
        });

        test('handles security tag token specially', () => {
            const parsedArgsItem = createParsedArgsItem({
                queryParameter: 'security',
                value: 'http://system|code',
                type: 'token',
                field: 'meta.security'
            });
            const parsedArgs = createParsedArgs([parsedArgsItem]);

            const result = creator.buildR4SearchQuery({
                resourceType: 'Patient',
                parsedArgs,
                useHistoryTable: false,
                operation: 'READ',
                isUser: false
            });

            expect(result.query.$and).toBeDefined();
        });

        test('BUG: reference type with empty values array routes to FilterByCanonical', () => {
            // When queryParameterValue.values is empty [],
            // Array.every() returns true for empty arrays,
            // so UrlParser.isUrl check passes vacuously.
            // This routes to FilterByCanonical instead of FilterByReference.
            const propertyObj = new SearchParameterDefinition({
                type: 'reference',
                field: 'subject',
                target: ['Patient']
            });

            const queryParameterValue = new QueryParameterValue({
                value: [],
                operator: '$and'
            });

            const parsedArgsItem = new ParsedArgsItem({
                queryParameter: 'subject',
                queryParameterValue,
                propertyObj,
                modifiers: []
            });
            const parsedArgs = createParsedArgs([parsedArgsItem]);

            // This should not throw - the issue is that it uses wrong filter
            // but with empty values both filters produce empty results
            const result = creator.buildR4SearchQuery({
                resourceType: 'Observation',
                parsedArgs,
                useHistoryTable: false,
                operation: 'READ',
                isUser: false
            });

            expect(result.query).toBeDefined();
        });
    });

    describe('appendAndQuery', () => {
        test('adds to existing $and array', () => {
            const query = { $and: [{ status: 'active' }] };
            const andQuery = { name: 'test' };
            const result = creator.appendAndQuery({ query, andQuery });
            expect(result.$and).toEqual([{ status: 'active' }, { name: 'test' }]);
        });

        test('creates $and for empty query', () => {
            const query = {};
            const andQuery = { name: 'test' };
            const result = creator.appendAndQuery({ query, andQuery });
            expect(result.$and).toEqual([{ name: 'test' }]);
        });

        test('wraps existing non-$and query', () => {
            const query = { status: 'active' };
            const andQuery = { name: 'test' };
            const result = creator.appendAndQuery({ query, andQuery });
            expect(result.$and).toEqual([{ status: 'active' }, { name: 'test' }]);
        });
    });

    describe('appendAndSimplifyQuery', () => {
        test('simplifies after appending', () => {
            const query = {};
            const andQuery = { name: 'test' };
            const result = creator.appendAndSimplifyQuery({ query, andQuery });
            expect(result).toBeDefined();
        });
    });

    describe('getColumnsAndSegmentsForParameterType', () => {
        test('handles string type', () => {
            const parsedArgsItem = createParsedArgsItem({
                queryParameter: 'name',
                value: 'Smith',
                type: 'string',
                field: 'name'
            });

            const { FilterParameters } = require('../../../../operations/query/filters/filterParameters');
            const { FieldMapper } = require('../../../../operations/query/filters/fieldMapper');
            const fieldMapper = new FieldMapper({ useHistoryTable: false });
            const filterParameters = new FilterParameters({
                parsedArg: parsedArgsItem,
                propertyObj: parsedArgsItem.propertyObj,
                fnUseAccessIndex: () => false,
                fieldMapper,
                resourceType: 'Patient'
            });

            const result = creator.getColumnsAndSegmentsForParameterType({
                parsedArg: parsedArgsItem,
                filterParameters
            });

            expect(result.andSegments).toBeDefined();
            expect(Array.isArray(result.andSegments)).toBe(true);
        });

        test('handles uri type', () => {
            const parsedArgsItem = createParsedArgsItem({
                queryParameter: 'url',
                value: 'http://example.com',
                type: 'uri',
                field: 'url'
            });

            const { FilterParameters } = require('../../../../operations/query/filters/filterParameters');
            const { FieldMapper } = require('../../../../operations/query/filters/fieldMapper');
            const fieldMapper = new FieldMapper({ useHistoryTable: false });
            const filterParameters = new FilterParameters({
                parsedArg: parsedArgsItem,
                propertyObj: parsedArgsItem.propertyObj,
                fnUseAccessIndex: () => false,
                fieldMapper,
                resourceType: 'ValueSet'
            });

            const result = creator.getColumnsAndSegmentsForParameterType({
                parsedArg: parsedArgsItem,
                filterParameters
            });

            expect(result.andSegments).toBeDefined();
            expect(result.andSegments.length).toBeGreaterThan(0);
        });

        test('throws for unknown type', () => {
            const propertyObj = new SearchParameterDefinition({
                type: 'unknownType',
                field: 'someField'
            });

            const queryParameterValue = new QueryParameterValue({
                value: 'test',
                operator: '$and'
            });

            const parsedArgsItem = new ParsedArgsItem({
                queryParameter: 'someParam',
                queryParameterValue,
                propertyObj,
                modifiers: []
            });

            const { FilterParameters } = require('../../../../operations/query/filters/filterParameters');
            const { FieldMapper } = require('../../../../operations/query/filters/fieldMapper');
            const fieldMapper = new FieldMapper({ useHistoryTable: false });
            const filterParameters = new FilterParameters({
                parsedArg: parsedArgsItem,
                propertyObj,
                fnUseAccessIndex: () => false,
                fieldMapper,
                resourceType: 'Patient'
            });

            expect(() => {
                creator.getColumnsAndSegmentsForParameterType({
                    parsedArg: parsedArgsItem,
                    filterParameters
                });
            }).toThrow('Unknown type=unknownType');
        });

        test('BUG: undefined type matches case fhirFilterTypes.dateTime (which is undefined)', () => {
            // fhirFilterTypes.dateTime is undefined (it should be fhirFilterTypes.datetime)
            // This means 'case undefined:' exists in the switch
            // A SearchParameterDefinition with missing type would be treated as dateTime
            const propertyObj = new SearchParameterDefinition({
                field: 'someField'
                // type is intentionally omitted => undefined
            });

            const queryParameterValue = new QueryParameterValue({
                value: 'eq2023-01-01',
                operator: '$and'
            });

            const parsedArg = new ParsedArgsItem({
                queryParameter: 'someParam',
                queryParameterValue,
                propertyObj,
                modifiers: []
            });

            const { FilterParameters } = require('../../../../operations/query/filters/filterParameters');
            const { FieldMapper } = require('../../../../operations/query/filters/fieldMapper');
            const fieldMapper = new FieldMapper({ useHistoryTable: false });
            const filterParameters = new FilterParameters({
                parsedArg,
                propertyObj,
                fnUseAccessIndex: () => false,
                fieldMapper,
                resourceType: 'Patient'
            });

            // This would route to FilterByDateTime instead of throwing
            const result = creator.getColumnsAndSegmentsForParameterType({
                parsedArg,
                filterParameters
            });

            // It matches the dateTime case instead of throwing 'Unknown type'
            expect(result.andSegments).toBeDefined();
        });

        test('handles null propertyObj returns empty andSegments', () => {
            const queryParameterValue = new QueryParameterValue({
                value: 'test',
                operator: '$and'
            });

            // Create parsedArgsItem without propertyObj check
            const parsedArg = {
                queryParameter: 'unknownParam',
                queryParameterValue,
                propertyObj: null,
                modifiers: []
            };

            const { FilterParameters } = require('../../../../operations/query/filters/filterParameters');
            const { FieldMapper } = require('../../../../operations/query/filters/fieldMapper');
            const fieldMapper = new FieldMapper({ useHistoryTable: false });
            const filterParameters = new FilterParameters({
                parsedArg,
                propertyObj: null,
                fnUseAccessIndex: () => false,
                fieldMapper,
                resourceType: 'Patient'
            });

            const result = creator.getColumnsAndSegmentsForParameterType({
                parsedArg,
                filterParameters
            });

            expect(result.andSegments).toEqual([]);
        });
    });
});
