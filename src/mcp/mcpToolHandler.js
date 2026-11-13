'use strict';

const httpContext = require('express-http-context');
const { assertTypeEquals } = require('../utils/assertType');
const { SearchBundleOperation } = require('../operations/search/searchBundle');
const { R4ArgsParser } = require('../operations/query/r4ArgsParser');
const { PatientDataViewControlExclusion } = require('../utils/patientDataViewControlExclusion');
const { QueryRewriterManager } = require('../queryRewriters/queryRewriterManager');
const { VERSIONS } = require('../middleware/fhir/utils/constants');
const { mcpToolsByResourceType } = require('./tools');
const { genericFhirSearchTool, DEDICATED_RESOURCE_TYPES } = require('./genericFhirSearchTool');
const { fhirBundleOutputSchema } = require('./fhirBundleOutputSchema');
const { MCP_REQUEST_INFO_CONTEXT_KEY, OPERATIONS: { READ } } = require('../constants');
const { logError } = require('../operations/common/logging');
const { convertErrorToOperationOutcome } = require('../utils/convertErrorToOperationOutcome');
const { buildOperationOutcome } = require('../utils/operationOutcomeBuilder');

/**
 * Mongo server error code for "operation exceeded time limit" (MaxTimeMSExpired). Walks
 * RethrownError's `.original_error` (which resolves through any number of wrapping layers --
 * see src/utils/rethrownError.js -- to the innermost error) so a query timeout deep in
 * searchManager.js's pipeline() is still recognized here.
 * @param {Error} err
 * @returns {boolean}
 */
function isMongoTimeoutError (err) {
    return err?.original_error?.code === 50 || err?.code === 50;
}

class McpToolHandler {
    /**
     * @param {Object} params
     * @param {SearchBundleOperation} params.searchBundleOperation
     * @param {R4ArgsParser} params.r4ArgsParser
     * @param {PatientDataViewControlExclusion} params.patientDataViewControlExclusion
     * @param {QueryRewriterManager} params.queryRewriterManager
     */
    constructor ({
        searchBundleOperation,
        r4ArgsParser,
        patientDataViewControlExclusion,
        queryRewriterManager
    }) {
        this.searchBundleOperation = searchBundleOperation;
        assertTypeEquals(searchBundleOperation, SearchBundleOperation);
        this.r4ArgsParser = r4ArgsParser;
        assertTypeEquals(r4ArgsParser, R4ArgsParser);
        this.patientDataViewControlExclusion = patientDataViewControlExclusion;
        assertTypeEquals(patientDataViewControlExclusion, PatientDataViewControlExclusion);
        this.queryRewriterManager = queryRewriterManager;
        assertTypeEquals(queryRewriterManager, QueryRewriterManager);
    }

    /**
     * Registers every dedicated resource tool plus the generic fhir_search tool.
     * @param {{registerTool: Function}} server an @modelcontextprotocol/server McpServer instance
     */
    registerTools (server) {
        for (const toolDef of Object.values(mcpToolsByResourceType)) {
            server.registerTool(
                toolDef.name,
                { description: toolDef.description, inputSchema: toolDef.inputSchema, outputSchema: fhirBundleOutputSchema },
                (args) => this.handleSearchToolCall({ resourceType: toolDef.resourceType, args })
            );
        }
        server.registerTool(
            genericFhirSearchTool.name,
            {
                description: genericFhirSearchTool.description,
                inputSchema: genericFhirSearchTool.inputSchema,
                outputSchema: fhirBundleOutputSchema
            },
            ({ resourceType, filters }) => this.handleGenericSearchToolCall({ resourceType, filters: filters || {} })
        );
    }

    /**
     * @param {string} resourceType
     * @param {Object<string,string>} filters
     */
    async handleGenericSearchToolCall ({ resourceType, filters }) {
        if (DEDICATED_RESOURCE_TYPES.has(resourceType)) {
            return {
                isError: true,
                content: [{
                    type: 'text',
                    text: `Use the dedicated ${mcpToolsByResourceType[resourceType].name} tool for ${resourceType}, not fhir_search.`
                }]
            };
        }
        return this.handleSearchToolCall({ resourceType, args: filters });
    }

