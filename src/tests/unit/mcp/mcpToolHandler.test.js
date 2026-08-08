'use strict';

const { describe, test, afterEach, expect, jest: jestGlobal } = require('@jest/globals');
const httpContext = require('express-http-context');
const { McpToolHandler } = require('../../../mcp/mcpToolHandler');
const { SearchBundleOperation } = require('../../../operations/search/searchBundle');
const { R4ArgsParser } = require('../../../operations/query/r4ArgsParser');
const { PatientDataViewControlManager } = require('../../../utils/patientDataViewController');
const { MCP_REQUEST_INFO_CONTEXT_KEY } = require('../../../constants');
const { ParsedArgs } = require('../../../operations/query/parsedArgs');

function createPrototypedMock (RealClass) {
    return Object.create(RealClass.prototype);
}

function createHandler () {
    const searchBundleOperation = createPrototypedMock(SearchBundleOperation);
    searchBundleOperation.searchBundleAsync = jestGlobal.fn();
    const r4ArgsParser = createPrototypedMock(R4ArgsParser);
    r4ArgsParser.parseArgs = jestGlobal.fn().mockReturnValue({ parsedArgItems: [] });
    const patientDataViewControlManager = createPrototypedMock(PatientDataViewControlManager);
    patientDataViewControlManager.getConsentAsync = jestGlobal.fn().mockResolvedValue({
        viewControlResourceToExcludeMap: {}
    });
    const handler = new McpToolHandler({ searchBundleOperation, r4ArgsParser, patientDataViewControlManager });
    return { handler, searchBundleOperation, r4ArgsParser, patientDataViewControlManager };
}

