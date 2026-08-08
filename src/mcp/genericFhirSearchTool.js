'use strict';

const { z } = require('zod/v4');
const { mcpToolsByResourceType } = require('./tools');

const DEDICATED_RESOURCE_TYPES = new Set(Object.keys(mcpToolsByResourceType));

// Filter value syntax varies by the target search parameter's FHIR type, which this generic tool
// (unlike the dedicated per-resource tools) has no per-parameter schema to hang a type-specific hint
// off of -- so this cheat sheet is spelled out once, covering every type, instead of silently
// leaving callers to guess. Kept in sync by hand with generatorScripts/mcp/generate_mcp_tools.py's
// TYPE_VALUE_SYNTAX_HINTS (Task 2), which is the source of truth for the dedicated tools' per-field
// hints -- if that table changes, update this string too.
const FILTER_VALUE_SYNTAX_CHEAT_SHEET =
    'Value syntax by parameter type: date/dateTime/instant/period/number -- optionally prefix the ' +
    "value with a comparator (eq, ne, gt, lt, ge, le, sa, eb, ap), e.g. 'ge2020-01-01'. quantity -- " +
    "'[comparator]value|system|code', e.g. 'ge5.4|http://unitsofmeasure.org|mg'. token -- 'system|code' " +
    "or bare 'code'. reference -- 'ResourceType/id' or bare 'id'. string -- case-insensitive " +
    "starts-with by default. uri/canonical -- exact match. Comma-separate multiple values for the " +
    "same filter to OR them. Append ':modifier' to a filter key for: :missing, :not, :contains, " +
    ':exact, :above, :below, :text, :of-type.';

const genericFhirSearchTool = {
    name: 'fhir_search',
    description:
        'Search any FHIR resource type not covered by a dedicated search_<resource> tool ' +
        `(dedicated tools already exist for: ${[...DEDICATED_RESOURCE_TYPES].sort().join(', ')}). ` +
        "Provide the target 'resourceType' plus any FHIR search parameters as string values in " +
        `'filters'. ${FILTER_VALUE_SYNTAX_CHEAT_SHEET}`,
    inputSchema: z.object({
        resourceType: z.string().describe(
            'The FHIR resource type to search, e.g. "Practitioner" or "Coverage". Do not use this ' +
            'for a resource type that already has a dedicated search_<resource> tool.'
        ),
        filters: z.record(z.string(), z.string()).optional().describe(
            'Search parameter name/value pairs, e.g. { "identifier": "12345", "status": "active" }. ' +
            FILTER_VALUE_SYNTAX_CHEAT_SHEET
        )
    })
};

module.exports = { genericFhirSearchTool, DEDICATED_RESOURCE_TYPES };
