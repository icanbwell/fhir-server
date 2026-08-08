'use strict';

const httpContext = require('express-http-context');
const { assertTypeEquals } = require('../utils/assertType');
const { SearchBundleOperation } = require('../operations/search/searchBundle');
const { R4ArgsParser } = require('../operations/query/r4ArgsParser');
const { PatientDataViewControlManager } = require('../utils/patientDataViewController');
const { VERSIONS } = require('../middleware/fhir/utils/constants');
const { mcpToolsByResourceType } = require('./tools');
const { genericFhirSearchTool, DEDICATED_RESOURCE_TYPES } = require('./genericFhirSearchTool');
const { MCP_REQUEST_INFO_CONTEXT_KEY } = require('../constants');
const { ParsedArgsItem } = require('../operations/query/parsedArgsItem');
const { QueryParameterValue } = require('../operations/query/queryParameterValue');
const { searchParameterQueries } = require('../searchParameters/searchParameters');

class McpToolHandler {
    /**
     * @param {Object} params
     * @param {SearchBundleOperation} params.searchBundleOperation
     * @param {R4ArgsParser} params.r4ArgsParser
     * @param {PatientDataViewControlManager} params.patientDataViewControlManager
     */
    constructor ({ searchBundleOperation, r4ArgsParser, patientDataViewControlManager }) {
        this.searchBundleOperation = searchBundleOperation;
        assertTypeEquals(searchBundleOperation, SearchBundleOperation);
        this.r4ArgsParser = r4ArgsParser;
        assertTypeEquals(r4ArgsParser, R4ArgsParser);
        this.patientDataViewControlManager = patientDataViewControlManager;
        assertTypeEquals(patientDataViewControlManager, PatientDataViewControlManager);
    }

    /**
     * Registers every dedicated resource tool plus the generic fhir_search tool.
     * @param {{registerTool: Function}} server an @modelcontextprotocol/server McpServer instance
     */
    registerTools (server) {
        for (const toolDef of Object.values(mcpToolsByResourceType)) {
            server.registerTool(
                toolDef.name,
                { description: toolDef.description, inputSchema: toolDef.inputSchema },
                (args) => this.handleSearchToolCall({ resourceType: toolDef.resourceType, args })
            );
        }
        server.registerTool(
            genericFhirSearchTool.name,
            { description: genericFhirSearchTool.description, inputSchema: genericFhirSearchTool.inputSchema },
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
            const parsedArgs = this.r4ArgsParser.parseArgs({ resourceType, args });

            // Patient data-connection-view-control (consent-based) exclusion -- mirrors
            // src/graphqlv2/dataSource.js's getParsedArgsAsync. Deliberately re-fetched on every
            // call rather than cached on `this`: McpToolHandler is a singleton shared across every
            // request/tenant, unlike FhirDataSource which is constructed fresh per GraphQL request,
            // so caching this on instance state would leak one request's exclude-list into another.
            if (fhirRequestInfo.isUser) {
                const { viewControlResourceToExcludeMap } = await this.patientDataViewControlManager.getConsentAsync({
                    requestInfo: fhirRequestInfo,
                    base_version: VERSIONS['4_0_0'],
                    raiseErrorForMissingUserOwner: false
                });
                const resourceExcludeIds = viewControlResourceToExcludeMap?.[resourceType] || [];
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
                            queryParameterValue: new QueryParameterValue({ value: resourceExcludeIds, operator: '$and' }),
                            propertyObj: searchParameterQueries['Resource']['_id'],
                            modifiers: ['not']
                        })
                    );
                }
            }

            const bundle = await this.searchBundleOperation.searchBundleAsync({
                requestInfo: fhirRequestInfo,
                parsedArgs,
                resourceType,
                useAggregationPipeline: false
            });
            return { content: [{ type: 'text', text: JSON.stringify(bundle) }] };
        } catch (err) {
            return { isError: true, content: [{ type: 'text', text: err.message || 'FHIR search failed.' }] };
        }
    }
}

module.exports = { McpToolHandler };
