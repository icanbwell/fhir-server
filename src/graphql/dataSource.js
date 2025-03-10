const { logWarn } = require('../operations/common/logging');
const async = require('async');
const DataLoader = require('dataloader');
const { REFERENCE_EXTENSION_DATA_MAP, OPERATIONS: { READ }, COLLECTION } = require('../constants');
const { groupByLambda } = require('../utils/list.util');
const { assertTypeEquals, assertIsValid } = require('../utils/assertType');
const { R4ArgsParser } = require('../operations/query/r4ArgsParser');
const { QueryRewriterManager } = require('../queryRewriters/queryRewriterManager');
const { ResourceWithId } = require('./resourceWithId');
const { isValidResource } = require('../utils/validResourceCheck');
const { ReferenceParser } = require('../utils/referenceParser');
const { ConfigManager } = require('../utils/configManager');
const { parseResolveInfo } = require('graphql-parse-resolve-info');
const { getResource } = require('../operations/common/getResource');
const { VERSIONS } = require('../middleware/fhir/utils/constants');

/**
 * This class implements the DataSource pattern, so it is called by our GraphQL resolvers to load the data
 */
class FhirDataSource {
    /**
     * @param {FhirRequestInfo} requestInfo
     * @param {SearchBundleOperation} searchBundleOperation
     * @param {R4ArgsParser} r4ArgsParser
     * @param {QueryRewriterManager} queryRewriterManager
     * @param {ConfigManager} configManager
     */
    constructor (
        {
            requestInfo,
            searchBundleOperation,
            r4ArgsParser,
            queryRewriterManager,
            configManager
        }
    ) {
        assertIsValid(requestInfo !== undefined);

        /**
         * @type {SearchBundleOperation}
         */
        this.searchBundleOperation = searchBundleOperation;
        /**
         * @type {FhirRequestInfo}
         */
        this.requestInfo = requestInfo;
        /**
         * @type {DataLoader<unknown, {resourceType: string, id: string}, Resource>}
         */
        this.dataLoader = null;
        /**
         * @type {Meta[]}
         */
        this.metaList = [];

        /**
         * @type {R4ArgsParser}
         */
        this.r4ArgsParser = r4ArgsParser;
        assertTypeEquals(this.r4ArgsParser, R4ArgsParser);

        /**
         * @type {QueryRewriterManager}
         */
        this.queryRewriterManager = queryRewriterManager;
        assertTypeEquals(this.queryRewriterManager, QueryRewriterManager);

        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(this.configManager, ConfigManager);

        /**
         * whether the caller has requested debug mode
         * @type {boolean}
         */
        this.debugMode = false;

        /**
         * contains list of all fields requested for each resource
         * @type {object|null}
         */
        this.resourceProjections = null;

        /**
         * whether to disable class object creation while getting bundle
         * @type {boolean}
         */
        this.getRawBundle = this.configManager.getRawGraphQLBundle;
    }

    /**
     * This function takes a FHIR Bundle and returns the resources in it
     * @param {Bundle} bundle
     * @return {Resource[]}
     */
    unBundle (bundle) {
        if (bundle.meta) {
            this.metaList.push(bundle.meta);
        }
        return bundle.entry ? bundle.entry.map((e) => e.resource) : [];
    }

    /**
     * This function orders the resources by key so DataLoader can find the right results.
     * IMPORTANT: This HAS to return nulls for missing resources or the ordering gets messed up
     * https://github.com/graphql/dataloader#batching
     * @param {Resource[]} resources
     * @param {string[]} keys
     * @return {(Resource|null)[]}
     */
    async reorderResources (resources, keys) {
        // now order them the same way
        /**
         * @type {(Resource|null)[]}
         */
        const resultsOrdered = [];
        for (const /** @type {string} */ key of keys) {
            const {
                /** @type {string} */
                resourceType,
                /** @type {string} */
                id
            } = ResourceWithId.getResourceTypeAndIdFromReference(key) || {};
            /**
             * resources with this resourceType and id
             * @type {Resource[]}
             */
            const items = resources.filter((r) => r.resourceType === resourceType && (r._uuid === id || r.id === id.split('|')[0]));
            // IMPORTANT: This HAS to return nulls for missing resources or the ordering gets messed up
            resultsOrdered.push(items.length > 0 ? items[0] : null);
        }
        return resultsOrdered;
    }

