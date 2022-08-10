const {logOperation} = require('../common/logging');
const {isAccessToResourceAllowedBySecurityTags} = require('../security/scopes');
const {getResource} = require('../common/getResource');
const {BadRequestError, ForbiddenError, NotFoundError} = require('../../utils/httpErrors');
const {enrich} = require('../../enrich/enrich');
const {getExpandedValueSetAsync} = require('../../utils/valueSet.util');
const {isTrue} = require('../../utils/isTrue');
const env = require('var');
const {DatabaseQueryManager} = require('../../dataLayer/databaseQueryManager');
const {verifyHasValidScopes} = require('../security/scopesValidator');
/**
 * does a FHIR Search By Id
 * @param {import('../../utils/requestInfo').RequestInfo} requestInfo
 * @param {Object} args
 * @param {string} resourceType
 * @return {Resource}
 */
// eslint-disable-next-line no-unused-vars
module.exports.expand = async (requestInfo, args, resourceType) => {
    const currentOperationName = 'expand';
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

    // Common search params
    let {id} = args;
    let {base_version} = args;

    // Search Result param

    let query = {};
    query.id = id;
    /**
     * @type {boolean}
     */
    const useAtlas = (isTrue(env.USE_ATLAS) || isTrue(args['_useAtlas']));

    let Resource = getResource(base_version, resourceType);

    /**
     * @type {Resource}
     */
    let resource;
    try {
        resource = await new DatabaseQueryManager(resourceType, base_version, useAtlas)
            .findOneAsync({id: id.toString()});
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
        throw new BadRequestError(e);
    }

    if (resource) {
        if (!(isAccessToResourceAllowedBySecurityTags(resource, user, scope))) {
            const forbiddenError = new ForbiddenError(
                'user ' + user + ' with scopes [' + scope + '] has no access to resource ' +
                resource.resourceType + ' with id ' + id);
            logOperation({
                requestInfo,
                args,
                resourceType,
                startTime,
                message: 'operationFailed',
                action: currentOperationName,
                error: forbiddenError
            });

            throw forbiddenError;
        }

        // implement expand functionality
        resource = await getExpandedValueSetAsync(resourceType, base_version, useAtlas, resource);

        // run any enrichment
        resource = (await enrich([resource], resourceType))[0];

        const result = new Resource(resource);
        logOperation({
            requestInfo, args, resourceType, startTime,
            message: 'operationCompleted', action: currentOperationName,
            result: JSON.stringify(result)
        });
        return result;
    } else {
        throw new NotFoundError(`Not Found: ${resourceType}.searchById: ${id.toString()}`);
    }
};
