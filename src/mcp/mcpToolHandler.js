'use strict';

const httpContext = require('express-http-context');
const { assertTypeEquals } = require('../utils/assertType');
const { SearchBundleOperation } = require('../operations/search/searchBundle');
const { R4ArgsParser } = require('../operations/query/r4ArgsParser');
const { PatientDataViewControlManager } = require('../utils/patientDataViewController');
const { PatientScopeManager } = require('../operations/security/patientScopeManager');
const { QueryRewriterManager } = require('../queryRewriters/queryRewriterManager');
const { VERSIONS } = require('../middleware/fhir/utils/constants');
const { mcpToolsByResourceType } = require('./tools');
const { genericFhirSearchTool, DEDICATED_RESOURCE_TYPES } = require('./genericFhirSearchTool');
const { fhirBundleOutputSchema } = require('./fhirBundleOutputSchema');
const { MCP_REQUEST_INFO_CONTEXT_KEY, OPERATIONS: { READ } } = require('../constants');
const { ParsedArgsItem } = require('../operations/query/parsedArgsItem');
const { QueryParameterValue } = require('../operations/query/queryParameterValue');
const { searchParameterQueries } = require('../searchParameters/searchParameters');
const { logError } = require('../operations/common/logging');
const { convertErrorToOperationOutcome } = require('../utils/convertErrorToOperationOutcome');

class McpToolHandler {
    /**
     * @param {Object} params
     * @param {SearchBundleOperation} params.searchBundleOperation
     * @param {R4ArgsParser} params.r4ArgsParser
     * @param {PatientDataViewControlManager} params.patientDataViewControlManager
     * @param {PatientScopeManager} params.patientScopeManager
     * @param {QueryRewriterManager} params.queryRewriterManager
     */
    constructor ({
        searchBundleOperation,
        r4ArgsParser,
        patientDataViewControlManager,
        patientScopeManager,
        queryRewriterManager
    }) {
        this.searchBundleOperation = searchBundleOperation;
        assertTypeEquals(searchBundleOperation, SearchBundleOperation);
        this.r4ArgsParser = r4ArgsParser;
        assertTypeEquals(r4ArgsParser, R4ArgsParser);
        this.patientDataViewControlManager = patientDataViewControlManager;
        assertTypeEquals(patientDataViewControlManager, PatientDataViewControlManager);
        this.patientScopeManager = patientScopeManager;
        assertTypeEquals(patientScopeManager, PatientScopeManager);
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
            // (mirrors the getConsentAsync call a few lines down, which already hardcodes the same
            // constant for the same reason).
            let parsedArgs = this.r4ArgsParser.parseArgs({
                resourceType,
                args: { ...args, base_version: VERSIONS['4_0_0'] }
            });

            // Patient data-connection-view-control (consent-based) exclusion -- mirrors
            // src/graphqlv2/dataSource.js's getParsedArgsAsync. Deliberately re-fetched on every
            // call rather than cached on `this`: McpToolHandler is a singleton shared across every
            // request/tenant, unlike FhirDataSource which is constructed fresh per GraphQL request,
            // so caching this on instance state would leak one request's exclude-list into another.
            if (fhirRequestInfo.isUser) {
                const { isUser, personIdFromJwtToken } = fhirRequestInfo;
                // PatientDataViewControlManager.getConsentAsync reads the caller's person-owner out
                // of httpContext (`personOwnerFor-<personId>`) to decide whether their client is
                // enrolled in configManager.clientsWithDataConnectionViewControl. Nothing else on
                // the /mcp path ever populates that key, so without this priming call the
                // enrollment gate silently never fires and the Consent-exclusion query runs for
                // every patient-scoped caller regardless of enrollment. Mirrors
                // src/graphqlv2/dataSource.js's getParsedArgsAsync, which primes the same way right
                // before its own getConsentAsync call. Unlike dataSource.js this is not guarded by
                // a per-instance cache flag: McpToolHandler is a process-wide singleton, so any
                // instance state would leak across requests/tenants (the underlying
                // getLinkedPatientsAsync result is itself request-scoped-cached, so the repeat cost
                // within a request is nil).
                await this.patientScopeManager.getPatientIdsFromScopeAsync({
                    base_version: VERSIONS['4_0_0'],
                    isUser,
                    personIdFromJwtToken,
                    addPersonOwnerToContext: true,
                    // Apply the caller's access-tag security filter while traversing Person.link so
                    // a Person/Patient reachable only via a cross-tenant link on the caller's own
                    // Person is not silently included.
                    requestInfo: fhirRequestInfo
                });

                const { viewControlResourceToExcludeMap } = await this.patientDataViewControlManager.getConsentAsync({
                    requestInfo: fhirRequestInfo,
                    base_version: VERSIONS['4_0_0'],
                    raiseErrorForMissingUserOwner: false
                });
                let resourceExcludeIds = viewControlResourceToExcludeMap?.[resourceType] || [];
                // Merge with (rather than overwrite) any '_id:not' filter the caller already
                // supplied in their own args/filters, mirroring dataSource.js:819-825 -- otherwise
                // .add() below would replace the caller's own _id:not ParsedArgsItem outright.
                if (parsedArgs['_id:not']) {
                    const existingExcludeIds = Array.isArray(parsedArgs['_id:not'])
                        ? parsedArgs['_id:not']
                        : [parsedArgs['_id:not']];
                    resourceExcludeIds = [...resourceExcludeIds, ...existingExcludeIds];
                }
                if (resourceExcludeIds.length > 0) {
                    // The bracket assignment alone is not read by R4SearchQueryCreator (it only
                    // iterates parsedArgs.parsedArgItems), so it must be paired with .add(...) of a
                    // real ParsedArgsItem -- exactly what dataSource.js does at
                    // src/graphqlv2/dataSource.js:827-838 -- for the exclusion to actually reach the
                    // Mongo query. The bracket assignment is kept alongside it for parity with
                    // dataSource.js and because parsedArgs.getRawArgs()/other readers may check it.
                    parsedArgs['_id:not'] = resourceExcludeIds;
                    parsedArgs.add(
                        new ParsedArgsItem({
                            queryParameter: '_id',
                            queryParameterValue: new QueryParameterValue({
                                value: resourceExcludeIds,
                                // '$or', NOT '$and' (which src/graphqlv2/dataSource.js still uses --
                                // the same bug, out of scope here). FilterById.filterByItems
                                // (src/operations/query/filters/id.js) splits a mixed
                                // uuid/source-id list into two sub-filters
                                // ({_uuid: {$in: [...]}} and {id: {$in: [...]}}) and filter()
                                // combines them with `{[operator]: [...]}`. With '$and' a single
                                // document would have to match BOTH sub-filters at once --
                                // impossible when the two lists name different resources -- and
                                // since r4.js wraps this in $nor for the ':not' modifier,
                                // $nor: [always-false] is always true, so NOTHING gets excluded.
                                // A caller-supplied non-uuid '_id:not' value merged with uuid-form
                                // consent excludes would therefore neutralize the whole exclusion.
                                // '$or' gives the intended "exclude if the id matches in either
                                // form" semantics.
                                operator: '$or'
                            }),
                            propertyObj: searchParameterQueries['Resource']['_id'],
                            modifiers: ['not']
                        })
                    );
                }
            }

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
            const status = err.statusCode || 500;
            const operationOutcome = convertErrorToOperationOutcome({ error: err, internalError: status >= 500 });
            return { isError: true, content: [{ type: 'text', text: JSON.stringify(operationOutcome) }] };
        }
    }
}

module.exports = { McpToolHandler };
