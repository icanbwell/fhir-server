const { GraphOperation } = require('../graph/graph');
const { ScopesValidator } = require('../security/scopesValidator');
const { assertTypeEquals, assertIsValid } = require('../../utils/assertType');
const { FhirLoggingManager } = require('../common/fhirLoggingManager');
const { ParsedArgs } = require('../query/parsedArgs');
const { ConfigManager } = require('../../utils/configManager');
const patientSummaryGraph = require("../../graphs/patient/summary.json");
const { ComprehensiveIPSCompositionBuilder, TBundle } = require("@imranq2/fhirpatientsummary");
const deepcopy = require('deepcopy');
const { ParsedArgsItem } = require('../query/parsedArgsItem');
const { QueryParameterValue } = require('../query/queryParameterValue');
const { logInfo, logError } = require('../common/logging');
const { DatabaseQueryFactory } = require('../../dataLayer/databaseQueryFactory');
const { SearchManager } = require('../search/searchManager');
const { isUuid } = require('../../utils/uid.util');
const { PERSON_PROXY_PREFIX } = require('../../constants');
const { READ } = require('../../constants').OPERATIONS;
const { SummaryCacheKeyGenerator } = require('./summaryCacheKeyGenerator');
const { CachedFhirResponseStreamer } = require('../../utils/cachedFhirResponseStreamer');
const { RedisStreamManager } = require('../../utils/redisStreamManager');
const { PostRequestProcessor } = require('../../utils/postRequestProcessor');
const { filterResources } = require('../../utils/resourceFilter');
const { mergeBundleMetaTags } = require('./mergeBundleMetaTags');
const { isTrue } = require('../../utils/isTrue');
const { SearchBundleOperation } = require('../search/searchBundle');
const { R4ArgsParser } = require('../query/r4ArgsParser');

class SummaryOperation {
    /**
     * constructor
     * @param {GraphOperation} graphOperation
     * @param {SearchBundleOperation} searchBundleOperation
     * @param {R4ArgsParser} r4ArgsParser
     * @param {FhirLoggingManager} fhirLoggingManager
     * @param {ScopesValidator} scopesValidator
     * @param {ConfigManager} configManager
     * @param {DatabaseQueryFactory} databaseQueryFactory
     * @param {SearchManager} searchManager
     * @param {RedisStreamManager} redisStreamManager
     * @param {PostRequestProcessor} postRequestProcessor
     */
    constructor({ graphOperation, searchBundleOperation, r4ArgsParser, fhirLoggingManager, scopesValidator, configManager, databaseQueryFactory, searchManager, redisStreamManager, postRequestProcessor }) {
        /**
         * @type {GraphOperation}
         */
        this.graphOperation = graphOperation;
        assertTypeEquals(graphOperation, GraphOperation);
        /**
         * @type {SearchBundleOperation}
         */
        this.searchBundleOperation = searchBundleOperation;
        assertTypeEquals(searchBundleOperation, SearchBundleOperation);
        /**
         * @type {R4ArgsParser}
         */
        this.r4ArgsParser = r4ArgsParser;
        assertTypeEquals(r4ArgsParser, R4ArgsParser);
        /**
         * @type {FhirLoggingManager}
         */
        this.fhirLoggingManager = fhirLoggingManager;
        assertTypeEquals(fhirLoggingManager, FhirLoggingManager);

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
         * @type {DatabaseQueryFactory}
         */
        this.databaseQueryFactory = databaseQueryFactory;
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);

        /**
         * @type {SearchManager}
         */
        this.searchManager = searchManager;
        assertTypeEquals(searchManager, SearchManager);

        /**
         * @type {RedisStreamManager}
         */
        this.redisStreamManager = redisStreamManager;
        assertTypeEquals(redisStreamManager, RedisStreamManager);

