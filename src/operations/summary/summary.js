const { GraphOperation } = require('../graph/graph');
const { ScopesValidator } = require('../security/scopesValidator');
const { assertTypeEquals, assertIsValid } = require('../../utils/assertType');
const { FhirLoggingManager } = require('../common/fhirLoggingManager');
const { ParsedArgs } = require('../query/parsedArgs');
const { ConfigManager } = require('../../utils/configManager');
const patientSummaryGraph = require('../../graphs/patient/summary.json');
const { ComprehensiveIPSCompositionBuilder, TBundle } = require('@imranq2/fhirpatientsummary');
const deepcopy = require('deepcopy');
const { ParsedArgsItem } = require('../query/parsedArgsItem');
const { QueryParameterValue } = require('../query/queryParameterValue');
const { logInfo, logError } = require('../common/logging');
const { isUuid } = require('../../utils/uid.util');
const { PERSON_PROXY_PREFIX, CACHE_STATUS } = require('../../constants');
const { SummaryCacheKeyGenerator } = require('./summaryCacheKeyGenerator');
const { RedisManager } = require('../../utils/redisManager');
const { PostRequestProcessor } = require('../../utils/postRequestProcessor');
const { filterGraphResources } = require('../../utils/filterGraphResources');
const { mergeBundleMetaTags } = require('./mergeBundleMetaTags');
const { isTrue } = require('../../utils/isTrue');
const { SearchBundleOperation } = require('../search/searchBundle');
const { R4ArgsParser } = require('../query/r4ArgsParser');
const { FhirRequestInfo } = require('../../utils/fhirRequestInfo');
const { BaseResponseHandler } = require('../../utils/responseHandler/baseResponseHandler');
const { EnrichmentManager } = require('../../enrich/enrich');

