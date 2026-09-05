const { describe, test, expect, beforeEach, jest } = require('@jest/globals');
const { AtlasSearchQueryBuilder } = require('../../../../operations/search/atlasSearchQueryBuilder');
const { ConfigManager } = require('../../../../utils/configManager');
const { ParsedArgs } = require('../../../../operations/query/parsedArgs');
const { ParsedArgsItem } = require('../../../../operations/query/parsedArgsItem');
const { QueryParameterValue } = require('../../../../operations/query/queryParameterValue');
const { R4ArgsParser } = require('../../../../operations/query/r4ArgsParser');
const { FhirTypesManager } = require('../../../../fhir/fhirTypesManager');
const { SearchParametersManager } = require('../../../../searchParameters/searchParametersManager');

jest.mock('../../../../operations/common/logging', () => ({
    logError: jest.fn(),
    logInfo: jest.fn(),
    logWarn: jest.fn(),
    logDebug: jest.fn()
}));

function makeParsedArgs(items) {
    const parsedArgs = new ParsedArgs({ base_version: '4_0_0' });
    for (const { queryParameter, values, modifiers = [] } of items) {
        parsedArgs.add(new ParsedArgsItem({
            queryParameter,
            queryParameterValue: new QueryParameterValue({ value: values.join(',') }),
            propertyObj: undefined,
            modifiers,
            references: []
        }));
    }
    return parsedArgs;
}

