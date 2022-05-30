/* eslint-disable no-unused-vars */
const globals = require('../../globals');
const {CLIENT_DB, ATLAS_CLIENT_DB, AUDIT_EVENT_CLIENT_DB} = require('../../constants');
const env = require('var');
const {MongoError} = require('../../utils/mongoErrors');
const {
    verifyHasValidScopes,
} = require('../security/scopes');
const {getResource} = require('../common/getResource');
const {logRequest, logDebug} = require('../common/logging');
const {isTrue} = require('../../utils/isTrue');
const {logAuditEntryAsync} = require('../../utils/auditLogger');
const {searchOld} = require('./searchOld');
const {getCursorForQueryAsync} = require('./getCursorForQuery');
const {createBundle} = require('./createBundle');
const {constructQuery} = require('./constructQuery');
const {streamResourcesFromCursorAsync} = require('./streamResourcesFromCursor');
const {streamBundleFromCursorAsync} = require('./streamBundleFromCursor');
const {fhirContentTypes} = require('../../utils/contentTypes');
const {logErrorToSlackAsync} = require('../../utils/slack.logger');


/**
 * does a FHIR Search
 * @param {import('../../utils/requestInfo').RequestInfo} requestInfo
 * @param {import('http').ServerResponse} res
 * @param {Object} args
 * @param {string} resourceName
 * @param {string} collection_name
 * @return {Resource[] | {entry:{resource: Resource}[]}} array of resources or a bundle
 */
module.exports.searchStreaming = async (requestInfo, res, args, resourceName, collection_name) => {
    if (isTrue(env.OLD_SEARCH) || isTrue(args['_useOldSearch'])) {
        return searchOld(requestInfo, args, resourceName, collection_name);
    }
    /**
     * @type {number}
     */
    const startTime = Date.now();
    /**
     * @type {string | null}
     */
    const user = requestInfo.user;
    /**
     * @type {string | null}
     */
    const scope = requestInfo.scope;
    /**
     * @type {string | null}
     */
    const url = requestInfo.originalUrl;
    logRequest(user, resourceName + ' >>> search' + ' scope:' + scope);
    // logRequest('user: ' + req.user);
    // logRequest('scope: ' + req.authInfo.scope);
    verifyHasValidScopes(resourceName, 'read', user, scope);
    logRequest(user, '---- args ----');
    logRequest(user, JSON.stringify(args));
    logRequest(user, '--------');

    /**
     * @type {boolean}
     */
    const useAccessIndex = (isTrue(env.USE_ACCESS_INDEX) || isTrue(args['_useAccessIndex']));

    let {
        /** @type {string} **/
        base_version,
        /** @type {import('mongodb').Document}**/
        query,
        /** @type {Set} **/
        columns
    } = constructQuery(user, scope, args, resourceName, collection_name, useAccessIndex);

    /**
     * @type {boolean}
     */
    const useAtlas = (isTrue(env.USE_ATLAS) || isTrue(args['_useAtlas']));

    // Grab an instance of our DB and collection
    // noinspection JSValidateTypes
    /**
     * mongo db connection
     * @type {import('mongodb').Db}
     */
    let db = (resourceName === 'AuditEvent') ?
        globals.get(AUDIT_EVENT_CLIENT_DB) : (useAtlas && globals.has(ATLAS_CLIENT_DB)) ?
            globals.get(ATLAS_CLIENT_DB) : globals.get(CLIENT_DB);
    /**
     * @type {string}
     */
    const mongoCollectionName = `${collection_name}_${base_version}`;
    /**
     * mongo collection
     * @type {import('mongodb').Collection}
     */
    let collection = db.collection(mongoCollectionName);
    /**
     * @type {function(?Object): Resource}
     */
    let Resource = getResource(base_version, resourceName);

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
        const __ret = await getCursorForQueryAsync(args, columns, resourceName, options, query, useAtlas, collection,
            maxMongoTimeMS, user, mongoCollectionName, true, useAccessIndex);
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
         * @type {import('mongodb').Cursor<import('mongodb').WithId<import('mongodb').Document>>}
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
                resourceIds = await streamResourcesFromCursorAsync(cursor, res, user, scope, args, Resource, resourceName,
                    useAccessIndex,
                    fhirContentTypes.ndJson, batchObjectCount);
            } else {
                // if env.RETURN_BUNDLE is set then return as a Bundle
                if (env.RETURN_BUNDLE || args['_bundle']) {
                    resourceIds = await streamBundleFromCursorAsync(cursor, url,
                        (last_id, stopTime1) => createBundle(
                            url,
                            last_id,
                            [],
                            base_version,
                            total_count,
                            args,
                            originalQuery,
                            mongoCollectionName,
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
                        res, user, scope, args, Resource, resourceName, useAccessIndex, batchObjectCount);
                } else {
                    resourceIds = await streamResourcesFromCursorAsync(cursor, res, user, scope, args,
                        Resource, resourceName,
                        useAccessIndex,
                        fhirContentTypes.fhirJson,
                        batchObjectCount);
                }
            }
            if (resourceIds.length > 0) {
                // don't write audit log for just looking up ids since no PHI is shown
                if (resourceName !== 'AuditEvent' && args['_elements'] !== 'id') {
                    try {
                        // log access to audit logs
                        await logAuditEntryAsync(
                            requestInfo,
                            base_version,
                            resourceName,
                            'read',
                            args,
                            resourceIds
                        );
                    } catch (e) {
                        await logErrorToSlackAsync(`searchStreaming: Error writing AuditEvent for resource ${resourceName}`, e);
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
                        mongoCollectionName,
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
        throw new MongoError(e.message, e, mongoCollectionName, query, (stopTime1 - startTime), options);
    }
};
