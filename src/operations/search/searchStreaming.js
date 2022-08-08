const env = require('var');
const {MongoError} = require('../../utils/mongoErrors');
const {
    verifyHasValidScopes,
} = require('../security/scopes');
const {getResource} = require('../common/getResource');
const {logRequest, logDebug} = require('../common/logging');
const {isTrue} = require('../../utils/isTrue');
const {logAuditEntryAsync} = require('../../utils/auditLogger');
const {getCursorForQueryAsync} = require('./getCursorForQuery');
const {createBundle} = require('./createBundle');
const {constructQuery} = require('./constructQuery');
const {streamResourcesFromCursorAsync} = require('./streamResourcesFromCursor');
const {streamBundleFromCursorAsync} = require('./streamBundleFromCursor');
const {fhirContentTypes} = require('../../utils/contentTypes');
const {logErrorToSlackAsync} = require('../../utils/slack.logger');
const {getLinkedPatientsAsync} = require('../security/getLinkedPatientsByPersonId');
const {ResourceLocator} = require('../common/resourceLocator');

/**
 * does a FHIR Search
 * @param {import('../../utils/requestInfo').RequestInfo} requestInfo
 * @param {import('http').ServerResponse} res
 * @param {Object} args
 * @param {string} resourceType
 * @param {boolean} filter
 * @return {Resource[] | {entry:{resource: Resource}[]}} array of resources or a bundle
 */
module.exports.searchStreaming = async (requestInfo, res, args, resourceType,
                                        filter = true) => {
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
        isUser
    } = requestInfo;

    logRequest(user, resourceType + ' >>> search' + ' scope:' + scope);
    // logRequest('user: ' + req.user);
    // logRequest('scope: ' + req.authInfo.scope);
    verifyHasValidScopes(resourceType, 'read', user, scope);
    logRequest(user, '---- args ----');
    logRequest(user, JSON.stringify(args));
    logRequest(user, '--------');

    /**
     * @type {boolean}
     */
    const useAccessIndex = (isTrue(env.USE_ACCESS_INDEX) || isTrue(args['_useAccessIndex']));

    /**
     * @type {boolean}
     */
    const useAtlas = (isTrue(env.USE_ATLAS) || isTrue(args['_useAtlas']));

    /** @type {string} **/
    let {base_version} = args;

    const allPatients = patients.concat(await getLinkedPatientsAsync(base_version, useAtlas, isUser, fhirPersonId));

    let {
        /** @type {import('mongodb').Document}**/
        query,
        /** @type {Set} **/
        columns
    } = constructQuery(user, scope, isUser, allPatients, args, resourceType, useAccessIndex, filter);

    /**
     * @type {function(?Object): Resource}
     */
    let Resource = getResource(base_version, resourceType);

    logDebug(user, '---- query ----');
    logDebug(user, JSON.stringify(query));
    logDebug(user, '--------');

    /**
     * @type {import('mongodb').FindOneOptions}
     */
    let options = {};

    // Query our collection for this observation
    /**
     * @type {number}
     */
    const maxMongoTimeMS = env.MONGO_TIMEOUT ? parseInt(env.MONGO_TIMEOUT) : 30 * 1000;

    try {
        /** @type {GetCursorResult} **/
        const __ret = await getCursorForQueryAsync(resourceType, base_version, useAtlas,
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
                resourceIds = await streamResourcesFromCursorAsync(cursor, res, user, scope, args, Resource, resourceType,
                    useAccessIndex,
                    fhirContentTypes.ndJson, batchObjectCount);
            } else {
                // if env.RETURN_BUNDLE is set then return as a Bundle
                if (env.RETURN_BUNDLE || args['_bundle']) {
                    /**
                     * @type {string}
                     */
                    const collectionName = new ResourceLocator(resourceType, base_version, useAtlas)
                        .getFirstCollectionNameForQuery();
                    resourceIds = await streamBundleFromCursorAsync(cursor, url,
                        (last_id, stopTime1) => createBundle(
                            url,
                            last_id,
                            [],
                            base_version,
                            total_count,
                            args,
                            originalQuery,
                            collectionName,
                            originalOptions,
                            columns,
                            stopTime1,
                            startTime,
                            useTwoStepSearchOptimization,
                            indexHint,
                            cursorBatchSize,
                            user,
                            useAtlas
                        ),
                        res, user, scope, args, Resource, resourceType, useAccessIndex, batchObjectCount);
                } else {
                    resourceIds = await streamResourcesFromCursorAsync(cursor, res, user, scope, args,
                        Resource, resourceType,
                        useAccessIndex,
                        fhirContentTypes.fhirJson,
                        batchObjectCount);
                }
            }
            if (resourceIds.length > 0) {
                if (resourceType !== 'AuditEvent') {
                    try {
                        // log access to audit logs
                        await logAuditEntryAsync(
                            requestInfo,
                            base_version,
                            resourceType,
                            'read',
                            args,
                            resourceIds
                        );
                    } catch (e) {
                        await logErrorToSlackAsync(`searchStreaming: Error writing AuditEvent for resource ${resourceType}`, e);
                    }
                }
            }
        } else { // no records found
            if (useNdJson) {
                // empty response
                res.type(fhirContentTypes.ndJson);
                res.status(200).end();
            } else {
                // return empty bundle
                if (env.RETURN_BUNDLE || args['_bundle']) {
                    /**
                     * @type {string}
                     */
                    const collectionName = new ResourceLocator(resourceType, base_version, useAtlas)
                        .getFirstCollectionNameForQuery();
                    /**
                     * @type {Resource}
                     */
                    const bundle = createBundle(
                        url,
                        null,
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
                    );
                    res.type(fhirContentTypes.fhirJson).json(bundle.toJSON());
                } else {
                    res.type(fhirContentTypes.fhirJson).json([]);
                }
            }
        }
    } catch (e) {
        /**
         * @type {number}
         */
        const stopTime1 = Date.now();
        /**
         * @type {string}
         */
        const collectionName = new ResourceLocator(resourceType, base_version, useAtlas)
            .getFirstCollectionNameForQuery();
        throw new MongoError(e.message, e, collectionName, query, (stopTime1 - startTime), options);
    }
};
