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
const {readResourcesFromCursorAsync} = require('./readResourcesFromCursor');
const {createBundle} = require('./createBundle');
const {constructQuery} = require('./constructQuery');
const {logErrorToSlackAsync} = require('../../utils/slack.logger');
const {mongoQueryAndOptionsStringify} = require('../../utils/mongoQueryStringify');
const {getLinkedPatientsAsync} = require('../security/getLinkedPatientsByPersonId');
const {
    getCollectionNameForResourceType,
    getCollectionNamesForQueryForResourceType
} = require('../common/resourceManager');

/**
 * does a FHIR Search
 * @param {import('../../utils/requestInfo').RequestInfo} requestInfo
 * @param {Object} args
 * @param {string} resourceType
 * @param {boolean} filter
 * @return {Resource[] | {entry:{resource: Resource}[]}} array of resources or a bundle
 */
module.exports.search = async (requestInfo, args, resourceType,
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

    /**
     * @type {string}
     */
    const collectionName = getCollectionNamesForQueryForResourceType(resourceType, base_version)[0];

    try {
        /** @type {GetCursorResult} **/
        const __ret = await getCursorForQueryAsync(resourceType, base_version, useAtlas,
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
                mongoQueryAndOptionsStringify(getCollectionNameForResourceType(resourceType, base_version), originalQuery, originalOptions));
            resources = await readResourcesFromCursorAsync(cursor, user, scope, args, Resource, resourceType, batchObjectCount,
                useAccessIndex
            );

            if (resources.length > 0) {
                if (resourceType !== 'AuditEvent') {
                    try {
                        // log access to audit logs
                        await logAuditEntryAsync(
                            requestInfo,
                            base_version,
                            resourceType,
                            'read',
                            args,
                            resources.map((r) => r['id'])
                        );
                    } catch (e) {
                        await logErrorToSlackAsync(`search: Error writing AuditEvent for resource ${resourceType}`, e);
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
        } else {
            return resources;
        }
    } catch (e) {
        /**
         * @type {number}
         */
        const stopTime1 = Date.now();
        throw new MongoError(e.message, e, collectionName, query, (stopTime1 - startTime), options);
    }
};
