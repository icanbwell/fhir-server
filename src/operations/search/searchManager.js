const { isTrue } = require('../../utils/isTrue');
const env = require('var');
const { logDebug, logError } = require('../common/logging');
const deepcopy = require('deepcopy');
const moment = require('moment-timezone');
const { pipeline } = require('stream/promises');
const { ResourcePreparerTransform } = require('../streaming/resourcePreparerTransform');
const { Transform } = require('stream');
const { IndexHinter } = require('../../indexes/indexHinter');
const { HttpResponseWriter } = require('../streaming/responseWriter');
const { ResourceIdTracker } = require('../streaming/resourceIdTracker');
const { DatabaseQueryFactory } = require('../../dataLayer/databaseQueryFactory');
const { ResourceLocatorFactory } = require('../common/resourceLocatorFactory');
const { assertTypeEquals, assertIsValid } = require('../../utils/assertType');
const { SecurityTagManager } = require('../common/securityTagManager');
const { ResourcePreparer } = require('../common/resourcePreparer');
const { RethrownError } = require('../../utils/rethrownError');
const { BadRequestError } = require('../../utils/httpErrors');
const { mongoQueryStringify } = require('../../utils/mongoQueryStringify');
const { R4SearchQueryCreator } = require('../query/r4');
const { ConfigManager } = require('../../utils/configManager');
const { QueryRewriterManager } = require('../../queryRewriters/queryRewriterManager');
const { PersonToPatientIdsExpander } = require('../../utils/personToPatientIdsExpander');
const { ScopesManager } = require('../security/scopesManager');
const { GetCursorResult } = require('./getCursorResult');
const { QueryItem } = require('../graph/queryItem');
const { DatabaseAttachmentManager } = require('../../dataLayer/databaseAttachmentManager');
const { FhirResourceWriterFactory } = require('../streaming/resourceWriters/fhirResourceWriterFactory');
const { MongoReadableStream } = require('../streaming/mongoStreamReader');
const { DataSharingManager } = require('./dataSharingManager');
const { SearchQueryBuilder } = require('./searchQueryBuilder');
const { MongoQuerySimplifier } = require('../../utils/mongoQuerySimplifier');
const { getResource } = require('../../operations/common/getResource');
const { VERSIONS } = require('../../middleware/fhir/utils/constants');
const { PatientScopeManager } = require('../security/patientScopeManager');
const { PatientQueryCreator } = require('../common/patientQueryCreator');
const { DB_SEARCH_LIMIT_FOR_IDS, DB_SEARCH_LIMIT } = require('../../constants');

class SearchManager {
    /**
     * constructor
     * @param {DatabaseQueryFactory} databaseQueryFactory
     * @param {ResourceLocatorFactory} resourceLocatorFactory
     * @param {SecurityTagManager} securityTagManager
     * @param {ResourcePreparer} resourcePreparer
     * @param {IndexHinter} indexHinter
     * @param {R4SearchQueryCreator} r4SearchQueryCreator
     * @param {ConfigManager} configManager
     * @param {QueryRewriterManager} queryRewriterManager
     * @param {PersonToPatientIdsExpander} personToPatientIdsExpander
     * @param {ScopesManager} scopesManager
     * @param {DatabaseAttachmentManager} databaseAttachmentManager
     * @param {FhirResourceWriterFactory} fhirResourceWriterFactory
     * @param {DataSharingManager} dataSharingManager
     * @param {SearchQueryBuilder} searchQueryBuilder
     * @param {PatientScopeManager} patientScopeManager
     * @param {PatientQueryCreator} patientQueryCreator
     */
    constructor (
        {
            databaseQueryFactory,
            resourceLocatorFactory,
            securityTagManager,
            resourcePreparer,
            indexHinter,
            r4SearchQueryCreator,
            configManager,
            queryRewriterManager,
            personToPatientIdsExpander,
            scopesManager,
            databaseAttachmentManager,
            fhirResourceWriterFactory,
            dataSharingManager,
            searchQueryBuilder,
            patientScopeManager,
            patientQueryCreator
        }
    ) {
        /**
         * @type {DatabaseQueryFactory}
         */
        this.databaseQueryFactory = databaseQueryFactory;
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);
        /**
         * @type {ResourceLocatorFactory}
         */
        this.resourceLocatorFactory = resourceLocatorFactory;
        assertTypeEquals(resourceLocatorFactory, ResourceLocatorFactory);
        /**
         * @type {SecurityTagManager}
         */
        this.securityTagManager = securityTagManager;
        assertTypeEquals(securityTagManager, SecurityTagManager);

        /**
         * @type {ResourcePreparer}
         */
        this.resourcePreparer = resourcePreparer;
        assertTypeEquals(resourcePreparer, ResourcePreparer);

        /**
         * @type {IndexHinter}
         */
        this.indexHinter = indexHinter;
        assertTypeEquals(indexHinter, IndexHinter);

