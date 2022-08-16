const {logOperationAsync} = require('../common/logging');
const {isAccessToResourceAllowedBySecurityTags} = require('../../operations/security/scopes');
const {buildStu3SearchQuery} = require('../../operations/query/stu3');
const {buildDstu2SearchQuery} = require('../../operations/query/dstu2');
const {getResource} = require('../common/getResource');
const {NotFoundError} = require('../../utils/httpErrors');
const {isTrue} = require('../../utils/isTrue');
const env = require('var');
const {DatabaseHistoryManager} = require('../../dataLayer/databaseHistoryManager');
const {verifyHasValidScopesAsync} = require('../security/scopesValidator');
const assert = require('node:assert/strict');
const {VERSIONS} = require('@asymmetrik/node-fhir-server-core').constants;

/**
 * does a FHIR History
 * @param {SimpleContainer} container
 * @param {import('../../utils/requestInfo').RequestInfo} requestInfo
 * @param {Object} args
 * @param {string} resourceType
 */
// eslint-disable-next-line no-unused-vars
module.exports.history = async (container,
                                requestInfo, args, resourceType) => {
    assert(container !== undefined);
    assert(requestInfo !== undefined);
    assert(args !== undefined);
    assert(resourceType !== undefined);
    const currentOperationName = 'history';
    /**
     * @type {number}
     */
    const startTime = Date.now();
    const user = requestInfo.user;
    const scope = requestInfo.scope;

    await verifyHasValidScopesAsync({
        requestInfo,
        args,
        resourceType,
        startTime,
        action: currentOperationName,
        accessRequested: 'read'
    });

    // Common search params
    let {base_version} = args;

    let query = {};

    if (base_version === VERSIONS['3_0_1']) {
        query = buildStu3SearchQuery(args);
    } else if (base_version === VERSIONS['1_0_2']) {
        query = buildDstu2SearchQuery(args);
    }
    /**
     * @type {boolean}
     */
    const useAtlas = (isTrue(env.USE_ATLAS) || isTrue(args['_useAtlas']));

    let Resource = getResource(base_version, resourceType);

    // Query our collection for this observation
    /**
     * @type {DatabasePartitionedCursor}
     */
    let cursor;
    try {
        cursor = await new DatabaseHistoryManager(resourceType, base_version, useAtlas).findAsync(query);
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
        throw new NotFoundError(e.message);
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
    await logOperationAsync({
        requestInfo,
        args,
        resourceType,
        startTime,
        message: 'operationCompleted',
        action: currentOperationName
    });
    return resources;
};
