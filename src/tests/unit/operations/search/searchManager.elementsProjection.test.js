'use strict';

const { describe, test, expect } = require('@jest/globals');
const { SearchManager } = require('../../../../operations/search/searchManager');

describe('SearchManager.handleElementsQuery view control projection', () => {
    const searchManager = Object.create(SearchManager.prototype);
    searchManager.base64DataManager = { resourcePaths: {} };

    const project = ({ resourceType, elements, viewControlExcludeMap }) => {
        const parsedArgs = {
            viewControlExcludeMap,
            get: () => ({ queryParameterValue: { values: elements } })
        };
        const { options } = searchManager.handleElementsQuery({
            parsedArgs, columns: new Set(), resourceType, options: {}, useAccessIndex: false
        });
        return options.projection;
    };

    test.each([
        ['a Composition with hidden ids', 'Composition', { CarePlan: ['care-plan-1'] }, true],
        ['a Composition with hidden ids of another type only', 'Composition', { Encounter: ['enc-1'] }, true],
        ['a Composition with no hidden ids', 'Composition', { CarePlan: [] }, false],
        ['a Composition with no exclude map', 'Composition', undefined, false],
        ['another resource type with hidden ids', 'Observation', { CarePlan: ['care-plan-1'] }, false]
    ])('reads section for %s only when the filter needs it', (_name, resourceType, viewControlExcludeMap, reads) => {
        const projection = project({ resourceType, elements: ['text'], viewControlExcludeMap });

        expect(projection.text).toBe(1);
        expect(projection.section === 1).toBe(reads);
    });
});
