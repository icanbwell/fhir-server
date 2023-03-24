const env = require('var');
const {MongoError} = require('../../utils/mongoErrors');
const {isTrue} = require('../../utils/isTrue');
const {fhirContentTypes} = require('../../utils/contentTypes');
const {fhirRequestTimer} = require('../../utils/prometheus.utils');
const {mongoQueryAndOptionsStringify} = require('../../utils/mongoQueryStringify');
const moment = require('moment-timezone');
const {assertTypeEquals} = require('../../utils/assertType');
const {SearchManager} = require('./searchManager');
const {ResourceLocatorFactory} = require('../common/resourceLocatorFactory');
const {AuditLogger} = require('../../utils/auditLogger');
const {ErrorReporter} = require('../../utils/slack.logger');
const {FhirLoggingManager} = require('../common/fhirLoggingManager');
const {ScopesValidator} = require('../security/scopesValidator');
const {BundleManager} = require('../common/bundleManager');
const {ConfigManager} = require('../../utils/configManager');
const {BadRequestError} = require('../../utils/httpErrors');
const {ParsedArgs} = require('../query/parsedArgs');
const {QueryItem} = require('../graph/queryItem');


class SearchStreamingOperation {
    /**
     * constructor
     * @param {SearchManager} searchManager
     * @param {ResourceLocatorFactory} resourceLocatorFactory
     * @param {AuditLogger} auditLogger
     * @param {ErrorReporter} errorReporter
     * @param {FhirLoggingManager} fhirLoggingManager
     * @param {ScopesValidator} scopesValidator
     * @param {BundleManager} bundleManager
     * @param {ConfigManager} configManager
     */
    constructor(
        {
            searchManager,
            resourceLocatorFactory,
            auditLogger,
            errorReporter,
            fhirLoggingManager,
            scopesValidator,
            bundleManager,
            configManager
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
         * @type {ErrorReporter}
         */
        this.errorReporter = errorReporter;
        assertTypeEquals(errorReporter, ErrorReporter);
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
    }

    /**
     * does a FHIR Search
     * @param {FhirRequestInfo} requestInfo
     * @param {import('express').Response} res
     * @param {ParsedArgs} parsedArgs
     * @param {string} resourceType
     * @return {Promise<Resource[] | {entry:{resource: Resource}[]}>} array of resources or a bundle
     */
    async searchStreamingAsync(
        {requestInfo, res, parsedArgs, resourceType}) {
        assertTypeEquals(parsedArgs, ParsedArgs);
        const currentOperationName = 'searchStreaming';
        // Start the FHIR request timer, saving a reference to the returned method
        const timer = fhirRequestTimer.startTimer();
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
            /** @type {string[] | null} */
            patientIdsFromJwtToken,
            /** @type {string} */
            personIdFromJwtToken,
            /** @type {boolean} */
            isUser,
            /** @type {string} */
            requestId,
            /** @type {string} */
            method
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
        const useAccessIndex = (this.configManager.useAccessIndex || isTrue(parsedArgs['_useAccessIndex']));

        const {/** @type {string} **/base_version} = parsedArgs;

        /** @type {import('mongodb').Document}**/
        let query = {};
        /** @type {Set} **/
        let columns = new Set();

        // check if required filters for AuditEvent are passed
        if (resourceType === 'AuditEvent') {
            // args must contain one of these
            const requiredFiltersForAuditEvent = this.configManager.requiredFiltersForAuditEvent;
            if (requiredFiltersForAuditEvent && requiredFiltersForAuditEvent.length > 0) {
                if (requiredFiltersForAuditEvent.filter(r => parsedArgs[`${r}`]).length === 0) {
                    const message = `One of the filters [${requiredFiltersForAuditEvent.join(',')}] are required to query AuditEvent`;
                    throw new BadRequestError(
                        {
                            'message': message,
                            toString: function () {
                                return message;
                            }
                        }
                    );
                }
            }
        }

        try {
            ({
                /** @type {import('mongodb').Document}**/
                query,
                /** @type {Set} **/
                columns
            } = await this.searchManager.constructQueryAsync(
                {
                    user, scope, isUser, patientIdsFromJwtToken, resourceType, useAccessIndex,
                    personIdFromJwtToken,
                    parsedArgs
                }));
        } catch (e) {
            await this.fhirLoggingManager.logOperationFailureAsync(
                {
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
        let options = {};

        // Query our collection for this observation
        /**
         * @type {number}
         */
        const maxMongoTimeMS = env.MONGO_TIMEOUT ? parseInt(env.MONGO_TIMEOUT) : 30 * 1000;
        /**
         * @type {ResourceLocator}
         */
        const resourceLocator = this.resourceLocatorFactory.createResourceLocator(
            {resourceType, base_version});

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
                    resourceType, base_version,
                    parsedArgs, columns, options, query,
                    maxMongoTimeMS, user, isStreaming: true, useAccessIndex
                }
            );
            /**
             * @type {Set}
             */
            columns = __ret.columns;
            /**
             * @type {QueryItem|QueryItem[]}
             */
            let originalQuery = __ret.originalQuery;
            /**
             * @type {import('mongodb').FindOneOptions[]}
             */
            let originalOptions = __ret.originalOptions;
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
            let total_count = __ret.total_count;
            /**
             * @type {string | null}
             */
            let indexHint = __ret.indexHint;
            /**
             * @type {number}
             */
            let cursorBatchSize = __ret.cursorBatchSize;
            /**
             * @type {DatabasePartitionedCursor}
             */
            let cursor = __ret.cursor;

            /**
             * @type {number}
             */
            const stopTime = Date.now();

            /**
             * @type {boolean}
             */
            const useNdJson = requestInfo.accept.includes(fhirContentTypes.ndJson);

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
            const explanations = (cursor && (parsedArgs['_explain'] || parsedArgs['_debug'] || env.LOGLEVEL === 'DEBUG')) ?
                (await cursor.explainAsync()) : [];
            if (cursor && parsedArgs['_explain']) {
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
                if (useNdJson) {
                    resourceIds = await this.searchManager.streamResourcesFromCursorAsync(
                        {
                            requestId,
                            cursor,
                            res,
                            user,
                            scope,
                            parsedArgs,
                            resourceType,
                            useAccessIndex,
                            contentType: fhirContentTypes.ndJson,
                            batchObjectCount
                        });
                } else {
                    // if env.RETURN_BUNDLE is set then return as a Bundle
                    if (this.configManager.enableReturnBundle || parsedArgs['_bundle']) {
                        /**
                         * @type {Resource[]}
                         */
                        const resources1 = [];
                        /**
                         * bundle
                         * @param {string|null} last_id
                         * @param {number} stopTime1
                         * @return {Bundle}
                         */
                        const fnBundle = (last_id, stopTime1) => this.bundleManager.createBundle(
                            {
                                type: 'searchset',
                                requestId: requestInfo.requestId,
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
                        resourceIds = await this.searchManager.streamBundleFromCursorAsync(
                            {
                                requestId,
                                cursor,
                                url: originalUrl,
                                fnBundle,
                                res,
                                user,
                                scope,
                                parsedArgs,
                                resourceType,
                                useAccessIndex,
                                batchObjectCount
                            });
                    } else {
                        resourceIds = await this.searchManager.streamResourcesFromCursorAsync(
                            {
                                requestId,
                                cursor, res, user, scope, parsedArgs,
                                resourceType,
                                useAccessIndex,
                                contentType: fhirContentTypes.fhirJson,
                                batchObjectCount
                            });
                    }
                }
                if (resourceIds.length > 0) {
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
                    const currentDate = moment.utc().format('YYYY-MM-DD');
                    await this.auditLogger.flushAsync({requestId, currentDate, method});
                }
            } else { // no records found
                if (useNdJson) {
                    if (requestId && !res.headersSent) {
                        res.setHeader('X-Request-ID', String(requestId));
                    }
                    // empty response
                    res.type(fhirContentTypes.ndJson);
                    res.status(200).end();
                } else {
                    // return empty bundle
                    if (this.configManager.enableReturnBundle || parsedArgs['_bundle']) {
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
                            res.setHeader('X-Request-ID', String(requestId));
                        }
                        // noinspection JSUnresolvedFunction
                        res.type(fhirContentTypes.fhirJson).json(bundle.toJSON());
                    } else {
                        if (requestId && !res.headersSent) {
                            res.setHeader('X-Request-ID', String(requestId));
                        }
                        res.type(fhirContentTypes.fhirJson).json([]);
                    }
                }
            }
            await this.fhirLoggingManager.logOperationSuccessAsync(
                {
                    requestInfo,
                    args: parsedArgs.getRawArgs(),
                    resourceType,
                    startTime,
                    action: currentOperationName,
                    query: mongoQueryAndOptionsStringify({
                            query: new QueryItem({
                                query,
                                resourceType,
                                collectionName
                            }), options
                        }
                    )
                });
        } catch (e) {
            /**
             * @type {string}
             */
            collectionName = collectionName || (await resourceLocator.getFirstCollectionNameForQueryDebugOnlyAsync({
                query
            }));
            await this.fhirLoggingManager.logOperationFailureAsync(
                {
                    requestInfo,
                    args: parsedArgs.getRawArgs(),
                    resourceType,
                    startTime,
                    action: currentOperationName,
                    error: e,
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
            throw new MongoError(requestId, e.message, e, collectionName, query, (Date.now() - startTime), options);
        } finally {
            timer({action: currentOperationName, resourceType});
        }
    }
}

module.exports = {
    SearchStreamingOperation
};
