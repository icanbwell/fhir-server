// noinspection ExceptionCaughtLocallyJS

const {logOperation} = require('../common/logging');
const {verifyHasValidScopes, isAccessToResourceAllowedBySecurityTags} = require('../security/scopes');
const {buildStu3SearchQuery} = require('../query/stu3');
const {buildDstu2SearchQuery} = require('../query/dstu2');
const {getResource} = require('../common/getResource');
const {BadRequestError, NotFoundError} = require('../../utils/httpErrors');
const {isTrue} = require('../../utils/isTrue');
const env = require('var');
const {DatabaseHistoryManager} = require('../../dataLayer/databaseHistoryManager');
const {VERSIONS} = require('@asymmetrik/node-fhir-server-core').constants;
/**
 * does a FHIR History By id
 * @param {import('../../utils/requestInfo').RequestInfo} requestInfo
 * @param {Object} args
 * @param {string} resourceType
 */
// eslint-disable-next-line no-unused-vars
module.exports.historyById = async (requestInfo, args, resourceType) => {
    const currentOperationName = 'historyById';
    /**
     * @type {number}
     */
    const startTime = Date.now();
    const user = requestInfo.user;
    const scope = requestInfo.scope;

    verifyHasValidScopes({
        requestInfo,
        args,
        resourceType,
        startTime,
        action: currentOperationName,
        accessRequested: 'read'
    });

    let {base_version, id} = args;
    let query = {};

    if (base_version === VERSIONS['3_0_1']) {
        query = buildStu3SearchQuery(args);
    } else if (base_version === VERSIONS['1_0_2']) {
        query = buildDstu2SearchQuery(args);
    }

    query.id = `${id}`;

    /**
     * @type {boolean}
     */
    const useAtlas = (isTrue(env.USE_ATLAS) || isTrue(args['_useAtlas']));

    let Resource = getResource(base_version, resourceType);

    try {
        /**
         * @type {DatabasePartitionedCursor}
         */
        let cursor;
        try {
            cursor = await new DatabaseHistoryManager(resourceType, base_version, useAtlas).findAsync(query);
        } catch (e) {
            throw new BadRequestError(e);
        }
        const resources = [];
        while (await cursor.hasNext()) {
            const element = await cursor.next();
            const resource = new Resource(element);
            if (isAccessToResourceAllowedBySecurityTags(resource, user, scope)) {
                resources.push(resource);
            }
        }
        if (resources.length === 0) {
            throw new NotFoundError();
        }
        logOperation({
            requestInfo,
            args,
            resourceType,
            startTime,
            message: 'operationCompleted',
            action: currentOperationName
        });
        return resources;
    } catch (e) {
        logOperation({
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
};
