const { describe, test, expect, beforeEach } = require('@jest/globals');
const { AtlasSearchQueryBuilder } = require('../../../../operations/search/atlasSearchQueryBuilder');
const { ConfigManager } = require('../../../../utils/configManager');
const { ParsedArgs } = require('../../../../operations/query/parsedArgs');
const { ParsedArgsItem } = require('../../../../operations/query/parsedArgsItem');
const { QueryParameterValue } = require('../../../../operations/query/queryParameterValue');

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
    });
});
