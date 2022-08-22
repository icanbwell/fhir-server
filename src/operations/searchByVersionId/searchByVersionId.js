// noinspection ExceptionCaughtLocallyJS

const {logOperationAsync} = require('../common/logging');
const {isAccessToResourceAllowedBySecurityTags} = require('../security/scopes');
const {getResource} = require('../common/getResource');
const {BadRequestError, ForbiddenError, NotFoundError} = require('../../utils/httpErrors');
const {enrich} = require('../../enrich/enrich');
const {isTrue} = require('../../utils/isTrue');
const env = require('var');
const {verifyHasValidScopesAsync} = require('../security/scopesValidator');
const {assertTypeEquals, assertIsValid} = require('../../utils/assertType');
const {DatabaseHistoryFactory} = require('../../dataLayer/databaseHistoryFactory');

class SearchByVersionIdOperation {
    /**
     * constructor
     * @param {DatabaseHistoryFactory} databaseHistoryFactory
     */
    constructor(
        {
            databaseHistoryFactory
        }
    ) {
        /**
         * @type {DatabaseHistoryFactory}
         */
        this.databaseHistoryFactory = databaseHistoryFactory;
        assertTypeEquals(databaseHistoryFactory, DatabaseHistoryFactory);
    }

    /**
     * does a FHIR Search By Version
     * @param {import('../../utils/requestInfo').RequestInfo} requestInfo
     * @param {Object} args
     * @param {string} resourceType
     */
    async searchByVersionId(requestInfo, args, resourceType) {
        assertIsValid(requestInfo !== undefined);
        assertIsValid(args !== undefined);
        assertIsValid(resourceType !== undefined);
        const currentOperationName = 'searchByVersionId';
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

        try {

            let {base_version, id, version_id} = args;

            let Resource = getResource(base_version, resourceType);

            /**
             * @type {boolean}
             */
            const useAtlas = (isTrue(env.USE_ATLAS) || isTrue(args['_useAtlas']));

            // Query our collection for this observation
            let resource;
            try {
                resource = await this.databaseHistoryFactory.createDatabaseHistoryManager(resourceType, base_version, useAtlas)
                    .findOneAsync({id: id.toString(), 'meta.versionId': `${version_id}`});
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
                await logOperationAsync({
                    requestInfo,
                    args,
                    resourceType,
                    startTime,
                    message: 'operationCompleted',
                    action: currentOperationName
                });
                return (new Resource(resource));
            } else {
                throw new NotFoundError();
            }
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
            throw e;
        }
    }
}

module.exports = {
    SearchByVersionIdOperation
};

