const { describe, test, expect } = require('@jest/globals');
const { FULL_TEXT_SEARCH_SUPPORTED_RESOURCE_TYPES } = require('../../constants');

describe('FULL_TEXT_SEARCH_SUPPORTED_RESOURCE_TYPES', () => {
    test('is exactly the three resource types fhir-notes-vector-store indexes', () => {
        expect(FULL_TEXT_SEARCH_SUPPORTED_RESOURCE_TYPES).toEqual(
            ['DocumentReference', 'DiagnosticReport', 'CarePlan']
        );
    });
});
