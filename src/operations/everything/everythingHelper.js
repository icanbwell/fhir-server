/**
 * This file contains functions to retrieve a graph of data from the database
 */
const async = require('async');
const { R4SearchQueryCreator } = require('../query/r4');
const env = require('var');
const { escapeRegExp } = require('../../utils/regexEscaper');
const { assertTypeEquals } = require('../../utils/assertType');
const { DatabaseQueryFactory } = require('../../dataLayer/databaseQueryFactory');
const { SecurityTagManager } = require('../common/securityTagManager');
const { ScopesManager } = require('../security/scopesManager');
const { ScopesValidator } = require('../security/scopesValidator');
const BundleEntry = require('../../fhir/classes/4_0_0/backbone_elements/bundleEntry');
const { ConfigManager } = require('../../utils/configManager');
const { BundleManager } = require('../common/bundleManager');
const { ResourceLocatorFactory } = require('../common/resourceLocatorFactory');
const { RethrownError } = require('../../utils/rethrownError');
const { SearchManager } = require('../search/searchManager');
const Bundle = require('../../fhir/classes/4_0_0/resources/bundle');
const BundleRequest = require('../../fhir/classes/4_0_0/backbone_elements/bundleRequest');
const { EnrichmentManager } = require('../../enrich/enrich');
const { R4ArgsParser } = require('../query/r4ArgsParser');
const { ParsedArgs } = require('../query/parsedArgs');
const { VERSIONS } = require('../../middleware/fhir/utils/constants');
const { ReferenceParser } = require('../../utils/referenceParser');
const { FhirResourceCreator } = require('../../fhir/fhirResourceCreator');
const GraphDefinition = require('../../fhir/classes/4_0_0/resources/graphDefinition');
const ResourceContainer = require('../../fhir/classes/4_0_0/simple_types/resourceContainer');
const { logError, logDebug } = require('../common/logging');
const { sliceIntoChunks, sliceIntoChunksGenerator } = require('../../utils/list.util');
const { ResourceIdentifier } = require('../../fhir/resourceIdentifier');
const { DatabaseAttachmentManager } = require('../../dataLayer/databaseAttachmentManager');
const {
    GRIDFS: { RETRIEVE },
    OPERATIONS: { READ },
    SUBSCRIPTION_RESOURCES_REFERENCE_FIELDS,
    SUBSCRIPTION_RESOURCES_REFERENCE_KEY_MAP,
    PATIENT_REFERENCE_PREFIX,
    PERSON_REFERENCE_PREFIX,
    SUBSCRIPTION_RESOURCES_REFERENCE_SYSTEM,
    PERSON_PROXY_PREFIX
} = require('../../constants');
const { isValidResource } = require('../../utils/validResourceCheck');
const { SearchParametersManager } = require('../../searchParameters/searchParametersManager');
const { NestedPropertyReader } = require('../../utils/nestedPropertyReader');
const Resource = require('../../fhir/classes/4_0_0/resources/resource');
const nonClinicalDataFields = require('../../graphs/patient/generated.non_clinical_resources_fields.json');
const { SearchBundleOperation } = require('../search/searchBundle');
const { DatabasePartitionedCursor } = require('../../dataLayer/databasePartitionedCursor');
const { EverythingRelatedResourcesMapper } = require('./everythingRelatedResourcesMapper');
const { ProcessMultipleIdsAsyncResult } = require('../common/processMultipleIdsAsyncResult');
const { QueryItem } = require('../graph/queryItem');
const clinicalResources = require('../../graphs/patient/generated.clinical_resources.json')['clinicalResources'];

/**
 * @typedef {import('./everythingRelatedResourcesMapper').EverythingRelatedResources} EverythingRelatedResources
 * @typedef {import('../query/parsedArgsItem').ParsedArgsItem}  ParsedArgsItem
 */

/**
 * This class helps with creating graph responses
 */
