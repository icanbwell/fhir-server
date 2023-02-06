const env = require('var');
const {MongoError} = require('../../utils/mongoErrors');
const {logDebug} = require('../common/logging');
const {isTrue} = require('../../utils/isTrue');
const {mongoQueryAndOptionsStringify} = require('../../utils/mongoQueryStringify');
const {fhirRequestTimer} = require('../../utils/prometheus.utils');
const moment = require('moment-timezone');
const {assertTypeEquals, assertIsValid} = require('../../utils/assertType');
const {SearchManager} = require('./searchManager');
const {ResourceLocatorFactory} = require('../common/resourceLocatorFactory');
const {ErrorReporter} = require('../../utils/slack.logger');
const {AuditLogger} = require('../../utils/auditLogger');
const {FhirLoggingManager} = require('../common/fhirLoggingManager');
const {ScopesValidator} = require('../security/scopesValidator');
const {BundleManager} = require('../common/bundleManager');
const {ConfigManager} = require('../../utils/configManager');
const {BadRequestError} = require('../../utils/httpErrors');
const deepcopy = require('deepcopy');

class SearchBundleOperation {
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
     * @param {Object} args
     * @param {string} resourceType
     * @return {Promise<Bundle>} array of resources or a bundle
     */
    async searchBundle(
        {requestInfo, args, resourceType}
    ) {
        assertIsValid(requestInfo !== undefined);
        assertIsValid(args !== undefined);
        assertIsValid(resourceType !== undefined);
        const currentOperationName = 'search';
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
            originalUrl: url,
            /** @type {string[] | null} */
            patientIdsFromJwtToken,
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
            requestId,
            /** @type {string} */ method
        } = requestInfo;

        const originalArgs = deepcopy(args);

        assertIsValid(requestId, 'requestId is null');
        await this.scopesValidator.verifyHasValidScopesAsync({
            requestInfo,
            args,
            resourceType,
            startTime,
            action: currentOperationName,
            accessRequested: 'read'
        });

        /**
         * @type {boolean}
         */
        const useAccessIndex = (this.configManager.useAccessIndex || isTrue(args['_useAccessIndex']));

        const {/** @type {string} **/base_version} = args;

        /** @type {import('mongodb').Document}**/
        let query = {};
        /** @type {Set} **/
        let columns = new Set();

        // check if required filters for AuditEvent are passed
        if (resourceType === 'AuditEvent') {
            // args must contain one of these
            const requiredFiltersForAuditEvent = this.configManager.requiredFiltersForAuditEvent;
            if (requiredFiltersForAuditEvent && requiredFiltersForAuditEvent.length > 0) {
                if (requiredFiltersForAuditEvent.filter(r => args[`${r}`]).length === 0) {
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
                    user, scope, isUser, patientIdsFromJwtToken, args, resourceType, useAccessIndex,
                    personIdFromJwtToken
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
        try {
            /** @type {GetCursorResult} **/
            const __ret = await this.searchManager.getCursorForQueryAsync(
                {
                    resourceType, base_version,
                    args, columns, options, query,
                    maxMongoTimeMS, user, isStreaming: false, useAccessIndex
                });
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
             * @type {Number}
             */
            let cursorBatchSize = __ret.cursorBatchSize;
            /**
             * @type {DatabasePartitionedCursor}
             */
            let cursor = __ret.cursor;

            /**
             * @type {import('mongodb').Document[]}
             */
            const explanations = (cursor && (args['_explain'] || args['_debug'] || env.LOGLEVEL === 'DEBUG')) ? await cursor.explainAsync() : [];
            if (cursor && args['_explain']) {
                // if explain is requested then don't return any results
                cursor.clear();
            }
            // process results
            if (cursor !== null) { // usually means the two-step optimization found no results
                logDebug('', {
                    user, args: {
                        query:
                            mongoQueryAndOptionsStringify(
                                await resourceLocator.getFirstCollectionNameForQueryDebugOnlyAsync({
                                    query: originalQuery
                                }), originalQuery, originalOptions)
                    }
                });
                resources = await this.searchManager.readResourcesFromCursorAsync(
                    {
                        cursor, user, scope, args,
                        resourceType,
                        useAccessIndex,
                        originalArgs
                    }
                );

                if (resources.length > 0) {
                    // log access to audit logs
                    await this.auditLogger.logAuditEntryAsync(
                        {
                            requestInfo,
                            base_version,
                            resourceType,
                            operation: 'read',
                            args,
                            ids: resources.map((r) => r['id'])
                        }
                    );
                    const currentDate = moment.utc().format('YYYY-MM-DD');
                    await this.auditLogger.flushAsync({requestId, currentDate, method});
                }
            }

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
             * id of last resource in the list
             * @type {?string}
             */
            const last_id = resources.length > 0 ? resources[resources.length - 1].id : null;
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
                    requestId: requestInfo.requestId,
                    originalUrl: url,
                    host,
                    protocol,
                    last_id,
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
                    explanations,
                    allCollectionsToSearch
                }
            );
            await this.fhirLoggingManager.logOperationSuccessAsync(
                {
                    requestInfo,
                    args,
                    resourceType,
                    startTime,
                    action: currentOperationName,
                    query: mongoQueryAndOptionsStringify(collectionName, query, options)
                });
            return bundle;

        } catch (e) {
            /**
             * @type {string}
             */
            const collectionName = await resourceLocator.getFirstCollectionNameForQueryDebugOnlyAsync({
                query
            });
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
    SearchBundleOperation
};