describe('McpToolHandler', () => {
    afterEach(() => {
        jestGlobal.restoreAllMocks();
    });

    describe('handleSearchToolCall', () => {
        test('returns an error result when no request context is present', async () => {
            const { handler } = createHandler();
            jestGlobal.spyOn(httpContext, 'get').mockReturnValue(undefined);

            const result = await handler.handleSearchToolCall({ resourceType: 'Patient', args: { name: 'Smith' } });

            expect(result.isError).toBe(true);
            expect(result.content[0].text).toMatch(/authenticated request context/);
        });

        test('calls searchBundleAsync with parsed args and returns the bundle as JSON text', async () => {
            const { handler, searchBundleOperation, r4ArgsParser, patientDataViewControlManager } = createHandler();
            const fhirRequestInfo = { user: 'test-user', isUser: false };
            jestGlobal.spyOn(httpContext, 'get').mockImplementation(
                (key) => (key === MCP_REQUEST_INFO_CONTEXT_KEY ? fhirRequestInfo : undefined)
            );
            const bundle = { resourceType: 'Bundle', type: 'searchset', entry: [] };
            searchBundleOperation.searchBundleAsync.mockResolvedValue(bundle);

            const result = await handler.handleSearchToolCall({ resourceType: 'Patient', args: { name: 'Smith' } });

            expect(r4ArgsParser.parseArgs).toHaveBeenCalledWith({ resourceType: 'Patient', args: { name: 'Smith' } });
            expect(patientDataViewControlManager.getConsentAsync).not.toHaveBeenCalled();
            expect(searchBundleOperation.searchBundleAsync).toHaveBeenCalledWith(
                expect.objectContaining({ requestInfo: fhirRequestInfo, resourceType: 'Patient', useAggregationPipeline: false })
            );
            expect(result.content[0].text).toBe(JSON.stringify(bundle));
            expect(result.isError).toBeUndefined();
        });

        test('excludes patient-data-connection-view-control-hidden ids for a patient-scoped caller', async () => {
            const { handler, searchBundleOperation, r4ArgsParser, patientDataViewControlManager } = createHandler();
            const fhirRequestInfo = { user: 'test-patient-user', isUser: true };
            jestGlobal.spyOn(httpContext, 'get').mockImplementation(
                (key) => (key === MCP_REQUEST_INFO_CONTEXT_KEY ? fhirRequestInfo : undefined)
            );
            const parsedArgs = { parsedArgItems: [], add: jestGlobal.fn() };
            r4ArgsParser.parseArgs.mockReturnValue(parsedArgs);
            patientDataViewControlManager.getConsentAsync.mockResolvedValue({
                viewControlResourceToExcludeMap: { Observation: ['hidden-obs-1'] }
            });
            searchBundleOperation.searchBundleAsync.mockResolvedValue({ resourceType: 'Bundle', entry: [] });

            await handler.handleSearchToolCall({ resourceType: 'Observation', args: {} });

            expect(patientDataViewControlManager.getConsentAsync).toHaveBeenCalledWith(
                expect.objectContaining({ requestInfo: fhirRequestInfo })
            );
            expect(searchBundleOperation.searchBundleAsync).toHaveBeenCalledWith(
                expect.objectContaining({
                    parsedArgs: expect.objectContaining({ '_id:not': ['hidden-obs-1'] })
                })
            );
        });

        test('regression: the exclusion is functionally real, not just a cosmetic bracket property', async () => {
            // Setting parsedArgs['_id:not'] directly is not read by R4SearchQueryCreator
            // (src/operations/query/r4.js), which only iterates parsedArgs.parsedArgItems. Only
            // parsedArgs.add(...) actually registers a filterable ParsedArgsItem. This test uses a
            // real ParsedArgs instance (not the plain-object mock used above) and asserts on
            // parsedArgItems -- the same internal state buildR4SearchQuery reads -- so a regression
            // back to a bracket-only assignment would be caught here.
            const { handler, searchBundleOperation, r4ArgsParser, patientDataViewControlManager } = createHandler();
            const fhirRequestInfo = { user: 'test-patient-user', isUser: true };
            jestGlobal.spyOn(httpContext, 'get').mockImplementation(
                (key) => (key === MCP_REQUEST_INFO_CONTEXT_KEY ? fhirRequestInfo : undefined)
            );
            const parsedArgs = new ParsedArgs({ base_version: '4_0_0', parsedArgItems: [] });
            r4ArgsParser.parseArgs.mockReturnValue(parsedArgs);
            patientDataViewControlManager.getConsentAsync.mockResolvedValue({
                viewControlResourceToExcludeMap: { Observation: ['hidden-obs-1'] }
            });
            searchBundleOperation.searchBundleAsync.mockResolvedValue({ resourceType: 'Bundle', entry: [] });

            await handler.handleSearchToolCall({ resourceType: 'Observation', args: {} });

            const idNotItem = parsedArgs.parsedArgItems.find(
                (item) => item.queryParameter === '_id' && item.modifiers.includes('not')
            );
            expect(idNotItem).toBeDefined();
            expect(idNotItem.queryParameterValue.value).toEqual(['hidden-obs-1']);
        });

        test('returns an error result when searchBundleAsync throws', async () => {
            const { handler, searchBundleOperation } = createHandler();
            jestGlobal.spyOn(httpContext, 'get').mockReturnValue({ user: 'test-user' });
            searchBundleOperation.searchBundleAsync.mockRejectedValue(new Error('boom'));

            const result = await handler.handleSearchToolCall({ resourceType: 'Patient', args: {} });

            expect(result.isError).toBe(true);
            expect(result.content[0].text).toBe('boom');
        });
    });

    describe('handleGenericSearchToolCall', () => {
        test('rejects a resourceType that has a dedicated tool', async () => {
            const { handler } = createHandler();

            const result = await handler.handleGenericSearchToolCall({ resourceType: 'Patient', filters: {} });

            expect(result.isError).toBe(true);
            expect(result.content[0].text).toMatch(/search_patient/);
        });

        test('delegates to handleSearchToolCall for a non-dedicated resourceType', async () => {
            const { handler, searchBundleOperation } = createHandler();
            jestGlobal.spyOn(httpContext, 'get').mockReturnValue({ user: 'test-user' });
            searchBundleOperation.searchBundleAsync.mockResolvedValue({ resourceType: 'Bundle', entry: [] });

            // 'Location' has no dedicated search_<resource> tool (see the 14 dedicated
            // resourceTypes in src/mcp/tools/index.js / DEDICATED_RESOURCE_TYPES) -- unlike
            // 'Coverage', which is dedicated and would be rejected by handleGenericSearchToolCall.
            const result = await handler.handleGenericSearchToolCall({ resourceType: 'Location', filters: { status: 'active' } });

            expect(searchBundleOperation.searchBundleAsync).toHaveBeenCalledWith(
                expect.objectContaining({ resourceType: 'Location' })
            );
            expect(result.isError).toBeUndefined();
        });
    });

    describe('registerTools', () => {
        test('registers every dedicated tool plus the generic tool', () => {
            const { handler } = createHandler();
            const registerTool = jestGlobal.fn();
            const fakeServer = { registerTool };

            handler.registerTools(fakeServer);

            const registeredNames = registerTool.mock.calls.map((call) => call[0]);
            expect(registeredNames).toContain('search_patient');
            expect(registeredNames).toContain('fhir_search');
        });
    });
});