class EverythingHelper {
    /**
     * @param {DatabaseQueryFactory} databaseQueryFactory
     * @param {SecurityTagManager} securityTagManager
     * @param {ScopesManager} scopesManager
     * @param {ScopesValidator} scopesValidator
     * @param {ConfigManager} configManager
     * @param {BundleManager} bundleManager
     * @param {ResourceLocatorFactory} resourceLocatorFactory
     * @param {R4SearchQueryCreator} r4SearchQueryCreator
     * @param {SearchManager} searchManager
     * @param {EnrichmentManager} enrichmentManager
     * @param {R4ArgsParser} r4ArgsParser
     * @param {DatabaseAttachmentManager} databaseAttachmentManager
     * @param {SearchParametersManager} searchParametersManager
     * @param {SearchBundleOperation} searchParametersOperation
     */
    constructor({
        databaseQueryFactory,
        securityTagManager,
        scopesManager,
        scopesValidator,
        configManager,
        bundleManager,
        resourceLocatorFactory,
        r4SearchQueryCreator,
        searchManager,
        enrichmentManager,
        r4ArgsParser,
        databaseAttachmentManager,
        searchParametersManager,
        searchBundleOperation,
        everythingRelatedResourceMapper
    }) {
        /**
         * @type {DatabaseQueryFactory}
         */
        this.databaseQueryFactory = databaseQueryFactory;
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);
        /**
         * @type {SecurityTagManager}
         */
        this.securityTagManager = securityTagManager;
        assertTypeEquals(securityTagManager, SecurityTagManager);