    /**
     * gets resources for the passed in keys
     * https://github.com/graphql/dataloader#batching
     * @param {string[]} keys
     * @param {FhirRequestInfo} requestInfo
     * @param {Object} args
     * @return {Promise<(Resource|null)[]>}>}
     */
    async getResourcesInBatch ({ keys, requestInfo, args }) {
        // separate by resourceType
        /**
         * Each field in the object is the key
         * @type {Object}
         */
        const groupKeysByResourceType = groupByLambda(keys, (key) =>
            ResourceWithId.getResourceTypeFromReference(key)
        );
        // noinspection UnnecessaryLocalVariableJS
        /**
         * @type {(Resource|null)[]}
         */
        const results = this.reorderResources(
            // run the loads in parallel by resourceType
            await async.flatMap(
                Object.entries(groupKeysByResourceType),
                async (groupKeysByResourceTypeKey) => {
                    // resourceType is a string and resources is a list of resources of that resourceType
                    const [
                        /** @type {string} **/
                        resourceType,
                        /** @type {string[]} **/
                        references
                    ] = groupKeysByResourceTypeKey;

                    if (!resourceType) {
                        return [];
                    }
                    /**
                     * @type {string[]}
                     */
                    const idsOfReference = references
                        .map((r) => ResourceWithId.getIdFromReference(r))
                        .filter((r) => r !== null);

                    // Initialize an array to hold the combined results from all batches
                    let combinedResults = [];
                    const batchSize = this.configManager.graphQLFetchResourceBatchSize;
                    let projections = null;

                    if (this.resourceProjections?.[resourceType]) {
                        projections = Array.from(this.resourceProjections[resourceType]);
                    }

                    // Process the IDs in batches
                    for (let i = 0; i < idsOfReference.length; i += batchSize) {
                        const batch = idsOfReference.slice(i, i + batchSize);

                        const args1 = {
                            base_version: '4_0_0',
                            id: batch.join(','),
                            _bundle: '1',
                            ...args
                        };

                        if (!args1._debug && this.debugMode) {
                            args1._debug = true;
                        }
                        if (projections) {
                            args1._elements = projections;
                            args1._isGraphQLRequest = true;
                        }

                        const bundle = await this.searchBundleOperation.searchBundleAsync({
                            requestInfo,
                            resourceType,
                            parsedArgs: await this.getParsedArgsAsync({
                                args: args1,
                                resourceType,
                                headers: requestInfo.headers
                            }),
                            useAggregationPipeline: false,
                            getRaw: this.getRawBundle
                        });

                        // Add results from this batch to the combined results array
                        combinedResults.push(bundle);
                    }

                    return combinedResults.flatMap((result) => this.unBundle(result));
                }
            ),
            keys
        );

        return results;
    }

    /**
     * This is to handle unions in GraphQL
     * @param {Object|Object[]} obj
     * @param {GraphQLContext} context
     * @param {Object} info
     * @return {null|string}
     */
    // noinspection JSUnusedLocalSymbols

    resolveType (obj, context, info) {
        if (!Array.isArray(obj)) {
            // noinspection JSUnresolvedReference
            return obj.resourceType;
        }
        if (obj.length > 0) {
            // apollo does not seem to allow returning lists.  Uncomment when Apollo supports that.
            // return obj.map(o => resolveType(o, context, info));
            return obj[0].resourceType;
        } else {
            return null;
        }
    }

