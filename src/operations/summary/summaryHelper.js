/**
 * This file contains functions to retrieve summarized resources of given resource from the database
 */
const {assertTypeEquals, assertIsValid} = require('../../utils/assertType');
const {DatabaseQueryFactory} = require('../../dataLayer/databaseQueryFactory');
const BundleEntry = require('../../fhir/classes/4_0_0/backbone_elements/bundleEntry');
const {ConfigManager} = require('../../utils/configManager');
const {BundleManager} = require('../common/bundleManager');
const {RethrownError} = require('../../utils/rethrownError');
const {SearchManager} = require('../search/searchManager');
const Bundle = require('../../fhir/classes/4_0_0/resources/bundle');
const {EnrichmentManager} = require('../../enrich/enrich');
const {R4ArgsParser} = require('../query/r4ArgsParser');
const {ParsedArgs} = require('../query/parsedArgs');
const {VERSIONS} = require('../../middleware/fhir/utils/constants');
const {logError} = require('../common/logging');
const {sliceIntoChunksGenerator} = require('../../utils/list.util');
const {ResourceIdentifier} = require('../../fhir/resourceIdentifier');
const {DatabaseAttachmentManager} = require('../../dataLayer/databaseAttachmentManager');
const {
    GRIDFS: {RETRIEVE},
    OPERATIONS: {READ},
    SUBSCRIPTION_RESOURCES_REFERENCE_FIELDS,
    SUBSCRIPTION_RESOURCES_REFERENCE_KEY_MAP,
    PATIENT_REFERENCE_PREFIX,
    PERSON_REFERENCE_PREFIX,
    SUBSCRIPTION_RESOURCES_REFERENCE_SYSTEM,
    PERSON_PROXY_PREFIX,
    EVERYTHING_OP_NON_CLINICAL_RESOURCE_DEPTH,
    HTTP_CONTEXT_KEYS,
    CONSENT_CATEGORY
} = require('../../constants');
const {SearchParametersManager} = require('../../searchParameters/searchParametersManager');
const Resource = require('../../fhir/classes/4_0_0/resources/resource');
const {DatabasePartitionedCursor} = require('../../dataLayer/databasePartitionedCursor');
const {ProcessMultipleIdsAsyncResult} = require('../common/processMultipleIdsAsyncResult');
const {QueryItem} = require('../graph/queryItem');
const {ResourceProccessedTracker} = require('../../fhir/resourceProcessedTracker');
const {BadRequestError} = require('../../utils/httpErrors');
const {MongoQuerySimplifier} = require('../../utils/mongoQuerySimplifier');
const {isUuid} = require('../../utils/uid.util');
const {isTrue} = require('../../utils/isTrue');
const {isFalseWithFallback} = require('../../utils/isFalse');
const deepcopy = require('deepcopy');
const httpContext = require('express-http-context');
const {ReferenceParser} = require('../../utils/referenceParser');

/**
 * @typedef {import('../../utils/fhirRequestInfo').FhirRequestInfo} FhirRequestInfo
 * @typedef {import('./summaryRelatedResourcesMapper').SummaryRelatedResources} SummaryRelatedResources
 * @typedef {import('../query/parsedArgsItem').ParsedArgsItem}  ParsedArgsItem
 * @typedef {import('../../utils/baseResponseStreamer').BaseResponseStreamer}  BaseResponseStreamer
 *
 * @typedef {Record<string, Set<string>> | null} NestedResourceReferences
 */

/**
 * This class is for $summary operation
 */