        /**
         * @type {PostRequestProcessor}
         */
        this.postRequestProcessor = postRequestProcessor;
        assertTypeEquals(postRequestProcessor, PostRequestProcessor);
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
    * @returns {Promise<string[]>}
    */
    async fetchPatientUUID(parsedArgs, requestInfo, resourceType) {
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
        const databaseQueryManager = this.databaseQueryFactory.createQuery({ resourceType, base_version: parsedArgs.base_version });
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
     * @returns {Promise<string|undefined>}
     */
    async getCacheKey(parsedArgs, requestInfo, resourceType) {
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
            if (isUuid(id) && (requestInfo.personIdFromJwtToken === undefined || id === requestInfo.personIdFromJwtToken)) {
                idForCache = `${PERSON_PROXY_PREFIX}${id}`;
            }
        } else {
            let patientIds = await this.fetchPatientUUID(parsedArgs, requestInfo, resourceType);
            idForCache = patientIds && patientIds.length === 1 ? patientIds[0] : undefined;
        }
        let keyGenerator = new SummaryCacheKeyGenerator();
        return idForCache ? keyGenerator.generateCacheKey(
            { id: idForCache, parsedArgs: parsedArgs, scope: requestInfo.scope, contentType: requestInfo.contentTypeFromHeader?.type }
        ) : undefined;
    }

    /**
     * does a FHIR $summary
     * @typedef summaryAsyncParams
     * @property {FhirRequestInfo} requestInfo
     * @property {import('http').ServerResponse} res
     * @property {ParsedArgs} parsedArgs
     * @property {string} resourceType
     * @property {BaseResponseStreamer|undefined} [responseStreamer]
     *
     * @param {summaryAsyncParams}
     * @return {Promise<Bundle>}
     */
    async summaryAsync({ requestInfo, res, parsedArgs, resourceType, responseStreamer }) {
        assertIsValid(requestInfo !== undefined, 'requestInfo is undefined');
        assertIsValid(res !== undefined, 'res is undefined');
        assertIsValid(resourceType !== undefined, 'resourceType is undefined');
        assertTypeEquals(parsedArgs, ParsedArgs);

        /**
         * @type {number}
         */
        const startTime = Date.now();

        try {
            return await this.summaryBundleAsync({
                requestInfo,
                res,
                parsedArgs,
                resourceType,
                responseStreamer // disable response streaming if we are answering a question
            });
        } catch (err) {
            await this.fhirLoggingManager.logOperationFailureAsync({
                requestInfo,
                args: parsedArgs.getRawArgs(),
                resourceType,
                startTime,
                action: 'summary',
                error: err
            });
            throw err;
        }
    }

