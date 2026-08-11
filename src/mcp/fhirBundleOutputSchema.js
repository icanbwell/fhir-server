'use strict';

const { z } = require('zod/v4');

// Shared across every dedicated search_<resource> tool and the generic fhir_search tool: every one
// of them returns a FHIR search-set Bundle (src/operations/common/bundleManager.js's
// createRawBundleFromEntries), so unlike inputSchema (which is genuinely per-resource and generated
// by generatorScripts/mcp/generate_mcp_tools.py) there is nothing resource-specific to generate here.
// entry[].resource is left as a passthrough record rather than typed per-resourceType: FHIR resources
// are deeply nested with choice types ([x] elements) and backbone elements, and callers already get
// the concrete shape from the Bundle's own resourceType field plus the input tool's resourceType.
const fhirBundleOutputSchema = z.object({
    resourceType: z.literal('Bundle').describe("Always 'Bundle' for a FHIR search response."),
    type: z.string().describe("The bundle type, e.g. 'searchset'."),
    total: z.number().optional().describe('Total number of matching resources across all pages, when available.'),
    entry: z.array(
        z.object({
            fullUrl: z.string().optional().describe('The canonical URL of the resource.'),
            resource: z.record(z.string(), z.any()).describe("The matched FHIR resource, shaped per its own 'resourceType' field.")
        }).passthrough()
    ).nullable().optional().describe('The matched resources, one per entry. Null/absent when there are zero matches.'),
    link: z.array(
        z.object({
            relation: z.string().describe("e.g. 'self' or 'next'."),
            url: z.string()
        }).passthrough()
    ).nullable().optional().describe("Pagination links; a 'next' relation link is present when more pages are available.")
}).passthrough();

module.exports = { fhirBundleOutputSchema };
