const env = require('var');
const {MongoError} = require('../../utils/mongoErrors');
const {getResource} = require('../common/getResource');
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
     */
    constructor(
        {
            searchManager,
            resourceLocatorFactory,
            auditLogger,
            errorReporter,
            fhirLoggingManager,
            scopesValidator,
            bundleManager
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
    }

    /**
     * does a FHIR Search
     * @param {FhirRequestInfo} requestInfo
     * @param {import('http').ServerResponse} res
     * @param {Object} args
     * @param {string} resourceType
     * @param {boolean} filter
     * @return {Promise<Resource[] | {entry:{resource: Resource}[]}>} array of resources or a bundle
     */
    async searchStreaming(
        requestInfo, res, args, resourceType,
        filter = true) {
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
            patients = [],
            /** @type {string} */
            fhirPersonId,
            /** @type {boolean} */
            isUser,
            /** @type {string} */
            requestId
        } = requestInfo;

        await this.scopesValidator.verifyHasValidScopesAsync(
            {
                requestInfo,
                args,
                resourceType,
                startTime,
                action: currentOperationName,
                accessRequested: 'read'
            }
        );

        /**
         * @type {boolean}
         */
        const useAccessIndex = (isTrue(env.USE_ACCESS_INDEX) || isTrue(args['_useAccessIndex']));

        /**
         * @type {boolean}
         */
        const useAtlas = (isTrue(env.USE_ATLAS) || isTrue(args['_useAtlas']));

        const {/** @type {string} **/base_version} = args;

        const allPatients = patients.concat(await this.searchManager.getLinkedPatientsAsync(
                {
                    base_version, useAtlas, isUser, fhirPersonId
                }
            )
        );

        /** @type {import('mongodb').Document}**/
        let query = {};
        /** @type {Set} **/
        let columns = new Set();

        try {
            ({
                /** @type {import('mongodb').Document}**/
                query,
                /** @type {Set} **/
                columns
            } = this.searchManager.constructQuery(
                {
                    user, scope, isUser, patients: allPatients, args, resourceType, useAccessIndex, filter
                }));
        } catch (e) {
            await this.fhirLoggingManager.logOperationFailureAsync(
                {
                    requestInfo,
                    args,
                    resourceType,
                    startTime,
                    action: currentOperationName,
                    error: e
                });
            throw e;
        }

        /**
         * @type {function(?Object): Resource}
         */
        let ResourceCreator = getResource(base_version, resourceType);

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
        const resourceLocator = this.resourceLocatorFactory.createResourceLocator(resourceType, base_version, useAtlas);
        try {
            /** @type {GetCursorResult} **/
            const __ret = await this.searchManager.getCursorForQueryAsync(
                {
                    resourceType, base_version, useAtlas,
                    args, columns, options, query,
                    maxMongoTimeMS, user, isStreaming: true, useAccessIndex
                }
            );
            /**
             * @type {Set}
             */
            columns = __ret.columns;
            // options = __ret.options;
            // query = __ret.query;
            /**
             * @type {import('mongodb').Document[]}
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

            if (cursor !== null) { // usually means the two-step optimization found no results
                if (useNdJson) {
                    resourceIds = await this.searchManager.streamResourcesFromCursorAsync(
                        {
                            requestId,
                            cursor,
                            res,
                            user,
                            scope,
                            args,
                            ResourceCreator,
                            resourceType,
                            useAccessIndex,
                            contentType: fhirContentTypes.ndJson,
                            batchObjectCount
                        });
                } else {
                    // if env.RETURN_BUNDLE is set then return as a Bundle
                    if (env.RETURN_BUNDLE || args['_bundle']) {
                        /**
                         * @type {string}
                         */
                        const collectionName = resourceLocator.getFirstCollectionNameForQuery();
                        /**
                         * @type {Resource[]}
                         */
                        const resources1 = [];
                        /**
                         * bundle
                         * @param {string|null} last_id
                         * @param {number} stopTime1
                         * @return {{entry: {resource: Resource}[]}}
                         */
                        const fnBundle = (last_id, stopTime1) => this.bundlManager.createBundle(
                            {
                                type: 'searchset',
                                originalUrl,
                                host,
                                protocol,
                                last_id,
                                resources: resources1,
                                base_version,
                                total_count,
                                args,
                                originalQuery,
                                collectionName,
                                originalOptions,
                                columns,
                                stopTime: stopTime1,
                                startTime,
                                useTwoStepSearchOptimization,
                                indexHint,
                                cursorBatchSize,
                                user,
                                useAtlas
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
                                args,
                                ResourceCreator,
                                resourceType,
                                useAccessIndex,
                                batchObjectCount
                            });
                    } else {
                        resourceIds = await this.searchManager.streamResourcesFromCursorAsync(
                            {
                                requestId,
                                cursor, res, user, scope, args,
                                ResourceCreator, resourceType,
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
                            args,
                            ids: resourceIds
                        }
                    );
                    const currentDate = moment.utc().format('YYYY-MM-DD');
                    await this.auditLogger.flushAsync({requestId, currentDate});
                }
            } else { // no records found
                if (useNdJson) {
                    if (requestId) {
                        res.setHeader('X-Request-ID', String(requestId));
                    }
                    // empty response
                    res.type(fhirContentTypes.ndJson);
                    res.status(200).end();
                } else {
                    // return empty bundle
                    if (env.RETURN_BUNDLE || args['_bundle']) {
                        /**
                         * @type {string}
                         */
                        const collectionName = resourceLocator.getFirstCollectionNameForQuery();
                        /**
                         * @type {{entry: {resource: Resource}[]}}
                         */
                        const bundle = this.bundleManager.createBundle(
                            {
                                type: 'searchset',
                                originalUrl,
                                host,
                                protocol,
                                last_id: null,
                                resources,
                                base_version,
                                total_count,
                                args,
                                originalQuery,
                                collectionName,
                                originalOptions,
                                columns,
                                stopTime,
                                startTime,
                                useTwoStepSearchOptimization,
                                indexHint,
                                cursorBatchSize,
                                user,
                                useAtlas
                            }
                        );
                        if (requestId) {
                            res.setHeader('X-Request-ID', String(requestId));
                        }
                        // noinspection JSUnresolvedFunction
                        res.type(fhirContentTypes.fhirJson).json(bundle.toJSON());
                    } else {
                        if (requestId) {
                            res.setHeader('X-Request-ID', String(requestId));
                        }
                        res.type(fhirContentTypes.fhirJson).json([]);
                    }
                }
            }
            /**
             * @type {string}
             */
            const collectionName = resourceLocator.getFirstCollectionNameForQuery();
            await this.fhirLoggingManager.logOperationSuccessAsync(
                {
                    requestInfo,
                    args,
                    resourceType,
                    startTime,
                    action: currentOperationName,
                    query: mongoQueryAndOptionsStringify(collectionName, query, options)
                });
        } catch (e) {
            /**
             * @type {string}
             */
            const collectionName = resourceLocator.getFirstCollectionNameForQuery();
            await this.fhirLoggingManager.logOperationFailureAsync(
                {
                    requestInfo,
                    args,
                    resourceType,
                    startTime,
                    action: currentOperationName,
                    error: e,
                    query: mongoQueryAndOptionsStringify(collectionName, query, options)
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
