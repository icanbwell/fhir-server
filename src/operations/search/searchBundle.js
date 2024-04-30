const env = require('var');
const httpContext = require('express-http-context');
const { MongoError } = require('../../utils/mongoErrors');
const { logDebug } = require('../common/logging');
const { isTrue } = require('../../utils/isTrue');
const { mongoQueryAndOptionsStringify } = require('../../utils/mongoQueryStringify');
const { assertTypeEquals, assertIsValid } = require('../../utils/assertType');
const { SearchManager } = require('./searchManager');
const { ResourceLocatorFactory } = require('../common/resourceLocatorFactory');
const { AuditLogger } = require('../../utils/auditLogger');
const { FhirLoggingManager } = require('../common/fhirLoggingManager');
const { ScopesValidator } = require('../security/scopesValidator');
const { BundleManager } = require('../common/bundleManager');
const { ConfigManager } = require('../../utils/configManager');
const { ParsedArgs } = require('../query/parsedArgs');
const { QueryItem } = require('../graph/queryItem');
const { DatabaseAttachmentManager } = require('../../dataLayer/databaseAttachmentManager');
const { PostRequestProcessor } = require('../../utils/postRequestProcessor');
const { GRIDFS: { RETRIEVE }, OPERATIONS: { READ }, ACCESS_LOGS_ENTRY_DATA } = require('../../constants');

class SearchBundleOperation {
    /**
     * constructor
     * @param {SearchManager} searchManager
     * @param {ResourceLocatorFactory} resourceLocatorFactory
     * @param {AuditLogger} auditLogger
     * @param {FhirLoggingManager} fhirLoggingManager
     * @param {ScopesValidator} scopesValidator
     * @param {BundleManager} bundleManager
     * @param {ConfigManager} configManager
     * @param {DatabaseAttachmentManager} databaseAttachmentManager
     * @param {PostRequestProcessor} postRequestProcessor
     */
    constructor (
        {
            searchManager,
            resourceLocatorFactory,
            auditLogger,
            fhirLoggingManager,
            scopesValidator,
            bundleManager,
            configManager,
            databaseAttachmentManager,
            postRequestProcessor
        }
    ) {
        /**
         * @type {SearchManager}
         */
        this.searchManager = searchManager;
        assertTypeEquals(searchManager, SearchManager);

        /**
         * @type {ResourceLocatorFactory}
         */
        this.resourceLocatorFactory = resourceLocatorFactory;
        assertTypeEquals(resourceLocatorFactory, ResourceLocatorFactory);

        /**
         * @type {AuditLogger}
         */
        this.auditLogger = auditLogger;
        assertTypeEquals(auditLogger, AuditLogger);

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
         * @type {BundleManager}
         */
        this.bundleManager = bundleManager;
        assertTypeEquals(bundleManager, BundleManager);

        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);

        /**
         * @type {DatabaseAttachmentManager}
         */
        this.databaseAttachmentManager = databaseAttachmentManager;
        assertTypeEquals(databaseAttachmentManager, DatabaseAttachmentManager);