    /**
     * Finds a single resource by reference
     * @param {Resource|null} parent
     * @param {Object} args
     * @param {GraphQLContext} context
     * @param {Object} info
     * @param {{reference: string, type: string, _uuid: string}} reference
     * @return {Promise<null|Resource>}
     */
    async findResourceByReference (parent, args, context, info, reference) {
        if (!reference) {
            return null;
        }

        // Check the resources request by the user
        const requestedResources = info
            .fieldNodes[0]
            .selectionSet
            ?.selections?.map(s => {
                if (s.kind === 'FragmentSpread' && info.fragments) {
                    return info.fragments[s.name.value]?.typeCondition?.name?.value
                } else {
                    return s.typeCondition?.name?.value;
                }
            })
            ?.filter(s => s) || [];

        if (!reference.reference) {
            if (requestedResources.length === 0) {
                if (info.returnType) {
                    if (info.returnType.constructor.name === 'GraphQLList' && info.returnType.ofType?._types?.length > 0) {
                        requestedResources.push(info.returnType.ofType._types[0].name);
                    } else if (info.returnType._types?.length > 0) {
                        requestedResources.push(info.returnType._types[0].name);
                    }
                }
            }
            if (
                reference.type &&
                requestedResources.length !== 0 &&
                !requestedResources.includes(reference.type) &&
                !requestedResources.includes('Resource')
            ) {
                return null;
            }
            const possibleResourceType = reference.type ? reference.type : requestedResources[0];

            const enrichedResource = this.enrichResourceWithReferenceData(
                {},
                reference,
                possibleResourceType
            );
            if (Object.keys(enrichedResource).length === 0) {
                return null;
            }
            return enrichedResource;
        }

        // Note: Temporary fix to handle mismatch in sourceAssigningAuthority of references in Person and Practitioner resources
        const referenceValue = ['Person', 'Practitioner'].includes(
            ResourceWithId.getResourceTypeFromReference(reference.reference)
        ) ? reference.reference : (reference._uuid || reference.reference);
        const referenceObj = ResourceWithId.getResourceTypeAndIdFromReference(referenceValue);
        if (!referenceObj) {
            return null;
        }
        const {
            /** @type {string} **/
            resourceType,
            /** @type {string} **/
            id
        } = referenceObj;
        // Case when invalid resourceType is passed and if this resourceType is requested in the query
        // if requested resources contains Resource then all resources are allowed here
        if (!isValidResource(resourceType) || (
            requestedResources.length > 0 &&
            !requestedResources.includes('Resource') &&
            !requestedResources.includes(resourceType)
        )
        ) {
            return null;
        }
        try {
            this.createDataLoader(args);
            // noinspection JSValidateTypes
            let resource = await this.dataLoader.load(ResourceWithId.getReferenceKey(resourceType, id));
            resource = this.enrichResourceWithReferenceData(resource, reference, resourceType);
            return resource;
        } catch (e) {
            if (e.name === 'NotFound') {
                // noinspection JSUnresolvedReference
                logWarn(
                    'findResourcesByReference: Resource not found for parent',
                    {
                        user: context.user,
                        args: {
                            resourceType,
                            id,
                            parentResourceType: parent.resourceType,
                            parentId: parent.id
                        }
                    }
                );
                return null;
            } else {
                throw e;
            }
        }
    }

    /**
     * Finds one or more resources by references array
     * @param {Resource|null} parent
     * @param {Object} args
     * @param {GraphQLContext} context
     * @param {Object} info
     * @param {{reference: string, type: string, _uuid: string}[]} references
     * @return {Promise<null|Resource[]>}
     */
    async findResourcesByReference (parent, args, context, info, references) {
        if (!references) {
            return null;
        }
        return async.flatMap(references, async (reference) => {
            return await this.findResourceByReference(parent, args, context, info, reference);
        });
    }

