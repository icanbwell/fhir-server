/**
 * This file contains functions to retrieve all related resources of given resource from the database
 */
const { assertTypeEquals, assertIsValid } = require('../../utils/assertType');
const { DatabaseQueryFactory } = require('../../dataLayer/databaseQueryFactory');
const { AuditLogger } = require('../../utils/auditLogger');
const { PostRequestProcessor } = require('../../utils/postRequestProcessor');
const BundleEntry = require('../../fhir/classes/4_0_0/backbone_elements/bundleEntry');
const { ConfigManager } = require('../../utils/configManager');
const { BundleManager } = require('../common/bundleManager');
const { RethrownError } = require('../../utils/rethrownError');
const { SearchManager } = require('../search/searchManager');
const { ScopesValidator } = require('../security/scopesValidator');
const Bundle = require('../../fhir/classes/4_0_0/resources/bundle');
const { EnrichmentManager } = require('../../enrich/enrich');
const { R4ArgsParser } = require('../query/r4ArgsParser');
const { ParsedArgs } = require('../query/parsedArgs');
const { VERSIONS } = require('../../middleware/fhir/utils/constants');
const { logError } = require('../common/logging');
const { sliceIntoChunksGenerator } = require('../../utils/list.util');
const { ResourceIdentifier } = require('../../fhir/resourceIdentifier');
const { DatabaseAttachmentManager } = require('../../dataLayer/databaseAttachmentManager');
const { PatientEverythingCacheKeyGenerator } = require('./patientEverythingCachekeyGenerator')
const {
    GRIDFS: { RETRIEVE },
    OPERATIONS: { READ },
    SUBSCRIPTION_RESOURCES_REFERENCE_FIELDS,
    SUBSCRIPTION_RESOURCES_REFERENCE_KEY_MAP,
    PATIENT_REFERENCE_PREFIX,
    PERSON_REFERENCE_PREFIX,
    SUBSCRIPTION_RESOURCES_REFERENCE_SYSTEM,
    PERSON_PROXY_PREFIX,
    EVERYTHING_OP_NON_CLINICAL_RESOURCE_DEPTH,
    HTTP_CONTEXT_KEYS,
    REGEX
} = require('../../constants');
const { SearchParametersManager } = require('../../searchParameters/searchParametersManager');
const Resource = require('../../fhir/classes/4_0_0/resources/resource');
const { EverythingRelatedResourcesMapper } = require('./everythingRelatedResourcesMapper');
const { ProcessMultipleIdsAsyncResult } = require('../common/processMultipleIdsAsyncResult');
const { QueryItem } = require('../graph/queryItem');
const { ResourceProccessedTracker } = require('../../fhir/resourceProcessedTracker');
const { NonClinicalReferencesExtractor } = require('./nonClinicalResourceExtractor');
const { BadRequestError } = require('../../utils/httpErrors');
const { MongoQuerySimplifier } = require('../../utils/mongoQuerySimplifier');
const { EverythingRelatedResourceManager } = require('./everythingRelatedResourceManager');
const { isUuid } = require('../../utils/uid.util');
const { isTrue } = require('../../utils/isTrue');
const { isFalseWithFallback } = require('../../utils/isFalse');
const deepcopy = require('deepcopy');
const clinicalResources = require('./generated.resource_types.json')['clinicalResources'];
const { CustomTracer } = require('../../utils/customTracer');
const { PatientDataViewControlManager } = require('../../utils/patientDataViewController');
const { ResourceMapper, UuidOnlyMapper } = require('./resourceMapper');
const { RedisStreamManager } = require('../../utils/redisStreamManager');
const { CachedFhirResponseStreamer } = require('../../utils/cachedFhirResponseStreamer');
const httpContext = require('express-http-context');

/**
 * @typedef {import('../../utils/fhirRequestInfo').FhirRequestInfo} FhirRequestInfo
 * @typedef {import('./everythingRelatedResourcesMapper').EverythingRelatedResources} EverythingRelatedResources
 * @typedef {import('../query/parsedArgsItem').ParsedArgsItem}  ParsedArgsItem
 * @typedef {import('../../utils/baseResponseStreamer').BaseResponseStreamer}  BaseResponseStreamer
 *
 * @typedef {Record<string, Set<string>> | null} NestedResourceReferences
 */

/**
 * This class is for $everything operation
 */
class EverythingHelper {
    /**
     * @typedef {Object} EverythingHelperParams
     * @property {DatabaseQueryFactory} databaseQueryFactory
     * @property {ConfigManager} configManager
     * @property {BundleManager} bundleManager
     * @property {SearchManager} searchManager
     * @property {ScopesValidator} scopesValidator
     * @property {EnrichmentManager} enrichmentManager
     * @property {R4ArgsParser} r4ArgsParser
     * @property {DatabaseAttachmentManager} databaseAttachmentManager
     * @property {SearchParametersManager} searchParametersManager
     * @property {CustomTracer} customTracer
     * @property {PatientDataViewControlManager} patientDataViewControlManager
     * @property {AuditLogger} auditLogger
     * @property {PostRequestProcessor} postRequestProcessor
     *
     * @param {EverythingHelperParams}
     * @param {RedisStreamManager} redisStreamManager
     */
    constructor({
        databaseQueryFactory,
        configManager,
        bundleManager,
        searchManager,
        scopesValidator,
        enrichmentManager,
        r4ArgsParser,
        databaseAttachmentManager,
        searchParametersManager,
        everythingRelatedResourceMapper,
        customTracer,
        patientDataViewControlManager,
        auditLogger,
        postRequestProcessor,
        redisStreamManager
    }) {
        /**
         * @type {DatabaseQueryFactory}
         */
        this.databaseQueryFactory = databaseQueryFactory;
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);

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
         * @type {SearchManager}
         */
        this.searchManager = searchManager;
        assertTypeEquals(searchManager, SearchManager);

        /**
         * @type {ScopesValidator}
         */
        this.scopesValidator = scopesValidator;
        assertTypeEquals(scopesValidator, ScopesValidator);

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
         * @type {EverythingRelatedResourcesMapper}
         */
        this.everythingRelatedResourceMapper = everythingRelatedResourceMapper;
        assertTypeEquals(everythingRelatedResourceMapper, EverythingRelatedResourcesMapper);

        /**
         * @type {PatientDataViewControlManager}
         * */
        this.patientDataViewControlManager = patientDataViewControlManager;
        assertTypeEquals(patientDataViewControlManager, PatientDataViewControlManager);