    /**
     * does a FHIR $summary
     * @typedef summaryBundleAsyncParams
     * @property {FhirRequestInfo} requestInfo
     * @property {import('express').Response} res
     * @property {ParsedArgs} parsedArgs
     * @property {string} resourceType
     * @property {BaseResponseStreamer|undefined} [responseStreamer]
     *
     * @param {summaryBundleAsyncParams}
     * @return {Promise<Bundle>}
     */
    async summaryBundleAsync({ requestInfo, res, parsedArgs, resourceType, responseStreamer }) {
        assertIsValid(requestInfo !== undefined, 'requestInfo is undefined');
        assertIsValid(res !== undefined, 'res is undefined');
        assertIsValid(resourceType !== undefined, 'resourceType is undefined');
        assertTypeEquals(parsedArgs, ParsedArgs);
        const currentOperationName = 'summary';

        /**
         * @type {number}
         */
        const startTime = Date.now();

        await this.scopesValidator.verifyHasValidScopesAsync({
            requestInfo,
            parsedArgs,
            resourceType,
            startTime,
            action: currentOperationName,
            accessRequested: 'read'
        });

        const writeCache = this.configManager.writeToCacheForSummaryOperation;
        const cacheKey = writeCache ? await this.getCacheKey(
            parsedArgs, requestInfo, resourceType
        ) : undefined;
        const cachedStreamer = cacheKey ? new CachedFhirResponseStreamer({
            redisStreamManager: this.redisStreamManager,
            cacheKey,
            responseStreamer,
            ttlSeconds: this.configManager.summaryCacheTtlSeconds,
            enrichmentManager: null,
            parsedArgs
        }) : null;
        const readFromCache = (
            this.configManager.readFromCacheForSummaryOperation &&
            responseStreamer &&
            cachedStreamer &&
            !requestInfo.skipCachedData() &&
            await this.redisStreamManager.hasCachedStream(cacheKey)
        );
        // Check if we need to fall back to MongoDB
        let fallbackToMongo = false;
        if (readFromCache) {
            try {
                await cachedStreamer.streamFromCacheAsync();
                await this.fhirLoggingManager.logOperationSuccessAsync({
                    requestInfo,
                    args: parsedArgs.getRawArgs(),
                    resourceType,
                    startTime,
                    action: currentOperationName
                });
                return undefined;
            } catch (err) {
                fallbackToMongo = !cachedStreamer.writeFromRedisStarted;
                logError('Error reading summary response from cache', { error: err, cacheKey });
                if (!fallbackToMongo) {
                    throw err;
                }
            }
        }

        try {
            const { _type: resourceFilter, headers, id } = parsedArgs;
            const supportLegacyId = false;

            if (resourceFilter) {
                // _type and contained parameter are not supported together
                parsedArgs.contained = 0;
                let resourceFilterList = resourceFilter.split(',');
                parsedArgs.resourceFilterList = resourceFilterList;
            }

            if (resourceType !== 'Patient') {
                throw new Error('$summary is not supported for resource: ' + resourceType);
            }

            // set global_id to true
            const updatedHeaders = {
                prefer: 'global_id=true',
                ...headers
            };
            parsedArgs.headers = updatedHeaders;

            let lastUpdatedQueryParam = null;
            // apply _lastUpdated to linked resources in graph if passed in parameters
            if (parsedArgs._lastUpdated) {
                const lastUpdated = parsedArgs._lastUpdated;

                parsedArgs.remove('_lastUpdated');
                parsedArgs._lastUpdated = null;

                lastUpdatedQueryParam = Array.isArray(lastUpdated)
                    ? `&_lastUpdated=${lastUpdated.join(',')}`
                    : `&_lastUpdated=${lastUpdated}`;
            }

            // apply filter on Observation for last 2 years
            const summaryGraph = deepcopy(patientSummaryGraph);
            const pastDate = new Date();
            pastDate.setFullYear(new Date().getFullYear() - 2);
            const pastDateString = pastDate.toISOString().split('T')[0];
            summaryGraph.link.forEach((link) => {
                link.target.forEach((target) => {
                    if (target.params && target.type === "Observation") {
                        target.params = target.params.replace('{Last2Years}', pastDateString);
                    }
                    if (lastUpdatedQueryParam && target.params && target.type !== "Patient") {
                        target.params += lastUpdatedQueryParam;
                    }
                });
            });

            // disable proxy patient rewrite by default
            if (!parsedArgs._rewritePatientReference) {
                parsedArgs.add(
                    new ParsedArgsItem({
                        queryParameter: '_rewritePatientReference',
                        queryParameterValue: new QueryParameterValue({
                            value: false,
                            operator: '$and'
                        }),
                        modifiers: [],
                        patientToPersonMap: undefined
                    })
                );
            }

            // Compute proxy patient id once and reuse
            const proxyPatientId =
                Array.isArray(id) && id.length > 1
                    ? id.filter((patientId) => patientId.startsWith('person.'))?.[0]
                    : undefined;

            const builder = new ComprehensiveIPSCompositionBuilder();
            const timezone = this.configManager.serverTimeZone;

            const includeSummaryCompositionOnly = isTrue(parsedArgs._includeSummaryCompositionOnly) && proxyPatientId;

            let compositionResult;
            let requiredResourcesList;
            if (includeSummaryCompositionOnly) {

                const compositionParsedArgs = this.r4ArgsParser.parseArgs({
                    resourceType: 'Composition',
                    args: {
                        _rewritePatientReference: false,
                        _debug: parsedArgs._debug,
                        _explain: parsedArgs._explain,
                        headers: parsedArgs.headers,
                        base_version: parsedArgs.base_version,
                        patient: proxyPatientId,
                        identifier: 'https://fhir.icanbwell.com/4_0_0/CodeSystem/composition/bwell|bwell_composition_for_health_data_summary,https://fhir.icanbwell.com/4_0_0/CodeSystem/composition/bwell|bwell_composition_for_international_patient_summary'
                    }
                })


                /**
                 * @type {import('../../fhir/classes/4_0_0/resources/bundle')}
                 */
                compositionResult = await this.searchBundleOperation.searchBundleAsync({
                    requestInfo,
                    res,
                    parsedArgs: compositionParsedArgs,
                    resourceType: 'Composition'
                });

                requiredResourcesList = builder.getRemainingResourcesFromCompositionBundle(
                    compositionResult
                );
                if (requiredResourcesList.length > 0) {
                    parsedArgs.resource = filterResources(
                        deepcopy(summaryGraph),
                        requiredResourcesList
                    );
                } else {
                    parsedArgs.resource = {};
                }
            } else {
                parsedArgs.resource = summaryGraph;
            }

            /**
             * @type {import('../../fhir/classes/4_0_0/resources/bundle')}
             */
            const result = await this.graphOperation.graph({
                requestInfo,
                res,
                parsedArgs,
                resourceType,
                responseStreamer: null, // don't stream the response for $summary since we will generate a summary bundle
                supportLegacyId
            });

            let combinedResult = result;

            if (includeSummaryCompositionOnly) {
                if (compositionResult && Array.isArray(compositionResult.entry) && compositionResult.entry.length > 0) {
                    combinedResult.entry = combinedResult.entry || [];
                    for (const e of compositionResult.entry) {
                        combinedResult.entry.push(e);
                    }
                }
                combinedResult = mergeBundleMetaTags(combinedResult, compositionResult);
            }

            if (!combinedResult || !combinedResult.entry || combinedResult.entry.length === 0) {
                // no resources found
                if (responseStreamer) {
                    responseStreamer.setBundle({ bundle: combinedResult });
                    return undefined;
                }
                else {
                    return combinedResult;
                }
            }

            await builder.readBundleAsync(
                /** @type {TBundle} */(combinedResult),
                timezone,
                proxyPatientId ? true : false,
                includeSummaryCompositionOnly,
                {
                    info: (msg, args = {}) => logInfo(msg, args),
                    error: (msg, args = {}) => logError(msg, args)
                }
            );
            // noinspection JSCheckFunctionSignatures
            const summaryBundle = await builder.buildBundleAsync(
                this.configManager.summaryGeneratorOrganizationId,
                this.configManager.summaryGeneratorOrganizationName,
                this.configManager.summaryGeneratorOrganizationBaseUrl,
                timezone,
                includeSummaryCompositionOnly,
                proxyPatientId
            );

            // add meta information from merged bundle
            summaryBundle.meta = combinedResult.meta;

            if (responseStreamer) {
                const summaryBundleEntries = summaryBundle.entry;
                delete summaryBundle.entry;
                responseStreamer.setBundle({ bundle: summaryBundle });
                for (const entry of summaryBundleEntries) {
                    await responseStreamer.writeBundleEntryAsync({
                        bundleEntry: entry
                    });
                }
                if (cachedStreamer) {
                    this.postRequestProcessor.add({
                        requestId: requestInfo.requestId,
                        fnTask: async () => {
                            try {
                                for (const entry of summaryBundleEntries) {
                                    await cachedStreamer.writeBundleEntryToRedis({
                                        bundleEntry: entry
                                    });
                                }
                            } catch (error) {
                                logError(`Error in caching summary bundle: ${error.message}`, { error });
                                await this.redisStreamManager.deleteStream(cacheKey);
                            }
                        }
                    });
                }
                await this.fhirLoggingManager.logOperationSuccessAsync({
                    requestInfo,
                    args: parsedArgs.getRawArgs(),
                    resourceType,
                    startTime,
                    action: currentOperationName
                });
                // data was already written to the response streamer
                return undefined;
            } else {
                await this.fhirLoggingManager.logOperationSuccessAsync({
                    requestInfo,
                    args: parsedArgs.getRawArgs(),
                    resourceType,
                    startTime,
                    action: currentOperationName
                });
                return summaryBundle;
            }
        } catch (err) {
            await this.fhirLoggingManager.logOperationFailureAsync({
                requestInfo,
                args: parsedArgs.getRawArgs(),
                resourceType,
                startTime,
                action: currentOperationName,
                error: err
            });
            throw err;
        }
    }
}

module.exports = {
    SummaryOperation
};