class SummaryOperation {
    /**
     * constructor
     * @param {GraphOperation} graphOperation
     * @param {SearchBundleOperation} searchBundleOperation
     * @param {R4ArgsParser} r4ArgsParser
     * @param {FhirLoggingManager} fhirLoggingManager
     * @param {ScopesValidator} scopesValidator
     * @param {ConfigManager} configManager
     * @param {RedisManager} redisManager
     * @param {EnrichmentManager} enrichmentManager
     * @param {PostRequestProcessor} postRequestProcessor
     * @param {SummaryCacheKeyGenerator} summaryCacheKeyGenerator
     */
    constructor({
        graphOperation,
        searchBundleOperation,
        r4ArgsParser,
        fhirLoggingManager,
        scopesValidator,
        configManager,
        redisManager,
        enrichmentManager,
        postRequestProcessor,
        summaryCacheKeyGenerator
    }) {
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
         * @type {RedisManager}
         */
        this.redisManager = redisManager;
        assertTypeEquals(redisManager, RedisManager);

        /**
         * @type {EnrichmentManager}
         */
        this.enrichmentManager = enrichmentManager;
        assertTypeEquals(enrichmentManager, EnrichmentManager);

        /**
         * @type {PostRequestProcessor}
         */
        this.postRequestProcessor = postRequestProcessor;
        assertTypeEquals(postRequestProcessor, PostRequestProcessor);

        /**
         * @type {SummaryCacheKeyGenerator}
         */
        this.summaryCacheKeyGenerator = summaryCacheKeyGenerator;
        assertTypeEquals(this.summaryCacheKeyGenerator, SummaryCacheKeyGenerator);
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
     * Get cache key for a given request
     * @param {ParsedArgs} parsedArgs
     * @param {FhirRequestInfo} requestInfo
     * @returns {Promise<string|undefined>}
     */
    async getCacheKey(parsedArgs, requestInfo) {
        let paramsIds = this.fetchOriginalIdsFromParams(parsedArgs);
        // Multiple ids are not supported and check for cacheable response type
        if (
            paramsIds.length !== 1 ||
            !this.summaryCacheKeyGenerator.isResponseTypeCacheable(requestInfo.accept, parsedArgs)
        ) {
            return undefined;
        }
        let id = paramsIds[0];

        if (id.startsWith(PERSON_PROXY_PREFIX)) {
            id = id.replace(PERSON_PROXY_PREFIX, '');
            if (isUuid(id) && (!requestInfo.isUser || id === requestInfo.personIdFromJwtToken)) {
                return await this.summaryCacheKeyGenerator.generateCacheKey({
                    id,
                    isPersonId: true,
                    parsedArgs: parsedArgs,
                    scope: requestInfo.scope
                });
            }
        }

        return undefined;
    }

    /**
     * does a FHIR $summary
     * @typedef summaryAsyncParams
     * @property {FhirRequestInfo} requestInfo
     * @property {import('http').ServerResponse} res
     * @property {ParsedArgs} parsedArgs
     * @property {string} resourceType
     * @property {BaseResponseHandler} responseHandler
     *
     * @param {summaryAsyncParams}
     * @return {Promise<Bundle>}
     */
    async summaryAsync({ requestInfo, res, parsedArgs, resourceType, responseHandler }) {
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
                responseHandler
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
     * @property {BaseResponseHandler} responseHandler
     *
     * @param {summaryBundleAsyncParams}
     * @return {Promise<Bundle>}
     */
    async summaryBundleAsync({ requestInfo, res, parsedArgs, resourceType, responseHandler }) {
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

        try {
            const { headers, id } = parsedArgs;

            if (resourceType !== 'Patient') {
                throw new Error('$summary is not supported for resource: ' + resourceType);
            }

            // set global_id to true
            const updatedHeaders = {
                prefer: 'global_id=true',
                ...headers
            };
            parsedArgs.headers = updatedHeaders;

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

            let patientDataBundle = null;

            // Compute proxy patient id once and reuse
            const proxyPatientId =
                Array.isArray(id) && id.length > 1
                    ? id.filter((patientId) => patientId.startsWith('person.'))?.[0]
                    : undefined;
            const builder = new ComprehensiveIPSCompositionBuilder();
            const timezone = this.configManager.serverTimeZone;
            const includeSummaryCompositionOnly =
                proxyPatientId && isTrue(parsedArgs._includeSummaryCompositionOnly);

            const cacheKey = this.configManager.writeToCacheForSummaryOperation
                ? await this.getCacheKey(parsedArgs, requestInfo)
                : undefined;

            let readFromCache =
                cacheKey &&
                this.configManager.readFromCacheForSummaryOperation &&
                !requestInfo.skipCachedData() &&
                (await this.redisManager.hasCacheKeyAsync(cacheKey));

            if (readFromCache) {
                try {
                    patientDataBundle = await this.redisManager.readBundleFromCacheAsync(cacheKey);
                } catch (err) {
                    logError('Error reading summary response from cache', { error: err, cacheKey });
                    readFromCache = false;
                    patientDataBundle = null;
                }
            }

            // fetch data using graph if not read from cache
            if (!patientDataBundle) {
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

                // Get _profile parameter for filtering Composition resources
                // Per FHIR spec, we use _profile as the search parameter
                const profileParam = parsedArgs._profile;
                const profileQueryParam = profileParam
                    ? `&_profile=${Array.isArray(profileParam) ? profileParam.join(',') : profileParam}`
                    : null;

                // Remove _profile from parsedArgs so it doesn't apply to other resource types
                if (profileParam) {
                    parsedArgs.remove('_profile');
                    parsedArgs._profile = null;
                }

                // apply filter on Observation for last 2 years
                const summaryGraph = deepcopy(patientSummaryGraph);
                const pastDate = new Date();
                pastDate.setFullYear(new Date().getFullYear() - 2);
                const pastDateString = pastDate.toISOString().split('T')[0];
                summaryGraph.link.forEach((link) => {
                    link.target.forEach((target) => {
                        if (target.params && target.type === 'Observation') {
                            target.params = target.params.replace('{Last2Years}', pastDateString);
                        }
                        if (lastUpdatedQueryParam && target.params && target.type !== 'Patient') {
                            target.params += lastUpdatedQueryParam;
                        }
                        if (profileQueryParam && target.params && target.type === 'Composition') {
                            target.params += profileQueryParam;
                        }
                    });
                });

                let compositionResult;
                if (includeSummaryCompositionOnly) {
                    const compositionSearchArgs = {
                        _rewritePatientReference: false,
                        _debug: parsedArgs._debug,
                        _explain: parsedArgs._explain,
                        headers: parsedArgs.headers,
                        base_version: parsedArgs.base_version,
                        patient: proxyPatientId,
                        identifier:
                            'https://fhir.icanbwell.com/4_0_0/CodeSystem/composition/bwell|bwell_composition_for_health_data_summary,https://fhir.icanbwell.com/4_0_0/CodeSystem/composition/bwell|bwell_composition_for_international_patient_summary'
                    };

                    if (profileParam) {
                        compositionSearchArgs._profile = profileParam;
                    }

                    const compositionParsedArgs = this.r4ArgsParser.parseArgs({
                        resourceType: 'Composition',
                        args: compositionSearchArgs
                    });

                    /**
                     * @type {import('../../fhir/classes/4_0_0/resources/bundle')}
                     */
                    compositionResult = await this.searchBundleOperation.searchBundleAsync({
                        requestInfo,
                        res,
                        parsedArgs: compositionParsedArgs,
                        resourceType: 'Composition'
                    });

                    const requiredResourcesList =
                        builder.getRemainingResourcesFromCompositionBundle(compositionResult);
                    if (requiredResourcesList.length > 0) {
                        parsedArgs.resource = filterGraphResources(
                            deepcopy(summaryGraph),
                            requiredResourcesList
                        );
                    } else {
                        parsedArgs.resource = {};
                    }
                } else {
                    parsedArgs.resource = summaryGraph;
                }

                if (parsedArgs.resource && Object.keys(parsedArgs.resource).length > 0) {
                    const graphArgs = this.r4ArgsParser.parseArgs({
                        resourceType: 'Patient',
                        args: {
                            _debug: parsedArgs._debug,
                            _explain: parsedArgs._explain,
                            base_version: parsedArgs.base_version,
                            resource: parsedArgs.resource,
                            _rewritePatientReference: false
                        }
                    });
                    graphArgs.add(parsedArgs.get('_id'));
                    graphArgs.headers = {
                        prefer: 'global_id=false'
                    };

                    patientDataBundle = await this.graphOperation.graph({
                        requestInfo,
                        res,
                        parsedArgs: graphArgs,
                        resourceType,
                        responseStreamer: null, // don't stream the response for $summary since we will generate a summary bundle
                        supportLegacyId: false
                    });
                }

                if (includeSummaryCompositionOnly) {
                    if (
                        compositionResult &&
                        Array.isArray(compositionResult.entry) &&
                        compositionResult.entry.length > 0
                    ) {
                        patientDataBundle.entry = patientDataBundle.entry || [];
                        patientDataBundle.entry = patientDataBundle.entry.concat(
                            compositionResult.entry
                        );
                    }
                    patientDataBundle = mergeBundleMetaTags(patientDataBundle, compositionResult);
                }

                if (cacheKey) {
                    const patientDataBundleForCache = deepcopy(patientDataBundle);
                    this.postRequestProcessor.add({
                        requestId: requestInfo.requestId,
                        fnTask: async () => {
                            try {
                                await this.redisManager.writeBundleAsync(
                                    cacheKey,
                                    patientDataBundleForCache
                                );
                            } catch (error) {
                                logError(`Error in caching summary bundle: ${error.message}`, {
                                    error
                                });
                                await this.redisManager.deleteKeyAsync(cacheKey);
                            }
                        }
                    });
                }
            }

            if (
                !patientDataBundle ||
                !patientDataBundle.entry ||
                patientDataBundle.entry.length === 0
            ) {
                // no resources found
                await responseHandler.sendResponseAsync(
                    patientDataBundle,
                    readFromCache ? CACHE_STATUS.HIT : CACHE_STATUS.MISS
                );
            } else {
                patientDataBundle.entry = await this.enrichmentManager.enrichBundleEntriesAsync({
                    entries: patientDataBundle.entry,
                    parsedArgs
                });

                await builder.readBundleAsync(
                    /** @type {TBundle} */ (patientDataBundle),
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
                summaryBundle.meta = patientDataBundle.meta;
                await responseHandler.sendResponseAsync(
                    summaryBundle,
                    readFromCache ? CACHE_STATUS.HIT : CACHE_STATUS.MISS
                );
            }

            await this.fhirLoggingManager.logOperationSuccessAsync({
                requestInfo,
                args: parsedArgs.getRawArgs(),
                resourceType,
                startTime,
                action: currentOperationName
            });
            return;
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
