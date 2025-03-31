/**
 * This file contains functions to retrieve a graph of data from the database
 */
const async = require('async');
const { R4SearchQueryCreator } = require('../query/r4');
const env = require('var');
const { escapeRegExp } = require('../../utils/regexEscaper');
const { assertTypeEquals, assertIsValid } = require('../../utils/assertType');
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
const { ResourceProccessedTracker } = require('../../fhir/resourceProcessedTracker');
const { NonClinicalReferenesExtractor } = require('./nonClinicalResourceExtractor');
const clinicalResources = require('../../graphs/patient/generated.clinical_resources.json')['clinicalResources'];

/**
 * @typedef {import('../../utils/fhirRequestInfo').FhirRequestInfo} FhirRequestInfo
 * @typedef {import('./everythingRelatedResourcesMapper').EverythingRelatedResources} EverythingRelatedResources
 * @typedef {import('../query/parsedArgsItem').ParsedArgsItem}  ParsedArgsItem
 *
 * @typedef {Record<string, Set<string>> | null} NestedResourceReferences
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
        getRaw = false
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
            /**
             * @type {ResourceProccessedTracker}
             */
            let bundleEntryIdsProcessedTracker = new ResourceProccessedTracker();

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
                        bundleEntryIdsProcessedTracker,
                        responseStreamer,
                        supportLegacyId,
                        includeNonClinicalResources,
                        nonClinicalResourcesDepth,
                        proxyPatientIds,
                        getRaw
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
            const bundle = this.bundleManager[getRaw ? 'createRawBundle' : 'createBundle'](
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
                responseStreamer.setBundle({ bundle, rawResources: getRaw });
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
     * @param {ResourceProccessedTracker} bundleEntryIdsProcessedTracker
     * @param {boolean} supportLegacyId
     * @param {boolean} includeNonClinicalResources
     * @param {number} nonClinicalResourcesDepth
     * @param {string[]} proxyPatientIds
     * @param {boolean} getRaw
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
        bundleEntryIdsProcessedTracker,
        supportLegacyId = true,
        includeNonClinicalResources = false,
        nonClinicalResourcesDepth = 1,
        proxyPatientIds = [],
        getRaw = false
    }) {
        assertTypeEquals(parsedArgs, ParsedArgs);
        try {
            /**
             * @type {string[]|null}
             */
            const specificReltedResourceType = parsedArgs.resourceFilterList;
            const nonClinicalReferenesExtractor = includeNonClinicalResources ? new NonClinicalReferenesExtractor({ resourcesTypeToExclude: clinicalResources }) : null;
            const specificReltedResourceTypeSet = specificReltedResourceType ? new Set(specificReltedResourceType) : null;
            const realtedResourcesMap = this.everythingRelatedResourceMapper.relatedResources(resourceType, specificReltedResourceTypeSet);
            /**
             * @type {Generator<import('./everythingRelatedResourcesMapper').EverythingRelatedResources[],void, unknown>}
             */
            const relatedResourceMapChunks = sliceIntoChunksGenerator(realtedResourcesMap, this.configManager.everythingRealtedResourceBatchSize)

            // so any POSTed data is not read as parameters
            parsedArgs.remove('resource');

            /**
            * @type {BundleEntry[]}
            */
            let entries;
            /**
            * @type {QueryItem[]}
            */
            let queries;
            /**
             * @type {import('mongodb').FindOptions<import('mongodb').DefaultSchema>[]}
             */
            let optionsForQueries;
            /**
             * @type {import('mongodb').Document[]}
             */
            let explanations;
            /**
             * @type {ResourceIdentifier[]}
             */
            let baseResourceIdentifiers = [];

            ({ options: optionsForQueries, explanations, entries, queryItems: queries } = await this.fetchBaseResourceAsync({
                resourceType,
                base_version,
                queries,
                optionsForQueries,
                explain,
                debug,
                getRaw,
                parsedArgs,
                responseStreamer,
                bundleEntryIdsProcessedTracker,
                specificReltedResourceTypeSet,
                resourceIdentifiers: baseResourceIdentifiers,
                entries,
                explanations,
                requestInfo
            }));

            const baseResourcesProcessedTracker = new ResourceProccessedTracker();
            baseResourceIdentifiers.forEach(resourceIdentifier => {
                baseResourcesProcessedTracker.add(resourceIdentifier);
            })

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
                        parentResourceIdentifiers: baseResourceIdentifiers,
                        parentResourcesProcessedTracker: baseResourcesProcessedTracker,
                        explain,
                        debug,
                        parsedArgs,
                        responseStreamer,
                        bundleEntryIdsProcessedTracker,
                        supportLegacyId,
                        proxyPatientIds,
                        getRaw,
                        nonClinicalReferenesExtractor
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

            if (includeNonClinicalResources) {
                let resourcesTypeToExclude = clinicalResources;
                // finding non clinical resources in depth using previous result as input
                let referenceExtractor = nonClinicalReferenesExtractor;
                for (let i = 0; i < nonClinicalResourcesDepth; i++) {
                    let { entities, queryItems } = await this.getLinkedNonClinicalResources(
                        {
                            requestInfo,
                            parsedArgs,
                            base_version,
                            explain,
                            debug,
                            getRaw: false,
                            referenceExtractor,
                            bundleEntryIdsProcessedTracker
                        }
                    );

                    for (const q of queryItems) {
                        if (q) {
                            queries.push(q);
                        }

                        for (const e of q.explanations) {
                            explanations.push(e);
                        }
                    }

                    if (explain) {
                        // Don't include same resourceType, when explain is passed
                        const resourceTypes = Object.keys(referenceExtractor.nestedResourceReferences);
                        resourcesTypeToExclude = resourcesTypeToExclude.concat(resourceTypes);
                    }

                    // for next level
                    const referenceExtractorForNextLevel = new NonClinicalReferenesExtractor({ resourcesTypeToExclude })

                    entities.forEach((e => {
                        referenceExtractorForNextLevel.processResource(e.resource);
                        const resourceIdentifier = new ResourceIdentifier(e.resource);
                        if (!bundleEntryIdsProcessedTracker.has(resourceIdentifier)) {
                            if (responseStreamer) {
                                responseStreamer.writeBundleEntryAsync({
                                    bundleEntry: e,
                                    rawResources: getRaw
                                })
                            } else {
                                entries.push(e);
                            }
                        }
                        bundleEntryIdsProcessedTracker.add(resourceIdentifier);
                    }))

                    // For Next Level of clinical Resources
                    referenceExtractor = referenceExtractorForNextLevel;
                }
            }

            if (responseStreamer) {
                entries = [];
            } else {
                entries = await this.enrichmentManager.enrichBundleEntriesAsync(
                    {
                        entries,
                        parsedArgs,
                        rawResources: getRaw
                    }
                );
            }

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
    * fetch top level resource
    * @param {string} base_version
    * @param {FhirRequestInfo} requestInfo
    * @param {string} resourceType
    * @param {boolean} [explain]
    * @param {boolean} [debug]
    * @param {ParsedArgs} parsedArgs
    * @param {BaseResponseStreamer|undefined} [responseStreamer]
    * @param {ResourceProccessedTracker} bundleEntryIdsProcessedTracker
    * @param {ResourceIdentifier[]} resourceIdentifiers
    * @param {Set<string>} specificReltedResourceTypeSet
    * @param {boolean} getRaw
    * @return {Promise<ProcessMultipleIdsAsyncResult>}
    */
    async fetchBaseResourceAsync({
        base_version,
        requestInfo,
        resourceType,
        explain,
        debug,
        parsedArgs,
        responseStreamer,
        bundleEntryIdsProcessedTracker,
        resourceIdentifiers,
        getRaw,
        specificReltedResourceTypeSet
    }) {

        /**
         * @type {BundleEntry[]}
         */
        let entries = [];
        /**
        * @type {QueryItem[]}
        */
        let queries = [];
        /**
         * @type {import('mongodb').FindOptions<import('mongodb').DefaultSchema>[]}
         */
        let optionsForQueries = [];
        /**
         * @type {import('mongodb').Document[]}
         */
        let explanations = [];

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


        const options = {};
        const projection = {};
        // also exclude _id so if there is a covering index the query can be satisfied from the covering index
        projection._id = 0;
        options.projection = projection;

        // this is required to be filled only once
        optionsForQueries.push(options);
        // Query only if resourceType is present in specificReltedResourceTypeSet or specificReltedResourceTypeSet is not passed
        if (!specificReltedResourceTypeSet || specificReltedResourceTypeSet.has(resourceType)) {
            /**
             * @type {number}
             */
            const maxMongoTimeMS = this.configManager.mongoTimeout;

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

            /**
             * @type {import('mongodb').Document[]}
             */
            const explanations1 = explain || debug ? await cursor.explainAsync() : [];
            if (explain) {
                // if explain is requested then just return one result
                cursor = cursor.limit(1);
            }

            explanations.push(...explanations1);

            const { bundleEntries } = await this.processCursorAsync({
                cursor,
                getRaw,
                parentParsedArgs: parsedArgs,
                responseStreamer,
                bundleEntryIdsProcessedTracker,
                resourceIdentifiers
            });

            entries.push(...(bundleEntries || []));
        }

        return new ProcessMultipleIdsAsyncResult({
            entries,
            queryItems: queries,
            options: optionsForQueries,
            explanations
        })

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
    * @param {ResponseStreamer} responseStreamer
    * @param {ResourceProccessedTracker} bundleEntryIdsProcessedTracker
    * @param {ResourceIdentifier[]} parentResourceIdentifiers
    * @param {ResourceProccessedTracker} parentResourcesProcessedTracker
    * @param {boolean} supportLegacyId
    * @param {string[]} proxyPatientIds
    * @param {boolean} getRaw
    * @param {NonClinicalReferenesExtractor} nonClinicalReferenesExtractor
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
            bundleEntryIdsProcessedTracker,
            parentResourceIdentifiers,
            parentResourcesProcessedTracker,
            proxyPatientIds = [],
            supportLegacyId = true,
            getRaw = false,
            nonClinicalReferenesExtractor
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
        /**
         * @type {ResourceIdentifier[]}
         */
        let parentResourceIdentifiersList = parentResourceIdentifiers;
        for (const relatedResource of relatedResourcesMap) {
            const relatedResourceType = relatedResource.type;
            const filterTemplateParam = relatedResource.params;

            if (!filterTemplateParam || !relatedResourceType) {
                continue;
            }

            /**
             * @type {string[]}
             */
            let parentIdList = parentResourceIdentifiersList.map(r => r._uuid);
            let parentResourceTypeAndIdList = parentResourceIdentifiersList.map(r => `${r.resourceType}/${r._uuid}`);

            // for now this will always be true
            if (parentResourceType === 'Patient' && proxyPatientIds) {
                parentResourceTypeAndIdList = [...parentResourceTypeAndIdList, ...proxyPatientIds.map(id => PATIENT_REFERENCE_PREFIX + id)]
                parentIdList = [...parentIdList, ...proxyPatientIds]
            }

            if (parentResourceTypeAndIdList.length === 0) {
                return;
            }

            const filterByPatientIds = filterTemplateParam;

            /**
             * @type {string}
             */
            let reverseFilterWithParentIds = filterByPatientIds.replace('{ref}', parentResourceTypeAndIdList.join(','));
            const searchParameterName = filterByPatientIds.split('=')[0];
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

            // find matching field name in searchParameter list.  We will use this to match up to parent
            /**
             * @type {string}
             */
            const fieldForSearchParameter = this.searchParametersManager.getFieldNameForSearchParameter(relatedResourceType, searchParameterName);

            if (!fieldForSearchParameter) {
                throw new Error(`${searchParameterName} is not a valid search parameter for resource ${relatedResourceType}`);
            }

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
                parentParsedArgs: parsedArgs,
                bundleEntryIdsProcessedTracker,
                getRaw,
                nonClinicalReferenesExtractor,
                parentResourcesProcessedTracker,
                fieldForSearchParameter,
                proxyPatientIds: proxyPatientIds || [],
                parentResourceType
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
     *  parentParsedArgs: ParsedArgs,
     *  bundleEntryIdsProcessedTracker: ResourceProccessedTracker,
     *  resourceIdentifiers: ResourceIdentifier[] | null,
     *  sendBundleEntry?: boolean,
     *  getRaw: boolean,
     *  nonClinicalReferenesExtractor: NonClinicalReferenesExtractor | null,
     *  parentResourcesProcessedTracker?: ResourceProccessedTracker,
     *  fieldForSearchParameter?: string,
     *  proxyPatientIds?: string[],
     *  parentResourceType?: string,
     * }} options
     * @return {Promise<{ bundleEntries: BundleEntry[]}>}
     */
    async processCursorAsync({
        cursor,
        responseStreamer,
        parentParsedArgs,
        bundleEntryIdsProcessedTracker,
        resourceIdentifiers,
        getRaw,
        nonClinicalReferenesExtractor,
        parentResourcesProcessedTracker,
        fieldForSearchParameter,
        proxyPatientIds,
        parentResourceType
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


                let sendResource = true;
                if (parentResourceType) {
                    assertIsValid(proxyPatientIds, 'proxyPatientIds should be present');
                    assertIsValid(fieldForSearchParameter, 'fieldForSearchParameter should be present');
                    assertIsValid(parentResourcesProcessedTracker, 'parentResourcesProcessedTracker should be present');
                    const properties = this.getPropertiesForEntity({
                        resource: startResource, property: fieldForSearchParameter
                    });

                    // the reference property can be a single item or an array. Remove the sourceAssigningAuthority
                    // from references before matching.
                    /**
                     * @type {string[]}
                     */
                    let references = properties
                        .flatMap(r => this.getReferencesFromPropertyValue({ propertyValue: r }))
                        .filter(r => r !== undefined).map(r => r.split('|')[0]);

                    // for handling case when searching using sourceid of proxy patient
                    /**
                     * @type {string[]}
                     */
                    let referenceWithSourceIds = []
                    if (proxyPatientIds) {
                        referenceWithSourceIds = properties
                            .flatMap(r => this.getReferencesFromPropertyValue({ propertyValue: r }))
                            .filter(r => r !== undefined).map(r => r.split('|')[0]);
                    }

                    // for handling case for subscription resources where instead of
                    // reference we only have id of person/patient resource in extension/identifier
                    if (
                        references.length == 0 &&
                        SUBSCRIPTION_RESOURCES_REFERENCE_FIELDS.includes(fieldForSearchParameter)
                    ) {

                        properties.flat().map((r) => {
                            if (
                                r[
                                SUBSCRIPTION_RESOURCES_REFERENCE_KEY_MAP[fieldForSearchParameter]['key']
                                ] === SUBSCRIPTION_RESOURCES_REFERENCE_SYSTEM.person
                            ) {
                                references.push(
                                    PERSON_REFERENCE_PREFIX +
                                    r[SUBSCRIPTION_RESOURCES_REFERENCE_KEY_MAP[fieldForSearchParameter]['value']]
                                );
                            } else if (
                                r[
                                SUBSCRIPTION_RESOURCES_REFERENCE_KEY_MAP[fieldForSearchParameter]['key']
                                ] === SUBSCRIPTION_RESOURCES_REFERENCE_SYSTEM.patient
                            ) {
                                references.push(
                                    PATIENT_REFERENCE_PREFIX +
                                    r[SUBSCRIPTION_RESOURCES_REFERENCE_KEY_MAP[fieldForSearchParameter]['value']]
                                );
                            }
                        });
                    }

                    /**
                     * @type {ResourceIdentifier[]}
                     */
                    let matchingParentReferences = [];
                    {
                        const referencesSet = new Set(references);
                        parentResourcesProcessedTracker.uuidSet.forEach(parentUuidReference => {
                            if (referencesSet.has(parentUuidReference)) {
                                matchingParentReferences.push(parentUuidReference);
                            }
                        })
                    }

                    // if parent reference is present in child resource, then only send it in response
                    if (matchingParentReferences.length === 0) {
                        if (parentResourceType === 'Patient' && proxyPatientIds && proxyPatientIds.some(id => referenceWithSourceIds.includes(PATIENT_REFERENCE_PREFIX + id))) {
                            sendResource = true;
                        } else {
                            sendResource = false;
                            const parentEntitiesString = Array.from(parentResourcesProcessedTracker.uuidSet).toString()
                            logError(
                                `No match found for parent entities ${parentEntitiesString} ` +
                                `using property ${fieldForSearchParameter} in ` +
                                'child entity ' +
                                `${current_entity.resourceType}/${current_entity.id}`, {}
                            );
                        }
                    }

                }

                if (sendResource) {
                    const resourceIdentifier = new ResourceIdentifier(current_entity.resource);
                    if (responseStreamer) {
                        [current_entity] = await this.enrichmentManager.enrichBundleEntriesAsync({
                            entries: [current_entity],
                            parsedArgs: parentParsedArgs,
                            rawResources: getRaw
                        });

                        if (!bundleEntryIdsProcessedTracker.has(resourceIdentifier)) {
                            if (resourceIdentifiers) {
                                resourceIdentifiers.push(resourceIdentifier)
                            }
                            await responseStreamer.writeBundleEntryAsync(
                                {
                                    bundleEntry: current_entity,
                                    rawResources: getRaw
                                }
                            );
                        }

                    } else {
                        if (!bundleEntryIdsProcessedTracker.has(resourceIdentifier)) {
                            if (resourceIdentifiers) {
                                resourceIdentifiers.push(resourceIdentifier)
                            }
                            bundleEntries.push(current_entity);
                        }
                    }

                    bundleEntryIdsProcessedTracker.add(resourceIdentifier);

                    // find references
                    if (nonClinicalReferenesExtractor) {
                        await nonClinicalReferenesExtractor.processResource(startResource);
                    }
                }
            }
        }

        return { bundleEntries }
    }

    /**
     * @typedef {Object} GetLinkedNonClinicalResourcesOptions
     * @property {FhirRequestInfo} requestInfo - Information about the FHIR request.
     * @property {ParsedArgs} parsedArgs - Parsed query arguments.
     * @property {string} base_version - The FHIR version being used.
     * @property {boolean} explain - Whether to include query explanation details.
     * @property {boolean} debug - Whether to enable debug mode.
     * @property {boolean} [getRaw=false] - Whether to return raw database results.
     * @property {NonClinicalReferenesExtractor} referenceExtractor - List of nested resource references.
     *
     * @description get all the non-clinical resources whose references are in the provided entity list
     * @param {GetLinkedNonClinicalResourcesOptions} options
     * @returns {Promise<{entities: BundleEntry[], queryItems: QueryItem[]}>}
     *
     * TODO: Send parallely
     */
    async getLinkedNonClinicalResources({
        requestInfo,
        parsedArgs,
        base_version,
        explain,
        debug,
        getRaw = false,
        referenceExtractor
    }) {
        try {
            /**
             * @type {BundleEntry[]}
             */
            let entities = [];
            /**
             * @type {QueryItem[]}
             */
            let queryItems = [];

            for (const res of Object.entries(referenceExtractor.nestedResourceReferences)) {
                const [resourceType, ids] = res;
                const args = {
                    base_version: base_version,
                    id: Array.from(ids).join(','),
                    _debug: debug || explain
                };
                if (explain) {
                    args['_count'] = 1;
                }

                // Note: We are not running query-rewriters here
                const childParseArgs = this.r4ArgsParser.parseArgs({
                    resourceType,
                    args
                });

                const bundle = await this.searchBundleOperation.searchBundleAsync({
                    requestInfo,
                    resourceType,
                    parsedArgs: childParseArgs,
                    useAggregationPipeline: false,
                    getRaw,
                    // Disable them to make feature consistent as currently we are not generating any access/audit logs in everything
                    skipAccessLogs: true,
                    skipAuditLogs: true
                });

                // TODO: Add stream support
                for (let entry of bundle.entry || []) {
                    const resourceBundleEntry = getRaw
                        ? {
                            id: entry.id,
                            resource: entry.resource
                        }
                        : new BundleEntry({
                            id: entry.id,
                            resource: entry.resource
                        });
                    entities.push(resourceBundleEntry);
                }

                if (debug || explain) {
                    // making query items from meta of bundle
                    let query = bundle.meta.tag.find((obj) => {
                        return obj.system.endsWith('query');
                    }).display;
                    let collectionName = query.split('.')[1];
                    query = query.split('.find(')[1].split(', {}')[0];
                    query = JSON.parse(query.replace(/'/g, '"'));
                    let explanations = bundle.meta.tag.find((obj) => {
                        return obj.system.endsWith('queryExplain');
                    }).system;
                    queryItems.push(
                        new QueryItem({
                            query,
                            resourceType,
                            collectionName,
                            explanations
                        })
                    );
                }
            }

            // TODO: Move this up
            entities = await this.enrichmentManager.enrichBundleEntriesAsync({
                entries: entities,
                parsedArgs,
                rawResources: getRaw
            });

            return { entities, queryItems };
        } catch (e) {
            logError(`Error in getLinkedNonClinicalResources(): ${e.message}`, { error: e });
            throw new RethrownError({
                message: `Error in getLinkedNonClinicalResources()`,
                error: e,
                args: {
                    requestInfo,
                    referenceExtractor,
                    parsedArgs,
                    base_version,
                    explain,
                    debug
                }
            });
        }
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

    /**
     * returns property values
     * @param {Resource} resource
     * @param {string} property Property to read
     * @param {string?} filterProperty Filter property (optional)
     * @param {string?} filterValue Filter value (optional)
     * @returns {Object[]}
     */
    getPropertiesForEntity({ resource, property, filterProperty, filterValue }) {
        const item = resource;
        if (property.includes('.')) { // this is a nested property so recurse down and find the value
            /**
             * @type {string[]}
             */
            const propertyComponents = property.split('.');
            /**
             * @type {Object[]}
             */
            let currentElements = [item];
            for (const propertyComponent of propertyComponents) {
                // find nested elements where the property is present and select the property
                currentElements = currentElements.filter(c => c[`${propertyComponent}`]).flatMap(c => c[`${propertyComponent}`]);
                if (currentElements.length === 0) {
                    return [];
                }
            }
            // if there is a filter then check that the last element has that value
            if (filterProperty) {
                currentElements = currentElements.filter(c => c[`${filterProperty}`] && c[`${filterProperty}`] === filterValue);
            }
            return currentElements;
        } else {
            return [item[`${property}`]];
        }
    }

    /**
     * retrieves references from the provided property.
     * Always returns an array of references whether the property value is an array or just an object
     * @param {Object || Object[]} propertyValue
     * @param {boolean} supportLegacyId By default false for everything
     * @return {string[]}
     */
    getReferencesFromPropertyValue({ propertyValue, supportLegacyId = false }) {
        if (this.configManager.supportLegacyIds && supportLegacyId) {
            // concat uuids and ids so we can search both in case some reference does not have
            // _sourceAssigningAuthority set correctly
            return Array.isArray(propertyValue)
                ? propertyValue.map(a => a._uuid).concat(propertyValue.map(a => a.reference))
                : [].concat([propertyValue._uuid]).concat([propertyValue.reference]);
        } else {
            return Array.isArray(propertyValue)
                ? propertyValue.map(a => a._uuid)
                : [].concat([propertyValue._uuid]);
        }
    }
}


module.exports = {
    EverythingHelper
};