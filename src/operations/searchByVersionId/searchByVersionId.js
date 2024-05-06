const { NotFoundError } = require('../../utils/httpErrors');
const { EnrichmentManager } = require('../../enrich/enrich');
const { assertTypeEquals, assertIsValid } = require('../../utils/assertType');
const { DatabaseHistoryFactory } = require('../../dataLayer/databaseHistoryFactory');
const { FhirLoggingManager } = require('../common/fhirLoggingManager');
const { ScopesValidator } = require('../security/scopesValidator');
const { isTrue } = require('../../utils/isTrue');
const { ConfigManager } = require('../../utils/configManager');
const { SearchManager } = require('../search/searchManager');
const { ParsedArgs } = require('../query/parsedArgs');
const { DatabaseAttachmentManager } = require('../../dataLayer/databaseAttachmentManager');
const { GRIDFS: { RETRIEVE }, OPERATIONS: { READ } } = require('../../constants');

class SearchByVersionIdOperation {
    /**
     * constructor
     * @param {DatabaseHistoryFactory} databaseHistoryFactory
     * @param {FhirLoggingManager} fhirLoggingManager
     * @param {ScopesValidator} scopesValidator
     * @param {EnrichmentManager} enrichmentManager
     * @param {ConfigManager} configManager
     * @param {SearchManager} searchManager
     * @param {DatabaseAttachmentManager} databaseAttachmentManager
     */
    constructor (
        {
            databaseHistoryFactory,
            fhirLoggingManager,
            scopesValidator,
            enrichmentManager,
            configManager,
            searchManager,
            databaseAttachmentManager
        }
    ) {
        /**
         * @type {DatabaseHistoryFactory}
         */
        this.databaseHistoryFactory = databaseHistoryFactory;
        assertTypeEquals(databaseHistoryFactory, DatabaseHistoryFactory);
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
        /**
         * @type {DatabaseAttachmentManager}
         */
        this.databaseAttachmentManager = databaseAttachmentManager;
        assertTypeEquals(databaseAttachmentManager, DatabaseAttachmentManager);
    }

    /**
     * does a FHIR Search By Version
     * @param {FhirRequestInfo} requestInfo
     * @param {ParsedArgs} parsedArgs
     * @param {string} resourceType
     */
    async searchByVersionIdAsync ({ requestInfo, parsedArgs, resourceType }) {
        assertIsValid(requestInfo !== undefined);
        assertIsValid(resourceType !== undefined);
        assertTypeEquals(parsedArgs, ParsedArgs);
        const currentOperationName = 'searchByVersionId';
        /**
         * @type {number}
         */
        const startTime = Date.now();
        const {
            /** @type {boolean} */
            isUser,
            /** @type {string} */
            personIdFromJwtToken,
            /** @type {string | null} */
            user,
            /** @type {string | null} */
            scope
            // /** @type {string} */
            // requestId
        } = requestInfo;

        try {
            const { base_version, id, version_id } = parsedArgs;
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
            const useAccessIndex = (this.configManager.useAccessIndex || isTrue(parsedArgs._useAccessIndex));

            /**
             * @type {{base_version, columns: Set, query: import('mongodb').Document}}
             */
            let {
                /** @type {import('mongodb').Document}**/
                query
                // /** @type {Set} **/
                // columns
            } = await this.searchManager.constructQueryAsync({
                user,
                scope,
                isUser,
                resourceType,
                useAccessIndex,
                personIdFromJwtToken,
                parsedArgs,
                useHistoryTable: true,
                operation: READ
            });

            const queryForVersionId = {
                'resource.meta.versionId': version_id
            };
            if (query.$and) {
                query.$and.push(queryForVersionId);
            } else {
                query = {
                    $and: [
                        query,
                        queryForVersionId
                    ]
                };
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
                    query
                });
            } catch (e) {
                throw new NotFoundError(new Error(`Resource not found: ${resourceType}/${id}`));
            }

            if (resource) {
                // run any enrichment
                resource = (await this.enrichmentManager.enrichAsync({
                            resources: [resource], parsedArgs
                        }
                    )
                )[0];

                resource = await this.databaseAttachmentManager.transformAttachments(resource, RETRIEVE);
                await this.fhirLoggingManager.logOperationSuccessAsync({
                    requestInfo,
                    args: parsedArgs.getRawArgs(),
                    resourceType,
                    startTime,
                    action: currentOperationName
                });
                return resource;
            } else {
                throw new NotFoundError(`History not found for ${resourceType}/${id} with versionId:${version_id}`);
            }
        } catch (e) {
            await this.fhirLoggingManager.logOperationFailureAsync({
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
