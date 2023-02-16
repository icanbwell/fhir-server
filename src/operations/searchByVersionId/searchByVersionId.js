const {ForbiddenError, NotFoundError} = require('../../utils/httpErrors');
const {EnrichmentManager} = require('../../enrich/enrich');
const {assertTypeEquals, assertIsValid} = require('../../utils/assertType');
const {DatabaseHistoryFactory} = require('../../dataLayer/databaseHistoryFactory');
const {ScopesManager} = require('../security/scopesManager');
const {FhirLoggingManager} = require('../common/fhirLoggingManager');
const {ScopesValidator} = require('../security/scopesValidator');
const {isTrue} = require('../../utils/isTrue');
const {ConfigManager} = require('../../utils/configManager');
const {SearchManager} = require('../search/searchManager');
const {ParsedArgs} = require('../query/parsedArgsItem');

class SearchByVersionIdOperation {
    /**
     * constructor
     * @param {DatabaseHistoryFactory} databaseHistoryFactory
     * @param {ScopesManager} scopesManager
     * @param {FhirLoggingManager} fhirLoggingManager
     * @param {ScopesValidator} scopesValidator
     * @param {EnrichmentManager} enrichmentManager
     * @param {ConfigManager} configManager
     * @param {SearchManager} searchManager
     */
    constructor(
        {
            databaseHistoryFactory,
            scopesManager,
            fhirLoggingManager,
            scopesValidator,
            enrichmentManager,
            configManager,
            searchManager
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
        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);
        /**
         * @type {SearchManager}
         */
        this.searchManager = searchManager;
        assertTypeEquals(searchManager, SearchManager);
    }

    /**
     * does a FHIR Search By Version
     * @param {FhirRequestInfo} requestInfo
     * @param {ParsedArgs} parsedArgs
     * @param {string} resourceType
     */
    async searchByVersionId({requestInfo, parsedArgs, resourceType}) {
        assertIsValid(requestInfo !== undefined);
        assertIsValid(resourceType !== undefined);
        assertTypeEquals(parsedArgs, ParsedArgs);
        const currentOperationName = 'searchByVersionId';
        /**
         * @type {number}
         */
        const startTime = Date.now();
        const {
            /** @type {string[]} */
            patientIdsFromJwtToken,
            /** @type {boolean} */
            isUser,
            /** @type {string} */
            personIdFromJwtToken,
            /** @type {string | null} */
            user,
            /** @type {string | null} */
            scope,
            // /** @type {string} */
            // requestId
        } = requestInfo;

        try {

            let {base_version, id, version_id} = parsedArgs;
            // check if user has permissions to access this resource
            await this.scopesValidator.verifyHasValidScopesAsync(
                {
                    requestInfo,
                    parsedArgs,
                    resourceType,
                    startTime,
                    action: currentOperationName,
                    accessRequested: 'read'
                }
            );


            /**
             * @type {boolean}
             */
            const useAccessIndex = (this.configManager.useAccessIndex || isTrue(parsedArgs['_useAccessIndex']));

            /**
             * @type {{base_version, columns: Set, query: import('mongodb').Document}}
             */
            const {
                /** @type {import('mongodb').Document}**/
                query,
                // /** @type {Set} **/
                // columns
            } = await this.searchManager.constructQueryAsync({
                user,
                scope,
                isUser,
                patientIdsFromJwtToken,
                resourceType,
                useAccessIndex,
                personIdFromJwtToken,
                parsedArgs,
                useHistoryTable: true
            });

            const queryForVersionId = {
                '$or': [
                    {
                        'meta.versionId': version_id
                    },
                    {
                        'resource.meta.versionId': version_id
                    },
                ]
            };
            if (query.$and) {
                query.$and.push(queryForVersionId);
            } else {
                query.$and = [queryForVersionId];
            }
            /**
             * @type {Resource|null}
             */
            let resource;
            try {
                const databaseHistoryManager = this.databaseHistoryFactory.createDatabaseHistoryManager(
                    {
                        resourceType, base_version
                    }
                );
                resource = await databaseHistoryManager.findOneAsync({
                    query: query
                });
            } catch (e) {
                throw new NotFoundError(new Error(`Resource not found: ${resourceType}/${id}`));
            }

            if (resource) {
                if (!(this.scopesManager.isAccessToResourceAllowedBySecurityTags({
                    resource: resource, user, scope
                }))) {
                    throw new ForbiddenError(
                        'user ' + user + ' with scopes [' + scope + '] has no access to resource ' +
                        resource.resourceType + ' with id ' + id);
                }
                // run any enrichment
                resource = (await this.enrichmentManager.enrichAsync({
                            resources: [resource], parsedArgs
                        }
                    )
                )[0];
                await this.fhirLoggingManager.logOperationSuccessAsync(
                    {
                        requestInfo,
                        args: parsedArgs.getRawArgs(),
                        resourceType,
                        startTime,
                        action: currentOperationName
                    });
                return resource;
            } else {
                throw new NotFoundError('Resource not found');
            }
        } catch (e) {
            await this.fhirLoggingManager.logOperationFailureAsync(
                {
                    requestInfo,
                    args: parsedArgs.getRawArgs(),
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

