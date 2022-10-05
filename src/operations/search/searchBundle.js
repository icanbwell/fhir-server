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
        this.searchManager = searchManager;
        assertTypeEquals(searchManager, SearchManager);

        this.resourceLocatorFactory = resourceLocatorFactory;
        assertTypeEquals(resourceLocatorFactory, ResourceLocatorFactory);

        this.auditLogger = auditLogger;
        assertTypeEquals(auditLogger, AuditLogger);

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
     * @param {boolean} filter
     * @return {Promise<Bundle>} array of resources or a bundle
     */
    async searchBundle(
        requestInfo, args, resourceType,
        filter = true
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
            patients = [],
            /** @type {string} */
            fhirPersonId,
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

        /**
         * @type {boolean}
         */
        const useAtlas = (isTrue(env.USE_ATLAS) || isTrue(args['_useAtlas']));

        const {/** @type {string} **/base_version} = args;

        const allPatients = patients.concat(
            await this.searchManager.getLinkedPatientsAsync(
                {
                    base_version, useAtlas, isUser, fhirPersonId
                }));

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
            {resourceType, base_version, useAtlas});
        try {
            /** @type {GetCursorResult} **/
            const __ret = await this.searchManager.getCursorForQueryAsync(
                {
                    resourceType, base_version, useAtlas,
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

            if (cursor !== null) { // usually means the two-step optimization found no results
                logDebug({
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
                        useAccessIndex
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
                    await this.auditLogger.flushAsync({requestId, currentDate});
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
             * @type {import('mongodb').Document[]}
             */
            const explanations = (args['_debug'] || env.LOGLEVEL === 'DEBUG') ? await cursor.explainAsync() : [];
            /**
             * @type {Bundle}
             */
            const bundle = this.bundleManager.createBundle(
                {
                    type: 'searchset',
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
                    useAtlas,
                    explanations
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