    /**
     * Finds resources with args
     * @param {Resource|null} parent
     * @param {Object} args
     * @param {GraphQLContext} context
     * @param {Object} info
     * @param {string} resourceType
     * @return {Promise<Resource[]>}
     */
    async getResources (parent, args, context, info, resourceType) {
        this.generateResourceProjections(info);
        // https://www.apollographql.com/blog/graphql/filtering/how-to-search-and-filter-results-with-graphql/
        const args1 = {
            base_version: '4_0_0',
            _bundle: '1',
            ...args
        };
        // if _debug is not set and we are in debug mode, set it
        if (!args1._debug && this.debugMode) {
            args1._debug = true;
        }
        if (this.resourceProjections?.[resourceType]) {
            const elements = Array.from(this.resourceProjections[resourceType])
            if (elements){
                args1._elements = elements;
                args1._isGraphQLRequest = true;
            }
        }
        return this.unBundle(
            await this.searchBundleOperation.searchBundleAsync(
                {
                    requestInfo: context.fhirRequestInfo,
                    resourceType,
                    parsedArgs: await this.getParsedArgsAsync(
                        {
                            args: args1,
                            resourceType,
                            headers: context.fhirRequestInfo ? context.fhirRequestInfo.headers : undefined
                        }
                    ),
                    useAggregationPipeline: false,
                    getRaw: this.getRawBundle
                }
            )
        );
    }

    /**
     * Finds resources with args used specifically while performing mutation
     * @param {Resource|null} parent
     * @param {Object} args
     * @param {GraphQLContext} context
     * @param {Object} info
     * @param {string} resourceType
     * @return {Promise<Resource[]>}
     */
    async getResourcesForMutation (parent, args, context, info, resourceType) {
        // https://www.apollographql.com/blog/graphql/filtering/how-to-search-and-filter-results-with-graphql/
        const args1 = {
            base_version: '4_0_0',
            _bundle: '1',
            ...args
        };
        // if _debug is not set and we are in debug mode, set it
        if (!args1._debug && this.debugMode) {
            args1._debug = true;
        }
        return this.unBundle(
            await this.searchBundleOperation.searchBundleAsync(
                {
                    requestInfo: context.fhirRequestInfo,
                    resourceType,
                    parsedArgs: await this.getParsedArgsForMutationAsync(
                        {
                            args: args1,
                            resourceType,
                            headers: context.fhirRequestInfo ? context.fhirRequestInfo.headers : undefined
                        }
                    ),
                    useAggregationPipeline: false
                }
            )
        );
    }

    // noinspection OverlyComplexFunctionJS
    /**
     * Finds resources with args
     * @param {Resource|null} parent
     * @param {Object} args
     * @param {GraphQLContext} context
     * @param {Object} info
     * @param {string} resourceType
     * @param {boolean} useAggregationPipeline
     * @return {Promise<Bundle>}
     */
    async getResourcesBundle (parent, args, context, info, resourceType, useAggregationPipeline = false) {
        this.createDataLoader(args);
        this.generateResourceProjections(info);
        // https://www.apollographql.com/blog/graphql/filtering/how-to-search-and-filter-results-with-graphql/

        context.req.resourceType = resourceType;
        const args1 = {
            base_version: '4_0_0',
            _bundle: '1',
            ...args
        };
        // if _debug is not set and we are in debug mode, set it
        if (!args1._debug && this.debugMode) {
            args1._debug = true;
        }
        if (!useAggregationPipeline && this.resourceProjections?.[resourceType]) {
            const elements = Array.from(this.resourceProjections[resourceType])
            if (elements){
                args1._elements = elements;
                args1._isGraphQLRequest = true;
            }
        }
        const bundle = await this.searchBundleOperation.searchBundleAsync(
            {
                requestInfo: context.fhirRequestInfo,
                resourceType,
                parsedArgs: await this.getParsedArgsAsync(
                    {
                        args: args1,
                        resourceType,
                        headers: context.fhirRequestInfo ? context.fhirRequestInfo.headers : undefined
                    }
                ),
                useAggregationPipeline,
                getRaw: this.getRawBundle
            }
        );
        if (bundle.meta) {
            this.metaList.push(bundle.meta);
        }
        return bundle;
    }

    /**
     * Creates the data loader if it does not exist (lazy init)
     * @param {Object} args
     */
    createDataLoader (args) {
        if (!this.dataLoader) {
            // noinspection JSValidateTypes
            this.dataLoader = new DataLoader(
                async (keys) => await this.getResourcesInBatch(
                    {
                        keys,
                        requestInfo: this.requestInfo,
                        args: { // these args should apply to every nested property
                            _debug: args._debug,
                            _explain: args._explain
                        }
                    }
                )
            );
            if (args._debug) {
                this.debugMode = true;
            }
        }
    }

