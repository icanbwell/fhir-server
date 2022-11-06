// noinspection ExceptionCaughtLocallyJS

const {BadRequestError, ForbiddenError, NotFoundError} = require('../../utils/httpErrors');
const {EnrichmentManager} = require('../../enrich/enrich');
const {assertTypeEquals, assertIsValid} = require('../../utils/assertType');
const {DatabaseHistoryFactory} = require('../../dataLayer/databaseHistoryFactory');
const {ScopesManager} = require('../security/scopesManager');
const {FhirLoggingManager} = require('../common/fhirLoggingManager');
const {ScopesValidator} = require('../security/scopesValidator');

class SearchByVersionIdOperation {
    /**
     * constructor
     * @param {DatabaseHistoryFactory} databaseHistoryFactory
     * @param {ScopesManager} scopesManager
     * @param {FhirLoggingManager} fhirLoggingManager
     * @param {ScopesValidator} scopesValidator
     * @param {EnrichmentManager} enrichmentManager
     */
    constructor(
        {
            databaseHistoryFactory,
            scopesManager,
            fhirLoggingManager,
            scopesValidator,
            enrichmentManager
        }
    ) {
        /**
         * @type {DatabaseHistoryFactory}
         */
        this.databaseHistoryFactory = databaseHistoryFactory;
        assertTypeEquals(databaseHistoryFactory, DatabaseHistoryFactory);

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
     * does a FHIR Search By Version
     * @param {FhirRequestInfo} requestInfo
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

        await this.scopesValidator.verifyHasValidScopesAsync(
            {
                requestInfo,
                args,
                resourceType,
                startTime,
                action: currentOperationName,
                accessRequested: 'read'
            }
        );

        try {

            let {base_version, id, version_id} = args;

            // Query our collection for this observation
            /**
             * @type {Resource|null}
             */
            let resource;
            try {
                resource = await this.databaseHistoryFactory.createDatabaseHistoryManager(
                    {
                        resourceType, base_version
                    }
                ).findOneAsync({
                    query: {id: id.toString(), 'meta.versionId': `${version_id}`}
                });
            } catch (e) {
                throw new BadRequestError(e);
            }

            if (resource) {
                if (!(this.scopesManager.isAccessToResourceAllowedBySecurityTags(resource, user, scope))) {
                    throw new ForbiddenError(
                        'user ' + user + ' with scopes [' + scope + '] has no access to resource ' +
                        resource.resourceType + ' with id ' + id);
                }
                // run any enrichment
                resource = (await this.enrichmentManager.enrichAsync({
                            resources: [resource], resourceType, args
                        }
                    )
                )[0];
                await this.fhirLoggingManager.logOperationSuccessAsync(
                    {
                        requestInfo,
                        args,
                        resourceType,
                        startTime,
                        action: currentOperationName
                    });
                return resource;
            } else {
                throw new NotFoundError();
            }
        } catch (e) {
            await this.fhirLoggingManager.logOperationFailureAsync(
                {
                    requestInfo,
                    args,
                    resourceType,
                    startTime,
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

