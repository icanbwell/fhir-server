'use strict';

const { describe, test, expect } = require('@jest/globals');
const { genericFhirSearchTool, DEDICATED_RESOURCE_TYPES } = require('../../../mcp/genericFhirSearchTool');
const { TYPE_VALUE_SYNTAX_HINTS } = require('../../../mcp/typeValueSyntaxHints');

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

    test('filter value syntax cheat sheet is derived from the generated hints, not a hand-copied duplicate', () => {
        // Regression guard for drift between this tool's cheat sheet and
        // generatorScripts/mcp/generate_mcp_tools.py's TYPE_VALUE_SYNTAX_HINTS: every hint in the
        // generated module must appear verbatim in the description, so a future edit to one can't
        // silently stop matching the other.
        for (const hint of Object.values(TYPE_VALUE_SYNTAX_HINTS)) {
            expect(genericFhirSearchTool.description).toContain(hint);
        }
    });
});
