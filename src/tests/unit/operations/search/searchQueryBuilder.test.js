'use strict';

const { describe, test, expect, jest: jestObj } = require('@jest/globals');

jestObj.mock('../../../../utils/assertType', () => ({
    assertTypeEquals: jestObj.fn()
}));

jestObj.mock('../../../../middleware/fhir/utils/constants', () => ({
    VERSIONS: { '4_0_0': '4_0_0', '3_0_1': '3_0_1', '1_0_2': '1_0_2' }
}));

jestObj.mock('../../../../operations/query/stu3', () => ({
    buildStu3SearchQuery: jestObj.fn((args) => ({ stu3: true, ...args }))
}));

jestObj.mock('../../../../operations/query/dstu2', () => ({
    buildDstu2SearchQuery: jestObj.fn((args) => ({ dstu2: true, ...args }))
}));

jestObj.mock('../../../../operations/query/r4', () => ({
    R4SearchQueryCreator: class R4SearchQueryCreator {
        buildR4SearchQuery({ resourceType, parsedArgs }) {
            return { query: { r4: true, resourceType }, columns: new Set(['id']) };
        }
    }
}));

const { SearchQueryBuilder } = require('../../../../operations/search/searchQueryBuilder');
const { R4SearchQueryCreator } = require('../../../../operations/query/r4');

describe('SearchQueryBuilder', () => {
    let builder;

    test('constructor stores r4SearchQueryCreator', () => {
        builder = new SearchQueryBuilder({ r4SearchQueryCreator: new R4SearchQueryCreator() });
        expect(builder.r4SearchQueryCreator).toBeInstanceOf(R4SearchQueryCreator);
    });

    test('uses buildStu3SearchQuery for 3_0_1', () => {
        builder = new SearchQueryBuilder({ r4SearchQueryCreator: new R4SearchQueryCreator() });
        const { query } = builder.buildSearchQueryBasedOnVersion({
            base_version: '3_0_1',
            parsedArgs: { id: 'p1' },
            resourceType: 'Patient'
        });
        expect(query.stu3).toBe(true);
    });

    test('uses buildDstu2SearchQuery for 1_0_2', () => {
        builder = new SearchQueryBuilder({ r4SearchQueryCreator: new R4SearchQueryCreator() });
        const { query } = builder.buildSearchQueryBasedOnVersion({
            base_version: '1_0_2',
            parsedArgs: { id: 'p1' },
            resourceType: 'Patient'
        });
        expect(query.dstu2).toBe(true);
    });

    test('uses R4SearchQueryCreator for 4_0_0', () => {
        builder = new SearchQueryBuilder({ r4SearchQueryCreator: new R4SearchQueryCreator() });
        const { query, columns } = builder.buildSearchQueryBasedOnVersion({
            base_version: '4_0_0',
            parsedArgs: { name: 'Smith' },
            resourceType: 'Patient'
        });
        expect(query.r4).toBe(true);
        expect(query.resourceType).toBe('Patient');
        expect(columns).toBeInstanceOf(Set);
    });

    test('defaults to R4 for unknown version', () => {
        builder = new SearchQueryBuilder({ r4SearchQueryCreator: new R4SearchQueryCreator() });
        const { query } = builder.buildSearchQueryBasedOnVersion({
            base_version: '4_0_0',
            parsedArgs: {},
            resourceType: 'Observation'
        });
        expect(query.r4).toBe(true);
    });

    test('throws when r4SearchQueryCreator throws', () => {
        const badCreator = new R4SearchQueryCreator();
        badCreator.buildR4SearchQuery = () => { throw new Error('query build failed'); };
        builder = new SearchQueryBuilder({ r4SearchQueryCreator: badCreator });

        expect(() => builder.buildSearchQueryBasedOnVersion({
            base_version: '4_0_0',
            parsedArgs: {},
            resourceType: 'Patient'
        })).toThrow('query build failed');
    });
});
