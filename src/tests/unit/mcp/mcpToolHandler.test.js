'use strict';

const { describe, test, afterEach, expect, jest: jestGlobal } = require('@jest/globals');
const httpContext = require('express-http-context');
const { McpToolHandler } = require('../../../mcp/mcpToolHandler');
const { SearchBundleOperation } = require('../../../operations/search/searchBundle');
const { R4ArgsParser } = require('../../../operations/query/r4ArgsParser');
const { PatientDataViewControlManager } = require('../../../utils/patientDataViewController');
const { PatientScopeManager } = require('../../../operations/security/patientScopeManager');
const { QueryRewriterManager } = require('../../../queryRewriters/queryRewriterManager');
const { MCP_REQUEST_INFO_CONTEXT_KEY, OPERATIONS: { READ } } = require('../../../constants');
const { ParsedArgs } = require('../../../operations/query/parsedArgs');
const { ParsedArgsItem } = require('../../../operations/query/parsedArgsItem');
const { QueryParameterValue } = require('../../../operations/query/queryParameterValue');
const { searchParameterQueries } = require('../../../searchParameters/searchParameters');
const { FilterById } = require('../../../operations/query/filters/id');
const { FilterParameters } = require('../../../operations/query/filters/filterParameters');
const { FieldMapper } = require('../../../operations/query/filters/fieldMapper');
const { fhirBundleOutputSchema } = require('../../../mcp/fhirBundleOutputSchema');
const { RethrownError } = require('../../../utils/rethrownError');

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
    const patientScopeManager = createPrototypedMock(PatientScopeManager);
    patientScopeManager.getPatientIdsFromScopeAsync = jestGlobal.fn().mockResolvedValue([]);
    const queryRewriterManager = createPrototypedMock(QueryRewriterManager);
    // Default pass-through: the real manager returns the (possibly rewritten) ParsedArgs, and
    // handleSearchToolCall reassigns parsedArgs from the return value, so a mock that returned
    // undefined would break every other assertion in this file.
    queryRewriterManager.rewriteArgsAsync = jestGlobal.fn().mockImplementation(
        async ({ parsedArgs }) => parsedArgs
    );
    const handler = new McpToolHandler({
        searchBundleOperation,
        r4ArgsParser,
        patientDataViewControlManager,
        patientScopeManager,
        queryRewriterManager
    });
    return {
        handler,
        searchBundleOperation,
        r4ArgsParser,
        patientDataViewControlManager,
        patientScopeManager,
        queryRewriterManager
    };
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
            const {
                handler, searchBundleOperation, r4ArgsParser, patientDataViewControlManager, queryRewriterManager
            } = createHandler();
            const fhirRequestInfo = { user: 'test-user', isUser: false };
            jestGlobal.spyOn(httpContext, 'get').mockImplementation(
                (key) => (key === MCP_REQUEST_INFO_CONTEXT_KEY ? fhirRequestInfo : undefined)
            );
            const bundle = { resourceType: 'Bundle', type: 'searchset', entry: [] };
            searchBundleOperation.searchBundleAsync.mockResolvedValue(bundle);

            const result = await handler.handleSearchToolCall({ resourceType: 'Patient', args: { name: 'Smith' } });

            // base_version must be injected before parsing -- none of the generated tool schemas
            // expose it for callers to supply, and R4ArgsParser.parseArgs asserts it's present
            // (see the comment in handleSearchToolCall for the bug this was fixed to catch).
            expect(r4ArgsParser.parseArgs).toHaveBeenCalledWith({
                resourceType: 'Patient',
                args: { name: 'Smith', base_version: '4_0_0' }
            });
            expect(patientDataViewControlManager.getConsentAsync).not.toHaveBeenCalled();
            // Both REST (fhirOperationsManager.getParsedArgsAsync) and GraphQL v2
            // (dataSource.getParsedArgsAsync) run parsed args through the query rewriters before
            // searching; /mcp must too or ReferenceQueryRewriter/PatientProxyQueryRewriter never fire.
            expect(queryRewriterManager.rewriteArgsAsync).toHaveBeenCalledWith(
                expect.objectContaining({
                    base_version: '4_0_0',
                    resourceType: 'Patient',
                    operation: READ,
                    requestInfo: fhirRequestInfo
                })
            );
            expect(searchBundleOperation.searchBundleAsync).toHaveBeenCalledWith(
                expect.objectContaining({ requestInfo: fhirRequestInfo, resourceType: 'Patient', useAggregationPipeline: false })
            );
            expect(result.content[0].text).toBe(JSON.stringify(bundle));
            // The tool declares outputSchema (fhirBundleOutputSchema), so the SDK requires
            // structuredContent on every non-error result or tools/call throws a ProtocolError.
            expect(result.structuredContent).toBe(bundle);
            expect(result.isError).toBeUndefined();
        });

        test('excludes patient-data-connection-view-control-hidden ids for a patient-scoped caller', async () => {
            const {
                handler, searchBundleOperation, r4ArgsParser, patientDataViewControlManager, patientScopeManager
            } = createHandler();
            const fhirRequestInfo = {
                user: 'test-patient-user', isUser: true, personIdFromJwtToken: 'person-123'
            };
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

            // getConsentAsync decides whether the caller's client is enrolled in
            // configManager.clientsWithDataConnectionViewControl by reading
            // httpContext('personOwnerFor-<personId>'), which ONLY
            // personToPatientIdsExpander.getPatientIdsAsync({addPersonOwnerToContext: true}) ever
            // populates. Without this priming call first, that key is always undefined on /mcp and
            // the enrollment gate silently never fires (mirrors dataSource.js's own priming call).
            expect(patientScopeManager.getPatientIdsFromScopeAsync).toHaveBeenCalledWith({
                base_version: '4_0_0',
                isUser: true,
                personIdFromJwtToken: 'person-123',
                addPersonOwnerToContext: true,
                requestInfo: fhirRequestInfo
            });
            expect(patientScopeManager.getPatientIdsFromScopeAsync.mock.invocationCallOrder[0])
                .toBeLessThan(patientDataViewControlManager.getConsentAsync.mock.invocationCallOrder[0]);
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
            // r4.js:81 requires propertyObj to be truthy for the item to be used when building the
            // Mongo query -- confirm it's actually set, not just the value.
            expect(idNotItem.propertyObj).toBeDefined();
        });

        test('regression: a mixed uuid/non-uuid _id:not list still actually excludes (operator is $or, not $and)', async () => {
            // FilterById.filterByItems (src/operations/query/filters/id.js) splits a mixed list into
            // TWO sub-filters -- {_uuid: {$in: [uuids]}} and {id: {$in: [sourceIds]}} -- and
            // FilterById.filter() joins them with `{[queryParameterValue.operator]: [...]}`. With
            // '$and' that means "a single document matches BOTH", which no real document can, and
            // since r4.js wraps a ':not' item in $nor, `$nor: [always-false]` is always TRUE, so
            // nothing would be excluded at all. A caller-supplied non-uuid '_id:not' value (allowed
            // through by the tool schemas' .passthrough()) merged with uuid-form consent excludes is
            // exactly that mix -- a real PHI-exposure path. Asserting on the built Mongo filter
            // rather than just the operator string so the semantics, not the spelling, are pinned.
            const { handler, searchBundleOperation, r4ArgsParser, patientDataViewControlManager } = createHandler();
            const fhirRequestInfo = {
                user: 'test-patient-user', isUser: true, personIdFromJwtToken: 'person-123'
            };
            jestGlobal.spyOn(httpContext, 'get').mockImplementation(
                (key) => (key === MCP_REQUEST_INFO_CONTEXT_KEY ? fhirRequestInfo : undefined)
            );
            const consentHiddenUuid = '5f1e3b2a-1111-4c2b-9d3e-000000000001';
            const parsedArgs = new ParsedArgs({ base_version: '4_0_0', parsedArgItems: [] });
            // The caller's own '_id:not' filter, in NON-uuid (source-id) form.
            parsedArgs.add(
                new ParsedArgsItem({
                    queryParameter: '_id',
                    queryParameterValue: new QueryParameterValue({
                        value: 'caller-excluded-source-id', operator: '$or'
                    }),
                    propertyObj: searchParameterQueries.Resource._id,
                    modifiers: ['not']
                })
            );
            parsedArgs['_id:not'] = ['caller-excluded-source-id'];
            r4ArgsParser.parseArgs.mockReturnValue(parsedArgs);
            // The consent-derived exclude, in uuid form.
            patientDataViewControlManager.getConsentAsync.mockResolvedValue({
                viewControlResourceToExcludeMap: { Observation: [consentHiddenUuid] }
            });
            searchBundleOperation.searchBundleAsync.mockResolvedValue({ resourceType: 'Bundle', entry: [] });

            await handler.handleSearchToolCall({ resourceType: 'Observation', args: {} });

            const idNotItems = parsedArgs.parsedArgItems.filter(
                (item) => item.queryParameter === '_id' && item.modifiers.includes('not')
            );
            // .add() replaces the caller's item with the merged one rather than appending a second.
            expect(idNotItems).toHaveLength(1);
            const mergedItem = idNotItems[0];
            expect(mergedItem.queryParameterValue.values).toEqual(
                expect.arrayContaining([consentHiddenUuid, 'caller-excluded-source-id'])
            );
            expect(mergedItem.queryParameterValue.operator).toBe('$or');

            // Build the real Mongo filter this item produces and confirm the two sub-filters are
            // OR'd (satisfiable, so $nor actually excludes) rather than AND'd (unsatisfiable, so
            // $nor would be vacuously true and exclude nothing).
            const [builtFilter] = new FilterById(
                new FilterParameters({
                    propertyObj: searchParameterQueries.Resource._id,
                    parsedArg: mergedItem,
                    fieldMapper: new FieldMapper({ useHistoryTable: false }),
                    fnUseAccessIndex: () => false,
                    resourceType: 'Observation'
                })
            ).filter();
            const subFilterGroups = builtFilter.$or;
            expect(subFilterGroups).toHaveLength(1);
            expect(subFilterGroups[0].$and).toBeUndefined();
            expect(subFilterGroups[0].$or).toEqual(
                expect.arrayContaining([
                    { _uuid: { $in: [consentHiddenUuid] } },
                    // FieldMapper maps the 'id' field to the stored '_sourceId' column.
                    { _sourceId: { $in: ['caller-excluded-source-id'] } }
                ])
            );
        });

        test('returns an error result when searchBundleAsync throws, masking internal details', async () => {
            const { handler, searchBundleOperation } = createHandler();
            jestGlobal.spyOn(httpContext, 'get').mockReturnValue({ user: 'test-user' });
            // A plain Error (no .statusCode) is treated as an internal/unexpected failure (status
            // 500) by convertErrorToOperationOutcome, the same HIPAA/HITRUST-safe mapping
            // src/routeHandlers/handleError.js's handleServerError uses -- the raw message
            // ('boom', which could carry internal details like a Mongo query/collection name in a
            // real failure) must not reach the MCP client.
            searchBundleOperation.searchBundleAsync.mockRejectedValue(new Error('boom'));

            const result = await handler.handleSearchToolCall({ resourceType: 'Patient', args: {} });

            expect(result.isError).toBe(true);
            const operationOutcome = JSON.parse(result.content[0].text);
            expect(operationOutcome.issue[0].details.text).toBe('Internal Server Error');
            expect(result.content[0].text).not.toContain('boom');
        });

        test('surfaces a Mongo query-timeout (MaxTimeMSExpired) as FHIR IssueType "timeout", not generic "internal"', async () => {
            const { handler, searchBundleOperation } = createHandler();
            jestGlobal.spyOn(httpContext, 'get').mockReturnValue({ user: 'test-user' });
            // Mirrors the real wrapping chain (see DCON-5311): mongoStreamReader.js's
            // readCursorAsync wraps the raw Mongo error in a RethrownError, and searchManager.js
            // wraps that again with a query-shaped message. RethrownError.original_error resolves
            // through both layers to the innermost error, which is what isMongoTimeoutError checks.
            const rawMongoTimeout = new Error(
                'Executor error during find command: fhir.Patient_4_0_0 :: caused by :: operation exceeded time limit'
            );
            rawMongoTimeout.code = 50;
            rawMongoTimeout.codeName = 'MaxTimeMSExpired';
            const innerRethrown = new RethrownError({
                message: rawMongoTimeout.message,
                error: rawMongoTimeout,
                source: 'readAsync'
            });
            const outerRethrown = new RethrownError({
                message: 'Error reading resources for Patient with query: {"telecom.value":"redacted@example.com"}',
                error: innerRethrown
            });
            searchBundleOperation.searchBundleAsync.mockRejectedValue(outerRethrown);

            const result = await handler.handleSearchToolCall({ resourceType: 'Patient', args: {} });

            expect(result.isError).toBe(true);
            const operationOutcome = JSON.parse(result.content[0].text);
            expect(operationOutcome.issue[0].code).toBe('timeout');
            expect(operationOutcome.issue[0].details.text).toBe(
                'The search timed out. Try narrowing your search criteria.'
            );
            // Still must not leak the wrapped error's query/PHI-adjacent details.
            expect(result.content[0].text).not.toContain('redacted@example.com');
            expect(result.content[0].text).not.toContain('operation exceeded time limit');
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

        test('declares the shared FHIR Bundle outputSchema on every registered tool', () => {
            // Every tool returns a search-set Bundle (structuredContent, wired in
            // handleSearchToolCall), so every registerTool call must declare the same outputSchema
            // -- a tool that omits it would make the SDK drop any structuredContent it's given.
            const { handler } = createHandler();
            const registerTool = jestGlobal.fn();
            const fakeServer = { registerTool };

            handler.registerTools(fakeServer);

            for (const call of registerTool.mock.calls) {
                const [, config] = call;
                expect(config.outputSchema).toBe(fhirBundleOutputSchema);
            }
        });
    });
});

