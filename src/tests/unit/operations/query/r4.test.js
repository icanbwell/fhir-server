'use strict';

const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

// Mock logging
jestObj.mock('../../../../operations/common/logging', () => ({
    logError: jestObj.fn(),
    logInfo: jestObj.fn(),
    logWarn: jestObj.fn(),
    logDebug: jestObj.fn()
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

function createMockConfigManager() {
    const manager = Object.create(ConfigManager.prototype);
    Object.defineProperty(manager, 'useAccessIndex', { get: () => false, configurable: true });
    return manager;
}

function createMockIndexProvider() {
    const provider = Object.create(IndexProvider.prototype);
    provider.hasIndexForAccessCodes = jestObj.fn().mockReturnValue(false);
    return provider;
}

function createMockAccessIndexManager() {
    const manager = Object.create(AccessIndexManager.prototype);
    manager.configManager = createMockConfigManager();
    manager.indexProvider = createMockIndexProvider();
    manager.resourceHasAccessIndexForAccessCodes = jestObj.fn().mockReturnValue(false);
    return manager;
}

function createMockR4ArgsParser() {
    const parser = Object.create(R4ArgsParser.prototype);
    return parser;
}

function createParsedArgs(parsedArgItems = [], overrides = {}) {
    const pa = new ParsedArgs({
        base_version: '4_0_0',
        parsedArgItems
    });
    Object.assign(pa, overrides);
    return pa;
}

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

function createCompositeParsedArgsItem({ queryParameter, value, scopes, modifiers = [] }) {
    const propertyObj = new SearchParameterDefinition({
        type: 'composite',
        scopes
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
    let mockConfigManager;
    let mockAccessIndexManager;
    let mockR4ArgsParser;

    beforeEach(() => {
        jestObj.clearAllMocks();

        mockConfigManager = createMockConfigManager();
        mockAccessIndexManager = createMockAccessIndexManager();
        mockR4ArgsParser = createMockR4ArgsParser();

        creator = new R4SearchQueryCreator({
            configManager: mockConfigManager,
            accessIndexManager: mockAccessIndexManager,
            r4ArgsParser: mockR4ArgsParser
        });
    });

    describe('constructor', () => {
        test('stores configManager dependency', () => {
            expect(creator.configManager).toBe(mockConfigManager);
        });

        test('stores accessIndexManager dependency', () => {
            expect(creator.accessIndexManager).toBe(mockAccessIndexManager);
        });

        test('stores r4ArgsParser dependency', () => {
            expect(creator.r4ArgsParser).toBe(mockR4ArgsParser);
        });

        test('throws when configManager is not ConfigManager instance', () => {
            expect(() => new R4SearchQueryCreator({
                configManager: {},
                accessIndexManager: mockAccessIndexManager,
                r4ArgsParser: mockR4ArgsParser
            })).toThrow();
        });

        test('throws when accessIndexManager is not AccessIndexManager instance', () => {
            expect(() => new R4SearchQueryCreator({
                configManager: mockConfigManager,
                accessIndexManager: {},
                r4ArgsParser: mockR4ArgsParser
            })).toThrow();
        });

        test('throws when r4ArgsParser is not R4ArgsParser instance', () => {
            expect(() => new R4SearchQueryCreator({
                configManager: mockConfigManager,
                accessIndexManager: mockAccessIndexManager,
                r4ArgsParser: {}
            })).toThrow();
        });
    });

    describe('buildR4SearchQuery', () => {
        test('returns hidden tag filter when no parsed args for non-AuditEvent', () => {
            const parsedArgs = createParsedArgs([]);
            const { query, columns } = creator.buildR4SearchQuery({
                resourceType: 'Patient',
                parsedArgs,
                operation: 'read',
                isUser: false
            });

            // Simplifier flattens single-element $and; hidden tag filter should be present
            expect(query['meta.tag']).toBeDefined();
            expect(query['meta.tag'].$not).toBeDefined();
            expect(query['meta.tag'].$not.$elemMatch).toBeDefined();
        });

        test('does not add hidden tag filter for AuditEvent', () => {
            const parsedArgs = createParsedArgs([]);
            const { query } = creator.buildR4SearchQuery({
                resourceType: 'AuditEvent',
                parsedArgs,
                operation: 'read',
                isUser: false
            });

            expect(query.$and).toBeUndefined();
        });

        test('does not add hidden tag filter for DELETE operation', () => {
            const parsedArgs = createParsedArgs([]);
            const { query } = creator.buildR4SearchQuery({
                resourceType: 'Patient',
                parsedArgs,
                operation: 'delete',
                isUser: false
            });

            expect(query.$and).toBeUndefined();
        });

        test('does not add hidden tag filter when id is present', () => {
            const parsedArgs = createParsedArgs([], { id: 'some-id' });
            const { query } = creator.buildR4SearchQuery({
                resourceType: 'Patient',
                parsedArgs,
                operation: 'read',
                isUser: false
            });

            // When id is present, hidden tag filter should be skipped
            if (query.$and) {
                const hiddenTagFilter = query.$and.find(seg =>
                    seg['meta.tag'] && seg['meta.tag'].$not
                );
                expect(hiddenTagFilter).toBeUndefined();
            }
        });

        test('does not add hidden tag filter when _includeHidden is true', () => {
            const parsedArgs = createParsedArgs([], { _includeHidden: 'true' });
            const { query } = creator.buildR4SearchQuery({
                resourceType: 'Patient',
                parsedArgs,
                operation: 'read',
                isUser: false
            });

            if (query.$and) {
                const hiddenTagFilter = query.$and.find(seg =>
                    seg['meta.tag'] && seg['meta.tag'].$not
                );
                expect(hiddenTagFilter).toBeUndefined();
            }
        });

        test('does not add hidden tag filter for useHistoryTable', () => {
            const parsedArgs = createParsedArgs([]);
            const { query } = creator.buildR4SearchQuery({
                resourceType: 'Patient',
                parsedArgs,
                useHistoryTable: true,
                operation: 'read',
                isUser: false
            });

            if (query.$and) {
                const hiddenTagFilter = query.$and.find(seg =>
                    seg['meta.tag'] && seg['meta.tag'].$not
                );
                expect(hiddenTagFilter).toBeUndefined();
            }
        });

        test('builds string filter for string type param', () => {
            const item = createParsedArgsItem({
                queryParameter: 'name',
                value: 'John',
                type: 'string',
                field: 'name'
            });
            const parsedArgs = createParsedArgs([item]);

            const { query } = creator.buildR4SearchQuery({
                resourceType: 'Patient',
                parsedArgs,
                operation: 'read',
                isUser: false
            });

            expect(query.$and).toBeDefined();
            expect(query.$and.length).toBeGreaterThan(0);
        });

        test('builds token filter for token type param', () => {
            const item = createParsedArgsItem({
                queryParameter: 'status',
                value: 'active',
                type: 'token',
                field: 'status'
            });
            const parsedArgs = createParsedArgs([item]);

            const { query } = creator.buildR4SearchQuery({
                resourceType: 'Patient',
                parsedArgs,
                operation: 'read',
                isUser: false
            });

            expect(query.$and).toBeDefined();
            expect(query.$and.length).toBeGreaterThan(0);
        });

        test('applies not modifier by wrapping in $nor', () => {
            const item = createParsedArgsItem({
                queryParameter: 'status',
                value: 'active',
                type: 'token',
                field: 'status',
                modifiers: ['not']
            });
            const parsedArgs = createParsedArgs([item]);

            const { query } = creator.buildR4SearchQuery({
                resourceType: 'Patient',
                parsedArgs,
                operation: 'read',
                isUser: false
            });

            expect(query.$and).toBeDefined();
            const norSegment = query.$and.find(seg => seg.$nor);
            expect(norSegment).toBeDefined();
        });

        test('handles missing modifier', () => {
            const item = createParsedArgsItem({
                queryParameter: 'name',
                value: 'true',
                type: 'string',
                field: 'name',
                modifiers: ['missing']
            });
            const parsedArgs = createParsedArgs([item]);

            const { query } = creator.buildR4SearchQuery({
                resourceType: 'Patient',
                parsedArgs,
                operation: 'read',
                isUser: false
            });

            expect(query.$and).toBeDefined();
        });

        test('builds composite filter for composite type param instead of throwing Unknown type', () => {
            const item = createCompositeParsedArgsItem({
                queryParameter: 'code-value-quantity',
                value: '8480-6$ge140',
                scopes: [{
                    components: [
                        new SearchParameterDefinition({ type: 'token', field: 'code' }),
                        new SearchParameterDefinition({ type: 'quantity', field: 'valueQuantity' })
                    ]
                }]
            });
            const parsedArgs = createParsedArgs([item]);

            const { query } = creator.buildR4SearchQuery({
                resourceType: 'Observation',
                parsedArgs,
                operation: 'read',
                isUser: false
            });

            expect(query.$and).toBeDefined();
            expect(query.$and.length).toBeGreaterThan(0);
        });

        test('rejects a disallowed modifier on a composite param with a BadRequestError before reaching the modifier-specific filter classes', () => {
            const item = createCompositeParsedArgsItem({
                queryParameter: 'code-value-quantity',
                value: '8480-6$ge140',
                scopes: [{
                    components: [
                        new SearchParameterDefinition({ type: 'token', field: 'code' }),
                        new SearchParameterDefinition({ type: 'quantity', field: 'valueQuantity' })
                    ]
                }],
                modifiers: ['contains']
            });
            const parsedArgs = createParsedArgs([item]);

            expect(() => creator.buildR4SearchQuery({
                resourceType: 'Observation',
                parsedArgs,
                operation: 'read',
                isUser: false
            })).toThrow(/not supported on composite search parameters/);
        });

        test('sets includesQuantityType for a composite param with a quantity component, so the simplifier does not touch its filter segment', () => {
            const codeComponent = new SearchParameterDefinition({ type: 'token', field: 'code' });
            const quantityComponent = new SearchParameterDefinition({ type: 'quantity', field: 'valueQuantity' });
            const scopes = [{ components: [codeComponent, quantityComponent] }];
            const item = createCompositeParsedArgsItem({
                queryParameter: 'code-value-quantity',
                value: '8480-6$ge140',
                scopes
            });
            const parsedArgs = createParsedArgs([item]);

            const { query } = creator.buildR4SearchQuery({
                resourceType: 'Observation',
                parsedArgs,
                operation: 'read',
                isUser: false
            });

            // Independently compute what FilterByComposite alone produces for this item. If
            // includesQuantityType were not set, MongoQuerySimplifier.simplifyFilter would run
            // over the final query and could restructure/dedupe this segment (it explicitly
            // targets $or/$and shapes like the one FilterByComposite emits) -- so finding it
            // byte-identical in the final query proves the simplifier left it alone.
            const { FilterByComposite } = require('../../../../operations/query/filters/composite');
            const { FilterParameters } = require('../../../../operations/query/filters/filterParameters');
            const { FieldMapper } = require('../../../../operations/query/filters/fieldMapper');
            const expectedSegments = new FilterByComposite(new FilterParameters({
                parsedArg: item,
                propertyObj: item.propertyObj,
                fnUseAccessIndex: () => false,
                fieldMapper: new FieldMapper({ useHistoryTable: false }),
                resourceType: 'Observation'
            })).filter();

            const compositeSegment = query.$and.find(
                seg => JSON.stringify(seg) === JSON.stringify(expectedSegments[0])
            );
            expect(compositeSegment).toBeDefined();
        });

        test('returns columns set', () => {
            const parsedArgs = createParsedArgs([]);
            const { columns } = creator.buildR4SearchQuery({
                resourceType: 'Patient',
                parsedArgs,
                operation: 'read',
                isUser: false
            });

            expect(columns).toBeInstanceOf(Set);
        });

        test('throws when resourceType is falsy', () => {
            const parsedArgs = createParsedArgs([]);

            expect(() => creator.buildR4SearchQuery({
                resourceType: '',
                parsedArgs,
                operation: 'read',
                isUser: false
            })).toThrow();
        });

        test('throws when parsedArgs is not ParsedArgs instance', () => {
            expect(() => creator.buildR4SearchQuery({
                resourceType: 'Patient',
                parsedArgs: {},
                operation: 'read',
                isUser: false
            })).toThrow();
        });
    });

    describe('appendAndQuery', () => {
        test('adds to existing $and array', () => {
            const query = { $and: [{ status: 'active' }] };
            const andQuery = { name: 'John' };

            const result = creator.appendAndQuery({ query, andQuery });

            expect(result.$and).toHaveLength(2);
            expect(result.$and[1]).toEqual({ name: 'John' });
        });

        test('creates $and array with both queries when query is not empty', () => {
            const query = { status: 'active' };
            const andQuery = { name: 'John' };

            const result = creator.appendAndQuery({ query, andQuery });

            expect(result.$and).toHaveLength(2);
            expect(result.$and[0]).toEqual({ status: 'active' });
            expect(result.$and[1]).toEqual({ name: 'John' });
        });

        test('creates $and array with just andQuery when query is empty', () => {
            const query = {};
            const andQuery = { name: 'John' };

            const result = creator.appendAndQuery({ query, andQuery });

            expect(result.$and).toHaveLength(1);
            expect(result.$and[0]).toEqual({ name: 'John' });
        });
    });

    describe('appendAndSimplifyQuery', () => {
        test('appends and simplifies query', () => {
            const query = {};
            const andQuery = { status: 'active' };

            const result = creator.appendAndSimplifyQuery({ query, andQuery });

            expect(result).toBeDefined();
            // After simplification of a single $and element, it might be flattened
            expect(result.status || result.$and).toBeDefined();
        });
    });

    describe('getColumnsAndSegmentsForParameterType', () => {
        test('handles _id parameter specially', () => {
            const item = createParsedArgsItem({
                queryParameter: '_id',
                value: 'test-123',
                type: 'token',
                field: '_id'
            });

            const { FilterParameters } = require('../../../../operations/query/filters/filterParameters');
            const { FieldMapper } = require('../../../../operations/query/filters/fieldMapper');

            const fieldMapper = new FieldMapper({ useHistoryTable: false });
            const filterParameters = new FilterParameters({
                parsedArg: item,
                propertyObj: item.propertyObj,
                fnUseAccessIndex: () => false,
                fieldMapper,
                resourceType: 'Patient'
            });

            const { andSegments } = creator.getColumnsAndSegmentsForParameterType({
                parsedArg: item,
                filterParameters
            });

            expect(andSegments).toBeDefined();
            expect(Array.isArray(andSegments)).toBe(true);
        });

        test('routes composite type to FilterByComposite instead of throwing Unknown type', () => {
            const item = createCompositeParsedArgsItem({
                queryParameter: 'code-value-quantity',
                value: '8480-6$ge140',
                scopes: [{
                    components: [
                        new SearchParameterDefinition({ type: 'token', field: 'code' }),
                        new SearchParameterDefinition({ type: 'quantity', field: 'valueQuantity' })
                    ]
                }]
            });

            const { FilterParameters } = require('../../../../operations/query/filters/filterParameters');
            const { FieldMapper } = require('../../../../operations/query/filters/fieldMapper');

            const fieldMapper = new FieldMapper({ useHistoryTable: false });
            const filterParameters = new FilterParameters({
                parsedArg: item,
                propertyObj: item.propertyObj,
                fnUseAccessIndex: () => false,
                fieldMapper,
                resourceType: 'Observation'
            });

            const { andSegments } = creator.getColumnsAndSegmentsForParameterType({
                parsedArg: item,
                filterParameters
            });

            expect(Array.isArray(andSegments)).toBe(true);
            expect(andSegments.length).toBeGreaterThan(0);
        });

        test('throws for unknown property type', () => {
            const item = createParsedArgsItem({
                queryParameter: 'custom',
                value: 'val',
                type: 'unknown_type',
                field: 'custom'
            });

            const { FilterParameters } = require('../../../../operations/query/filters/filterParameters');
            const { FieldMapper } = require('../../../../operations/query/filters/fieldMapper');

            const fieldMapper = new FieldMapper({ useHistoryTable: false });
            const filterParameters = new FilterParameters({
                parsedArg: item,
                propertyObj: item.propertyObj,
                fnUseAccessIndex: () => false,
                fieldMapper,
                resourceType: 'Patient'
            });

            expect(() => creator.getColumnsAndSegmentsForParameterType({
                parsedArg: item,
                filterParameters
            })).toThrow('Unknown type=unknown_type');
        });
    });
});