        /**
         * @type {PostRequestProcessor}
         */
        this.postRequestProcessor = postRequestProcessor;
        assertTypeEquals(postRequestProcessor, PostRequestProcessor);
    }

    /**
     * does a FHIR Search
     * @param {FhirRequestInfo} requestInfo
     * @param {ParsedArgs} parsedArgs
     * @param {string} resourceType
     * @param {boolean} useAggregationPipeline
     * @return {Promise<Bundle>} array of resources or a bundle
     */
    async searchBundleAsync (
        { requestInfo, parsedArgs, resourceType, useAggregationPipeline }
    ) {
        assertIsValid(requestInfo !== undefined);
        assertIsValid(resourceType !== undefined);
        assertTypeEquals(parsedArgs, ParsedArgs);
        const currentOperationName = 'search';
        const extraInfo = {
            currentOperationName
        };
        /**
         * @type {number}
         */
        const startTime = Date.now();
        const {
            /** @type {string | null} */
            user,
            /** @type {string | null} */
            scope,
            /** @type {string | null} */
            originalUrl: url,
            /** @type {string} */
            personIdFromJwtToken,
            /** @type {boolean} */
            isUser,
            /** @type {string | null} */
            protocol,
            /** @type {string | null} */
            host,
            /**
             * @type {string}
             */
            requestId
        } = requestInfo;

        assertIsValid(requestId, 'requestId is null');
        await this.scopesValidator.verifyHasValidScopesAsync({
            requestInfo,
            parsedArgs,
            resourceType,
            startTime,
            action: currentOperationName,
            accessRequested: 'read'
        });

        /**
         * @type {boolean}
         */
        const useAccessIndex = (this.configManager.useAccessIndex || isTrue(parsedArgs._useAccessIndex));

        const { /** @type {string} **/base_version } = parsedArgs;

        /** @type {import('mongodb').Document}**/
        let query = {};
        /** @type {Set} **/
        let columns;

        // check if required filters for AuditEvent are passed
        if (resourceType === 'AuditEvent') {
            this.searchManager.validateAuditEventQueryParameters(parsedArgs);
        }

        try {
            ({
                /** @type {import('mongodb').Document}**/
                query,
                /** @type {Set} **/
                columns
            } = await this.searchManager.constructQueryAsync(
                {
                    user,
                    scope,
                    isUser,
                    resourceType,
                    useAccessIndex,
                    personIdFromJwtToken,
                    parsedArgs,
                    operation: READ
                }));
        } catch (e) {
            httpContext.set(ACCESS_LOGS_ENTRY_DATA, {
                requestInfo,
                args: parsedArgs.getRawArgs(),
                resourceType,
                startTime,
                action: currentOperationName,
                error: e
            });
            await this.fhirLoggingManager.logOperationFailureAsync({
                requestInfo,
                args: parsedArgs.getRawArgs(),
                resourceType,
                startTime,
                action: currentOperationName,
                error: e
            });
            throw e;
        }
        /**
         * @type {import('mongodb').FindOneOptions}
         */
        const options = {};

        // Query our collection for this observation
        /**
         * @type {number}
         */
        const maxMongoTimeMS = env.MONGO_TIMEOUT ? parseInt(env.MONGO_TIMEOUT) : 30 * 1000;
        /**
         * @type {ResourceLocator}
         */
        const resourceLocator = this.resourceLocatorFactory.createResourceLocator(
            { resourceType, base_version });
        try {
            /** @type {GetCursorResult} **/
            const __ret = await this.searchManager.getCursorForQueryAsync(
                {
                    resourceType,
                    base_version,
                    columns,
                    options,
                    query,
                    maxMongoTimeMS,
                    user,
                    isStreaming: false,
                    useAccessIndex,
                    parsedArgs,
                    useAggregationPipeline,
                    extraInfo
                });
            /**
             * @type {Set}
             */
            columns = __ret.columns;
            /**
             * @type {QueryItem|QueryItem[]}
             */
            const originalQuery = __ret.originalQuery;
            /**
             * @type {import('mongodb').FindOneOptions[]}
             */
            const originalOptions = __ret.originalOptions;
            /**
             * @type {boolean}
             */
            const useTwoStepSearchOptimization = __ret.useTwoStepSearchOptimization;
            /**
             * @type {Resource[]}
             */
            let resources = __ret.resources;
            /**
             * @type {number | null}
             */
            const total_count = __ret.total_count;
            /**
             * @type {string | null}
             */
            const indexHint = __ret.indexHint;
            /**
             * @type {Number}
             */
            const cursorBatchSize = __ret.cursorBatchSize;
            /**
             * @type {DatabasePartitionedCursor}
             */
            const cursor = __ret.cursor;

            /**
             * @type {import('mongodb').Document[]}
             */
            const explanations = (cursor && !useAggregationPipeline && (parsedArgs._explain || parsedArgs._debug || env.LOGLEVEL === 'DEBUG')) ? await cursor.explainAsync() : [];
            if (cursor && parsedArgs._explain) {
                // if explain is requested then don't return any results
                cursor.clear();
            }
            // process results
            if (cursor !== null) { // usually means the two-step optimization found no results
                logDebug('', {
                    user,
                    args: {
                        query:
                            mongoQueryAndOptionsStringify(
                                { query: originalQuery, options: originalOptions })
                    }
                });
                resources = await this.searchManager.readResourcesFromCursorAsync(
                    {
                        cursor,
                        user,
                        parsedArgs,
                        resourceType
                    }
                );

                if (resources.length > 0 && resourceType !== 'AuditEvent') {
                    this.postRequestProcessor.add({
                        requestId,
                        fnTask: async () => {
                            // log access to audit logs
                            await this.auditLogger.logAuditEntryAsync(
                                {
                                    requestInfo,
                                    base_version,
                                    resourceType,
                                    operation: 'read',
                                    args: parsedArgs.getRawArgs(),
                                    ids: resources.map((r) => r.id)
                                }
                            );
                        }
                    });
                }
            }

            resources = await this.databaseAttachmentManager.transformAttachments(resources, RETRIEVE);

            /**
             * @type {number}
             */
            const stopTime = Date.now();

            /**
             * @type {string}
             */
            const collectionName = await resourceLocator.getFirstCollectionNameForQueryDebugOnlyAsync({
                query
            });
            /**
             * id of last resource in the list it can be either _uuid or id depending on DEFAULT_SORT_ID passed
             * @type {?string}
             */
            const defaultSortId = this.configManager.defaultSortId;
            const last_id = resources.length > 0 ? resources[resources.length - 1][defaultSortId] : null;
            /**
             * @type {string[]}
             */
            const allCollectionsToSearch = cursor ? cursor.getAllCollections() : [];
            /**
             * @type {Bundle}
             */
            const bundle = this.bundleManager.createBundle(
                {
                    type: 'searchset',
                    requestId: requestInfo.userRequestId,
                    originalUrl: url,
                    host,
                    protocol,
                    last_id,
                    resources,
                    base_version,
                    total_count,
                    originalQuery,
                    originalOptions,
                    columns,
                    stopTime,
                    startTime,
                    useTwoStepSearchOptimization,
                    indexHint,
                    cursorBatchSize,
                    user,
                    explanations,
                    allCollectionsToSearch,
                    parsedArgs
                }
            );
            httpContext.set(ACCESS_LOGS_ENTRY_DATA, {
                requestInfo,
                args: parsedArgs.getRawArgs(),
                resourceType,
                startTime,
                action: currentOperationName,
                query: mongoQueryAndOptionsStringify({
                    query: new QueryItem({
                        query,
                        collectionName,
                        resourceType
                    }),
                    options
                })
            });
            await this.fhirLoggingManager.logOperationSuccessAsync({
                requestInfo,
                args: parsedArgs.getRawArgs(),
                resourceType,
                startTime,
                action: currentOperationName,
                query: mongoQueryAndOptionsStringify({
                    query: new QueryItem({
                        query,
                        collectionName,
                        resourceType
                    }),
                    options
                })
            });
            return bundle;
        } catch (e) {
            /**
             * @type {string}
             */
            const collectionName = await resourceLocator.getFirstCollectionNameForQueryDebugOnlyAsync({
                query
            });
            httpContext.set(ACCESS_LOGS_ENTRY_DATA, {
                requestInfo,
                args: parsedArgs.getRawArgs(),
                resourceType,
                startTime,
                action: currentOperationName,
                error: e,
                query: mongoQueryAndOptionsStringify({
                    query: new QueryItem(
                        {
                            query,
                            resourceType,
                            collectionName
                        }
                    ),
                    options
                })
            });
            await this.fhirLoggingManager.logOperationFailureAsync({
                requestInfo,
                args: parsedArgs.getRawArgs(),
                resourceType,
                startTime,
                action: currentOperationName,
                error: e,
                query: mongoQueryAndOptionsStringify({
                    query: new QueryItem(
                        {
                            query,
                            resourceType,
                            collectionName
                        }
                    ),
                    options
                })
            });
            throw new MongoError(requestId, e.message, e, collectionName, query, (Date.now() - startTime), options);
        }
    }
}

module.exports = {
    SearchBundleOperation
};
