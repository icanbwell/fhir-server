'use strict';

const { describe, test, expect } = require('@jest/globals');
const { genericFhirSearchTool, DEDICATED_RESOURCE_TYPES } = require('../../../mcp/genericFhirSearchTool');

describe('genericFhirSearchTool', () => {
    test('is named fhir_search', () => {
        expect(genericFhirSearchTool.name).toBe('fhir_search');
    });

    test('input schema requires resourceType and accepts optional filters', () => {
        const parsed = genericFhirSearchTool.inputSchema.parse({ resourceType: 'Coverage', filters: { status: 'active' } });
        expect(parsed).toEqual({ resourceType: 'Coverage', filters: { status: 'active' } });
    });

    test('input schema allows omitting filters', () => {
        const parsed = genericFhirSearchTool.inputSchema.parse({ resourceType: 'Coverage' });
        expect(parsed.resourceType).toBe('Coverage');
    });

    test('DEDICATED_RESOURCE_TYPES contains Patient', () => {
        expect(DEDICATED_RESOURCE_TYPES.has('Patient')).toBe(true);
    });

    test('DEDICATED_RESOURCE_TYPES does not contain Coverage-adjacent non-dedicated types like Practitioner-alike placeholders', () => {
        expect(DEDICATED_RESOURCE_TYPES.has('ThisResourceTypeDoesNotExist')).toBe(false);
    });
});