class SummaryHelper {
    /**
     * @typedef {Object} SummaryHelperParams
     * @property {DatabaseQueryFactory} databaseQueryFactory
     * @property {ConfigManager} configManager
     * @property {BundleManager} bundleManager
     * @property {SearchManager} searchManager
     * @property {EnrichmentManager} enrichmentManager
     * @property {R4ArgsParser} r4ArgsParser
     * @property {DatabaseAttachmentManager} databaseAttachmentManager
     * @property {SearchParametersManager} searchParametersManager
     *
     * @param {SummaryHelperParams}
     */
    constructor({
                    databaseQueryFactory,
                    configManager,
                    bundleManager,
                    searchManager,
                    enrichmentManager,
                    r4ArgsParser,
                    databaseAttachmentManager,
                    searchParametersManager,
                    summaryRelatedResourceMapper
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
         * @type {string[]}
         */
        this.supportedResources = ["Patient"];


        /**
         * @type {Record<str,string[]>}
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
    }

    /**
     * @typedef {Object} retriveSummaryAsyncParams
     * @property {FhirRequestInfo} requestInfo
     * @property {string} resourceType
     * @property {string} base_version
     * @property {BaseResponseStreamer|undefined} responseStreamer
     * @property {ParsedArgs} parsedArgs
     * @property {boolean} supportLegacyId
     * @property {boolean} includeNonClinicalResources
     * @property {boolean} getRaw
     *
     * @param {retriveSummaryAsyncParams}
     * @return {Promise<Bundle>}
     */
    async retriveSummaryAsync({
                                  requestInfo,
                                  base_version,
                                  resourceType,
                                  responseStreamer,
                                  parsedArgs,
                                  includeNonClinicalResources = true,
                                  getRaw = false
                              }) {
        if (!this.supportedResources.includes(resourceType)) {
            throw new Error('$summary is not supported for resource: ' + resourceType);
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
            const idChunks = ids ? sliceIntoChunksGenerator(ids, this.configManager.summaryBatchSize) : [];

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
                let proxyPatientIds = [];
                if (resourceType === 'Patient') {
                    proxyPatientIds = idChunk.filter((q) => q && q.startsWith(PERSON_PROXY_PREFIX));

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
                    explanations: explanations1
                } = await this.retrieveSummaryMulipleIdsAsync(
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
                responseStreamer.setBundle({bundle, rawResources: getRaw});
            }
            return bundle;
        } catch (error) {
            logError(`Error in retriveSummaryAsync(): ${error.message}`, {error});
            throw new RethrownError({
                message: 'Error in retriveSummaryAsync(): ' + `resourceType: ${resourceType} , ` + error.message,
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
     * @typedef {Object} RetrieveSummaryMulipleIdsAsyncParams
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
     * @property {boolean} getRaw
     *
     * @param {RetrieveSummaryMulipleIdsAsyncParams}
     * @return {Promise<ProcessMultipleIdsAsyncResult>}
     */
    async retrieveSummaryMulipleIdsAsync({
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
                                             getRaw = false
                                         }) {
        assertTypeEquals(parsedArgs, ParsedArgs);
        try {
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

            if (isTrue(parsedArgs._includePatientLinkedUuidOnly)) {
                useUuidProjection = true;
            }

            // patient resource don't exist for proxy patient
            if (isFalseWithFallback(parsedArgs._includeProxyPatientLinkedOnly, true)) {
                ({
                    options: optionsForQueries,
                    explanations,
                    entries,
                    queryItems: queries
                } = await this.fetchResourceByArgsAsync({
                    resourceType,
                    base_version,
                    explain,
                    debug,
                    getRaw,
                    parsedArgs,
                    responseStreamer,
                    bundleEntryIdsProcessedTracker,
                    resourceIdentifiers: baseResourceIdentifiers,
                    requestInfo,
                    useUuidProjection
                }));
            }

            if (isTrue(parsedArgs._excludeProxyPatientLinked)) {
                proxyPatientIds = [];
            }

            let resourceToExcludeIdsMap = {};

            // get Consent resource containing resources marked as deleted to exclude
            if (requestInfo.isUser) {
                let {
                    entries: viewControlConsentEntries,
                    queryItems: viewControlConsentQueries,
                    options: viewControlConsentQueryOptions
                } = await this.getDataConnectionViwControlConsentAsync({
                    getRaw,
                    requestInfo,
                    base_version,
                    patientResourceIdentifiers: baseResourceIdentifiers
                });

                viewControlConsentEntries.forEach(entry => {
                    entry.resource.provision?.data?.forEach(ref => {
                        if (ref?.reference?.reference) {
                            const {
                                resourceType: refType,
                                id: refId
                            } = ReferenceParser.parseReference(ref.reference.reference);
                            if (refType && refId) {
                                if (!resourceToExcludeIdsMap[refType]) {
                                    resourceToExcludeIdsMap[refType] = [];
                                }
                                resourceToExcludeIdsMap[refType].push(refId);
                            }
                        }
                    });
                });

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
            });

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
            logError(`Error in retrieveSummaryMulipleIdsAsync(): ${e.message}`, {error: e});
            throw new RethrownError({
                message: 'Error in retrieveSummaryMulipleIdsAsync(): ' + `resourceType: ${resourceType} , `,
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
     * @property {boolean} getRaw
     * @property {boolean} applyPatientFilter
     * @property {Boolean} useUuidProjection
     * @property {boolean} addInBundleOnly
     *
     * @param {FetchResourceByArgsAsyncParams}
     * @return {Promise<ProcessMultipleIdsAsyncResult>}
     */
    async fetchResourceByArgsAsync(
        {
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
            useUuidProjection = false,
            applyPatientFilter = true,
            addInBundleOnly = false
        }
    ) {

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
            accessRequested: (requestInfo.method.toLowerCase() === 'delete' ? 'write' : 'read'),
            addPersonOwnerToContext: requestInfo.isUser,
            applyPatientFilter
        });


        const options = {};
        let projection = {};
        if (useUuidProjection) {
            projection = deepcopy(this.uuidProjection);
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

        const databaseQueryManager = this.databaseQueryFactory.createQuery({resourceType, base_version});
        /**
         * mongo db cursor
         * @type {DatabasePartitionedCursor}
         */
        let cursor = await databaseQueryManager.findAsync({query, options});
        cursor = cursor.maxTimeMS({milliSecs: maxMongoTimeMS});

        const collectionName = cursor.getFirstCollection();

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

        const {bundleEntries} = await this.processCursorAsync({
            cursor,
            getRaw,
            parentParsedArgs: parsedArgs,
            responseStreamer: responseStreamer,
            bundleEntryIdsProcessedTracker,
            resourceIdentifiers,
            useUuidProjection,
            addInBundleOnly
        });

        entries.push(...(bundleEntries || []));

        return new ProcessMultipleIdsAsyncResult({
            entries,
            queryItems: queries,
            options: optionsForQueries,
            explanations
        })

    }

    /**
     * Fetches the data from cursor and streams it
     * @param {{
     *  cursor: DatabasePartitionedCursor,
     *  responseStreamer: BaseResponseStreamer,
     *  parentParsedArgs: ParsedArgs,
     *  bundleEntryIdsProcessedTracker: ResourceProccessedTracker|undefined,
     *  resourceIdentifiers: ResourceIdentifier[] | null,
     *  getRaw: boolean,
     *  parentResourcesProcessedTracker?: ResourceProccessedTracker,
     *  parentLookupField?: string,
     *  proxyPatientIds?: string[],
     *  parentResourceType?: string,
     *  useUuidProjection: boolean,
     *  addInBundleOnly: boolean
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
                                 parentResourcesProcessedTracker,
                                 parentLookupField,
                                 proxyPatientIds,
                                 parentResourceType,
                                 useUuidProjection,
                                 addInBundleOnly = false
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
                        id: startResource._sourceId,
                        resource: startResource
                    }
                    : new BundleEntry({
                        id: startResource._sourceId,
                        resource: startResource
                    });


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
                        .flatMap(r => this.getReferencesFromPropertyValue({propertyValue: r}))
                        .filter(r => r !== undefined).map(r => r.split('|')[0]);

                    // for handling case when searching using sourceid of proxy patient
                    /**
                     * @type {string[]}
                     */
                    let referenceWithSourceIds = [];
                    if (proxyPatientIds) {
                        // supportLegacyId should be true for proxy patient
                        referenceWithSourceIds = properties
                            .flatMap(r => this.getReferencesFromPropertyValue({
                                propertyValue: r,
                                supportLegacyId: true
                            }))
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
                        references.length === 0 &&
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
                    });

                    // if parent reference is present in child resource, then only send it in response
                    if (matchingParentReferences.length === 0) {
                        if (parentResourceType === 'Patient' && proxyPatientIds && proxyPatientIds.some(id => referenceWithSourceIds.includes(PATIENT_REFERENCE_PREFIX + id))) {
                            sendResource = true;
                        } else {
                            sendResource = false;
                            const parentEntitiesString = Array.from(parentResourcesProcessedTracker.uuidSet).toString();
                            logError(
                                `No match found for parent entities ${parentEntitiesString} ` +
                                `using property ${parentLookupField} in ` +
                                'child entity ' +
                                `${current_entity.resourceType}/${current_entity._uuid}`, {}
                            );
                        }
                    }

                }

                if (addInBundleOnly) {
                    // if addInBundleOnly is true, then we don't need to send the resource
                    // in the response, we just need to add it to the bundle
                    bundleEntries.push(current_entity);
                } else if (sendResource) {
                    if (useUuidProjection) {
                        if (parentLookupField) {
                            // remove parent lookup field from result
                            let fieldTodelete = parentLookupField.split('.')[0];
                            delete current_entity.resource[fieldTodelete];
                        }
                        current_entity.id = current_entity.resource._uuid;
                        current_entity.resource.id = current_entity.resource._uuid;
                    }

                    const resourceIdentifier = new ResourceIdentifier(current_entity.resource);

                    if (
                        responseStreamer
                    ) {
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
                            if (summaryRelatedResourceManager.allowedToBeSent(resourceIdentifier.resourceType)) {
                                bundleEntries.push(current_entity);
                            }
                        }
                    }

                    bundleEntryIdsProcessedTracker.add(resourceIdentifier);
                }
            }
        }

        return {bundleEntries}
    }

    /**
     * returns property values
     * @param {Resource} resource
     * @param {string} property Property to read
     * @param {string?} filterProperty Filter property (optional)
     * @param {string?} filterValue Filter value (optional)
     * @returns {Object[]}
     */
    getPropertiesForEntity({resource, property, filterProperty, filterValue}) {
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
    getReferencesFromPropertyValue({propertyValue, supportLegacyId = false}) {
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

    /**
     * Fetch the Consent resources for data connection view control
     * @param {{
     * getRaw: boolean,
     * requestInfo: FhirRequestInfo,
     * base_version: string,
     * patientResourceIdentifiers: ResourceIdentifier[],
     * }} options
     * @return {Promise<{ ProcessMultipleIdsAsyncResult }>}
     */
    async getDataConnectionViwControlConsentAsync({getRaw, requestInfo, base_version, patientResourceIdentifiers}) {
        const {personIdFromJwtToken} = requestInfo;

        /**
         * @type {string | null}
         */
        let userOwnerFromContext = httpContext.get(`${HTTP_CONTEXT_KEYS.PERSON_OWNER_PREFIX}${personIdFromJwtToken}`);
        assertIsValid(userOwnerFromContext);

        if (!this.configManager.clientsWithDataConnectionViewControl.includes(userOwnerFromContext)) {
            return new ProcessMultipleIdsAsyncResult({
                entries: [],
                queryItems: [],
                options: [],
                explanations: []
            });
        }

        let resourceType = 'Consent';
        let patientReference = patientResourceIdentifiers.map(patientIdentifier => {
            return `${PATIENT_REFERENCE_PREFIX}${patientIdentifier._uuid}`;
        });

        return await this.fetchResourceByArgsAsync({
            resourceType,
            base_version,
            requestInfo,
            explain: false,
            debug: false,
            parsedArgs: this.r4ArgsParser.parseArgs({
                resourceType,
                args: {
                    base_version,
                    patient: `Patient/person.${personIdFromJwtToken}`,
                    actor: patientReference.join(','),
                    category: `${CONSENT_CATEGORY.DATA_CONNECTION_VIEW_CONTROL.SYSTEM}|${CONSENT_CATEGORY.DATA_CONNECTION_VIEW_CONTROL.CODE}`
                }
            }),
            getRaw,
            applyPatientFilter: false,
            addInBundleOnly: true
        });
    }
}

module.exports = {
    SummaryHelper
};
