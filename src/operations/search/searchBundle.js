const env = require('var');
const {MongoError} = require('../../utils/mongoErrors');
const {getResource} = require('../common/getResource');
const {logDebug, logOperationAsync} = require('../common/logging');
const {isTrue} = require('../../utils/isTrue');
const {mongoQueryAndOptionsStringify} = require('../../utils/mongoQueryStringify');
const {fhirRequestTimer} = require('../../utils/prometheus.utils');
const {verifyHasValidScopesAsync} = require('../security/scopesValidator');
const moment = require('moment-timezone');
const {assertTypeEquals, assertIsValid} = require('../../utils/assertType');
const {SearchManager} = require('./searchManager');
const {ResourceLocatorFactory} = require('../common/resourceLocatorFactory');
const {ErrorReporter} = require('../../utils/slack.logger');
const {AuditLogger} = require('../../utils/auditLogger');

class SearchBundleOperation {
    /**
     * constructor
     * @param {SearchManager} searchManager
     * @param {ResourceLocatorFactory} resourceLocatorFactory
     * @param {AuditLogger} auditLogger
     * @param {ErrorReporter} errorReporter
     */
    constructor({searchManager, resourceLocatorFactory, auditLogger, errorReporter}) {
        this.searchManager = searchManager;
        assertTypeEquals(searchManager, SearchManager);

        this.resourceLocatorFactory = resourceLocatorFactory;
        assertTypeEquals(resourceLocatorFactory, ResourceLocatorFactory);

        this.auditLogger = auditLogger;
        assertTypeEquals(auditLogger, AuditLogger);

        this.errorReporter = errorReporter;
        assertTypeEquals(errorReporter, ErrorReporter);
    }

    /**
     * does a FHIR Search
     * @param {import('../../utils/fhirRequestInfo').RequestInfo} requestInfo
     * @param {Object} args
     * @param {string} resourceType
     * @param {boolean} filter
     * @return {Promise<{entry:{resource: Resource}[]}>} array of resources or a bundle
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
            /**
             * @type {string}
             */
            requestId
        } = requestInfo;

        await verifyHasValidScopesAsync({
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
        const useAccessIndex = (isTrue(env.USE_ACCESS_INDEX) || isTrue(args['_useAccessIndex']));

        /**
         * @type {boolean}
         */
        const useAtlas = (isTrue(env.USE_ATLAS) || isTrue(args['_useAtlas']));

        const {/** @type {string} **/base_version} = args;

        const allPatients = patients.concat(
            await this.searchManager.getLinkedPatientsAsync(base_version, useAtlas, isUser, fhirPersonId));

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
            } = this.searchManager.constructQuery(user, scope, isUser, allPatients, args, resourceType, useAccessIndex, filter));
        } catch (e) {
            await logOperationAsync({
                requestInfo,
                args,
                resourceType,
                startTime,
                message: 'operationFailed',
                action: currentOperationName,
                error: e
            });
            throw e;
        }

        /**
         * @type {function(?Object): Resource}
         */
        let Resource = getResource(base_version, resourceType);

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
            resourceType, base_version, useAtlas);
        try {
            /** @type {GetCursorResult} **/
            const __ret = await this.searchManager.getCursorForQueryAsync(
                resourceType, base_version, useAtlas,
                args, columns, options, query,
                maxMongoTimeMS, user, false, useAccessIndex);
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
             * @type {number}
             */
            const batchObjectCount = Number(env.STREAMING_BATCH_COUNT) || 1;

            if (cursor !== null) { // usually means the two-step optimization found no results
                logDebug(user,
                    mongoQueryAndOptionsStringify(
                        resourceLocator.getFirstCollectionNameForQuery(), originalQuery, originalOptions));
                resources = await this.searchManager.readResourcesFromCursorAsync(cursor, user, scope, args,
                    Resource, resourceType, batchObjectCount,
                    useAccessIndex
                );

                if (resources.length > 0) {
                    if (resourceType !== 'AuditEvent') {
                        try {
                            // log access to audit logs
                            await this.auditLogger.logAuditEntryAsync(
                                requestInfo,
                                base_version,
                                resourceType,
                                'read',
                                args,
                                resources.map((r) => r['id'])
                            );
                            const currentDate = moment.utc().format('YYYY-MM-DD');
                            await this.auditLogger.flushAsync(requestId, currentDate);
                        } catch (e) {
                            await this.errorReporter.reportErrorAsync(
                                `search: Error writing AuditEvent for resource ${resourceType}`, e);
                        }
                    }
                }
            }

            /**
             * @type {number}
             */
            const stopTime = Date.now();

            /**
             * @type {string}
             */
            const collectionName = resourceLocator.getFirstCollectionNameForQuery();
            /**
             * id of last resource in the list
             * @type {?string}
             */
            const last_id = resources.length > 0 ? resources[resources.length - 1].id : null;
            const bundle = this.searchManager.createBundle({
                    url,
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
                    useAtlas
                }
            );
            await logOperationAsync({
                requestInfo,
                args,
                resourceType,
                startTime,
                message: 'operationCompleted',
                action: currentOperationName,
                query: mongoQueryAndOptionsStringify(collectionName, query, options)
            });
            return bundle;

        } catch (e) {
            /**
             * @type {string}
             */
            const collectionName = resourceLocator.getFirstCollectionNameForQuery();
            await logOperationAsync({
                requestInfo,
                args,
                resourceType,
                startTime,
                message: 'operationCompleted',
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

