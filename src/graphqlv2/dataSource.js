const { logWarn } = require('../operations/common/logging');
const async = require('async');
const DataLoader = require('dataloader');
const { OPERATIONS: { READ }, COLLECTION } = require('../constants');
const { groupByLambda } = require('../utils/list.util');
const { assertTypeEquals, assertIsValid } = require('../utils/assertType');
const { R4ArgsParser } = require('../operations/query/r4ArgsParser');
const { QueryRewriterManager } = require('../queryRewriters/queryRewriterManager');
const { ResourceWithId } = require('./resourceWithId');
const { isValidResource } = require('../utils/validResourceCheck');
const { ReferenceParser } = require('../utils/referenceParser');
const { ConfigManager } = require('../utils/configManager');
const { isUuid, generateUUIDv5 } = require('../utils/uid.util');
const { SearchBundleOperation } = require('../operations/search/searchBundle');
const { parseResolveInfo } = require('graphql-parse-resolve-info');
const { getResource } = require('../operations/common/getResource');
const { VERSIONS } = require('../middleware/fhir/utils/constants');

/**
 * This class implements the DataSource pattern, so it is called by our GraphQLV2 resolvers to load the data
 */
class FhirDataSource {
    /**
     * @typedef FhirDataSourceParams
     * @property {FhirRequestInfo} requestInfo
     * @property {SearchBundleOperation} searchBundleOperation
     * @property {R4ArgsParser} r4ArgsParser
     * @property {QueryRewriterManager} queryRewriterManager
     * @property {ConfigManager} configManager
     * @param {FhirDataSourceParams} params
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
            const items = resources.filter((r) => r.resourceType === resourceType && (r._uuid === id || r._sourceId === id.split('|')[0]));
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
                            useAggregationPipeline: false
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
        if (!reference || !reference.reference) {
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
     * Finds linked non clinical resources by reference
     * @typedef findLinkedNonClinicalResourceParams
     * @property {[String]} resourceTypes
     * @property {String} referenceString
     * @property {String} sourceAssigningAuthority
     * @param {findLinkedNonClinicalResourceParams} params
     * @return {Promise<null|Resource>}
     */
    async findLinkedNonClinicalResource({
        resourceTypes,
        referenceString,
        sourceAssigningAuthority
    }) {
        if (!referenceString) {
            return null;
        }

        const referenceObj = ResourceWithId.getResourceTypeAndIdFromReference(referenceString);
        if (!referenceObj) {
            return null;
        }
        let {
            /** @type {string} **/
            resourceType,
            /** @type {string} **/
            id
        } = referenceObj;

        if (
            !isValidResource(resourceType) ||
            (resourceTypes.length > 0 &&
                !resourceTypes.includes('Resource') &&
                !resourceTypes.includes(resourceType))
        ) {
            return null;
        }

        if (sourceAssigningAuthority && !isUuid(id)) {
            id = generateUUIDv5(`${id}|${sourceAssigningAuthority}`);
        }

        try {
            this.createDataLoader({});
            // noinspection JSValidateTypes
            let resource = await this.dataLoader.load(
                ResourceWithId.getReferenceKey(resourceType, id)
            );
            return resource;
        } catch (e) {
            if (e.name === 'NotFound') {
                // noinspection JSUnresolvedReference
                logWarn('findLinkedNonClinicalResource: Resource not found for parent', {
                    args: {
                        resourceTypes,
                        referenceString,
                        sourceAssigningAuthority
                    }
                });
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
    async getResourcesBundle (parent, args, context, info, resourceType) {
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
        if (this.resourceProjections?.[resourceType]) {
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
                useAggregationPipeline: false
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
                if (key === 'FhirSubscription') {
                    key = 'Subscription'
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
                        this.resourceProjections[resourceType] = new Set(['_uuid', '_sourceId', '_sourceAssigningAuthority'])
                    }
                    Object.values(value).forEach(field => {
                        // check if field is valid for resource type as some resources have custom fields
                        if (resourceFields.includes(field.name)) {
                            this.resourceProjections[resourceType].add(field.name);
                        }
                        else {
                            // handling for custom fields
                            if (resourceType === 'SubscriptionStatus' && field.name === 'subscriptionTopic') {
                                this.resourceProjections[resourceType].add('topic');
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
        if (this.configManager.enableMongoProjectionsInGraphQLv2 && !this.resourceProjections) {
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
        headers = {
            prefer: 'global_id=true',
            ...headers
        }
        if (headers) {
            parsedArgs.headers = headers;
        }
        return parsedArgs;
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

    /**
     * Resolves entity by reference
     * @param {{__typename: string, id: string}} reference
     * @param {GraphQLContext} context
     * @param {Object} info
     * @param {string} requestedResource
     */
    async resolveEntityByReference(reference, context, info, requestedResource) {
        if (!reference || !reference.id) {
            return null;
        }

        /**
         * @type {string[]}
         */
        const references = reference.id.split('/');
        let referenceObj;
        // We can receive either reference or just the id
        if (references.length === 1) {
            referenceObj = { resourceType: null, id: references[0] }
        }
        else if (references.length === 2) {
            referenceObj = { resourceType: references[0], id: references[1] };
        }
        else{
            return null;
        }

        const { resourceType, id } = referenceObj;

        if (resourceType && requestedResource !== resourceType) {
            return null;
        }

        try {
            this.createDataLoader({});
            this.generateResourceProjections(info);
            // noinspection JSValidateTypes
            let resource = await this.dataLoader.load(
                ResourceWithId.getReferenceKey(requestedResource, id)
            );
            return resource;
        } catch (e) {
            if (e.name === 'NotFound') {
                // noinspection JSUnresolvedReference
                logWarn('resolveEntityByReference: Resource not found', {
                    user: context.user,
                    args: {
                        requestedResource,
                        id
                    }
                });
                return null;
            } else {
                throw e;
            }
        }
    }
}

module.exports = {
    FhirDataSource
};