        /**
         * @type {R4SearchQueryCreator}
         */
        this.r4SearchQueryCreator = r4SearchQueryCreator;
        assertTypeEquals(r4SearchQueryCreator, R4SearchQueryCreator);

        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);

        this.queryRewriterManager = queryRewriterManager;
        assertTypeEquals(queryRewriterManager, QueryRewriterManager);
        /**
         * @type {PersonToPatientIdsExpander}
         */
        this.personToPatientIdsExpander = personToPatientIdsExpander;
        assertTypeEquals(personToPatientIdsExpander, PersonToPatientIdsExpander);

        /**
         * @type {ScopesManager}
         */
        this.scopesManager = scopesManager;
        assertTypeEquals(scopesManager, ScopesManager);

        /**
         * @type {DatabaseAttachmentManager}
         */
        this.databaseAttachmentManager = databaseAttachmentManager;
        assertTypeEquals(databaseAttachmentManager, DatabaseAttachmentManager);

        /**
         * @type {FhirResourceWriterFactory}
         */
        this.fhirResourceWriterFactory = fhirResourceWriterFactory;
        assertTypeEquals(fhirResourceWriterFactory, FhirResourceWriterFactory);

        /**
         * @type {DataSharingManager}
         */
        this.dataSharingManager = dataSharingManager;
        assertTypeEquals(dataSharingManager, DataSharingManager);

        /**
         * @type {SearchQueryBuilder}
         */
        this.searchQueryBuilder = searchQueryBuilder;
        assertTypeEquals(searchQueryBuilder, SearchQueryBuilder);

        /**
         * @type {PatientScopeManager}
         */
        this.patientScopeManager = patientScopeManager;
        assertTypeEquals(patientScopeManager, PatientScopeManager);

        /**
         * @type {PatientQueryCreator}
         */
        this.patientQueryCreator = patientQueryCreator;
        assertTypeEquals(patientQueryCreator, PatientQueryCreator);
    }

    // noinspection ExceptionCaughtLocallyJS
    /**
     * constructs a mongo query
     * @param {string | null} user
     * @param {string | null} scope
     * @param {boolean | null} isUser
     * @param {string} resourceType
     * @param {boolean} useAccessIndex
     * @param {string} personIdFromJwtToken
     * @param {string|null} requestId
     * @param {ParsedArgs} parsedArgs
     * @param {boolean|undefined} [useHistoryTable]
     * @param {'READ'|'WRITE'} operation
     * @param {string} accessRequested
     * @returns {Promise<{base_version: string, columns: Set, query: import('mongodb').Document}>}
     */
    async constructQueryAsync (
        {
            user,
            scope,
            isUser,
            resourceType,
            useAccessIndex,
            personIdFromJwtToken,
            requestId,
            parsedArgs,
            useHistoryTable,
            operation,
            accessRequested = 'read'
        }
    ) {
        try {
            /**
             * @type {string}
             */
            const { base_version } = parsedArgs;
            assertIsValid(base_version, 'base_version is not set');
            const accessViaPatientScopes = this.scopesManager.isAccessAllowedByPatientScopes({ scope, resourceType });

            /**
             * @type {string[]}
             */
            const securityTags = this.securityTagManager.getSecurityTagsFromScope({
                accessRequested, user, scope, accessViaPatientScopes
            });
            /**
             * @type {import('mongodb').Document}
             */
            let query;

            /**
             * @type {Set}
             */
            let columns;
            /**
             * @type {boolean}
             */
            let shouldUpdateColumns = false;

            ({ query, columns } = this.searchQueryBuilder.buildSearchQueryBasedOnVersion({
                base_version,
                parsedArgs,
                resourceType,
                useHistoryTable,
                operation,
                isUser
            }));

            if (accessViaPatientScopes) {
                shouldUpdateColumns = true;
                /**
                 * @type {string[]}
                 */
                const allPatientIdsFromJwtToken = await this.patientScopeManager.getPatientIdsFromScopeAsync({
                    base_version, isUser, personIdFromJwtToken
                });

                if (!this.configManager.doNotRequirePersonOrPatientIdForPatientScope &&
                    allPatientIdsFromJwtToken.length === (personIdFromJwtToken ? 1 : 0)) {
                    query = { id: '__invalid__' }; // return nothing since no patient ids were passed
                } else {
                    query = this.patientQueryCreator.getQueryWithPatientFilter({
                        patientIds: allPatientIdsFromJwtToken, query, resourceType, useHistoryTable,
                        personIds: personIdFromJwtToken ? [personIdFromJwtToken] : null
                    });
                }
            } else if (securityTags && securityTags.length > 0) {
                // JWT has access tag in scope i.e API call from a specific client
                shouldUpdateColumns = true;
                // Add access tag filter to the query
                query = this.securityTagManager.getQueryWithSecurityTags({
                    resourceType,
                    securityTags,
                    query,
                    useAccessIndex,
                    useHistoryTable
                });

                if (this.configManager.enableConsentedProaDataAccess || this.configManager.enableHIETreatmentRelatedDataAccess) {
                    query = await this.dataSharingManager.updateQueryConsideringDataSharing({
                        base_version,
                        resourceType,
                        parsedArgs,
                        securityTags,
                        query,
                        useHistoryTable,
                        requestId,
                        isUser
                    });
                }
            }

            if (shouldUpdateColumns) {
                // update the columns set
                columns = MongoQuerySimplifier.findColumnsInFilter({ filter: query });
            }

            ({ query, columns } = await this.queryRewriterManager.rewriteQueryAsync({
                base_version,
                query,
                columns,
                resourceType,
                operation
            }));
            if (query) {
                query = MongoQuerySimplifier.simplifyFilter({ filter: query });
            }
            return { base_version, query, columns };
        } catch (e) {
            throw new RethrownError({
                    message: 'Error in constructQueryAsync(): ' + (e.message || ''),
                    error: e,
                    args: {
                        user,
                        scope,
                        isUser,
                        parsedArgs,
                        resourceType,
                        useAccessIndex,
                        personIdFromJwtToken
                    }
                }
            );
        }
    }

    /**
     * Create the query and gets the cursor from mongo
     * @param {string} resourceType
     * @param {string} base_version
     * @param {ParsedArgs} parsedArgs
     * @param {Set} columns
     * @param {Object} options
     * @param {import('mongodb').Document} query
     * @param {number} maxMongoTimeMS
     * @param {string | null} user
     * @param {boolean} isStreaming
     * @param {boolean} useAccessIndex
     * @param {boolean} useAggregationPipeline
     * @param {Object} extraInfo
     * @returns {Promise<GetCursorResult>}
     */
    async getCursorForQueryAsync (
        {
            resourceType,
            base_version,
            parsedArgs,
            columns,
            options,
            query,
            maxMongoTimeMS,
            user,
            isStreaming,
            useAccessIndex,
            useAggregationPipeline = false,
            extraInfo
        }
    ) {
        // if _elements=x,y,z is in url parameters then restrict mongo query to project only those fields
        if (parsedArgs._elements) {
            const __ret = this.handleElementsQuery(
                {
                    parsedArgs, columns, resourceType, options, useAccessIndex
                });
            columns = __ret.columns;
            options = __ret.options;
        }
        // if _sort is specified then add sort criteria to mongo query
        if (parsedArgs._sort) {
            const __ret = this.handleSortQuery({ parsedArgs, columns, options });
            columns = __ret.columns;
            options = __ret.options;
        }

        // if _count is specified then limit mongo query to that
        if (parsedArgs._count) {
            const __ret = this.handleCountOption({ parsedArgs, options, isStreaming });
            options = __ret.options;
        } else {
            this.setDefaultLimit({ parsedArgs, options });
        }

        // for consistency in results while paging, always sort by id
        // https://docs.mongodb.com/manual/reference/method/cursor.sort/#sort-cursor-consistent-sorting
        const defaultSortId = this.configManager.defaultSortId;
        columns.add(defaultSortId);
        if (!('sort' in options)) {
            options.sort = {};
        }
        // add id to end if not present in sort
        if (!(`${defaultSortId}` in options.sort)) {
            options.sort[`${defaultSortId}`] = 1;
        }

        /**
         * queries for logging
         * @type {Object|Object[]}
         */
        let originalQuery = deepcopy(query);
        /**
         * options for logging
         * @type {Object|Object[]}
         */
        let originalOptions = deepcopy(options);

        /**
         * whether to use the two-step optimization
         * In the two-step optimization we request the ids first and then request the documents for those ids
         *  This can be faster in large tables as both queries can then be satisfied by indexes
         * @type {boolean}
         */
        const useTwoStepSearchOptimization =
            !parsedArgs._elements &&
            !parsedArgs.id &&
            (this.configManager.enableTwoStepOptimization || parsedArgs._useTwoStepOptimization);
        if (isTrue(useTwoStepSearchOptimization)) {
            const __ret = await this.handleTwoStepSearchOptimizationAsync(
                {
                    resourceType,
                    base_version,
                    options,
                    query,
                    maxMongoTimeMS
                }
            );
            options = __ret.options;
            originalQuery = __ret.originalQuery;
            query = __ret.query;
            originalOptions = __ret.originalOptions;
            if (query === null) {
                // no ids were found so no need to query
                return new GetCursorResult({
                        columns,
                        options,
                        query,
                        originalQuery: new QueryItem({
                            query: originalQuery,
                            collectionName: null,
                            resourceType
                        }),
                        originalOptions,
                        useTwoStepSearchOptimization,
                        resources: [],
                        total_count: 0,
                        indexHint: null,
                        cursorBatchSize: 0,
                        cursor: null
                    }
                );
            }
        }

        /**
         * resources to return
         * @type {Resource[]}
         */
        const resources = [];
        /**
         * @type {number}
         */
        let total_count = 0;
        /**
         * which index hint to use (if any)
         * @type {string|null}
         */
        let indexHint = null;
        /**
         * @type {int | null}
         */
        let cursorBatchSize = null;
        // run the query and get the results
        // Now run the query to get a cursor we will enumerate next
        const databaseQueryManager = this.databaseQueryFactory.createQuery(
            { resourceType, base_version }
        );
        /**
         * @type {DatabasePartitionedCursor}
         */
        let cursorQuery;
        if (useAggregationPipeline) {
            // Projection arguement to be used for aggregation query
            let projection = parsedArgs.projection || {};
            if (options.projection) {
                projection = { ...projection, ...options.projection };
            }
            cursorQuery = await databaseQueryManager.findUsingAggregationAsync({
                query,
                projection,
                options,
                extraInfo
            });
        } else {
            cursorQuery = await databaseQueryManager.findAsync({ query, options, extraInfo });
        }

        cursorQuery = cursorQuery.maxTimeMS({ milliSecs: maxMongoTimeMS });

        // avoid double sorting since Mongo gives you different results
        if (useTwoStepSearchOptimization && !options.sort) {
            const sortOption =
                originalOptions && originalOptions[0] && originalOptions[0].sort ? originalOptions[0].sort : null;
            if (sortOption !== null) {
                cursorQuery = cursorQuery.sort({ sortOption });
            }
        }

        // set batch size if specified
        if (env.MONGO_BATCH_SIZE || parsedArgs._cursorBatchSize) {
            // https://www.dbkoda.com/blog/2017/10/01/bulk-operations-in-mongoDB
            const __ret = this.setCursorBatchSize({ parsedArgs, cursorQuery });
            cursorBatchSize = __ret.cursorBatchSize;
            cursorQuery = __ret.cursorQuery;
        }
        /**
         * @type {DatabasePartitionedCursor}
         */
        let cursor = cursorQuery;

        // find columns being queried and match them to an index
        // noinspection JSUnresolvedReference
        if (isTrue(env.SET_INDEX_HINTS) || parsedArgs._setIndexHint) {
            // TODO: handle index hints for multiple collections
            const resourceLocator = this.resourceLocatorFactory.createResourceLocator(
                { resourceType, base_version });
            const collectionNamesForQueryForResourceType = await resourceLocator.getCollectionNamesForQueryAsync(
                {
                    query, extraInfo
                });
            const indexName = parsedArgs._setIndexHint;
            const __ret = this.setIndexHint(
                {
                    mongoCollectionName: collectionNamesForQueryForResourceType[0],
                    columns,
                    cursor,
                    user,
                    indexName
                }
            );
            indexHint = __ret.indexHint;
            cursor = __ret.cursor;
        }

        // if _total is specified then ask mongo for the total else set total to 0
        // Value 'estimate' is not supported now but kept it for backward compatibility.
        if (parsedArgs._total && ['accurate', 'estimate'].includes(parsedArgs._total)) {
            total_count = await this.handleGetTotalsAsync(
                {
                    resourceType,
                    base_version,
                    query,
                    maxMongoTimeMS
                });
        }

        const collectionName = cursor.getFirstCollection();
        return new GetCursorResult(
            {
                columns,
                options,
                query,
                originalQuery: new QueryItem({
                    query: originalQuery,
                    collectionName,
                    resourceType
                }),
                originalOptions,
                useTwoStepSearchOptimization,
                resources,
                total_count,
                indexHint,
                cursorBatchSize,
                cursor
            }
        );
    }

    /**
     * Handle count: https://www.hl7.org/fhir/search.html#count
     * @param {ParsedArgs} parsedArgs
     * @param {Object} options
     * @param {boolean} isStreaming
     * @return {{options: Object}} columns selected and changed options
     */
    handleCountOption ({ parsedArgs, options, isStreaming }) {
        /**
         * @type {number}
         */
        const nPerPage = Number(parsedArgs._count);

        // if _getpagesoffset is specified then skip to the page starting with that offset
        if (parsedArgs._getpagesoffset) {
            /**
             * @type {number}
             */
            const pageNumber = Number(parsedArgs._getpagesoffset);
            options.skip = pageNumber > 0 ? pageNumber * nPerPage : 0;
        }
        // cap it at DB_SEARCH_LIMIT_FOR_IDS to avoid running out of memory
        options.limit = isStreaming ? nPerPage : Math.min(nPerPage, DB_SEARCH_LIMIT_FOR_IDS);

        return { options };
    }

    /**
     * Handle when the caller pass in _elements: https://www.hl7.org/fhir/search.html#elements
     * @param {ParsedArgs} parsedArgs
     * @param {Set} columns
     * @param {string} resourceType
     * @param {Object} options
     * @param {boolean} useAccessIndex
     * @return {{columns:Set, options: Object}} columns selected and changed options
     */
    handleElementsQuery (
        {
            parsedArgs, columns, resourceType, options,

            useAccessIndex
        }
    ) {
        // GET [base]/Observation?_elements=status,date,category
        /**
         * @type {string[]}
         */
        const properties_to_return_list = parsedArgs.get('_elements').queryParameterValue.values;
        if (properties_to_return_list && properties_to_return_list.length > 0) {
            /**
             * @type {import('mongodb').Document}
             */
            const projection = {};
            /**
             * @type {Resource}
             */
            const Resource = getResource(VERSIONS['4_0_0'], resourceType);
            /**
             * @type {string[]}
             */
            const allowedProperties = Object.getOwnPropertyNames(new Resource({}));
            for (const property of properties_to_return_list) {
                if (allowedProperties.includes(property)) {
                    projection[`${property}`] = 1;
                } else {
                    throw new BadRequestError(new Error(`Unsupported property '${property}' for the specified resource type.`));
                }
            }
            // this is a hack for the CQL Evaluator since it does not request these fields but expects them
            if (resourceType === 'Library') {
                projection.id = 1;
                projection.url = 1;
            }
            // also exclude _id so if there is a covering index the query can be satisfied from the covering index
            projection._id = 0;
            if (
                (!useAccessIndex || properties_to_return_list.length > 1 || properties_to_return_list[0] !== 'id') &&
                !properties_to_return_list.includes('meta')
            ) {
                // special optimization when only ids are requested so the query can be satisfied by covering index
                // always add meta column, so we can do security checks
                projection['meta.security.system'] = 1;
                projection['meta.security.code'] = 1;
            }
            options.projection = projection;
        }

        return { columns, options };
    }

    /**
     * handle request to return totals for the query
     * @param {string} resourceType
     * @param {string} base_version
     * @param {Object} query
     * @param {number} maxMongoTimeMS
     * @return {Promise<number>}
     */
    async handleGetTotalsAsync (
        {
            resourceType, base_version,
            query, maxMongoTimeMS
        }
    ) {
        try {
            // https://www.hl7.org/fhir/search.html#total
            // if _total is passed then calculate the total count for matching records also
            // don't use the options since they set a limit and skip
            const databaseQueryManager = this.databaseQueryFactory.createQuery(
                { resourceType, base_version }
            );
            return await databaseQueryManager.exactDocumentCountAsync({
                query,
                options: { maxTimeMS: maxMongoTimeMS }
            });
        } catch (e) {
            throw new RethrownError({
                message: `Error getting totals for ${resourceType} with query: ${mongoQueryStringify(query)}`,
                error: e
            });
        }
    }

    /**
     * handles sort: https://www.hl7.org/fhir/search.html#sort
     * @param {ParsedArgs} parsedArgs
     * @param {Set} columns
     * @param {Object} options
     * @return {{columns:Set, options: Object}} columns selected and changed options
     */
    handleSortQuery (
        {
            parsedArgs, columns, options
        }
    ) {
        // GET [base]/Observation?_sort=status,-date,category
        // Each item in the comma separated list is a search parameter, optionally with a '-' prefix.
        // The prefix indicates decreasing order; in its absence, the parameter is applied in increasing order.
        /**
         * @type {string[]}
         */
        const sort_properties_list = parsedArgs.get('_sort').queryParameterValue.values;
        if (sort_properties_list && sort_properties_list.length > 0) {
            /**
             * @type {import('mongodb').Sort}
             */
            const sort = {};
            /**
             * @type {string}
             */
            for (const sortProperty of sort_properties_list) {
                if (sortProperty.startsWith('-')) {
                    /**
                     * @type {string}
                     */
                    const sortPropertyWithoutMinus = sortProperty.substring(1);
                    sort[`${sortPropertyWithoutMinus}`] = -1;
                    columns.add(sortPropertyWithoutMinus);
                } else {
                    sort[`${sortProperty}`] = 1;
                    columns.add(sortProperty);
                }
            }
            options.sort = sort;
        }
        return { columns, options };
    }

    /**
     * implements a two-step optimization by first retrieving ids and then requesting the data for those ids
     * @param {string} resourceType
     * @param {string} base_version
     * @param {Object} options
     * @param {Object} query
     * @param {number} maxMongoTimeMS
     * @return {Promise<{query: Object, options: Object, actualQuery: (Object|Object[]), actualOptions: Object}>}
     */
    async handleTwoStepSearchOptimizationAsync (
        {
            resourceType,
            base_version,
            options,
            query,
            maxMongoTimeMS
        }
    ) {
        try {
            // first get just the ids
            const projection = {};
            projection._id = 0;
            projection.id = 1;
            options.projection = projection;
            const originalQuery = [query];
            const originalOptions = [options];
            const sortOption = originalOptions[0] && originalOptions[0].sort ? originalOptions[0].sort : {};
            const databaseQueryManager = this.databaseQueryFactory.createQuery(
                { resourceType, base_version }
            );
            /**
             * @type {DatabasePartitionedCursor}
             */
            const cursor = await databaseQueryManager.findAsync({ query, options });
            /**
             * @type {import('mongodb').DefaultSchema[]}
             */
            const idResults = await cursor
                .sort({ sortOption })
                .maxTimeMS({ milliSecs: maxMongoTimeMS })
                .toArrayRawAsync();
            if (idResults.length > 0) {
                // now get the documents for those ids.  We can clear all the other query parameters
                query = idResults.length === 1
                    ? { id: idResults.map((r) => r.id)[0] }
                    : { id: { $in: idResults.map((r) => r.id) } };
                options = {}; // reset options since we'll be looking by id
                originalQuery.push(query);
                originalOptions.push(options);
            } else {
                // no results
                query = null; // no need to query
            }
            return { options, actualQuery: originalQuery, query, actualOptions: originalOptions };
        } catch (e) {
            throw new RethrownError({
                message: `Error in two step optimization for ${resourceType} with query: ${mongoQueryStringify(query)}`,
                error: e
            });
        }
    }

    // noinspection FunctionWithInconsistentReturnsJS
    /**
     * Reads resources from Mongo cursor
     * @param {DatabasePartitionedCursor} cursor
     * @param {string | null} user
     * @param {ParsedArgs|null} parsedArgs
     * @param {string} resourceType
     * @param {boolean} getRaw
     * @returns {Promise<Resource[]>}
     */
    async readResourcesFromCursorAsync (
        {
            cursor, user, parsedArgs, resourceType, getRaw = false
        }
    ) {
        /**
         * resources to return
         * @type {Resource[]}
         */
        const resources = [];

        const highWaterMark = 100;
        /**
         * @type {AbortController}
         */
        const ac = new AbortController();

        try {
            // https://mongodb.github.io/node-mongodb-native/4.5/classes/FindCursor.html
            // https://nodejs.org/docs/latest-v16.x/api/stream.html#streams-compatibility-with-async-generators-and-async-iterators
            // https://nodejs.org/docs/latest-v16.x/api/stream.html#additional-notes

            const readableMongoStream = new MongoReadableStream({
                cursor,
                signal: ac.signal,
                databaseAttachmentManager: this.databaseAttachmentManager,
                highWaterMark,
                configManager: this.configManager,
                getRaw
            });

            await pipeline(
                readableMongoStream,
                // new ObjectChunker(batchObjectCount),
                new ResourcePreparerTransform(
                    {
                        parsedArgs,
                        resourceType,
                        signal: ac.signal,
                        resourcePreparer: this.resourcePreparer,
                        highWaterMark,
                        configManager: this.configManager,
                        rawResources: getRaw
                    }
                ),
                // NOTE: do not use an async generator as the last writer otherwise the pipeline will hang
                new Transform({
                    writableObjectMode: true,

                    transform (chunk, encoding, callback) {
                        if (ac.signal.aborted) {
                            // https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop#partitioning
                            // calling in setImmediate to process it in next iteration of event loop
                            // and unblock other requests
                            setImmediate(callback);
                            return;
                        }
                        resources.push(chunk);
                        // https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop#partitioning
                        // calling in setImmediate to process it in next iteration of event loop
                        // and unblock other requests
                        setImmediate(callback);
                    }
                })
            );
        } catch (e) {
            logError('', { user, error: e });
            ac.abort();
            throw new RethrownError({
                message: `Error reading resources for ${resourceType} with query: ${mongoQueryStringify(cursor.getQuery())}`,
                error: e
            });
        }
        return resources;
    }

    /**
     * sets cursor batch size based on args or environment variables
     * @param {ParsedArgs} parsedArgs
     * @param {DatabasePartitionedCursor} cursorQuery
     * @return {{cursorBatchSize: number, cursorQuery: DatabasePartitionedCursor}}
     */
    setCursorBatchSize ({ parsedArgs, cursorQuery }) {
        const cursorBatchSize = parsedArgs._cursorBatchSize
            ? parseInt(parsedArgs._cursorBatchSize)
            : parseInt(env.MONGO_BATCH_SIZE);
        if (cursorBatchSize > 0) {
            cursorQuery = cursorQuery.batchSize({ size: cursorBatchSize });
        }
        return { cursorBatchSize, cursorQuery };
    }

    /**
     * set default sort options
     * @param {ParsedArgs} parsedArgs
     * @param {Object} options
     */
    setDefaultLimit (
        {
            parsedArgs,
            options
        }
    ) {
        // set a limit so the server does not come down due to volume of data
        if (!parsedArgs.id && (!parsedArgs._elements || parsedArgs._isGraphQLRequest) ) {
            options.limit = DB_SEARCH_LIMIT;
        } else {
            options.limit = DB_SEARCH_LIMIT_FOR_IDS;
        }
    }

    /**
     * sets the index hint
     * @param {string} mongoCollectionName
     * @param {Set} columns
     * @param {DatabasePartitionedCursor} cursor
     * @param {string | null} user
     * @param {string | undefined} indexName
     * @return {{cursor: DatabasePartitionedCursor, indexHint: (string|null)}}
     */
    setIndexHint (
        {
            mongoCollectionName,
            columns,
            cursor,
            user,
            indexName
        }
    ) {
        let _cursor = cursor;
        const indexHint = this.indexHinter.findIndexForFields(mongoCollectionName, Array.from(columns), indexName);
        if (indexHint) {
            _cursor = _cursor.hint({ indexHint });
            logDebug(
                'Using index hint',
                {
                    user,
                    args: {
                        indexHint,
                        columns: Array.from(columns)
                    }
                });
        }
        return { indexHint, cursor: _cursor };
    }

    /**
     * Reads resources from Mongo cursor and writes to response
     * @param {DatabasePartitionedCursor} cursor
     * @param {string|null} requestId
     * @param {string | null} url
     * @param {function (string | null, number): Bundle} fnBundle
     * @param {import('http').ServerResponse} res
     * @param {string | null} user
     * @param {ParsedArgs|null} parsedArgs
     * @param {string} resourceType
     * @param {string[]|null} accepts
     * @param {string} defaultSortId
     * @param {boolean} getRaw
     * @returns {Promise<string[]>} ids of resources streamed
     */
    async streamResourcesFromCursorAsync (
        {
            requestId,
            cursor,
            url,
            fnBundle,
            res,
            user,
            parsedArgs,
            resourceType,
            accepts,
            defaultSortId,
            params,
            getRaw = false
        }
    ) {
        assertIsValid(requestId);

        /**
         * For buffering: https://nodejs.org/docs/latest-v18.x/api/stream.html#buffering
         * @type {number}
         */
        const highWaterMark = this.configManager.streamingHighWaterMark || 100;

        /**
         * @type {{id: *[]}}
         */
        const tracker = {
            id: []
        };

        /**
         * @type {AbortController}
         */
        const ac = new AbortController();

        function onResponseClose () {
            ac.abort();
        }

        // if response is closed then abort the pipeline
        res.on('close', onResponseClose);

        /**
         * @type {FhirResourceWriterBase}
         */
        const fhirWriter = this.fhirResourceWriterFactory.createResourceWriter(
            {
                accepts,
                signal: ac.signal,
                format: parsedArgs._format,
                url,
                bundle: parsedArgs._bundle,
                fnBundle,
                defaultSortId,
                highWaterMark,
                configManager: this.configManager,
                response: res,
                rawResources: getRaw
            }
        );

        /**
         * @type {HttpResponseWriter}
         */
        const responseWriter = new HttpResponseWriter(
            {
                requestId,
                response: res,
                contentType: fhirWriter.getContentType(),
                signal: ac.signal,
                highWaterMark,
                configManager: this.configManager
            }
        );
        /**
         * @type {ResourcePreparerTransform}
         */
        const resourcePreparerTransform = new ResourcePreparerTransform(
            {
                parsedArgs,
                resourceType,
                signal: ac.signal,
                resourcePreparer: this.resourcePreparer,
                highWaterMark,
                configManager: this.configManager,
                response: res,
                rawResources: getRaw
            }
        );
        /**
         * @type {ResourceIdTracker}
         */
        const resourceIdTracker = new ResourceIdTracker(
            {
                tracker,
                signal: ac.signal,
                highWaterMark,
                configManager: this.configManager
            }
        );

        /**
         * @type {Readable}
         */
        const readableMongoStream = new MongoReadableStream({
            cursor,
            signal: ac.signal,
            databaseAttachmentManager: this.databaseAttachmentManager,
            searchManager: this,
            highWaterMark,
            configManager: this.configManager,
            response: res,
            params,
            getRaw
        });

        try {
            // now setup and run the pipeline
            await pipeline(
                readableMongoStream,
                // new Transform({
                //     objectMode: true,
                //     transform(chunk, encoding, callback) {
                //         sleep(60 * 1000).then(callback);
                //     }
                // }),
                resourcePreparerTransform,
                resourceIdTracker,
                fhirWriter,
                responseWriter
            );
        } catch (e) {
            logError(`SearchManager.streamResourcesFromCursorAsync: ${e.message} `, {
                user,
                error: new RethrownError(
                    {
                        message: `Error reading resources for ${resourceType} with query: ${mongoQueryStringify(cursor.getQuery())}`,
                        error: e
                    })
            });
            ac.abort();
        } finally {
            res.removeListener('close', onResponseClose);
        }
        if (!res.writableEnded) {
            res.end();
        }
        return tracker.id;
    }

    /**
     * @description Validates if the correct arguments are being sent that will query AuditEvents.
     * @param {ParsedArgs} parsedArgs
     */
    validateAuditEventQueryParameters (parsedArgs) {
        const requiredFiltersForAuditEvent = this.configManager.requiredFiltersForAuditEvent;
        // Validate all the required parameters are passed for AuditEvent.
        this.auditEventValidateRequiredFilters(parsedArgs, requiredFiltersForAuditEvent);

        if (requiredFiltersForAuditEvent && requiredFiltersForAuditEvent.includes('date')) {
            // Fetching all the parsed arguments for date
            const dateQueryParameterValues = parsedArgs.date;
            const queryParameters = Array.isArray(dateQueryParameterValues)
                ? dateQueryParameterValues
                : [dateQueryParameterValues];

            const [operationDateObject, isGreaterThanConditionPresent, isLessThanConditionPresent] = this.getAuditEventValidDateOperationList(queryParameters);

            if (!isGreaterThanConditionPresent || !isLessThanConditionPresent) {
                const message = 'Atleast two operations lt/le and gt/ge need to be passed in params to query AuditEvent';
                throw new BadRequestError(
                    {
                        message,
                        toString: function () {
                            return message;
                        }
                    }
                );
            }

            // Fetching all dates from operatorsList object
            const values = Object.values(operationDateObject);

            // If the difference between two dates is greater than a month throw error.
            if (Math.abs(values[0].diff(values[1], 'days')) >= this.configManager.auditEventMaxRangePeriod) {
                const message = `The difference between dates to query AuditEvent should not be greater than ${this.configManager.auditEventMaxRangePeriod}`;
                throw new BadRequestError(
                    {
                        message,
                        toString: function () {
                            return message;
                        }
                    }
                );
            }
        }
    }

    /**
     * @description Validates that all the required parameters for AuditEvent are present in parsedArgs
     * @param {ParsedArgs} parsedArgs
     * @param {string[]|null} requiredFiltersForAuditEvent
     */
    auditEventValidateRequiredFilters (parsedArgs, requiredFiltersForAuditEvent) {
        const missingFilters = requiredFiltersForAuditEvent?.filter(filter => !parsedArgs[filter]);
        if (missingFilters?.length > 0) {
            const missingFilterExamples = missingFilters.map(filter => {
                if (filter === 'date') {
                    return '?date=ge2024-01-01&date=le2024-01-07';
                }
                return null;
            }).filter(example => example !== null);
            const message = `One of the filters [${requiredFiltersForAuditEvent.join(',')}] is required to ` +
                `query AuditEvent. Example: ${missingFilterExamples.join(', ')}`;
            throw new BadRequestError({
                message,
                toString: function () {
                    return message;
                }
            });
        }
    }

    /**
     * @description Validates the correct AuditEvent operations are passed in params and date passed is valid.
     * @param {Object} queryParams
     * @returns {Object}
     */
    getAuditEventValidDateOperationList (queryParams) {
        const allowedOperations = ['gt', 'ge', 'lt', 'le'];
        const operationDateObject = {};
        const regex = /([a-z]+)(.+)/;
        let isLessThanConditionPresent = false;
        let isGreaterThanConditionPresent = false;
        for (const /* @type {string} */ dateParam of queryParams) {
            // Match the date passed in param if it matches the regex pattern.
            const regexMatch = dateParam.match(regex);
            if (!regexMatch) {
                const message = `${dateParam} is not valid to query AuditEvent. [lt, gt] operation is required`;
                throw new BadRequestError({
                    message,
                    toString: function () {
                        return message;
                    }
                });
            }
            // Validate if date is valid and the operations is allowed to be performed.
            if (!allowedOperations.includes(regexMatch[1]) || !moment.utc(regexMatch[2]).isValid()) {
                const message = `${regexMatch[0]} is not a valid query.`;
                throw new BadRequestError({
                    message,
                    toString: function () {
                        return message;
                    }
                });
            }
            if (regexMatch[1] === 'gt' || regexMatch[1] === 'ge') {
                isGreaterThanConditionPresent = true;
            } else if (regexMatch[1] === 'lt' || regexMatch[1] === 'le') {
                isLessThanConditionPresent = true;
            }
            // Object of operation and date.
            operationDateObject[regexMatch[1]] = moment.utc(regexMatch[2]);
        }
        return [operationDateObject, isGreaterThanConditionPresent, isLessThanConditionPresent];
    }
}

module.exports = {
    SearchManager
};
