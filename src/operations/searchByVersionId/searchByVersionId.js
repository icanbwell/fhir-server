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
const { GRIDFS: { RETRIEVE }, OPERATIONS: { READ }, RESOURCE_CLOUD_STORAGE_PATH_KEY } = require('../../constants');
const { CloudStorageClient } = require('../../utils/cloudStorageClient');
const { FhirResourceCreator } = require('../../fhir/fhirResourceCreator');

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
     * @param {CloudStorageClient | null} historyResourceCloudStorageClient
     */
    constructor (
        {
            databaseHistoryFactory,
            fhirLoggingManager,
            scopesValidator,
            enrichmentManager,
            configManager,
            searchManager,
            databaseAttachmentManager,
            historyResourceCloudStorageClient
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

        /**
         * @type {CloudStorageClient | null}
         */
        this.historyResourceCloudStorageClient = historyResourceCloudStorageClient;
        if (historyResourceCloudStorageClient) {
            assertTypeEquals(historyResourceCloudStorageClient, CloudStorageClient);
        }
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
             * @type {{resource: object, collectionName: string}|null}
             */
            let result;
            try {
                const databaseHistoryManager = this.databaseHistoryFactory.createDatabaseHistoryManager(
                    {
                        resourceType, base_version
                    }
                );
                result = await databaseHistoryManager.findOneRawAsync({
                    query
                });
            } catch (e) {
                throw new NotFoundError(new Error(`Resource not found: ${resourceType}/${id}`));
            }

            if (result) {
                let { resource: historyResource, collectionName } = result;

                // replace with cloud storage data if present
                if (
                    this.historyResourceCloudStorageClient &&
                    this.configManager.cloudStorageHistoryResources.includes(resourceType) &&
                    historyResource[RESOURCE_CLOUD_STORAGE_PATH_KEY]
                ) {
                    let downloadedResourceData =
                        await this.historyResourceCloudStorageClient.downloadAsync(
                            `${collectionName}/${historyResource[RESOURCE_CLOUD_STORAGE_PATH_KEY]}.json`
                        );

                    if (downloadedResourceData) {
                        historyResource = JSON.parse(downloadedResourceData);
                    }
                    // for handling missing history data on cloud storage
                    else if (historyResource.resource && !historyResource.resource.resourceType) {
                        historyResource.resource.resourceType = resourceType;
                    }
                }

                historyResource = FhirResourceCreator.create(historyResource.resource || historyResource);

                // run any enrichment
                historyResource = (await this.enrichmentManager.enrichAsync({
                            resources: [historyResource], parsedArgs
                        }
                    )
                )[0];

                historyResource = await this.databaseAttachmentManager.transformAttachments(historyResource, RETRIEVE);
                await this.fhirLoggingManager.logOperationSuccessAsync({
                    requestInfo,
                    args: parsedArgs.getRawArgs(),
                    resourceType,
                    startTime,
                    action: currentOperationName
                });
                return historyResource;
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
