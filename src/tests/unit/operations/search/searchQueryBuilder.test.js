'use strict';

const { describe, test, expect, jest: jestObj } = require('@jest/globals');

jestObj.mock('../../../../utils/assertType', () => ({
    assertTypeEquals: jestObj.fn()
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