        /**
         * @type {AuditLogger}
         */
        this.auditLogger = auditLogger;
        assertTypeEquals(auditLogger, AuditLogger);

        /**
         * @type {PostRequestProcessor}
         */
        this.postRequestProcessor = postRequestProcessor;
        assertTypeEquals(postRequestProcessor, PostRequestProcessor);

        /**
         * @type {string[]}
         */
        this.supportedResources = ["Patient"];


        /**
         * @type {string[]}
         */
        this.relatedResourceNeedingPatientScopeFilter = {
            Patient: ['Subscription', 'SubscriptionTopic', 'SubscriptionStatus', 'Person']
        };


        /**
         * @type {object}
         */
        this.uuidProjection = {
            _uuid: 1,
            _sourceId: 1,
            _sourceAssigningAuthority: 1,
            resourceType: 1
        }

        /**
         * @type {CustomTracer}
        */
        this.customTracer = customTracer;

        /**
         * @type {RedisStreamManager}
         */
        this.redisStreamManager = redisStreamManager;
    }

    /**
     * Get original ids from parsedArgs
     * @param {ParsedArgs} parsedArgs
     * @returns {string[]}
     */
    fetchOriginalIdsFromParams(parsedArgs) {
        const idParam = parsedArgs.getOriginal('id') || parsedArgs.getOriginal('_id');
        if (!idParam?.queryParameterValue?.value) {
            return [];
        }
        const id = idParam.queryParameterValue.value;
        return id.split(',');
    }

    /**
     * Get patient UUID for a given ID
     * @param {ParsedArgs} parsedArgs
     * @param {FhirRequestInfo} requestInfo
     * @param {string} resourceType
     * @param {string} base_version
    * @returns {Promise<string[]>}
    */
    async fetchPatientUUID(parsedArgs, requestInfo, resourceType, base_version) {
        const {
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
            accessRequested: 'read',
            addPersonOwnerToContext: requestInfo.isUser,
            applyPatientFilter: true
        });
        const databaseQueryManager = this.databaseQueryFactory.createQuery({ resourceType, base_version });
        const options = {
            projection: {
                _uuid: 1,
                _id: 0
            }
        };
        let cursor = await databaseQueryManager.findAsync({ query, options });
        let ids = [];
        while (await cursor.hasNext()) {
            const sourceResource = await cursor.next();
            ids.push(sourceResource._uuid);
        }
        return ids;
    }

    /**
     * Get cache key for a given request
     * @param {ParsedArgs} parsedArgs
     * @param {FhirRequestInfo} requestInfo
     * @param {string} resourceType
     * @param {string} base_version
     * @returns {Promise<string|undefined>}
     */
    async getCacheKey(parsedArgs, requestInfo, resourceType, base_version) {
        if (!requestInfo.personIdFromJwtToken) {
            return undefined;
        }
        const keyGenerator = new PatientEverythingCacheKeyGenerator();
        if (!keyGenerator.isResponseTypeCacheable(requestInfo.accept, parsedArgs)) {
            return undefined;
        }

        let paramsIds = this.fetchOriginalIdsFromParams(parsedArgs);
        // Multiple ids are not supported for now
        if (paramsIds.length !== 1) {
            return undefined;
        }
        let idForCache;
        let id = paramsIds[0];
        const isProxyPatient = id.startsWith(PERSON_PROXY_PREFIX);
        if (isProxyPatient) {
            id = id.replace(PERSON_PROXY_PREFIX, '');
            if (isUuid(id) && id == requestInfo.personIdFromJwtToken) {
                idForCache = id;
            }
        } else {
            let patientIds = await this.fetchPatientUUID(parsedArgs, requestInfo, resourceType, base_version);
            idForCache = patientIds && patientIds.length == 1 ? patientIds[0] : undefined;
        }

        return idForCache
            ? await keyGenerator.generateCacheKey({
                  id: idForCache,
                  isPersonId: isProxyPatient,
                  parsedArgs: parsedArgs,
                  scope: requestInfo.scope
              })
            : undefined;
    }

    /**
     * @typedef {Object} retriveEverythingAsyncParams
     * @property {FhirRequestInfo} requestInfo
     * @property {string} resourceType
     * @property {string} base_version
     * @property {BaseResponseStreamer|undefined} responseStreamer
     * @property {ParsedArgs} parsedArgs
     * @property {boolean} supportLegacyId
     * @property {boolean} includeNonClinicalResources
     *
     * @param {retriveEverythingAsyncParams}
     * @return {Promise<Bundle>}
     */
    async retriveEverythingAsync({
        requestInfo,
        base_version,
        resourceType,
        responseStreamer,
        parsedArgs,
        includeNonClinicalResources = true
    }) {
        if (!this.supportedResources.includes(resourceType)) {
            throw new Error('$everything is not supported for resource: ' + resourceType);
        }

        assertTypeEquals(parsedArgs, ParsedArgs);
        let cachedStreamer = undefined;
        let cacheKey = undefined;

        try {
            /**
             * @type {number}
             */
            const startTime = Date.now();
            /**
             * @type {ParsedArgsItem}
             */
            const idParsedArg = parsedArgs.get('id') || parsedArgs.get('_id');

            if (!idParsedArg) {
                throw new BadRequestError(new Error('No id was passed either in path param or query param'));
            }

            /**
             * @type {string[]|null}
             */
            const ids = idParsedArg.queryParameterValue.values;
            /**
             * @type {Generator<string[], void, unknown>}
             */
            const idChunks = ids ? sliceIntoChunksGenerator(ids, this.configManager.everythingBatchSize) : [];

            if (parsedArgs._since) {
                parsedArgs._since = new Date(parsedArgs._since);
            }

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
            /**
             * @type {{id: string, resourceType: string}[]} - Track resource IDs with types for audit logging
             */
            let streamedResources = [];
            const writeCache = this.configManager.writeToCacheForEverythingOperation;
            cacheKey = writeCache ? await this.getCacheKey(
                parsedArgs, requestInfo, resourceType, base_version
            ) : undefined;
            cachedStreamer = cacheKey ? new CachedFhirResponseStreamer({
                redisStreamManager: this.redisStreamManager,
                cacheKey,
                responseStreamer,
                ttlSeconds: this.configManager.everythingCacheTtlSeconds,
                enrichmentManager: this.enrichmentManager,
                parsedArgs
            }) : undefined;
            const readFromCache = (
                this.configManager.readFromCacheForEverythingOperation &&
                responseStreamer &&
                cachedStreamer &&
                await this.redisStreamManager.hasCachedStream(cacheKey) &&
                !requestInfo.skipCachedData()
            );
            // Check if we need to fall back to MongoDB
            let fallbackToMongo = false;
            if (readFromCache) {
                try {
                    streamedResources = await cachedStreamer.streamFromCacheAsync();
                } catch (err) {
                    fallbackToMongo = !cachedStreamer.writeFromRedisStarted;
                    logError('Error reading everything response from cache', { error: err, cacheKey });
                    if (!fallbackToMongo) {
                        throw err;
                    }
                }
            }
            if(!readFromCache || fallbackToMongo) {
                for (const idChunk of idChunks) {
                    const parsedArgsForChunk = parsedArgs.clone();
                    parsedArgsForChunk.id = idChunk;
                    parsedArgsForChunk.resourceFilterList = parsedArgs.resourceFilterList;
                    /**
                     * @type {string[]}
                     */
                    let proxyPatientIds = []
                    if (resourceType === 'Patient') {
                        proxyPatientIds = idChunk.filter(
                            // starts with proxy patient prefix and followed by valid id characters
                            (q) => q && q.startsWith(PERSON_PROXY_PREFIX) && REGEX.ID_FIELD.test(q)
                        );

                        // filter proxy patient ids to only include allowed ids for patient scope
                        if (requestInfo.isUser) {
                            proxyPatientIds = proxyPatientIds.filter(
                                (q) => q && q === PERSON_PROXY_PREFIX + requestInfo.personIdFromJwtToken
                            );
                        }
                    }

                    /**
                     * @type {ProcessMultipleIdsAsyncResult}
                     */
                    const {
                        entries: entries1,
                        queryItems: queryItems1,
                        options: options1,
                        explanations: explanations1,
                        streamedResources: streamedRes1
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
                        includeNonClinicalResources,
                        proxyPatientIds,
                        cachedStreamer
                        }
                    );

                    entries = entries.concat(entries1);
                    queryItems = queryItems.concat(queryItems1);
                    options = options.concat(options1);
                    explanations = explanations.concat(explanations1);
                    streamedResources = streamedResources.concat(streamedRes1 || []);
                }
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
            const bundle = this.bundleManager.createRawBundle(
                {
                    type: 'searchset',
                    requestId: requestInfo.userRequestId,
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

            // Log audit events for resources accessed (max 1000 per audit event per resource type)
            // Works for both streaming and non-streaming modes
            const resourcesToAudit = responseStreamer ? streamedResources : resources.map((r) => ({id: r.id, resourceType: r.resourceType}));

            if (resourcesToAudit.length > 0 && resourceType !== 'AuditEvent') {
                const requestId = requestInfo.requestId;
                const maxResourcesPerAudit = 1000;

                // Group resources by type for proper audit logging
                const resourcesByType = new Map();

                // Group by actual resource type from tracked data
                resourcesToAudit.forEach(resource => {
                    const type = resource.resourceType;
                    if (!resourcesByType.has(type)) {
                        resourcesByType.set(type, []);
                    }
                    resourcesByType.get(type).push(resource.id);
                });

                // Create audit events for each resource type
                for (const [type, ids] of resourcesByType.entries()) {
                    // Split resource IDs into chunks of 1000
                    for (let i = 0; i < ids.length; i += maxResourcesPerAudit) {
                        const resourceIdChunk = ids.slice(i, i + maxResourcesPerAudit);

                        this.postRequestProcessor.add({
                            requestId,
                            fnTask: async () => {
                                // https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop#partitioning
                                // calling in setImmediate to process it in next iteration of event loop
                                setImmediate(async () => {
                                    await this.auditLogger.logAuditEntryAsync({
                                        requestInfo,
                                        base_version,
                                        resourceType: type,
                                        operation: 'read',
                                        args: parsedArgs.getRawArgs(),
                                        ids: resourceIdChunk,
                                        maxNumberOfIds: maxResourcesPerAudit
                                    });
                                });
                            }
                        });
                    }
                }
            }

            if (responseStreamer) {
                responseStreamer.setBundle({ bundle });
            }
            return bundle;
        } catch (error) {
            // Deleting cached stream if any error occurs during processing
            if (cachedStreamer && !cachedStreamer.isFirstEntry) {
                await this.redisStreamManager.deleteStream(cacheKey);
            }
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
     * @typedef {Object} RetrieveEverythingMulipleIdsAsyncParams
     * @property {string} base_version
     * @property {FhirRequestInfo} requestInfo
     * @property {string} resourceType
     * @property {boolean} [explain]
     * @property {boolean} [debug]
     * @property {ParsedArgs} parsedArgs
     * @property {BaseResponseStreamer|undefined} responseStreamer
     * @property {ResourceProccessedTracker} bundleEntryIdsProcessedTracker
     * @property {boolean} includeNonClinicalResources
     * @property {string[]} proxyPatientIds
     * @property {CachedFhirResponseStreamer|null} [cachedStreamer]
     *
     * @param {RetrieveEverythingMulipleIdsAsyncParams}
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
        includeNonClinicalResources = false,
        proxyPatientIds = [],
        cachedStreamer = null
    }) {
        assertTypeEquals(parsedArgs, ParsedArgs);
        try {
            const everythingRelatedResourceManager = new EverythingRelatedResourceManager({
                resourceFilterList: parsedArgs.resourceFilterList,
                everythingRelatedResourceMapper: this.everythingRelatedResourceMapper
            });

            /**
             * @type {NonClinicalReferencesExtractor|null}
             */
            let nonClinicalReferencesExtractor = null;
            // Extract non-clinical only if includeNonClinicalResources is true or any nonClinical resource is present in _type filter
            if (includeNonClinicalResources || everythingRelatedResourceManager.nonClinicalResources?.size > 0) {
                nonClinicalReferencesExtractor = new NonClinicalReferencesExtractor({
                    resourcesTypeToExclude: clinicalResources,
                    resourcePool: everythingRelatedResourceManager.getRequiredResourcesForNonClinicalResources()
                });
            }

            const realtedResourcesMap = everythingRelatedResourceManager.getRelatedResourcesMap();

            /**
             * @type {Generator<import('./everythingRelatedResourcesMapper').EverythingRelatedResources[],void, unknown>}
             */
            const relatedResourceMapChunks = sliceIntoChunksGenerator(realtedResourcesMap, this.configManager.everythingMaxParallelProcess)

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
            /**
             * @type {ResourceIdentifier[]}
             */
            let baseResourceIdentifiers = [];
            /**
             * @type {Boolean}
            */
            let useUuidProjection = false;
            /**
             * @type {ResourceMapper}
             */
            let resourceMapper = new ResourceMapper();
            /**
             * @type {{id: string, resourceType: string}[]} - Track resource IDs with types for audit logging
             */
            let streamedResources = [];

            // Handle UUID-only responses:
            if (isTrue(parsedArgs._includeUuidOnly)) {
                // This is more optimized for clinical resources (uses projection)
                if (everythingRelatedResourceManager.isOnlyClinicalResourcesRequested(includeNonClinicalResources)) {
                    // Use optimized approach for clinical resources only
                    useUuidProjection = true;
                    includeNonClinicalResources = false;
                    nonClinicalReferencesExtractor = null;
                }
                resourceMapper = new UuidOnlyMapper();
            } else if (isTrue(parsedArgs._includePatientLinkedUuidOnly)) {
                useUuidProjection = true;
                includeNonClinicalResources = false;
                nonClinicalReferencesExtractor = null;
                resourceMapper = new UuidOnlyMapper();
            }

            // patient resource don't exist for proxy patient
            if (isFalseWithFallback(parsedArgs._includeProxyPatientLinkedOnly, true)) {
                const baseResult = await this.fetchResourceByArgsAsync({
                    resourceType,
                    base_version,
                    explain,
                    debug,
                    parsedArgs,
                    responseStreamer,
                    bundleEntryIdsProcessedTracker,
                    everythingRelatedResourceManager,
                    resourceIdentifiers: baseResourceIdentifiers,
                    requestInfo,
                    useUuidProjection,
                    resourceMapper,
                    cachedStreamer
                });

                optionsForQueries = baseResult.options;
                explanations = baseResult.explanations;
                entries = baseResult.entries;
                queries = baseResult.queryItems;

                // Collect streamed resources from base Patient fetch
                streamedResources = streamedResources.concat(baseResult.streamedResources || []);
            }

            if (isTrue(parsedArgs._excludeProxyPatientLinked)) {
                proxyPatientIds = [];
            }

            let resourceToExcludeIdsMap = {};

            let patientReference = baseResourceIdentifiers.map(patientIdentifier => {
                return `${PATIENT_REFERENCE_PREFIX}${patientIdentifier._uuid}`;
            });

            // get Consent resource containing resources marked as deleted to exclude
            if (requestInfo.isUser) {
                let {
                    viewControlResourceToExcludeMap,
                    viewControlConsentQueries,
                    viewControlConsentQueryOptions
                } = await this.customTracer.trace({
                    name: 'EverythingHelper.patientDataViewControlManager.getConsentAsync',
                    func: async () => await this.patientDataViewControlManager.getConsentAsync({
                        requestInfo,
                        base_version,
                        patientFilterReferences: patientReference
                    })
                });

                resourceToExcludeIdsMap = viewControlResourceToExcludeMap;

                for (const q of viewControlConsentQueries) {
                    if (q) {
                        queries.push(q);
                    }

                    if (q?.explanations) {
                        for (const e of q.explanations) {
                            explanations.push(e);
                        }
                    }
                }

                if (viewControlConsentQueryOptions) {
                    optionsForQueries.push(...viewControlConsentQueryOptions);
                }
            }

            const baseResourcesProcessedTracker = new ResourceProccessedTracker();
            baseResourceIdentifiers.forEach(resourceIdentifier => {
                baseResourcesProcessedTracker.add(resourceIdentifier);
            })

            // Fetch related resources
            /**
             * @type {import('mongodb').Document[]}
             */
            for (const relatedResourceMapChunk of relatedResourceMapChunks) {
                let { entities: relatedEntities, queryItems, optionsForQueries: relatedOptions, streamedResources: streamedRes } = await this.retriveveRelatedResourcesParallelyAsync({
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
                    proxyPatientIds,
                    nonClinicalReferencesExtractor,
                    everythingRelatedResourceManager,
                    useUuidProjection,
                    resourceToExcludeIdsMap,
                    resourceMapper,
                    cachedStreamer
                });

                if (!responseStreamer) {
                    entries.push(...(relatedEntities || []))
                } else {
                    // Collect streamed resources with their types
                    streamedResources.push(...(streamedRes || []));
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

                if (relatedOptions) {
                    optionsForQueries.push(...relatedOptions);
                }
            }

            if (includeNonClinicalResources || everythingRelatedResourceManager.nonClinicalResources?.size > 0) {
                let resourcesTypeToExclude = clinicalResources;
                // finding non clinical resources in depth using previous result as input
                let referenceExtractor = nonClinicalReferencesExtractor;

                for (let i = 0; i < EVERYTHING_OP_NON_CLINICAL_RESOURCE_DEPTH && referenceExtractor; i++) {
                    /**
                     * @type {Promise<ProcessMultipleIdsAsyncResult>[]}
                     */
                    let depthParallelProcess = [];

                    // for next level
                    let referenceExtractorForNextLevel =
                        i + 1 < EVERYTHING_OP_NON_CLINICAL_RESOURCE_DEPTH
                            ? new NonClinicalReferencesExtractor({
                                resourcesTypeToExclude,
                                resourcePool:
                                    everythingRelatedResourceManager.getRequiredResourcesForNonClinicalResources()
                            })
                            : null;

                    for (const res of Object.entries(referenceExtractor.nestedResourceReferences)) {
                        let [resourceType, ids] = res;
                        ids = Array.from(ids);

                        const baseArgs = {
                            base_version: base_version,
                            _debug: debug || explain,
                            _includeHidden: parsedArgs._includeHidden,
                            _since: parsedArgs._since
                        };

                        // for non-clinical resources, only binary support patient data view control
                        if (resourceType === 'Binary' && resourceToExcludeIdsMap[resourceType]?.length > 0) {
                            baseArgs["id:not"] = resourceToExcludeIdsMap[resourceType].join(',');
                        }

                        // if explain query, don't break in chunks as will be limit to single resource later
                        const idChunks = explain
                            ? [ids]
                            : sliceIntoChunksGenerator(ids, this.configManager.mongoInQueryIdBatchSize);

                        for (const idChunk of idChunks) {
                            const childParseArgs = this.r4ArgsParser.parseArgs({
                                resourceType,
                                args: { ...baseArgs, id: idChunk.join(',') }
                            });

                            childParseArgs.headers = { prefer: parsedArgs.headers.prefer };

                            const result = this.fetchResourceByArgsAsync({
                                resourceType,
                                base_version,
                                explain,
                                debug,
                                parsedArgs: childParseArgs,
                                responseStreamer,
                                bundleEntryIdsProcessedTracker,
                                requestInfo,
                                nonClinicalReferencesExtractor: referenceExtractorForNextLevel,
                                everythingRelatedResourceManager,
                                resourceMapper,
                                cachedStreamer
                            });

                            depthParallelProcess.push(result);

                            if(depthParallelProcess.length >= this.configManager.everythingMaxParallelProcess) {
                                const depthResults = await Promise.all(depthParallelProcess);
                                depthResults.forEach((result) => {
                                    queries.push(...(result.queryItems || []));
                                    explanations.push(...(result.explanations || []));
                                    optionsForQueries.push(...(result.options || []));
                                    if (!responseStreamer) {
                                        entries.push(...(result.entries || []));
                                    } else {
                                        // Collect streamed resources for audit logging
                                        streamedResources.push(...(result.streamedResources || []));
                                    }
                                });
                                depthParallelProcess = [];
                            }
                        }
                    }

                    if (depthParallelProcess.length > 0) {
                        const depthResults = await Promise.all(depthParallelProcess);
                        depthResults.forEach((result) => {
                            queries.push(...(result.queryItems || []));
                            explanations.push(...(result.explanations || []));
                            optionsForQueries.push(...(result.options || []));
                            if (!responseStreamer) {
                                entries.push(...(result.entries || []));
                            } else {
                                // Collect streamed resources for audit logging
                                streamedResources.push(...(result.streamedResources || []));
                            }
                        });
                    }

                    if (explain) {
                        // Don't include same resourceType, when explain is passed
                        const resourceTypes = Object.keys(referenceExtractor.nestedResourceReferences);
                        resourcesTypeToExclude = resourcesTypeToExclude.concat(resourceTypes);
                    }

                    // For Next Level of clinical Resources
                    referenceExtractor = referenceExtractorForNextLevel;
                }
            }

            if (responseStreamer) {
                entries = [];
            } else {
                entries = await this.enrichmentManager.enrichBundleEntriesAsync({
                    entries,
                    parsedArgs
                });
            }

            return new ProcessMultipleIdsAsyncResult({
                entries,
                queryItems: queries,
                options: optionsForQueries,
                explanations,
                streamedResources
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
     * @typedef FetchResourceByArgsAsyncParams
     * @property {string} base_version
     * @property {FhirRequestInfo} requestInfo
     * @property {string} resourceType
     * @property {boolean} [explain]
     * @property {boolean} [debug]
     * @property {ParsedArgs} parsedArgs
     * @property {BaseResponseStreamer|undefined} [responseStreamer]
     * @property {ResourceProccessedTracker|undefined} bundleEntryIdsProcessedTracker
     * @property {ResourceIdentifier[]} resourceIdentifiers
     * @property {EverythingRelatedResourceManager} everythingRelatedResourceManager
     * @property {boolean} applyPatientFilter
     * @property {NonClinicalReferencesExtractor | null} nonClinicalReferencesExtractor
     * @property {Boolean} useUuidProjection
     * @property {ResourceMapper} resourceMapper
     * @property {CachedFhirResponseStreamer|null} [cachedStreamer]
     *
     * @param {FetchResourceByArgsAsyncParams}
     * @return {Promise<ProcessMultipleIdsAsyncResult>}
     */
    async fetchResourceByArgsAsync({
        base_version,
        requestInfo,
        resourceType,
        explain,
        debug,
        parsedArgs,
        responseStreamer,
        bundleEntryIdsProcessedTracker,
        resourceIdentifiers,
        everythingRelatedResourceManager,
        nonClinicalReferencesExtractor,
        useUuidProjection = false,
        applyPatientFilter = true,
        resourceMapper = new ResourceMapper(),
        cachedStreamer = null
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
        /**
         * @type {{id: string, resourceType: string}[]} - Track resources with types for audit logging
         */
        let streamedResources = [];

        let isQueryById = !!parsedArgs.get('id') || !!parsedArgs.get('_id');

        if (this.scopesValidator.hasValidScopes({ requestInfo, parsedArgs, resourceType, action: 'everything', accessRequested: 'read' })) {
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
                accessRequested: (requestInfo.method.toLowerCase() === 'delete' ? 'write' : 'read'),
                addPersonOwnerToContext: requestInfo.isUser,
                applyPatientFilter,
                allowConsentedProaDataAccess: true
            });


            const options = {};
            let projection = {};
            if (useUuidProjection) {
                projection = deepcopy(this.uuidProjection);
                if (parsedArgs._since) {
                    projection.meta = {
                        lastUpdated: 1
                    }
                }
            }
            // also exclude _id so if there is a covering index the query can be satisfied from the covering index
            projection._id = 0;
            options.projection = projection;

            // this is required to be filled only once
            optionsForQueries.push(options);
            /**
             * @type {number}
             */
            const maxMongoTimeMS = this.configManager.mongoTimeout;

            const databaseQueryManager = this.databaseQueryFactory.createQuery({ resourceType, base_version });

            let cursor = await databaseQueryManager.findAsync({ query, options });
            cursor = cursor.maxTimeMS({ milliSecs: maxMongoTimeMS });

            if (
                isQueryById &&
                resourceType !== 'Practitioner' &&
                httpContext.get(HTTP_CONTEXT_KEYS.CONSENTED_PROA_DATA_ACCESSED)
            ) {
                // set index hint for non-clinical resources when consented proa data is accessed
                cursor = cursor.hint({ indexHint: 'uuid' });
            }

            const collectionName = cursor.getCollection();

            queries.push(
                new QueryItem({
                    query,
                    resourceType,
                    collectionName
                })
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

            const { bundleEntries, streamedResources: streamedResources1 } = await this.processCursorAsync({
                cursor,
                parentParsedArgs: parsedArgs,
                responseStreamer: responseStreamer,
                bundleEntryIdsProcessedTracker,
                resourceIdentifiers,
                nonClinicalReferencesExtractor,
                everythingRelatedResourceManager,
                useUuidProjection,
                resourceMapper,
                cachedStreamer
            });

            entries.push(...(bundleEntries || []));
            streamedResources = streamedResources.concat(streamedResources1 || []);
        }

        return new ProcessMultipleIdsAsyncResult({
            entries,
            queryItems: queries,
            options: optionsForQueries,
            explanations,
            streamedResources: streamedResources || []
        })

    }

    /**
     * Gets related resources and adds them to containedEntries in parentEntities
     * @typedef retriveveRelatedResourcesParallelyAsyncParams
     * @property {FhirRequestInfo} requestInfo
     * @property {string} base_version
     * @property {string} parentResourceType
     * @property {EverythingRelatedResources[]} relatedResources
     * @property {boolean} [explain]
     * @property {boolean} [debug]
     * @property {ParsedArgs} parsedArgs
     * @property {ResponseStreamer} responseStreamer
     * @property {ResourceProccessedTracker} bundleEntryIdsProcessedTracker
     * @property {ResourceIdentifier[]} parentResourceIdentifiers
     * @property {ResourceProccessedTracker} parentResourcesProcessedTracker
     * @property {string[]} proxyPatientIds
     * @property {NonClinicalReferencesExtractor} nonClinicalReferencesExtractor
     * @property {EverythingRelatedResourceManager} everythingRelatedResourceManager
     * @property {Boolean} useUuidProjection
     * @property {{string: string[]}} resourceToExcludeIdsMap
     * @property {{id: string, resourceType: string}[]} streamedResources
     * @property {ResourceMapper} resourceMapper
     * @property {CachedFhirResponseStreamer|null} [cachedStreamer]
     *
     * @param {retriveveRelatedResourcesParallelyAsyncParams}
     * @returns {Promise<{entities: BundleEntry[], queryItems: QueryItem[], optionsForQueries: any[], streamedResources: {id: string, resourceType: string}[]}>}
     */
    async retriveveRelatedResourcesParallelyAsync({
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
        everythingRelatedResourceManager,
        nonClinicalReferencesExtractor,
        useUuidProjection = false,
        resourceToExcludeIdsMap,
        resourceMapper = new ResourceMapper(),
        cachedStreamer = null
        }
    ) {

        /**
         * @type {QueryItem[]}
         */
        const queryItems = []

        /**
         * @type {import('mongodb').FindOptions<import('mongodb').DefaultSchema>[]}
         */
        let optionsForQueries = [];

        /**
         * @type {BundleEntry[]}
         */
        const bundleEntries = [];
        /**
         * @type {{id: string, resourceType: string}[]} - Collect streamed resources with types
         */
        const streamedResources = [];

        /**
         * @type {EverythingRelatedResources[]}
         */
        const relatedResourcesMap = relatedResources;
        /**
         * @type {Promise<{ bundleEntries: BundleEntry[] }>[]}
         */
        const parallelProcess = [];
        let parentResourceTypeAndIdList = parentResourceIdentifiers.map(r => `${r.resourceType}/${r._uuid}`);

        // for now this will always be true
        if (parentResourceType === 'Patient' && proxyPatientIds) {
            parentResourceTypeAndIdList = [...parentResourceTypeAndIdList, ...proxyPatientIds.map(id => PATIENT_REFERENCE_PREFIX + id)]
        }

        if (parentResourceTypeAndIdList.length === 0) {
            return {
                entities: bundleEntries,
                queryItems
            };
        }

        for (const relatedResource of relatedResourcesMap) {
            const relatedResourceType = relatedResource.type;
            const filterTemplateParam = relatedResource.params;
            const filterTemplateCustomQuery = relatedResource.customQuery;

            if ((!filterTemplateParam && !filterTemplateCustomQuery) || !relatedResourceType) {
                continue;
            }

            if (!this.scopesValidator.hasValidScopes({
                requestInfo,
                parsedArgs,
                resourceType: relatedResourceType,
                action: 'everything',
                accessRequested: 'read'
            })) {
                continue;
            }

            /**
             * @type {string}
             */
            let reverseFilterWithParentIds = '';

            /**
             * @type {string|null}
             */
            let parentLookupField = null;

            let commonArgs = {
                _includeHidden: parsedArgs._includeHidden
            };

            if (resourceToExcludeIdsMap && resourceToExcludeIdsMap[relatedResourceType]?.length > 0) {
                commonArgs["id:not"] = resourceToExcludeIdsMap[relatedResourceType].join(',');
            }

            if (!filterTemplateCustomQuery) {
                reverseFilterWithParentIds = filterTemplateParam.replace(
                    '{ref}',
                    parentResourceTypeAndIdList.join(',')
                );
            }

            /**
             * @type {ParsedArgs}
             */
            const relatedResourceParsedArgs = this.parseQueryStringIntoArgs({
                resourceType: relatedResourceType,
                queryString: reverseFilterWithParentIds,
                commonArgs
            });

            /**
             * @type {boolean}
             */
            const useAccessIndex = this.configManager.useAccessIndex;

            /**
             * @type {{base_version, columns: Set, query: import('mongodb').Document}}
             */
            let {
                /** @type {import('mongodb').Document}**/
                query
            } = await this.searchManager.constructQueryAsync({
                user: requestInfo.user,
                scope: requestInfo.scope,
                isUser: requestInfo.isUser,
                resourceType: relatedResourceType,
                useAccessIndex,
                personIdFromJwtToken: requestInfo.personIdFromJwtToken,
                requestId: requestInfo.requestId,
                parsedArgs: relatedResourceParsedArgs,
                operation: READ,
                applyPatientFilter:
                    requestInfo.isUser &&
                    this.relatedResourceNeedingPatientScopeFilter[parentResourceType].includes(relatedResourceType),
                allowConsentedProaDataAccess: true
            });

            if (filterTemplateCustomQuery) {
                let customParentQuery = [];
                parentLookupField = filterTemplateCustomQuery.fieldForParentLookup;
                parentResourceIdentifiers.forEach((parentResourceIdentifier) => {
                    let patientQuery = filterTemplateCustomQuery.query;
                    filterTemplateCustomQuery.requiredValues.forEach((requiredValue) => {
                        if (!parentResourceIdentifier[requiredValue]) {
                            throw new Error(`${requiredValue} is not present in parent resource identifier`);
                        }
                        patientQuery = patientQuery.replace(`{${requiredValue}}`, parentResourceIdentifier[requiredValue]);
                    })
                    customParentQuery.push(JSON.parse(patientQuery));
                });

                if (filterTemplateCustomQuery.includeProxyPatient && proxyPatientIds.length > 0) {
                    proxyPatientIds.forEach((proxyPatientId) => {
                        let proxyPatientIdentifier = {
                            id: proxyPatientId,
                            resourceType: 'Patient'
                        }
                        if (isUuid(proxyPatientId)) {
                            proxyPatientIdentifier.idType = '_uuid';
                        }
                        else {
                            proxyPatientIdentifier.idType = '_sourceId';
                        }
                        let patientQuery = filterTemplateCustomQuery.proxyPatientQuery;
                        filterTemplateCustomQuery.proxyPatientRequiredValues.forEach((requiredValue) => {
                            if (!proxyPatientIdentifier[requiredValue]) {
                                throw new Error(`${requiredValue} is not present in proxy patient resource identifier`);
                            }
                            patientQuery = patientQuery.replace(`{${requiredValue}}`, proxyPatientIdentifier[requiredValue]);
                        });
                        customParentQuery.push(JSON.parse(patientQuery));
                    });
                }

                if (httpContext.get(HTTP_CONTEXT_KEYS.CONSENTED_PROA_DATA_ACCESSED)) {
                    if (!query.$or?.length > 0 || !query.$or.every(q => q.$and?.length > 0)) {
                        logError(
                            `Expected $or operator in query for resource ${relatedResourceType} when consented PROA data is accessed.`,
                            { query, relatedResourceType }
                        );
                        query = { id: '__invalid__' };
                        continue;
                    }
                    for (const orQuery of query.$or) {
                        if (customParentQuery.length == 1) {
                            orQuery.$and.push(customParentQuery[0]);
                        } else if (customParentQuery.length > 1) {
                            orQuery.$and.push({ $or: customParentQuery });
                        } else {
                            continue;
                        }
                    }
                } else {
                    if (customParentQuery.length == 1) {
                        query.$and = query.$and || [];
                        query.$and.push(customParentQuery[0]);
                    } else if (customParentQuery.length > 1) {
                        query.$or = (query.$or || []).concat(customParentQuery);
                    } else {
                        continue;
                    }
                }

                query = MongoQuerySimplifier.simplifyFilter({ filter: query });
            }

            if (!parentLookupField) {
                const searchParameterName = filterTemplateParam.split('=')[0];

                /**
                 * @type {string}
                 */
                parentLookupField = this.searchParametersManager.getFieldNameForSearchParameter(
                    relatedResourceType,
                    searchParameterName
                );

                if (!parentLookupField) {
                    throw new Error(
                        `${searchParameterName} is not a valid search parameter for resource ${relatedResourceType}`
                    );
                }
            }

            const options = {};
            let projection = {}
            if (useUuidProjection) {
                projection = deepcopy(this.uuidProjection);
                projection[parentLookupField] = 1;
                if (parsedArgs._since) {
                    projection.meta = {
                        lastUpdated: 1
                    }
                }
            }

            // also exclude _id so if there is a covering index the query can be satisfied from the covering index
            projection._id = 0;
            options.projection = projection;

            optionsForQueries.push(options);

            /**
             * @type {number}
             */
            const maxMongoTimeMS = this.configManager.mongoTimeout;
            const databaseQueryManager = this.databaseQueryFactory.createQuery({
                resourceType: relatedResourceType,
                base_version
            });

            let cursor = await databaseQueryManager.findAsync({ query, options });
            cursor = cursor.maxTimeMS({ milliSecs: maxMongoTimeMS });

            if (httpContext.get(HTTP_CONTEXT_KEYS.CONSENTED_PROA_DATA_ACCESSED)) {
                // set index hint for patient filter
                if (relatedResource.indexHintName) {
                    cursor = cursor.hint({ indexHint: relatedResource.indexHintName });
                }
            }

            /**
             * @type {import('mongodb').Document[]}
             */
            const explanations = (explain || debug) ? await cursor.explainAsync() : [];
            if (explain) {
                // if explain is requested then don't return any results
                cursor = cursor.limit(1);
            }
            const collectionName = cursor.getCollection();

            const promiseResult = this.processCursorAsync({
                cursor,
                responseStreamer,
                parentParsedArgs: parsedArgs,
                bundleEntryIdsProcessedTracker,
                nonClinicalReferencesExtractor,
                parentResourcesProcessedTracker,
                parentLookupField,
                proxyPatientIds: proxyPatientIds || [],
                everythingRelatedResourceManager,
                parentResourceType,
                useUuidProjection,
                resourceMapper,
                cachedStreamer
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
            bundleEntries.push(...(entry.bundleEntries || []));
            // Collect streamed resources with their types
            if (entry.streamedResources) {
                streamedResources.push(...entry.streamedResources);
            }
        })


        return {
            entities: bundleEntries,
            queryItems,
            optionsForQueries,
            streamedResources
        }
    }

    /**
     * Fetches the data from cursor and streams it
     * @param {{
     *  cursor: import('../../dataLayer/databaseCursor').DatabaseCursor,
     *  responseStreamer: BaseResponseStreamer,
     *  parentParsedArgs: ParsedArgs,
     *  bundleEntryIdsProcessedTracker: ResourceProccessedTracker|undefined,
     *  resourceIdentifiers: ResourceIdentifier[] | null,
     *  nonClinicalReferencesExtractor: NonClinicalReferencesExtractor | null,
     *  parentResourcesProcessedTracker?: ResourceProccessedTracker,
     *  parentLookupField?: string,
     *  proxyPatientIds?: string[],
     *  parentResourceType?: string,
     *  everythingRelatedResourceManager: EverythingRelatedResourceManager,
     *  useUuidProjection: boolean,
     *  resourceMapper?: ResourceMapper,
     *  cachedStreamer?: CachedFhirResponseStreamer|null,
     * }} options
     * @return {Promise<{ bundleEntries: BundleEntry[], streamedResources: {id: string, resourceType: string}[]}>}
     */
    async processCursorAsync({
        cursor,
        responseStreamer,
        parentParsedArgs,
        bundleEntryIdsProcessedTracker,
        resourceIdentifiers,
        nonClinicalReferencesExtractor,
        parentResourcesProcessedTracker,
        parentLookupField,
        proxyPatientIds,
        parentResourceType,
        everythingRelatedResourceManager,
        useUuidProjection,
        resourceMapper = new ResourceMapper(),
        cachedStreamer = null
    }) {
        /**
         * @type {BundleEntry[]}
         */
        const bundleEntries = [];
        /**
         * @type {{id: string, resourceType: string}[]} - Track resources with types for audit logging
         */
        const streamedResources = [];
        while (await cursor.hasNext()) {
            /**
             * element
             * @type {Resource|null}
             */
            let startResource = await cursor.next();
            if (startResource) {
                /**
                 * @type {BundleEntry}
                 */

                startResource = await this.databaseAttachmentManager.transformAttachments(
                    startResource, RETRIEVE
                );
                let current_entity = {
                    id: startResource._sourceId,
                    resource: startResource
                };


                let sendResource = true;
                if (parentResourceType) {
                    assertIsValid(proxyPatientIds, 'proxyPatientIds should be present');
                    assertIsValid(parentLookupField, 'parentLookupField should be present');
                    assertIsValid(parentResourcesProcessedTracker, 'parentResourcesProcessedTracker should be present');
                    const properties = this.getPropertiesForEntity({
                        resource: startResource, property: parentLookupField
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
                        // supportLegacyId should be true for proxy patient
                        referenceWithSourceIds = properties
                            .flatMap(r => this.getReferencesFromPropertyValue({ propertyValue: r, supportLegacyId: true }))
                            .filter(r => r !== undefined).map(r => r.split('|')[0]);
                    }

                    /**
                     * @type {ResourceIdentifier[]}
                     */
                    let matchingParentReferences = [];

                    let useUuidSet = true;

                    // for handling case for subscription resources where instead of
                    // reference we only have id of person/patient resource in extension/identifier
                    if (
                        references.length == 0 &&
                        SUBSCRIPTION_RESOURCES_REFERENCE_FIELDS.includes(parentLookupField)
                    ) {

                        properties.flat().map((r) => {
                            if (
                                r[
                                SUBSCRIPTION_RESOURCES_REFERENCE_KEY_MAP[parentLookupField]['key']
                                ] === SUBSCRIPTION_RESOURCES_REFERENCE_SYSTEM.person
                            ) {
                                references.push(
                                    PERSON_REFERENCE_PREFIX +
                                    r[SUBSCRIPTION_RESOURCES_REFERENCE_KEY_MAP[parentLookupField]['value']]
                                );
                            } else if (
                                r[
                                SUBSCRIPTION_RESOURCES_REFERENCE_KEY_MAP[parentLookupField]['key']
                                ] === SUBSCRIPTION_RESOURCES_REFERENCE_SYSTEM.patient
                            ) {
                                references.push(
                                    PATIENT_REFERENCE_PREFIX +
                                    r[SUBSCRIPTION_RESOURCES_REFERENCE_KEY_MAP[parentLookupField]['value']]
                                );
                            }
                        });
                        useUuidSet = false;
                    }

                    const referencesSet = new Set(references);
                    parentResourcesProcessedTracker[useUuidSet ? 'uuidSet' : 'sourceIdSet'].forEach(parentReference => {
                        if (referencesSet.has(parentReference)) {
                            matchingParentReferences.push(parentReference);
                        }
                    })

                    // if parent reference is present in child resource, then only send it in response
                    if (matchingParentReferences.length === 0) {
                        if (parentResourceType === 'Patient' && proxyPatientIds && proxyPatientIds.some(id => referenceWithSourceIds.includes(PATIENT_REFERENCE_PREFIX + id))) {
                            sendResource = true;
                        } else {
                            sendResource = false;
                            const parentEntitiesString = Array.from(parentResourcesProcessedTracker.uuidSet).toString()
                            logError(
                                `No match found for parent entities ${parentEntitiesString} ` +
                                `using property ${parentLookupField} in ` +
                                'child entity ' +
                                `${current_entity.resourceType}/${current_entity._uuid}`, {}
                            );
                        }
                    }

                }

                if (sendResource) {
                    if (useUuidProjection){
                        if (parentLookupField) {
                            // remove parent lookup field from result
                            let fieldTodelete = parentLookupField.split('.')[0];
                            delete current_entity.resource[fieldTodelete];
                        }
                        current_entity.id = current_entity.resource._uuid;
                        current_entity.resource.id = current_entity.resource._uuid;
                    }

                    const resourceIdentifier = new ResourceIdentifier(current_entity.resource);

                    // find references
                    if (nonClinicalReferencesExtractor) {
                        await nonClinicalReferencesExtractor.processResource(startResource);
                    }

                    if (!bundleEntryIdsProcessedTracker.has(resourceIdentifier)) {
                        if (resourceIdentifiers) {
                            resourceIdentifiers.push(resourceIdentifier);
                        }
                        // check resource is allowed to be sent and either _since filter is not set or
                        // the last updated time of the resource is greater than the since filter
                        if (
                            everythingRelatedResourceManager.allowedToBeSent(resourceIdentifier.resourceType) &&
                            (!parentParsedArgs._since || current_entity.resource.meta.lastUpdated > parentParsedArgs._since)
                        ) {
                            if (useUuidProjection && parentParsedArgs._since) {
                                current_entity.resource.meta = null; // remove meta to avoid sending lastUpdated
                            }

                            // Apply resource mapper transformation
                            current_entity.resource = resourceMapper.map(current_entity.resource);

                            // if response streamer is present then write the entry to the response streamer
                            if (responseStreamer) {
                                if (cachedStreamer) {
                                    await cachedStreamer.writeBundleEntryToRedis({
                                        bundleEntry: current_entity
                                    });
                                }
                                [current_entity] = await this.enrichmentManager.enrichBundleEntriesAsync({
                                    entries: [current_entity],
                                    parsedArgs: parentParsedArgs
                                });

                                await responseStreamer.writeBundleEntryAsync({
                                    bundleEntry: current_entity
                                });
                                // Track resource ID and type for audit logging
                                streamedResources.push({
                                    id: current_entity.resource.id,
                                    resourceType: current_entity.resource.resourceType
                                });
                                // else push it to the bundle entries
                            } else {
                                bundleEntries.push(current_entity);
                            }
                        }
                        bundleEntryIdsProcessedTracker.add(resourceIdentifier);
                    }
                }
            }
        }

        return { bundleEntries, streamedResources }
    }

    /**
     * converts a query string into an args array
     * @param {string} resourceType
     * @param {string} queryString
     * @param {object} commonArgs
     * @return {ParsedArgs}
     */
    parseQueryStringIntoArgs({ resourceType, queryString, commonArgs = {} }) {
        const args = {};
        Object.assign(args, commonArgs, Object.fromEntries(new URLSearchParams(queryString)));
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
