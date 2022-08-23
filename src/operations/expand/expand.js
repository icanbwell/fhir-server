const {getResource} = require('../common/getResource');
const {BadRequestError, ForbiddenError, NotFoundError} = require('../../utils/httpErrors');
const {enrich} = require('../../enrich/enrich');
const {isTrue} = require('../../utils/isTrue');
const env = require('var');
const {verifyHasValidScopesAsync} = require('../security/scopesValidator');
const {assertTypeEquals, assertIsValid} = require('../../utils/assertType');
const {DatabaseQueryFactory} = require('../../dataLayer/databaseQueryFactory');
const {ValueSetManager} = require('../../utils/valueSet.util');
const {ScopesManager} = require('../security/scopesManager');
const {FhirLoggingManager} = require('../common/fhirLoggingManager');

class ExpandOperation {
    /**
     * constructor
     * @param {DatabaseQueryFactory} databaseQueryFactory
     * @param {ValueSetManager} valueSetManager
     * @param {ScopesManager} scopesManager
     * @param {FhirLoggingManager} fhirLoggingManager
     */
    constructor(
        {
            databaseQueryFactory,
            valueSetManager,
            scopesManager,
            fhirLoggingManager
        }
    ) {
        /**
         * @type {DatabaseQueryFactory}
         */
        this.databaseQueryFactory = databaseQueryFactory;
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);
        /**
         * @type {ValueSetManager}
         */
        this.valueSetManager = valueSetManager;
        assertTypeEquals(valueSetManager, ValueSetManager);

        /**
         * @type {ScopesManager}
         */
        this.scopesManager = scopesManager;
        assertTypeEquals(scopesManager, ScopesManager);
        /**
         * @type {FhirLoggingManager}
         */
        this.fhirLoggingManager = fhirLoggingManager;
        assertTypeEquals(fhirLoggingManager, FhirLoggingManager);
    }

    /**
     * does a FHIR Search By Id
     * @param {FhirRequestInfo} requestInfo
     * @param {Object} args
     * @param {string} resourceType
     * @return {Resource}
     */
    async expand(requestInfo, args, resourceType) {
        assertIsValid(requestInfo !== undefined);
        assertIsValid(args !== undefined);
        assertIsValid(resourceType !== undefined);
        const currentOperationName = 'expand';
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
            resource = await this.databaseQueryFactory.createQuery(resourceType, base_version, useAtlas)
                .findOneAsync({id: id.toString()});
        } catch (e) {
            await this.fhirLoggingManager.logOperationAsync({
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
            if (!(this.scopesManager.isAccessToResourceAllowedBySecurityTags(resource, user, scope))) {
                const forbiddenError = new ForbiddenError(
                    'user ' + user + ' with scopes [' + scope + '] has no access to resource ' +
                    resource.resourceType + ' with id ' + id);
                await this.fhirLoggingManager.logOperationAsync({
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
            resource = await this.valueSetManager.getExpandedValueSetAsync(resourceType, base_version, useAtlas, resource);

            // run any enrichment
            resource = (await enrich([resource], resourceType))[0];

            const result = new Resource(resource);
            await this.fhirLoggingManager.logOperationAsync({
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

