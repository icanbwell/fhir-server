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
const {logAuditEntry} = require('../../utils/auditLogger');
const {searchOld} = require('./searchOld');
const {getCursorForQueryAsync} = require('./getCursorForQuery');
const {readResourcesFromCursorAsync} = require('./readResourcesFromCursor');
const {createBundle} = require('./createBundle');
const {constructQuery} = require('./constructQuery');
const {logErrorToSlackAsync} = require('../../utils/slack.logger');
const {mongoQueryAndOptionsStringify} = require('../../utils/mongoQueryStringify');


/**
 * does a FHIR Search
 * @param {import('../../utils/requestInfo').RequestInfo} requestInfo
 * @param {Object} args
 * @param {string} resourceName
 * @param {string} collection_name
 * @return {Resource[] | {entry:{resource: Resource}[]}} array of resources or a bundle
 */
module.exports.search = async (requestInfo, args, resourceName, collection_name) => {
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
            maxMongoTimeMS, user, mongoCollectionName, false, useAccessIndex);
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
        const batchObjectCount = Number(env.STREAMING_BATCH_COUNT) || 1;

        if (cursor !== null) { // usually means the two-step optimization found no results
            logDebug(user,
                mongoQueryAndOptionsStringify(collection_name, originalQuery, originalOptions));
            resources = await readResourcesFromCursorAsync(cursor, user, scope, args, Resource, resourceName, batchObjectCount,
                useAccessIndex
            );

            if (resources.length > 0) {
                if (resourceName !== 'AuditEvent') {
                    try {
                        // log access to audit logs
                        await logAuditEntry(
                            requestInfo,
                            base_version,
                            resourceName,
                            'read',
                            args,
                            resources.map((r) => r['id'])
                        );
                    } catch (e) {
                        await logErrorToSlackAsync(`Error writing AuditEvent for resource ${resourceName}`, e);
                    }
                }
            }
        }

        /**
         * @type {number}
         */
        const stopTime = Date.now();

        // if env.RETURN_BUNDLE is set then return as a Bundle
        if (env.RETURN_BUNDLE || args['_bundle']) {
            /**
             * id of last resource in the list
             * @type {?string}
             */
            const last_id = resources.length > 0 ? resources[resources.length - 1].id : null;
            return createBundle(
                url,
                last_id,
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
        } else {
            return resources;
        }
    } catch (e) {
        /**
         * @type {number}
         */
        const stopTime1 = Date.now();
        throw new MongoError(e.message, e, mongoCollectionName, query, (stopTime1 - startTime), options);
    }
};