describe('McpToolHandler write-tool tripwire', () => {
    test('McpToolHandler exposes exactly its two known read-only handlers -- see plan note before adding a third', () => {
        // resource-authorization.md documents DelegatedAccessManager.verifyAccess (the operation-name
        // allowlist restricting delegated actors to search/searchById/everything/graph, rejecting any
        // write with a 403 before args are even parsed) as REST-specific -- it is not called anywhere
        // under src/mcp/. This is harmless today ONLY because every registered MCP tool resolves to
        // one of the two handlers below, both read-only (McpToolHandler.registerTools,
        // src/mcp/mcpToolHandler.js). If a third handler method appears here, it means a write-capable
        // MCP tool is being added, and per
        // docs/superpowers/plans/2026-08-14-mcp-resource-authorization-test-coverage.md's Task 9 note,
        // whoever adds it must also wire in an equivalent to DelegatedAccessManager.verifyAccess /
        // OperationAccessManager.verifyAccess before this assertion is updated -- not after.
        const handlerMethodNames = Object.getOwnPropertyNames(McpToolHandler.prototype)
            .filter((name) => name !== 'constructor' && name !== 'registerTools');
        expect(handlerMethodNames.sort()).toEqual(['handleGenericSearchToolCall', 'handleSearchToolCall']);
    });
});
