'use strict';

const { describe, test, expect } = require('@jest/globals');
const { SearchManager } = require('../../../../operations/search/searchManager');

describe('SearchManager.handleElementsQuery view control projection', () => {
    const searchManager = Object.create(SearchManager.prototype);
    searchManager.base64DataManager = { externalizationPaths: {} };

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
        externalizationPaths: {
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

// The projection follows the paths data is read back on (externalizationPaths), not the paths that
// only protect a pointer (resourcePaths). Checked on Binary, whose top-level data projects its
// sidecar; DocumentReference projects `content` whole, so it never adds a nested _blobMeta path.
describe('SearchManager.handleElementsQuery base64 sidecar projection follows externalizationPaths', () => {
    const binaryPaths = [{ dataPath: '/data', blobMetaPath: '/_blobMeta' }];
    const project = (externalizationPaths) => {
        const searchManager = Object.create(SearchManager.prototype);
        searchManager.base64DataManager = {
            resourcePaths: { Binary: binaryPaths },
            externalizationPaths
        };
        const parsedArgs = {
            get: () => ({ queryParameterValue: { values: ['data'] } })
        };
        const { options } = searchManager.handleElementsQuery({
            parsedArgs, columns: new Set(), resourceType: 'Binary', options: {}, useAccessIndex: false
        });
        return options.projection;
    };

    test('a type in externalizationPaths projects its _blobMeta with the data', () => {
        const projection = project({ Binary: binaryPaths });

        expect(projection.data).toBe(1);
        expect(projection._blobMeta).toBe(1);
    });

    test('a type only in resourcePaths does not project _blobMeta, as nothing reads it back', () => {
        const projection = project({});

        expect(projection.data).toBe(1);
        expect(projection._blobMeta).toBeUndefined();
    });
});
