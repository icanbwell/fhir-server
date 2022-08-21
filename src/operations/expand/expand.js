const {logOperationAsync} = require('../common/logging');
const {isAccessToResourceAllowedBySecurityTags} = require('../security/scopes');
const {getResource} = require('../common/getResource');
const {BadRequestError, ForbiddenError, NotFoundError} = require('../../utils/httpErrors');
const {enrich} = require('../../enrich/enrich');
const {isTrue} = require('../../utils/isTrue');
const env = require('var');
const {verifyHasValidScopesAsync} = require('../security/scopesValidator');
const assert = require('node:assert/strict');

class ExpandOperation {
    /**
     * does a FHIR Search By Id
     * @param {SimpleContainer} container
     * @param {import('../../utils/requestInfo').RequestInfo} requestInfo
     * @param {Object} args
     * @param {string} resourceType
     * @return {Resource}
     */
// eslint-disable-next-line no-unused-vars
    async expand(container, requestInfo, args, resourceType) {
        assert(container !== undefined);
        assert(requestInfo !== undefined);
        assert(args !== undefined);
        assert(resourceType !== undefined);
        const currentOperationName = 'expand';
        /**
         * @type {DatabaseQueryFactory}
         */
        const databaseQueryFactory = container.databaseQueryFactory;
        /**
         * @type {number}
         */
        const startTime = Date.now();

        const {user, scope} = requestInfo;

        await verifyHasValidScopesAsync({
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
            resource = await databaseQueryFactory.createQuery(resourceType, base_version, useAtlas)
                .findOneAsync({id: id.toString()});
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
            throw new BadRequestError(e);
        }

        if (resource) {
            if (!(isAccessToResourceAllowedBySecurityTags(resource, user, scope))) {
                const forbiddenError = new ForbiddenError(
                    'user ' + user + ' with scopes [' + scope + '] has no access to resource ' +
                    resource.resourceType + ' with id ' + id);
                await logOperationAsync({
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

            /**
             * @type {ValueSetManager}
             */
            const valueSetManager = container.valueSetManager;
            // implement expand functionality
            resource = await valueSetManager.getExpandedValueSetAsync(resourceType, base_version, useAtlas, resource);

            // run any enrichment
            resource = (await enrich([resource], resourceType))[0];

            const result = new Resource(resource);
            await logOperationAsync({
                requestInfo, args, resourceType, startTime,
                message: 'operationCompleted', action: currentOperationName,
                result: JSON.stringify(result)
            });
            return result;
        } else {
            throw new NotFoundError(`Not Found: ${resourceType}.searchById: ${id.toString()}`);
        }
    }
}

module.exports = {
    ExpandOperation
};