describe('AtlasSearchQueryBuilder', () => {
    let configManager;
    let builder;

    beforeEach(() => {
        configManager = Object.create(ConfigManager.prototype);
        configManager.isAtlasSearchEnabled = () => true;
        builder = new AtlasSearchQueryBuilder({ configManager });
    });

    describe('getEligibleParsedArgItemsOrNull', () => {
        test('returns null when the resource type flag is disabled', () => {
            configManager.isAtlasSearchEnabled = () => false;
            const parsedArgs = makeParsedArgs([{ queryParameter: 'family', values: ['Smith'] }]);
            expect(builder.getEligibleParsedArgItemsOrNull({ resourceType: 'Patient', parsedArgs })).toBeNull();
        });

        test('returns null for a resource type Atlas does not cover', () => {
            const parsedArgs = makeParsedArgs([{ queryParameter: 'family', values: ['Smith'] }]);
            expect(builder.getEligibleParsedArgItemsOrNull({ resourceType: 'Observation', parsedArgs })).toBeNull();
        });

        test('returns the eligible items for a simple family+given query', () => {
            const parsedArgs = makeParsedArgs([
                { queryParameter: 'family', values: ['Smith'] },
                { queryParameter: 'given', values: ['John'] }
            ]);
            const result = builder.getEligibleParsedArgItemsOrNull({ resourceType: 'Patient', parsedArgs });
            expect(result).toHaveLength(2);
            expect(result.map(r => r.queryParameter).sort()).toEqual(['family', 'given']);
        });

        test('ignores harmless pagination/system params', () => {
            const parsedArgs = makeParsedArgs([
                { queryParameter: 'family', values: ['Smith'] },
                { queryParameter: '_count', values: ['10'] },
                { queryParameter: '_sort', values: ['family'] },
                { queryParameter: '_total', values: ['accurate'] }
            ]);
            const result = builder.getEligibleParsedArgItemsOrNull({ resourceType: 'Patient', parsedArgs });
            expect(result).toHaveLength(1);
            expect(result[0].queryParameter).toBe('family');
        });

        test('falls back (returns null) when _id is present', () => {
            const parsedArgs = makeParsedArgs([
                { queryParameter: 'family', values: ['Smith'] },
                { queryParameter: '_id', values: ['abc-123'] }
            ]);
            expect(builder.getEligibleParsedArgItemsOrNull({ resourceType: 'Patient', parsedArgs })).toBeNull();
        });

        test('falls back for bare name, address, and phonetic params', () => {
            for (const queryParameter of ['name', 'address', 'address-city', 'phonetic']) {
                const parsedArgs = makeParsedArgs([{ queryParameter, values: ['Smith'] }]);
                expect(builder.getEligibleParsedArgItemsOrNull({ resourceType: 'Patient', parsedArgs })).toBeNull();
            }
        });

        test('falls back when any eligible param has a modifier', () => {
            const parsedArgs = makeParsedArgs([
                { queryParameter: 'family', values: ['Smith'], modifiers: ['contains'] }
            ]);
            expect(builder.getEligibleParsedArgItemsOrNull({ resourceType: 'Patient', parsedArgs })).toBeNull();
        });

        test('falls back for identifier with a system component (system|value)', () => {
            const parsedArgs = makeParsedArgs([
                { queryParameter: 'identifier', values: ['http://hl7.org/fhir/sid/us-npi|1234567890'] }
            ]);
            expect(builder.getEligibleParsedArgItemsOrNull({ resourceType: 'Practitioner', parsedArgs })).toBeNull();
        });

        test('falls back for gender with a system component (system|value)', () => {
            const parsedArgs = makeParsedArgs([
                { queryParameter: 'gender', values: ['http://hl7.org/fhir/administrative-gender|male'] }
            ]);
            expect(builder.getEligibleParsedArgItemsOrNull({ resourceType: 'Patient', parsedArgs })).toBeNull();
        });

        test('allows a plain-value identifier', () => {
            const parsedArgs = makeParsedArgs([{ queryParameter: 'identifier', values: ['1234567890'] }]);
            const result = builder.getEligibleParsedArgItemsOrNull({ resourceType: 'Practitioner', parsedArgs });
            expect(result).toHaveLength(1);
        });

        test('falls back for a birthdate with a comparator prefix', () => {
            const parsedArgs = makeParsedArgs([{ queryParameter: 'birthdate', values: ['ge2020-01-01'] }]);
            expect(builder.getEligibleParsedArgItemsOrNull({ resourceType: 'Patient', parsedArgs })).toBeNull();
        });

        test('falls back for a partial-precision birthdate', () => {
            const parsedArgs = makeParsedArgs([{ queryParameter: 'birthdate', values: ['2020'] }]);
            expect(builder.getEligibleParsedArgItemsOrNull({ resourceType: 'Patient', parsedArgs })).toBeNull();
        });

        test('allows a full-precision exact birthdate', () => {
            const parsedArgs = makeParsedArgs([{ queryParameter: 'birthdate', values: ['2020-01-15'] }]);
            const result = builder.getEligibleParsedArgItemsOrNull({ resourceType: 'Patient', parsedArgs });
            expect(result).toHaveLength(1);
        });

        test('allows gender, telecom, email, phone', () => {
            const parsedArgs = makeParsedArgs([
                { queryParameter: 'gender', values: ['male'] },
                { queryParameter: 'telecom', values: ['555-1234'] },
                { queryParameter: 'email', values: ['a@b.com'] },
                { queryParameter: 'phone', values: ['555-1234'] }
            ]);
            const result = builder.getEligibleParsedArgItemsOrNull({ resourceType: 'Person', parsedArgs });
            expect(result).toHaveLength(4);
        });

        test('returns null when there are no eligible items at all', () => {
            const parsedArgs = makeParsedArgs([{ queryParameter: '_count', values: ['10'] }]);
            expect(builder.getEligibleParsedArgItemsOrNull({ resourceType: 'Patient', parsedArgs })).toBeNull();
        });

        test('falls back when a parameter matches an inherited Object.prototype property name', () => {
            const parsedArgs = makeParsedArgs([
                { queryParameter: 'family', values: ['Smith'] },
                { queryParameter: 'constructor', values: ['foo'] }
            ]);
            expect(builder.getEligibleParsedArgItemsOrNull({ resourceType: 'Patient', parsedArgs })).toBeNull();
        });

        test('does not disqualify on a hand-built base_version ParsedArgsItem (mirrors what R4ArgsParser.parseArgs actually pushes)', () => {
            // Regression test for the bug where base_version -- present on every real request --
            // was not in ATLAS_SEARCH_IGNORABLE_PARAMS, so getEligibleParsedArgItemsOrNull
            // returned null unconditionally in production despite every hand-built ParsedArgs
            // test helper (including makeParsedArgs above) never including it.
            const parsedArgs = makeParsedArgs([
                { queryParameter: 'family', values: ['Smith'] },
                { queryParameter: 'given', values: ['John'] },
                { queryParameter: 'base_version', values: ['4_0_0'] }
            ]);
            const result = builder.getEligibleParsedArgItemsOrNull({ resourceType: 'Patient', parsedArgs });
            expect(result).not.toBeNull();
            expect(result.map(r => r.queryParameter).sort()).toEqual(['family', 'given']);
            expect(result.some(r => r.queryParameter === 'base_version')).toBe(false);
        });

        test('does not disqualify on a hand-built version_id ParsedArgsItem (same normalization-exempt risk profile as base_version in r4ArgsParser.js)', () => {
            const parsedArgs = makeParsedArgs([
                { queryParameter: 'family', values: ['Smith'] },
                { queryParameter: 'version_id', values: ['1'] }
            ]);
            const result = builder.getEligibleParsedArgItemsOrNull({ resourceType: 'Patient', parsedArgs });
            expect(result).not.toBeNull();
            expect(result.map(r => r.queryParameter)).toEqual(['family']);
        });

        test('does not disqualify on base_version when parsed through the real R4ArgsParser.parseArgs path (not a hand-built ParsedArgs)', () => {
            // Traces the real bug through the actual parsing path rather than a hand-built
            // ParsedArgs, so this class of bug (a real parser output disqualifying every
            // request) cannot recur silently again.
            const mockFhirTypesManager = Object.create(FhirTypesManager.prototype);
            mockFhirTypesManager.getTypeForField = () => 'string';

            const mockConfigManagerForParser = Object.create(ConfigManager.prototype);
            Object.defineProperty(mockConfigManagerForParser, 'defaultSortId', { get: () => '_uuid', configurable: true });

            const mockSearchParametersManager = Object.create(SearchParametersManager.prototype);
            mockSearchParametersManager.getPropertyObject = () => null;
            mockSearchParametersManager.combinedSearchParameters = {};

            const r4ArgsParser = new R4ArgsParser({
                fhirTypesManager: mockFhirTypesManager,
                configManager: mockConfigManagerForParser,
                searchParametersManager: mockSearchParametersManager
            });

            const parsedArgs = r4ArgsParser.parseArgs({
                resourceType: 'Patient',
                args: { base_version: '4_0_0', family: 'Smith', given: 'John' }
            });

            // Confirms the parser really does push base_version as a real ParsedArgsItem (the
            // premise of the bug), before asserting the builder correctly ignores it.
            expect(parsedArgs.parsedArgItems.some(item => item.queryParameter === 'base_version')).toBe(true);

            const result = builder.getEligibleParsedArgItemsOrNull({ resourceType: 'Patient', parsedArgs });
            expect(result).not.toBeNull();
            expect(result.map(r => r.queryParameter).sort()).toEqual(['family', 'given']);
            expect(result.some(r => r.queryParameter === 'base_version')).toBe(false);
        });
    });

    describe('buildSearchQuery', () => {
        test('returns null when ineligible', () => {
            configManager.isAtlasSearchEnabled = () => false;
            const parsedArgs = makeParsedArgs([{ queryParameter: 'family', values: ['Smith'] }]);
            expect(builder.buildSearchQuery({ resourceType: 'Patient', parsedArgs })).toBeNull();
        });

        test('builds a required fuzzy clause for a single family value', () => {
            const parsedArgs = makeParsedArgs([{ queryParameter: 'family', values: ['Smith'] }]);
            const compound = builder.buildSearchQuery({ resourceType: 'Patient', parsedArgs });
            expect(compound).toEqual({
                must: [
                    {
                        compound: {
                            should: [
                                { autocomplete: { path: 'name.family', query: 'Smith', fuzzy: { maxEdits: 1, prefixLength: 2 } } },
                                { text: { path: 'name.family', query: 'Smith' } }
                            ],
                            minimumShouldMatch: 1
                        }
                    }
                ]
            });
        });

        test('AND-s across distinct parameters: family AND given each become their own must entry', () => {
            const parsedArgs = makeParsedArgs([
                { queryParameter: 'family', values: ['Smith'] },
                { queryParameter: 'given', values: ['John'] }
            ]);
            const compound = builder.buildSearchQuery({ resourceType: 'Patient', parsedArgs });
            expect(compound.must).toHaveLength(2);
            const familyClause = compound.must.find(
                m => m.compound.should[0].autocomplete.path === 'name.family'
            );
            const givenClause = compound.must.find(
                m => m.compound.should[0].autocomplete.path === 'name.given'
            );
            expect(familyClause.compound.should[0].autocomplete.query).toBe('Smith');
            expect(givenClause.compound.should[0].autocomplete.query).toBe('John');
        });

        test('OR-s repeated values of the SAME parameter inside a nested should', () => {
            const parsedArgs = makeParsedArgs([{ queryParameter: 'family', values: ['Smith', 'Jones'] }]);
            const compound = builder.buildSearchQuery({ resourceType: 'Patient', parsedArgs });
            expect(compound.must).toHaveLength(1);
            const outer = compound.must[0].compound;
            expect(outer.minimumShouldMatch).toBe(1);
            expect(outer.should).toHaveLength(2);
            expect(outer.should[0].compound.should[0].autocomplete.query).toBe('Smith');
            expect(outer.should[1].compound.should[0].autocomplete.query).toBe('Jones');
        });

        test('builds an exact equals clause for identifier/gender/birthdate', () => {
            const parsedArgs = makeParsedArgs([
                { queryParameter: 'identifier', values: ['1234567890'] },
                { queryParameter: 'gender', values: ['male'] },
                { queryParameter: 'birthdate', values: ['2020-01-15'] }
            ]);
            const compound = builder.buildSearchQuery({ resourceType: 'Practitioner', parsedArgs });
            expect(compound.must).toEqual(
                expect.arrayContaining([
                    { equals: { path: 'identifier.value', value: '1234567890' } },
                    { equals: { path: 'gender', value: 'male' } },
                    { equals: { path: 'birthDate', value: '2020-01-15' } }
                ])
            );
        });

        test('builds a system+value clause for email and phone', () => {
            const parsedArgs = makeParsedArgs([
                { queryParameter: 'email', values: ['a@b.com'] },
                { queryParameter: 'phone', values: ['555-1234'] }
            ]);
            const compound = builder.buildSearchQuery({ resourceType: 'Person', parsedArgs });
            expect(compound.must).toEqual(
                expect.arrayContaining([
                    {
                        compound: {
                            must: [
                                { equals: { path: 'telecom.system', value: 'email' } },
                                { text: { path: 'telecom.value', query: 'a@b.com' } }
                            ]
                        }
                    },
                    {
                        compound: {
                            must: [
                                { equals: { path: 'telecom.system', value: 'phone' } },
                                { text: { path: 'telecom.value', query: '555-1234' } }
                            ]
                        }
                    }
                ])
            );
        });

        test('builds a bare telecom clause (any system) for the telecom parameter', () => {
            const parsedArgs = makeParsedArgs([{ queryParameter: 'telecom', values: ['555-1234'] }]);
            const compound = builder.buildSearchQuery({ resourceType: 'Person', parsedArgs });
            expect(compound.must).toEqual([
                { text: { path: 'telecom.value', query: '555-1234' } }
            ]);
        });
    });
});