    /**
     * Extracts the list of all top level fields requested for
     * each resource from nested fields data
     * @param {Object} resolvedFieldsInfo
     */
    extractFieldsForResource (resolvedFieldsInfo) {
        if (resolvedFieldsInfo instanceof Object){
            for (let [key, value] of Object.entries(resolvedFieldsInfo)) {
                if (key.startsWith('Subscription_')) {
                    key = key.replace("Subscription_", "")
                }
                if (Object.values(COLLECTION).includes(key)) {
                    let resourceType = key;
                    /**
                     * @type {Resource}
                     */
                    const resource = getResource(VERSIONS['4_0_0'], resourceType);
                    /**
                     * @type {string[]}
                     */
                    const resourceFields = Object.getOwnPropertyNames(new resource({}));

                    if (!this.resourceProjections[resourceType]) {
                        this.resourceProjections[resourceType] = new Set(['_uuid', '_sourceId', '_sourceAssigningAuthority', 'resourceType'])
                    }
                    Object.values(value).forEach(field => {
                        // for handling custom reference fields
                        if (field.name.endsWith('V2')) {
                            field.name = field.name.replace('V2', '');
                        }
                        // check if field is valid for resource type as some resources have custom fields
                        if (resourceFields.includes(field.name)) {
                            this.resourceProjections[resourceType].add(field.name);
                        }
                        else {
                            // handling for custom fields
                            if (
                                resourceType === 'SubscriptionStatus' &&
                                field.name === 'subscriptionTopic'
                            ) {
                                this.resourceProjections[resourceType].add('topic');
                            } else if (
                                resourceType === 'Subscription' &&
                                [
                                    'master_person_id',
                                    'client_person_id',
                                    'source_patient_id',
                                    'connection_type',
                                    'connection_name',
                                    'service_slug'
                                ].includes(field.name)
                            ) {
                                this.resourceProjections[resourceType].add('extension');
                            }
                        }
                    });
                }
                if (value instanceof Object) {
                    this.extractFieldsForResource(value);
                }
            }
        }
    }

    /**
     * Creates the list of all fields requested for each resource
     * @param {Object} info
     */
    generateResourceProjections (info) {
        if (this.configManager.enableMongoProjectionsInGraphQL && !this.resourceProjections) {
            this.resourceProjections = {};
            const resolvedFieldsInfo = parseResolveInfo(info, {});
            this.extractFieldsForResource(resolvedFieldsInfo)
        }
    }

    /**
     * combined the meta tags of all the queries and returns as one
     * @return {null|Meta}
     */
    getBundleMeta () {
        if (this.metaList.length === 0) {
            return null;
        }
        // noinspection JSValidateTypes
        /**
         * @type {Meta}
         */
        const combinedMeta = {
            tag: []
        };
        // get list of properties from first meta
        for (const /** @type {Meta} **/ meta of this.metaList) {
            for (const /** @type Coding **/ metaTag of meta.tag) {
                const foundCombinedMetaTag = combinedMeta.tag.find(
                    (tag) => tag.system === metaTag.system
                );
                if (foundCombinedMetaTag) {
                    // concatenate code and/or display
                    this.updateCombinedMetaTag(foundCombinedMetaTag, metaTag);
                } else {
                    combinedMeta.tag.push(metaTag);
                }
            }
        }

        // wrap all tag codes and display in [] to make it valid json
        for (const /** @type Coding **/ combinedMetaTag of combinedMeta.tag) {
            if (combinedMetaTag.display) {
                combinedMetaTag.display = '[' + combinedMetaTag.display + ']';
            }
            if (combinedMetaTag.code) {
                combinedMetaTag.code = '[' + combinedMetaTag.code + ']';
            }
        }
        return combinedMeta;
    }

    /**
     * Concatenate code and/or display
     * @param {Coding | undefined} targetMetaTag
     * @param {Coding | undefined} sourceMetaTag
     */
    updateCombinedMetaTag (targetMetaTag, sourceMetaTag) {
        if (sourceMetaTag.display && targetMetaTag.display) {
            targetMetaTag.display = targetMetaTag.display + ',' + sourceMetaTag.display;
        }
        if (sourceMetaTag.code && targetMetaTag.code) {
            targetMetaTag.code = targetMetaTag.code + ',' + sourceMetaTag.code;
        }
    }

