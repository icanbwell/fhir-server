const env = require('var');
const {MongoError} = require('../../utils/mongoErrors');
const {getResource} = require('../common/getResource');
const {logOperationAsync} = require('../common/logging');
const {isTrue} = require('../../utils/isTrue');
const {getCursorForQueryAsync} = require('./getCursorForQuery');
const {createBundle} = require('./createBundle');
const {constructQuery} = require('./constructQuery');
const {streamResourcesFromCursorAsync} = require('./streamResourcesFromCursor');
const {streamBundleFromCursorAsync} = require('./streamBundleFromCursor');
const {fhirContentTypes} = require('../../utils/contentTypes');
const {getLinkedPatientsAsync} = require('../security/getLinkedPatientsByPersonId');
const {ResourceLocator} = require('../common/resourceLocator');
const {fhirRequestTimer} = require('../../utils/prometheus.utils');
const {mongoQueryAndOptionsStringify} = require('../../utils/mongoQueryStringify');
const {verifyHasValidScopesAsync} = require('../security/scopesValidator');
const moment = require('moment-timezone');


/**
 * does a FHIR Search
 * @param {SimpleContainer} container
 * @param {import('../../utils/requestInfo').RequestInfo} requestInfo
 * @param {import('http').ServerResponse} res
 * @param {Object} args
 * @param {string} resourceType
 * @param {boolean} filter
 * @return {Resource[] | {entry:{resource: Resource}[]}} array of resources or a bundle
 */
module.exports.searchStreaming = async (
    container,
    requestInfo, res, args, resourceType,
    filter = true) => {
    const currentOperationName = 'searchStreaming';
    /**
     * @type {MongoCollectionManager}
     */
    const collectionManager = container.collectionManager;
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

    const allPatients = patients.concat(await getLinkedPatientsAsync(collectionManager,
        base_version, useAtlas, isUser, fhirPersonId));

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
        } = constructQuery(user, scope, isUser, allPatients, args, resourceType, useAccessIndex, filter));
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
    const resourceLocator = new ResourceLocator(collectionManager, resourceType, base_version, useAtlas);
    try {
        /** @type {GetCursorResult} **/
        const __ret = await getCursorForQueryAsync(collectionManager,
            resourceType, base_version, useAtlas,
            args, columns, options, query,
            maxMongoTimeMS, user, true, useAccessIndex);
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
                resourceIds = await streamResourcesFromCursorAsync({
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
                     * @param {string | null} last_id
                     * @param {number} stopTime1
                     * @return {Resource}
                     */
                    const fnBundle = (last_id, stopTime1) => createBundle({
                            url,
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
                    resourceIds = await streamBundleFromCursorAsync({
                        requestId,
                        cursor,
                        url,
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
                    resourceIds = await streamResourcesFromCursorAsync({
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
                try {
                    // log access to audit logs
                    /**
                     * @type {AuditLogger}
                     */
                    const auditLogger = container.auditLogger;
                    await auditLogger.logAuditEntryAsync(
                        requestInfo,
                        base_version,
                        resourceType,
                        'read',
                        args,
                        resourceIds
                    );
                    const currentDate = moment.utc().format('YYYY-MM-DD');
                    await auditLogger.flushAsync(requestId, currentDate);
                } catch (e) {
                    /**
                     * @type {ErrorReporter}
                     */
                    const errorReporter = container.errorReporter;
                    await errorReporter.logErrorToSlackAsync(
                        `searchStreaming: Error writing AuditEvent for resource ${resourceType}`, e);
                }
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
                     * @type {Resource}
                     */
                    const bundle = createBundle({
                            url,
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
        await logOperationAsync({
            requestInfo,
            args,
            resourceType,
            startTime,
            message: 'operationCompleted',
            action: currentOperationName,
            query: mongoQueryAndOptionsStringify(collectionName, query, options)
        });
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
            message: 'operationFailed',
            action: currentOperationName,
            error: e,
            query: mongoQueryAndOptionsStringify(collectionName, query, options)
        });
        throw new MongoError(requestId, e.message, e, collectionName, query, (Date.now() - startTime), options);
    } finally {
        timer({action: currentOperationName, resourceType});
    }
};
