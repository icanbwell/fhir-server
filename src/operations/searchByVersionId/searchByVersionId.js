const {logRequest} = require('../common/logging');
const {verifyHasValidScopes, isAccessToResourceAllowedBySecurityTags} = require('../security/scopes');
const {getResource} = require('../common/getResource');
const {BadRequestError, ForbiddenError, NotFoundError} = require('../../utils/httpErrors');
const {enrich} = require('../../enrich/enrich');
const {isTrue} = require('../../utils/isTrue');
const env = require('var');
const {getOrCreateHistoryCollectionForResourceTypeAsync} = require('../common/resourceManager');
/**
 * does a FHIR Search By Version
 * @param {import('../../utils/requestInfo').RequestInfo} requestInfo
 * @param {Object} args
 * @param {string} resourceType
 * @param {string} collection_name
 */
// eslint-disable-next-line no-unused-vars
module.exports.searchByVersionId = async (requestInfo, args, resourceType, collection_name) => {
    const user = requestInfo.user;
    const scope = requestInfo.scope;
    logRequest(user, `${resourceType} >>> searchByVersionId`);
    verifyHasValidScopes(resourceType, 'read', user, scope);

    let {base_version, id, version_id} = args;

    let Resource = getResource(base_version, resourceType);

    /**
     * @type {boolean}
     */
    const useAtlas = (isTrue(env.USE_ATLAS) || isTrue(args['_useAtlas']));

    /**
     * @type {import('mongodb').Collection<import('mongodb').DefaultSchema>}
     */
    const history_collection = await getOrCreateHistoryCollectionForResourceTypeAsync(resourceType, base_version, useAtlas);

    // Query our collection for this observation
    let resource;
    try {
        resource = await history_collection.findOne(
            {id: id.toString(), 'meta.versionId': `${version_id}`});
    } catch (e) {
        throw new BadRequestError(e);
    }

    if (resource) {
        if (!(isAccessToResourceAllowedBySecurityTags(resource, user, scope))) {
            throw new ForbiddenError(
                'user ' + user + ' with scopes [' + scope + '] has no access to resource ' +
                resource.resourceType + ' with id ' + id);
        }
        // run any enrichment
        resource = (await enrich([resource], resourceType))[0];
        return (new Resource(resource));
    } else {
        throw new NotFoundError();
    }
};
