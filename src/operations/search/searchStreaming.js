const env = require('var');
const httpContext = require('express-http-context');
const { MongoError } = require('../../utils/mongoErrors');
const { isTrue } = require('../../utils/isTrue');
const { fhirContentTypes } = require('../../utils/contentTypes');
const { mongoQueryAndOptionsStringify } = require('../../utils/mongoQueryStringify');
const { assertTypeEquals } = require('../../utils/assertType');
const { SearchManager } = require('./searchManager');
const { ResourceLocatorFactory } = require('../common/resourceLocatorFactory');
const { AuditLogger } = require('../../utils/auditLogger');
const { FhirLoggingManager } = require('../common/fhirLoggingManager');
const { ScopesValidator } = require('../security/scopesValidator');
const { BundleManager } = require('../common/bundleManager');
const { ConfigManager } = require('../../utils/configManager');
const { ParsedArgs } = require('../query/parsedArgs');
const { QueryItem } = require('../graph/queryItem');
const { PostRequestProcessor } = require('../../utils/postRequestProcessor');
const { ACCESS_LOGS_ENTRY_DATA } = require('../../constants');
const { READ } = require('../../constants').OPERATIONS;

class SearchStreamingOperation {
    /**
     * constructor
     * @param {SearchManager} searchManager
     * @param {ResourceLocatorFactory} resourceLocatorFactory
     * @param {AuditLogger} auditLogger
     * @param {FhirLoggingManager} fhirLoggingManager
     * @param {ScopesValidator} scopesValidator
     * @param {BundleManager} bundleManager
     * @param {ConfigManager} configManager
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
         * @type {PostRequestProcessor}
         */
        this.postRequestProcessor = postRequestProcessor;
        assertTypeEquals(postRequestProcessor, PostRequestProcessor);
    }

    /**
     * does a FHIR Search
     * @param {FhirRequestInfo} requestInfo
     * @param {import('express').Response} res
     * @param {ParsedArgs} parsedArgs
     * @param {string} resourceType
     * @return {Promise<Resource[] | {entry:{resource: Resource}[]}>} array of resources or a bundle
     */
    async searchStreamingAsync (
        { requestInfo, res, parsedArgs, resourceType }) {
        assertTypeEquals(parsedArgs, ParsedArgs);
        const currentOperationName = 'searchStreaming';
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
            originalUrl,
            /** @type {string | null} */
            protocol,
            /** @type {string | null} */
            host,
            /** @type {string} */
            personIdFromJwtToken,
            /** @type {string} */
            clientPersonIdFromJwtToken,
            /** @type {boolean} */
            isUser,
            /** @type {string} */
            requestId,
            /** @type {string} */
            userRequestId
        } = requestInfo;

        await this.scopesValidator.verifyHasValidScopesAsync(
            {
                requestInfo,
                parsedArgs,
                resourceType,
                startTime,
                action: currentOperationName,
                accessRequested: 'read'
            }
        );

        /**
         * @type {boolean}
         */
        const useAccessIndex = (this.configManager.useAccessIndex || isTrue(parsedArgs._useAccessIndex));

        const { /** @type {string} **/base_version } = parsedArgs;

        /** @type {import('mongodb').Document}**/
        let query = {};
        /** @type {Set} **/
        let columns = new Set();

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
                    clientPersonIdFromJwtToken,
                    parsedArgs,
                    operation: READ
                }));
        } catch (e) {
            await this.fhirLoggingManager.logOperationFailureAsync({
                requestInfo,
                args: parsedArgs.getRawArgs(),
                resourceType,
                startTime,
                action: currentOperationName,
                error: e,
                message: `Error in constructing query: ${e.message}`
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

        /**
         * @type {string}
         */
        let collectionName;
        /**
         * @type {string}
         */
        let databaseName = '';

        try {
            /** @type {GetCursorResult} **/
            const __ret = await this.searchManager.getCursorForQueryAsync(
                {
                    resourceType,
                    base_version,
                    parsedArgs,
                    columns,
                    options,
                    query,
                    maxMongoTimeMS,
                    user,
                    isStreaming: true,
                    useAccessIndex,
                    extraInfo
                }
            );
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
            const resources = __ret.resources;
            /**
             * @type {number | null}
             */
            const total_count = __ret.total_count;
            /**
             * @type {string | null}
             */
            const indexHint = __ret.indexHint;
            /**
             * @type {number}
             */
            const cursorBatchSize = __ret.cursorBatchSize;
            /**
             * @type {DatabasePartitionedCursor}
             */
            const cursor = __ret.cursor;

            /**
             * @type {number}
             */
            const stopTime = Date.now();

            /**
             * @type {boolean}
             */
            const useNdJson = fhirContentTypes.hasNdJsonContentType(requestInfo.accept);

            /**
             * @type {string[]}
             */
            let resourceIds = [];
            /**
             * @type {number}
             */
            const batchObjectCount = Number(env.STREAMING_BATCH_COUNT) || 1;

            /**
             * @type {import('mongodb').Document[]}
             */
            const explanations = (cursor && (parsedArgs._explain || parsedArgs._debug || env.LOGLEVEL === 'DEBUG'))
                ? (await cursor.explainAsync()) : [];
            if (cursor && parsedArgs._explain) {
                // if explain is requested then don't return any results
                cursor.clear();
            }

            collectionName = cursor ? cursor.getFirstCollection() : null;
            databaseName = cursor ? cursor.getFirstDatabase() : null;
            /**
             * @type {string[]}
             */
            const allCollectionsToSearch = cursor ? cursor.getAllCollections() : [];

            if (cursor !== null) { // usually means the two-step optimization found no results
                /**
                 * @type {Resource[]}
                 */
                const resources1 = [];
                const defaultSortId = this.configManager.defaultSortId;
                /**
                 * bundle
                 * @param {string|null} last_id
                 * @param {number} stopTime1
                 * @return {Bundle}
                 */
                const fnBundle = (last_id, stopTime1) => this.bundleManager.createBundle(
                    {
                        type: 'searchset',
                        requestId: requestInfo.userRequestId,
                        originalUrl,
                        host,
                        protocol,
                        last_id,
                        resources: resources1,
                        base_version,
                        total_count,
                        originalQuery: new QueryItem(
                            {
                                query,
                                resourceType,
                                collectionName
                            }
                        ),
                        databaseName,
                        originalOptions,
                        columns,
                        stopTime: stopTime1,
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
                resourceIds = await this.searchManager.streamResourcesFromCursorAsync(
                    {
                        requestId,
                        cursor,
                        url: originalUrl,
                        fnBundle,
                        res,
                        user,
                        parsedArgs,
                        resourceType,
                        batchObjectCount,
                        defaultSortId,
                        accepts: requestInfo.accept
                    });

                if (resourceIds.length > 0 && resourceType !== 'AuditEvent') {
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
                                    ids: resourceIds
                                }
                            );
                        }
                    });
                }
            } else { // no records found
                if (useNdJson) {
                    if (requestId && !res.headersSent) {
                        res.setHeader('X-Request-ID', String(userRequestId));
                    }
                    // empty response
                    res.type(fhirContentTypes.ndJson);
                    res.status(200).end();
                } else {
                    // return empty bundle
                    if (this.configManager.enableReturnBundle || parsedArgs._bundle) {
                        /**
                         * @type {Bundle}
                         */
                        const bundle = this.bundleManager.createBundle(
                            {
                                type: 'searchset',
                                requestId: requestInfo.requestId,
                                originalUrl,
                                host,
                                protocol,
                                last_id: null,
                                resources,
                                base_version,
                                total_count,
                                originalQuery,
                                databaseName,
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
                        if (requestId && !res.headersSent) {
                            res.setHeader('X-Request-ID', String(userRequestId));
                        }
                        // noinspection JSUnresolvedFunction
                        res.type(fhirContentTypes.fhirJson).json(bundle.toJSON());
                    } else {
                        if (requestId && !res.headersSent) {
                            res.setHeader('X-Request-ID', String(userRequestId));
                        }
                        res.type(fhirContentTypes.fhirJson).json([]);
                    }
                }
            }
            httpContext.set(ACCESS_LOGS_ENTRY_DATA, {
                query: mongoQueryAndOptionsStringify({
                        query: new QueryItem({
                            query,
                            resourceType,
                            collectionName
                        }),
                        options
                    }
                )
            });
            await this.fhirLoggingManager.logOperationSuccessAsync({
                requestInfo,
                args: parsedArgs.getRawArgs(),
                resourceType,
                startTime,
                action: currentOperationName
            });
        } catch (e) {
            /**
             * @type {string}
             */
            collectionName = collectionName || (await resourceLocator.getFirstCollectionNameForQueryDebugOnlyAsync({
                query
            }));
            httpContext.set(ACCESS_LOGS_ENTRY_DATA, {
                query: mongoQueryAndOptionsStringify({
                        query: new QueryItem({
                            query,
                            resourceType,
                            collectionName
                        }),
                        options
                    }
                )
            });
            await this.fhirLoggingManager.logOperationFailureAsync({
                requestInfo,
                args: parsedArgs.getRawArgs(),
                resourceType,
                startTime,
                action: currentOperationName,
                error: e,
                message: `Error in streaming resources: ${e.message}`
            });
            throw new MongoError(requestId, e.message, e, collectionName, query, (Date.now() - startTime), options);
        }
    }
}

module.exports = {
    SearchStreamingOperation
};
