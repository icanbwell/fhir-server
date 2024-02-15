const {logWarn} = require('../../operations/common/logging');
const async = require('async');
const DataLoader = require('dataloader');
const {REFERENCE_EXTENSION_DATA_MAP, OPERATIONS: { READ }} = require('../../constants');
const {groupByLambda} = require('../../utils/list.util');
const {assertTypeEquals, assertIsValid} = require('../../utils/assertType');
const {R4ArgsParser} = require('../../operations/query/r4ArgsParser');
const {QueryRewriterManager} = require('../../queryRewriters/queryRewriterManager');
const {ResourceWithId} = require('./resourceWithId');

/**
 * This class implements the DataSource pattern, so it is called by our GraphQL resolvers to load the data
 */
class FhirDataSource {
    /**
     * @param {FhirRequestInfo} requestInfo
     * @param {SearchBundleOperation} searchBundleOperation
     * @param {R4ArgsParser} r4ArgsParser
     * @param {QueryRewriterManager} queryRewriterManager
     */
    constructor(
        {
            requestInfo,
            searchBundleOperation,
            r4ArgsParser,
            queryRewriterManager
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
    }

    /**
     * This function takes a FHIR Bundle and returns the resources in it
     * @param {Bundle} bundle
     * @return {Resource[]}
     */
    unBundle(bundle) {
        if (bundle.meta) {
            this.metaList.push(bundle.meta);
        }
        return bundle.entry ? bundle.entry.map((e) => e.resource) : [];
    }

    /**
     * This function orders the resources by key so DataLoader can find the right results.
     * IMPORTANT: This HAS to return nulls for missing resources or the ordering gets messed up
     * https://github.com/graphql/dataloader#batching
     * @param {{Resource}[]} resources
     * @param {string[]} keys
     * @return {(Resource|null)[]}
     */
    async reorderResources(resources, keys) {
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
    async getResourcesInBatch({keys, requestInfo, args}) {
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
                    const args1 = {
                        base_version: '4_0_0',
                        id: idsOfReference.join(','),
                        _bundle: '1',
                        ...args
                    };

                    const bundle = await this.searchBundleOperation.searchBundleAsync(
                        {
                            requestInfo,
                            resourceType,
                            parsedArgs: await this.getParsedArgsAsync(
                                {
                                    args: args1,
                                    resourceType,
                                    headers: requestInfo.headers
                                }
                            ),
                            useAggregationPipeline: false
                        }
                    );

                    return this.unBundle(bundle);
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
    // eslint-disable-next-line no-unused-vars
    resolveType(obj, context, info) {
        if (!Array.isArray(obj)) {
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
     * @param {{reference: string}} reference
     * @return {Promise<null|Resource>}
     */
    async findResourceByReference(parent, args, context, info, reference) {
        if (!reference) {
            return null;
        }
        if (!reference.reference) {
            let possibleResourceType = reference.type;
            if (!possibleResourceType && info.returnType) {
                if (info.returnType.constructor.name === 'GraphQLList' && info.returnType.ofType && info.returnType.ofType._types && info.returnType.ofType._types.length > 0){
                    possibleResourceType = info.returnType.ofType._types[0].name;
                } else if (info.returnType._types && info.returnType._types.length > 0){
                    possibleResourceType = info.returnType._types[0].name;
                }
            }
            return this.enrichResourceWithReferenceData({}, reference, possibleResourceType);
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
        try {
            this.createDataLoader(args);
            // noinspection JSValidateTypes
            let resource = await this.dataLoader.load(ResourceWithId.getReferenceKey(resourceType, id));
            resource = this.enrichResourceWithReferenceData(resource, reference, resourceType);
            return resource;
        } catch (e) {
            if (e.name === 'NotFound') {
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
     * @param {{reference: string}[]} references
     * @return {Promise<null|Resource[]>}
     */
    async findResourcesByReference(parent, args, context, info, references) {
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
    async getResources(parent, args, context, info, resourceType) {
        // https://www.apollographql.com/blog/graphql/filtering/how-to-search-and-filter-results-with-graphql/
        const args1 = {
            base_version: '4_0_0',
            _bundle: '1',
            ...args
        };
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

    /**
     * Finds resources with args used specifically while performing mutation
     * @param {Resource|null} parent
     * @param {Object} args
     * @param {GraphQLContext} context
     * @param {Object} info
     * @param {string} resourceType
     * @return {Promise<Resource[]>}
     */
    async getResourcesForMutation(parent, args, context, info, resourceType) {
        // https://www.apollographql.com/blog/graphql/filtering/how-to-search-and-filter-results-with-graphql/
        const args1 = {
            base_version: '4_0_0',
            _bundle: '1',
            ...args
        };
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
    async getResourcesBundle(parent, args, context, info, resourceType, useAggregationPipeline = false) {
        this.createDataLoader(args);
        // https://www.apollographql.com/blog/graphql/filtering/how-to-search-and-filter-results-with-graphql/

        const args1 = {
            base_version: '4_0_0',
            _bundle: '1',
            ...args
        };
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
                useAggregationPipeline
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
    createDataLoader(args) {
        if (!this.dataLoader) {
            this.dataLoader = new DataLoader(
                async (keys) => await this.getResourcesInBatch(
                    {
                        keys,
                        requestInfo: this.requestInfo,
                        args: { // these args should appy to every nested property
                            '_debug': args._debug,
                            '_explain': args._explain
                        }
                    }
                )
            );
        }
    }

    /**
     * combined the meta tags of all the queries and returns as one
     * @return {null|Meta}
     */
    getBundleMeta() {
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
                if (!foundCombinedMetaTag) {
                    combinedMeta.tag.push(metaTag);
                } else {
                    // concatenate code and/or display
                    this.updateCombinedMetaTag(foundCombinedMetaTag, metaTag);
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
    updateCombinedMetaTag(targetMetaTag, sourceMetaTag) {
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
    async getParsedArgsAsync({args, resourceType, headers}) {
        const {base_version} = args;
        /**
         * @type {ParsedArgs}
         */
        let parsedArgs = this.r4ArgsParser.parseArgs(
            {
                resourceType, args,
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
     async getParsedArgsForMutationAsync({args, resourceType, headers}) {
        /**
         * @type {ParsedArgs}
         */
        const parsedArgs = this.r4ArgsParser.parseArgs(
            {
                resourceType, args,
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
    enrichResourceWithReferenceData(resolvedResource, reference, resourceType) {
        let resource = resolvedResource;
        const dataToEnrich = ['display', 'type'];
        const dataExtensionMap = REFERENCE_EXTENSION_DATA_MAP;
        if (dataToEnrich.some(dataKey => !!reference[`${dataKey}`])) {
            const extension = (resource && resource.extension) || [];
            dataToEnrich.forEach(dataKey => {
                if (reference[`${dataKey}`]) {
                    const extensionData = {...dataExtensionMap[`${dataKey}`]};
                    extensionData[extensionData['valueKey']] = reference[`${dataKey}`];
                    delete extensionData['valueKey'];
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
}

module.exports = {
    FhirDataSource
};
