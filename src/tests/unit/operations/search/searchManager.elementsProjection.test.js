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

describe('SearchManager.handleElementsQuery base64 sidecar projection', () => {
    const searchManager = Object.create(SearchManager.prototype);
    searchManager.base64DataManager = {
        resourcePaths: {
            Binary: [{ dataPath: '/data', blobMetaPath: '/_blobMeta' }],
            DocumentReference: [
                {
                    dataPath: '/content/[]/attachment/data',
                    blobMetaPath: '/content/[]/attachment/_blobMeta'
                }
            ]
        }
    };

    const project = (resourceType, elements) => {
        const parsedArgs = {
            get: () => ({ queryParameterValue: { values: elements } })
        };
        const { options } = searchManager.handleElementsQuery({
            parsedArgs, columns: new Set(), resourceType, options: {}, useAccessIndex: false
        });
        return options.projection;
    };

    test('DocumentReference _elements=content projects content whole, without a nested _blobMeta path', () => {
        const projection = project('DocumentReference', ['content']);

        expect(projection.content).toBe(1);
        expect(projection['content.attachment._blobMeta']).toBeUndefined();
    });

    test('DocumentReference without content does not project _blobMeta', () => {
        const projection = project('DocumentReference', ['status']);

        expect(projection.status).toBe(1);
        expect(projection['content.attachment._blobMeta']).toBeUndefined();
    });

    test('Binary _elements=data still projects _blobMeta', () => {
        const projection = project('Binary', ['data']);

        expect(projection.data).toBe(1);
        expect(projection._blobMeta).toBe(1);
    });

    test('Binary without data does not project _blobMeta', () => {
        const projection = project('Binary', ['contentType']);

        expect(projection._blobMeta).toBeUndefined();
    });
});