    /**
     * @param {string} resourceType
     * @param {Object<string,string>} args
     */
    async handleSearchToolCall ({ resourceType, args }) {
        const fhirRequestInfo = httpContext.get(MCP_REQUEST_INFO_CONTEXT_KEY);
        if (!fhirRequestInfo) {
            return {
                isError: true,
                content: [{ type: 'text', text: 'No authenticated request context found for this MCP call.' }]
            };
        }
        try {
            // Bug found by Task 10's integration tests: none of the generated tool schemas (Task 2/3)
            // expose a `base_version` field for MCP clients to supply -- there is no way for a caller
            // to ever provide one -- yet R4ArgsParser.parseArgs (via ParsedArgs's constructor,
            // src/operations/query/parsedArgs.js:12) asserts args.base_version is set, throwing for
            // every single /mcp search call otherwise. Every real invocation of this method 500'd
            // (masked to a generic OperationOutcome by the catch block below) until this was added.
            // VERSIONS['4_0_0'] is the only base_version this server's /mcp route ever runs under
            // (the view-control exclusion below uses the same constant for the same reason).
            let parsedArgs = this.r4ArgsParser.parseArgs({
                resourceType,
                args: { ...args, base_version: VERSIONS['4_0_0'] }
            });

            // Hide resources blocked by the caller's dataConnectionViewControl Consent (user tokens
            // of enrolled clients only), merged with any '_id:not' the caller supplied. The lookup
            // is the one every read path shares; it is kept in request-scoped httpContext, never on
            // this process-wide singleton, so one request's exclude list can't reach another.
            await this.patientDataViewControlExclusion.applyAsync({
                parsedArgs,
                resourceType,
                base_version: VERSIONS['4_0_0'],
                requestInfo: fhirRequestInfo
            });

            // See if any query rewriters want to rewrite the args -- the same call REST
            // (src/operations/fhirOperationsManager.js's getParsedArgsAsync) and GraphQL v2
            // (src/graphqlv2/dataSource.js's getParsedArgsAsync) both make after parsing and before
            // searching. Two registered rewriters depend on it (src/createContainer.js's
            // 'queryRewriterManager'): ReferenceQueryRewriter, which converts
            // `id|sourceAssigningAuthority`-form reference/_id values to their UUIDv5 form, and
            // PatientProxyQueryRewriter, which expands `Patient/person.<personId>` proxy-patient
            // references. Without this, /mcp searches using either convention silently matched zero
            // documents. Placed after the consent-exclusion block to match dataSource.js's ordering,
            // so the '_id:not' item the exclusion adds is itself run through the rewriters (its
            // '$or' operator is preserved by ReferenceQueryRewriter). Unlike dataSource.js, requestInfo
            // is passed through (as REST does) so PatientProxyQueryRewriter applies the caller's
            // access-tag filter when traversing Person.link.
            parsedArgs = await this.queryRewriterManager.rewriteArgsAsync({
                base_version: VERSIONS['4_0_0'],
                parsedArgs,
                resourceType,
                operation: READ,
                requestInfo: fhirRequestInfo
            });

            const bundle = await this.searchBundleOperation.searchBundleAsync({
                requestInfo: fhirRequestInfo,
                parsedArgs,
                resourceType,
                useAggregationPipeline: false
            });
            // structuredContent is required whenever a tool declares outputSchema (see
            // registerTools/fhirBundleOutputSchema) -- the SDK's tools/call handler throws a
            // ProtocolError if it's absent on a non-error result. content is kept alongside it for
            // MCP clients that only read unstructured text content.
            return { content: [{ type: 'text', text: JSON.stringify(bundle) }], structuredContent: bundle };
        } catch (err) {
            logError(
                `McpToolHandler.handleSearchToolCall: error searching resourceType=${resourceType}: ${err.message}`,
                { error: err }
            );
            // Mirrors src/routeHandlers/handleError.js's handleServerError so /mcp gives the same
            // HIPAA/HITRUST-safe error shape as REST/GraphQL: an error without a statusCode (an
            // unexpected/internal failure) is masked to a generic message with no stack trace or
            // internal details; a known error with a statusCode < 500 (e.g. ForbiddenError,
            // NotFoundError from src/utils/httpErrors.js) keeps its client-safe FHIR `.issue`.
            //
            // A Mongo query-timeout (code 50/MaxTimeMSExpired) carries no PHI or internal detail
            // worth masking -- unlike a raw stack trace, "the search timed out" is itself safe to
            // return -- so it gets its own FHIR IssueType('timeout') instead of being bucketed into
            // the generic 'internal' code. Without this, a caller (or an on-call engineer staring
            // at "Internal Server Error") has no way to tell a timeout apart from an actual server
            // fault short of trawling server-side logs (see DCON-5311).
            if (isMongoTimeoutError(err)) {
                const operationOutcome = buildOperationOutcome({
                    severity: 'error',
                    code: 'timeout',
                    details: { text: 'The search timed out. Try narrowing your search criteria.' }
                });
                return { isError: true, content: [{ type: 'text', text: JSON.stringify(operationOutcome) }] };
            }
            const status = err.statusCode || 500;
            const operationOutcome = convertErrorToOperationOutcome({ error: err, internalError: status >= 500 });
            return { isError: true, content: [{ type: 'text', text: JSON.stringify(operationOutcome) }] };
        }
    }
}

module.exports = { McpToolHandler };