        /**
         * @type {ScopesManager}
         */
        this.scopesManager = scopesManager;
        assertTypeEquals(scopesManager, ScopesManager);
        /**
         * @type {ScopesValidator}
         */
        this.scopesValidator = scopesValidator;
        assertTypeEquals(scopesValidator, ScopesValidator);

        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);

        /**
         * @type {BundleManager}
         */
        this.bundleManager = bundleManager;
        assertTypeEquals(bundleManager, BundleManager);

        /**
         * @type {ResourceLocatorFactory}
         */
        this.resourceLocatorFactory = resourceLocatorFactory;
        assertTypeEquals(resourceLocatorFactory, ResourceLocatorFactory);

        /**
         * @type {R4SearchQueryCreator}
         */
        this.r4SearchQueryCreator = r4SearchQueryCreator;
        assertTypeEquals(r4SearchQueryCreator, R4SearchQueryCreator);
        /**
         * @type {SearchManager}
         */
        this.searchManager = searchManager;
        assertTypeEquals(searchManager, SearchManager);

        /**
         * @type {EnrichmentManager}
         */
        this.enrichmentManager = enrichmentManager;
        assertTypeEquals(enrichmentManager, EnrichmentManager);

        /**
         * @type {R4ArgsParser}
         */
        this.r4ArgsParser = r4ArgsParser;
        assertTypeEquals(r4ArgsParser, R4ArgsParser);

        /**
         * @type {DatabaseAttachmentManager}
         */
        this.databaseAttachmentManager = databaseAttachmentManager;
        assertTypeEquals(databaseAttachmentManager, DatabaseAttachmentManager);

        /**
         * @type {SearchParametersManager}
         */
        this.searchParametersManager = searchParametersManager;
        assertTypeEquals(searchParametersManager, SearchParametersManager);

        /**
         * @type {SearchBundleOperation}
         */
        this.searchBundleOperation = searchBundleOperation;
        assertTypeEquals(searchBundleOperation, SearchBundleOperation);

        /**
         * @type {EverythingRelatedResourcesMapper}
         */
        this.everythingRelatedResourceMapper = everythingRelatedResourceMapper;
        assertTypeEquals(everythingRelatedResourceMapper, EverythingRelatedResourcesMapper);

        /**
         * @type {string[]}
         */
        this.supportedResources = ["Patient"];
    }

    /**
     *
    * @param {FhirRequestInfo} requestInfo
     * @param {string} resourceType
     * @param {string} base_version
     * @param {BaseResponseStreamer|undefined} [responseStreamer]
     * @param {ParsedArgs} parsedArgs
     * @param {boolean} supportLegacyId
     * @param {boolean} includeNonClinicalResources
     * @param {number} nonClinicalResourcesDepth
     * @param {boolean} getRaw
     * @param {boolean} useSerializerForRawResources
     * @return {Promise<Bundle>}
     */
    async retriveEverythingAsync({
        requestInfo,
        base_version,
        resourceType,
        responseStreamer,
        parsedArgs,
        supportLegacyId = true,
        includeNonClinicalResources = false,
        nonClinicalResourcesDepth = 1,
        getRaw = false,
        useSerializerForRawResources = false
    }) {
        if (!this.supportedResources.includes(resourceType)) {
            throw new Error('$everything is not supported for resource: ' + resourceType);
        }

        assertTypeEquals(parsedArgs, ParsedArgs);

        try {
            /**
             * @type {number}
             */
            const startTime = Date.now();
            /**
             * @type {ParsedArgsItem}
             */
            const idParsedArg = parsedArgs.get('id') || parsedArgs.get('_id');
            /**
                 * @type {string[]|null}
                 */
            const ids = idParsedArg.queryParameterValue.values;
            /**
             * @type {Generator<string[], void, unknown>}
             */
            const idChunks = ids ? sliceIntoChunksGenerator(ids, this.configManager.everythingBatchSize) : [];

            /**
                 * @type {BundleEntry[]}
                 */
            let entries = [];
            /**
             * @type {QueryItem[]}
             */
            let queryItems = [];
            /**
             * @type {import('mongodb').FindOptions<import('mongodb').DefaultSchema>[]}
             */
            let options = [];
            /**
             * @type {import('mongodb').Document[]}
             */
            let explanations = [];

            for (const idChunk of idChunks) {
                const parsedArgsForChunk = parsedArgs.clone();
                parsedArgsForChunk.id = idChunk;
                parsedArgsForChunk.resourceFilterList = parsedArgs.resourceFilterList;
                /**
                     * @type {string[]}
                     */
                let proxyPatientIds = []
                if (resourceType === 'Patient') {
                    proxyPatientIds = idChunk.filter((q) => q && q.startsWith(PERSON_PROXY_PREFIX));
                }

                /**
                     * @type {ProcessMultipleIdsAsyncResult}
                     */
                const {
                    entries: entries1,
                    queryItems: queryItems1,
                    options: options1,
                    explanations: explanations1
                } = await this.retrieveEverythingMulipleIdsAsync(
                    {
                        base_version,
                        requestInfo,
                        resourceType,
                        explain: !!parsedArgs._explain,
                        debug: !!parsedArgs._debug,
                        parsedArgs: parsedArgsForChunk,
                        responseStreamer,
                        supportLegacyId,
                        includeNonClinicalResources,
                        nonClinicalResourcesDepth,
                        proxyPatientIds,
                        getRaw,
                        useSerializerForRawResources
                    }
                );

                entries = entries.concat(entries1);
                queryItems = queryItems.concat(queryItems1);
                options = options.concat(options1);
                explanations = explanations.concat(explanations1);
            }

            /**
             * @type {number}
             */
            const stopTime = Date.now();

            /**
             * @type {Resource[]}
             */
            const resources = entries.map(bundleEntry => bundleEntry.resource);

            /**
             * @type {Bundle}
             */
            const bundle = this.bundleManager.createBundle(
                {
                    type: 'searchset',
                    requestId: requestInfo.userRequestId,
                    originalUrl: requestInfo.originalUrl,
                    host: requestInfo.host,
                    protocol: requestInfo.protocol,
                    resources,
                    base_version,
                    parsedArgs,
                    originalQuery: queryItems,
                    originalOptions: options,
                    columns: new Set(),
                    stopTime,
                    startTime,
                    user: requestInfo.user,
                    explanations
                }
            );
            if (responseStreamer) {
                responseStreamer.setBundle({ bundle });
            }
            return bundle;
        } catch (error) {
            logError(`Error in retriveEverythingAsync(): ${error.message}`, { error });
            throw new RethrownError({
                message: 'Error in retriveEverythingAsync(): ' + `resourceType: ${resourceType} , ` + error.message,
                error,
                args: {
                    requestInfo,
                    base_version,
                    resourceType,
                    parsedArgs,
                    responseStreamer
                }
            });
        }
    }

    /**
     * processing multiple ids
     * @param {string} base_version
     * @param {FhirRequestInfo} requestInfo
     * @param {string} resourceType
     * @param {boolean} [explain]
     * @param {boolean} [debug]
     * @param {ParsedArgs} parsedArgs
     * @param {BaseResponseStreamer|undefined} [responseStreamer]
     * @param {boolean} supportLegacyId
     * @param {boolean} includeNonClinicalResources
     * @param {number} nonClinicalResourcesDepth
     * @param {string[]} proxyPatientIds
     * @param {boolean} getRaw
     * @param {boolean} useSerializerForRawResources
     * @return {Promise<ProcessMultipleIdsAsyncResult>}
     */
    async retrieveEverythingMulipleIdsAsync({
        base_version,
        requestInfo,
        resourceType,
        explain,
        debug,
        parsedArgs,
        responseStreamer,
        supportLegacyId = true,
        includeNonClinicalResources = false,
        nonClinicalResourcesDepth = 1,
        proxyPatientIds = [],
        getRaw = false,
        useSerializerForRawResources = false
    }) {
        assertTypeEquals(parsedArgs, ParsedArgs);
        try {
            /**
            * @type {BundleEntry[]}
            */
            let entries = [];
            /**
             * @type {string[]|null}
             */
            const specificReltedResourceType = parsedArgs.resourceFilterList;
            const realtedResourcesMap = this.everythingRelatedResourceMapper.relatedResources(resourceType, specificReltedResourceType);
            /**
             * @type {Generator<import('./everythingRelatedResourcesMapper').EverythingRelatedResources[],void, unknown>}
             */
            const relatedResourceMapChunks = sliceIntoChunksGenerator(realtedResourcesMap, this.configManager.everythingRealtedResourceBatchSize)

            // so any POSTed data is not read as parameters
            parsedArgs.remove('resource');

            // get top level resource
            const {
                /** @type {import('mongodb').Document}**/
                query
            } = await this.searchManager.constructQueryAsync({
                user: requestInfo.user,
                scope: requestInfo.scope,
                isUser: requestInfo.isUser,
                resourceType,
                useAccessIndex: this.configManager.useAccessIndex,
                personIdFromJwtToken: requestInfo.personIdFromJwtToken,
                requestId: requestInfo.requestId,
                parsedArgs,
                operation: READ,
                accessRequested: (requestInfo.method.toLowerCase() === 'delete' ? 'write' : 'read')
            });

            /**
            * @type {QueryItem[]}
            */
            const queries = [];

            /**
            * @type {import('mongodb').FindOptions<import('mongodb').DefaultSchema>}
            */
            const options = {};
            const projection = {};
            // also exclude _id so if there is a covering index the query can be satisfied from the covering index
            projection._id = 0;
            options.projection = projection;

            /**
             * @type {number}
             */
            const maxMongoTimeMS = this.configManager.mongoTimeout;
            /**
             * @type {import('mongodb').FindOptions<import('mongodb').DefaultSchema>[]}
             */
            const optionsForQueries = [];

            const databaseQueryManager = this.databaseQueryFactory.createQuery({ resourceType, base_version });
            /**
             * mongo db cursor
             * @type {DatabasePartitionedCursor}
             */
            let cursor = await databaseQueryManager.findAsync({ query, options });
            cursor = cursor.maxTimeMS({ milliSecs: maxMongoTimeMS });

            const collectionName = cursor.getFirstCollection();
            queries.push(
                new QueryItem({
                    query,
                    resourceType,
                    collectionName
                }
                )
            );
            optionsForQueries.push(options);
            /**
             * @type {import('mongodb').Document[]}
             */
            const explanations = explain || debug ? await cursor.explainAsync() : [];
            if (explain) {
                // if explain is requested then just return one result
                cursor = cursor.limit(1);
            }

            const { bundleEntries } = await this.processCursorAsync({
                cursor,
                getRaw,
                parsedArgs,
                responseStreamer,
                useSerializerForRawResources
            })

            entries.push(...(bundleEntries || []));

            // Fetch related resources
            /**
             * @type {import('mongodb').Document[]}
             */
            for (const relatedResourceMapChunk of relatedResourceMapChunks) {
                let { entities: realtedEntitites, queryItems } = await this.retriveveRelatedResourcesParallelyAsync(
                    {
                        requestInfo,
                        base_version,
                        parentResourceType: resourceType,
                        relatedResources: relatedResourceMapChunk,
                        explain,
                        debug,
                        parsedArgs,
                        responseStreamer,
                        supportLegacyId,
                        proxyPatientIds,
                        getRaw,
                        useSerializerForRawResources
                    }
                )

                if (!responseStreamer) {
                    entries.push(...(realtedEntitites || []))
                }

                for (const q of queryItems) {
                    if (q) {
                        queries.push(q);
                    }

                    if (q?.explanations) {
                        for (const e of q.explanations) {
                            explanations.push(e);
                        }
                    }
                }
            }

            if (responseStreamer) {
                entries = [];
            } else {
                bundleEntriesForTopLevelResource = await this.enrichmentManager.enrichBundleEntriesAsync(
                    {
                        entries: bundleEntriesForTopLevelResource,
                        parsedArgs,
                        rawResources: getRaw
                    }
                );
            }

            // TODO: fetch non-clicincal resources
            return new ProcessMultipleIdsAsyncResult({
                entries,
                queryItems: queries,
                options: optionsForQueries,
                explanations
            })
        } catch (e) {
            logError(`Error in retrieveEverythingMulipleIdsAsync(): ${e.message}`, { error: e });
            throw new RethrownError({
                message: 'Error in retrieveEverythingMulipleIdsAsync(): ' + `resourceType: ${resourceType} , `,
                error: e,
                args: {
                    base_version,
                    requestInfo,
                    resourceType,
                    explain,
                    debug,
                    parsedArgs
                }
            });
        }
    }

    /**
    * Gets related resources and adds them to containedEntries in parentEntities
    * @param {FhirRequestInfo} requestInfo
    * @param {string} base_version
    * @param {string} parentResourceType
    * @param {EverythingRelatedResources} relatedResources
    * @param {boolean} [explain]
    * @param {boolean} [debug]
    * @param {ParsedArgs} parsedArgs
    * @param {responseStreamer} responseStreamer
    * @param {ResourceIdentifier[]} idsAlreayProcessed
    * @param {boolean} supportLegacyId
    * @param {string[]} proxyPatientIds
    * @param {boolean} getRaw
    * @param {boolean} useSerializerForRawResources
    * @returns {Promise<QueryItem>}
    */
    async retriveveRelatedResourcesParallelyAsync(
        {
            requestInfo,
            base_version,
            parentResourceType,
            relatedResources,
            explain,
            debug,
            parsedArgs,
            responseStreamer,
            idsAlreayProcessed = [],
            proxyPatientIds = [],
            supportLegacyId = true,
            getRaw = false,
            useSerializerForRawResources = false
        }
    ) {

        /**
         * @type {QueryItem[]}
         */
        const queryItems = []

        /**
         * @type {BundleEntry[]}
         */
        const bundleEntries = [];

        /**
         * @type {EverythingRelatedResources[]}
         */
        const relatedResourcesMap = relatedResources;
        /**
         * @type {Promise<{ bundleEntries: BundleEntry[] }>[]}
         */
        const parallelProcess = [];
        // TODO: Make it parallel
        for (const relatedResource of relatedResourcesMap) {
            const relatedResourceType = relatedResource.type;
            const filterTemplateParam = relatedResource.params;

            if (!filterTemplateParam || !relatedResourceType) {
                continue;
            }

            /**
             * @type {ParsedArgsItem}
             */
            const parentIdParsedArg = parsedArgs.get('id') || parsedArgs.get('_id');
            /**
             * @type {string[]}
             */
            const parentIdList = parentIdParsedArg.queryParameterValue.values || [];

            let parentResourceTypeAndIdList = parentIdList.map(id => `${parentResourceType}/${id}`)
            if (this.configManager.supportLegacyIds && supportLegacyId) {
                // TODO: Add legacyId support
            }

            // for now this will always be true
            if (parentResourceType === 'Patient' && proxyPatientIds) {
                parentResourceTypeAndIdList = [...parentResourceTypeAndIdList, ...proxyPatientIds.map(id => PATIENT_REFERENCE_PREFIX + id)]
            }

            if (parentResourceTypeAndIdList.length === 0) {
                return;
            }

            const filterByPatientIds = filterTemplateParam;

            /**
             * @type {string}
             */
            let reverseFilterWithParentIds = filterByPatientIds.replace('{ref}', parentResourceTypeAndIdList.join(','));
            reverseFilterWithParentIds = reverseFilterWithParentIds.replace('{id}', parentIdList.join(','));

            /**
             * @type {ParsedArgs}
             */
            const relatedResourceParsedArgs = this.parseQueryStringIntoArgs(
                {
                    resourceType: relatedResourceType,
                    queryString: reverseFilterWithParentIds
                }
            );

            const args = {};
            args.base_version = base_version;
            /**
             * @type {boolean}
             */
            const useAccessIndex = this.configManager.useAccessIndex;

            /**
             * @type {{base_version, columns: Set, query: import('mongodb').Document}}
             */
            const {
                /** @type {import('mongodb').Document}**/
                query // /** @type {Set} **/
                // columns
            } = await this.searchManager.constructQueryAsync(
                {
                    user: requestInfo.user,
                    scope: requestInfo.scope,
                    isUser: requestInfo.isUser,
                    resourceType: relatedResource.type,
                    useAccessIndex,
                    personIdFromJwtToken: requestInfo.personIdFromJwtToken,
                    requestId: requestInfo.requestId,
                    parsedArgs: relatedResourceParsedArgs,
                    operation: READ
                }
            );

            const options = {};
            const projection = {};
            // also exclude _id so if there is a covering index the query can be satisfied from the covering index
            projection._id = 0;
            options.projection = projection;


            /**
            * @type {number}
            */
            const maxMongoTimeMS = this.configManager.mongoTimeout;
            const databaseQueryManager = this.databaseQueryFactory.createQuery({
                resourceType: relatedResourceType,
                base_version
            });
            /**
             * mongo db cursor
             * @type {DatabasePartitionedCursor}
             */
            let cursor = await databaseQueryManager.findAsync({ query, options });
            cursor = cursor.maxTimeMS({ milliSecs: maxMongoTimeMS });

            /**
             * @type {import('mongodb').Document[]}
             */
            const explanations = (explain || debug) ? await cursor.explainAsync() : [];
            if (explain) {
                // if explain is requested then don't return any results
                cursor = cursor.limit(1);
            }
            const collectionName = cursor.getFirstCollection();
            const promiseResult = this.processCursorAsync({
                cursor,
                responseStreamer,
                parsedArgs: relatedResourceParsedArgs,
                getRaw,
                useSerializerForRawResources
            })

            parallelProcess.push(promiseResult)

            queryItems.push(new QueryItem({
                query,
                resourceType: relatedResourceType,
                collectionName,
                explanations
            }))
        }

        const result = await Promise.all(parallelProcess);
        result.forEach(entry => {
            bundleEntries.push(...(entry.bundleEntries || []))
        })


        return {
            entities: bundleEntries,
            queryItems
        }
    }

    /**
     * Fetches the data from cursor and streams it
     * @param {{
     *  cursor: DatabasePartitionedCursor,
     *  responseStreamer: ResponseStreamer,
     *  parsedArgs: ParsedArgs,
     *  getRaw: boolean,
     *  useSerializerForRawResources: boolean,
     * }} options
     * @return {Promise<{ bundleEntries: BundleEntry[]}>}
     */
    async processCursorAsync({
        cursor,
        responseStreamer,
        parsedArgs,
        getRaw,
        useSerializerForRawResources
    }) {
        /**
         * @type {BundleEntry[]}
         */
        const bundleEntries = [];
        while (await cursor.hasNext()) {
            /**
             * element
             * @type {Resource|null}
             */
            let startResource = getRaw ? await cursor.nextRaw() : await cursor.next();
            if (startResource) {
                /**
                 * @type {BundleEntry}
                 */

                startResource = await this.databaseAttachmentManager.transformAttachments(
                    startResource, RETRIEVE
                );
                let current_entity = getRaw
                    ? {
                        id: startResource.id,
                        resource: startResource
                    }
                    : new BundleEntry({
                        id: startResource.id,
                        resource: startResource
                    });

                if (responseStreamer) {
                    // TODO: Build something like ResponsePrepareTransform to enrich the resources
                    [current_entity] = await this.enrichmentManager.enrichBundleEntriesAsync({
                        entries: [current_entity],
                        parsedArgs,
                        rawResources: getRaw
                    });

                    await responseStreamer.writeBundleEntryAsync(
                        {
                            bundleEntry: current_entity,
                            rawResources: getRaw,
                            useSerializerForRawResources: useSerializerForRawResources
                        }
                    );
                } else {
                    bundleEntries.push(current_entity);
                }
            }
        }

        return { bundleEntries }
    }

    /**
     * converts a query string into an args array
     * @param {string} resourceType
     * @param {string} queryString
     * @return {ParsedArgs}
     */
    parseQueryStringIntoArgs({ resourceType, queryString }) {
        const args = Object.fromEntries(new URLSearchParams(queryString));
        args.base_version = VERSIONS['4_0_0'];
        return this.r4ArgsParser.parseArgs(
            {
                resourceType,
                args
            }
        );
    }
}


module.exports = {
    EverythingHelper
};