const {BadRequestError, ForbiddenError, NotFoundError} = require('../../utils/httpErrors');
const {EnrichmentManager} = require('../../enrich/enrich');
const {assertTypeEquals, assertIsValid} = require('../../utils/assertType');
const {DatabaseQueryFactory} = require('../../dataLayer/databaseQueryFactory');
const {ValueSetManager} = require('../../utils/valueSet.util');
const {ScopesManager} = require('../security/scopesManager');
const {FhirLoggingManager} = require('../common/fhirLoggingManager');
const {ScopesValidator} = require('../security/scopesValidator');

class ExpandOperation {
    /**
     * constructor
     * @param {DatabaseQueryFactory} databaseQueryFactory
     * @param {ValueSetManager} valueSetManager
     * @param {ScopesManager} scopesManager
     * @param {FhirLoggingManager} fhirLoggingManager
     * @param {ScopesValidator} scopesValidator
     * @param {EnrichmentManager} enrichmentManager
     */
    constructor(
        {
            databaseQueryFactory,
            valueSetManager,
            scopesManager,
            fhirLoggingManager,
            scopesValidator,
            enrichmentManager
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
        /**
         * @type {ScopesValidator}
         */
        this.scopesValidator = scopesValidator;
        assertTypeEquals(scopesValidator, ScopesValidator);

        /**
         * @type {EnrichmentManager}
         */
        this.enrichmentManager = enrichmentManager;
        assertTypeEquals(enrichmentManager, EnrichmentManager);
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

        await this.scopesValidator.verifyHasValidScopesAsync({
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
         * @type {Resource}
         */
        let resource;
        try {
            resource = await this.databaseQueryFactory.createQuery(
                {resourceType, base_version}
            ).findOneAsync({query: {id: id.toString()}});
        } catch (e) {
            await this.fhirLoggingManager.logOperationFailureAsync({
                requestInfo,
                args,
                resourceType,
                startTime,
                action: currentOperationName,
                error: e
            });
            throw new BadRequestError(e);
        }

        if (resource) {
            if (!(this.scopesManager.isAccessToResourceAllowedBySecurityTags({
                resource: resource, user, scope
            }))) {
                const forbiddenError = new ForbiddenError(
                    'user ' + user + ' with scopes [' + scope + '] has no access to resource ' +
                    resource.resourceType + ' with id ' + id);
                await this.fhirLoggingManager.logOperationFailureAsync({
                    requestInfo,
                    args,
                    resourceType,
                    startTime,
                    action: currentOperationName,
                    error: forbiddenError
                });

                throw forbiddenError;
            }

            // implement expand functionality
            resource = await this.valueSetManager.getExpandedValueSetAsync(resourceType, base_version, resource);

            // run any enrichment
            resource = (await this.enrichmentManager.enrichAsync({
                        resources: [resource], resourceType, args
                    }
                )
            )[0];

            await this.fhirLoggingManager.logOperationSuccessAsync(
                {
                    requestInfo, args, resourceType, startTime,
                    action: currentOperationName,
                    result: JSON.stringify(resource.toJSON())
                });
            return resource;
        } else {
            throw new NotFoundError(`Not Found: ${resourceType}.searchById: ${id.toString()}`);
        }
    }
}

module.exports = {
    ExpandOperation
};

