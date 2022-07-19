const {logRequest} = require('../common/logging');
const {verifyHasValidScopes, isAccessToResourceAllowedBySecurityTags} = require('../../operations/security/scopes');
const {buildStu3SearchQuery} = require('../../operations/query/stu3');
const {buildDstu2SearchQuery} = require('../../operations/query/dstu2');
const {getResource} = require('../common/getResource');
const {NotFoundError} = require('../../utils/httpErrors');
const {isTrue} = require('../../utils/isTrue');
const env = require('var');
const {getOrCreateHistoryCollectionForResourceTypeAsync} = require('../common/resourceManager');
const {VERSIONS} = require('@asymmetrik/node-fhir-server-core').constants;

/**
 * does a FHIR History
 * @param {import('../../utils/requestInfo').RequestInfo} requestInfo
 * @param {Object} args
 * @param {string} resourceType
 * @param {string} collection_name
 */
// eslint-disable-next-line no-unused-vars
module.exports.history = async (requestInfo, args, resourceType, collection_name) => {
    const user = requestInfo.user;
    const scope = requestInfo.scope;

    logRequest(user, `${resourceType} >>> history`);
    verifyHasValidScopes(resourceType, 'read', user, scope);

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

    /**
     * @type {import('mongodb').Collection<import('mongodb').DefaultSchema>}
     */
    const history_collection = await getOrCreateHistoryCollectionForResourceTypeAsync(resourceType, base_version, useAtlas);

    let Resource = getResource(base_version, resourceType);

    // Query our collection for this observation
    let cursor;
    try {
        cursor = await history_collection.find(query);
    } catch (e) {
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
    return (resources);
};