    /**
     * Parse arguments
     * @param {Object} args
     * @param {string} resourceType
     * @param {Object|undefined} headers
     * @return {Promise<ParsedArgs>}
     */
    async getParsedArgsAsync ({ args, resourceType, headers }) {
        const { base_version } = args;
        /**
         * @type {ParsedArgs}
         */
        let parsedArgs = this.r4ArgsParser.parseArgs(
            {
                resourceType,
                args,
                useOrFilterForArrays: true // in GraphQL we get arrays where we want to OR between the elements
            }
        );
        // see if any query rewriters want to rewrite the args
        parsedArgs = await this.queryRewriterManager.rewriteArgsAsync(
            {
                base_version, parsedArgs, resourceType, operation: READ
            }
        );
        if (headers) {
            parsedArgs.headers = headers;
        }
        return parsedArgs;
    }

    /**
     * Parse arguments
     * @param {Object} args
     * @param {string} resourceType
     * @param {Object|undefined} headers
     * @return {Promise<ParsedArgs>}
     */
    async getParsedArgsForMutationAsync ({ args, resourceType, headers }) {
        /**
         * @type {ParsedArgs}
         */
        const parsedArgs = this.r4ArgsParser.parseArgs(
            {
                resourceType,
                args,
                useOrFilterForArrays: true // in GraphQL we get arrays where we want to OR between the elements
            }
        );
        if (headers) {
            parsedArgs.headers = headers;
        }
        return parsedArgs;
    }

    /**
     * Populate resolved or unresolved Reference resource with data from reference like display and type.
     * This is useful when no resource is resolved and the client needs display data in graphql response.
     * @param resolvedResource
     * @param reference
     * @param resourceType
     * @returns {{extension}|*|{}}
     */
    enrichResourceWithReferenceData (resolvedResource, reference, resourceType) {
        let resource = resolvedResource;
        const dataToEnrich = ['display', 'type'];
        const dataExtensionMap = REFERENCE_EXTENSION_DATA_MAP;
        if (dataToEnrich.some(dataKey => !!reference[`${dataKey}`])) {
            const extension = (resource && resource.extension) || [];
            dataToEnrich.forEach(dataKey => {
                if (reference[`${dataKey}`]) {
                    const extensionData = { ...dataExtensionMap[`${dataKey}`] };
                    extensionData[extensionData.valueKey] = reference[`${dataKey}`];
                    delete extensionData.valueKey;
                    extension.push(extensionData);
                }
            });
            resource = resource || {};
            resource.extension = extension;
            if (!resource.resourceType) {
                resource.resourceType = resourceType;
            }
        }
        return resource;
    }

    /**
     * Finds a single resource by canonical reference
     * @param {Resource|null} parent
     * @param {Object} args
     * @param {GraphQLContext} context
     * @param {Object} info
     * @param {string|null} canonical
     * @return {Promise<null|Resource>}
     */
    async findResourceByCanonicalReference (parent, args, context, info, canonical) {
        // parse the canonical to remove server and version
        const parsedReference = ReferenceParser.parseCanonicalReference(
            {
                url: canonical
            }
        );
        if (parsedReference === null) {
            return null;
        }
        const { resourceType, id } = parsedReference;
        return await this.findResourceByReference(
            parent, args, context, info, {
                reference: `${resourceType}/${id}`
            }
        );
    }

    /**
     * Gets the extension value by url
     * @param {Resource} resource
     * @param {string} url
     * @param {string} valueType
     * @return {Promise<*|null>}
     */
    async getExtensionValueByUrl({resource, url, valueType= "valueString"}) {
        // noinspection JSUnresolvedReference
        if (!resource || !resource.extension) {
            return null;
        }
        const extension = resource.extension.find(e => e.url === url);
        return extension ? extension[valueType] : null;
    }
}

module.exports = {
    FhirDataSource
};
