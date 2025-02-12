const { NotFoundError } = require('../../utils/httpErrors');
const env = require('var');
const { assertTypeEquals, assertIsValid } = require('../../utils/assertType');
const { DatabaseHistoryFactory } = require('../../dataLayer/databaseHistoryFactory');
const { FhirLoggingManager } = require('../common/fhirLoggingManager');
const { ScopesValidator } = require('../security/scopesValidator');
const { BundleManager } = require('../common/bundleManager');
const { ResourceLocatorFactory } = require('../common/resourceLocatorFactory');
const { ConfigManager } = require('../../utils/configManager');
const { SearchManager } = require('../search/searchManager');
const { isTrue } = require('../../utils/isTrue');
const BundleEntry = require('../../fhir/classes/4_0_0/backbone_elements/bundleEntry');
const { ResourceManager } = require('../common/resourceManager');
const { ParsedArgs } = require('../query/parsedArgs');
const { QueryItem } = require('../graph/queryItem');
const { DatabaseAttachmentManager } = require('../../dataLayer/databaseAttachmentManager');
const { GRIDFS: { RETRIEVE }, OPERATIONS: { READ }, RESOURCE_CLOUD_STORAGE_PATH_KEY } = require('../../constants');
const { CloudStorageClient } = require('../../utils/cloudStorageClient');

class HistoryByIdOperation {
    /**
     * constructor
     * @param {DatabaseHistoryFactory} databaseHistoryFactory
     * @param {FhirLoggingManager} fhirLoggingManager
     * @param {ScopesValidator} scopesValidator
     * @param {BundleManager} bundleManager
     * @param {ResourceLocatorFactory} resourceLocatorFactory
     * @param {ConfigManager} configManager
     * @param {SearchManager} searchManager
     * @param {ResourceManager} resourceManager
     * @param {DatabaseAttachmentManager} databaseAttachmentManager
     * @param {CloudStorageClient | null} historyResourceCloudStorageClient
     */
    constructor (
        {
            databaseHistoryFactory,
            fhirLoggingManager,
            scopesValidator,
            bundleManager,
            resourceLocatorFactory,
            configManager,
            searchManager,
            resourceManager,
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
         * @type {BundleManager}
         */
        this.bundleManager = bundleManager;
        assertTypeEquals(bundleManager, BundleManager);

        /**
         * @type {ResourceLocatorFactory}
         */
        this.resourceLocatorFactory = resourceLocatorFactory;
        assertTypeEquals(resourceLocatorFactory, ResourceLocatorFactory);
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
         * @type {ResourceManager}
         */
        this.resourceManager = resourceManager;
        assertTypeEquals(resourceManager, ResourceManager);

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
     * does a FHIR History By id
     * @param {FhirRequestInfo} requestInfo
     * @param {ParsedArgs} parsedArgs
     * @param {string} resourceType
     */
    async historyByIdAsync ({ requestInfo, parsedArgs, resourceType }) {
        assertIsValid(requestInfo !== undefined);
        assertIsValid(resourceType !== undefined);
        assertTypeEquals(parsedArgs, ParsedArgs);
        const currentOperationName = 'historyById';
        /**
         * @type {number}
         */
        const startTime = Date.now();
        const {
            /** @type {string | null} */
            user,
            /** @type {string | null} */
            scope,
            /** @type {string | null} */
            originalUrl: url,
            /** @type {string | null} */
            protocol,
            /** @type {string | null} */
            host,
            /** @type {boolean} */
            isUser,
            /** @type {string} */
            personIdFromJwtToken
        } = requestInfo;

        await this.scopesValidator.verifyHasValidScopesAsync({
            requestInfo,
            parsedArgs,
            resourceType,
            startTime,
            action: currentOperationName,
            accessRequested: 'read'
        });

        const { base_version, id } = parsedArgs;
        /**
         * @type {boolean}
         */
        const useAccessIndex = (this.configManager.useAccessIndex || isTrue(parsedArgs._useAccessIndex));

        /**
         * @type {{base_version, columns: Set, query: import('mongodb').Document}}
         */
        const {
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

        // noinspection JSValidateTypes
        /**
         * @type {import('mongodb').FindOptions<import('mongodb').DefaultSchema>}
         */
        const options = {
            sort: {
                'resource.meta.versionId': -1
            }
        };
        try {
            /**
             * @type {DatabasePartitionedCursor}
             */
            let cursor;
            try {
                /**
                 * @type {DatabaseHistoryManager}
                 */
                const databaseHistoryManager = this.databaseHistoryFactory.createDatabaseHistoryManager(
                    {
                        resourceType, base_version
                    }
                );
                cursor = await databaseHistoryManager.findAsync({ query, options });
            } catch (e) {
                throw new NotFoundError(new Error(`Resource not found: ${resourceType}/${id}`));
            }
            /**
             * @type {import('mongodb').Document[]}
             */
            const explanations = (cursor && (parsedArgs._explain || parsedArgs._debug || env.LOGLEVEL === 'DEBUG')) ? (await cursor.explainAsync()) : [];
            if (cursor && parsedArgs._explain) {
                // if explain is requested then don't return any results
                cursor.clear();
            }
            const collectionName = cursor.getFirstCollection();

            /**
             * @type {String[]|null}
             */
            let resourcesCloudStoragePaths =
            this.historyResourceCloudStorageClient &&
            this.configManager.cloudStorageHistoryResources.includes(resourceType)
                ? []
                : null;
            let downloadedData = null;

            /**
             * @type {object[]}
             */
            let historyResources = [];

            /**
             * @type {BundleEntry[]}
             */
            const entries = [];
            while (await cursor.hasNext()) {
                let historyResource = await cursor.nextRaw();
                if (!historyResource) {
                    throw new NotFoundError('Resource not found');
                }

                // save paths for cloud storage data to fetch in batch
                if (
                    resourcesCloudStoragePaths &&
                    historyResource[RESOURCE_CLOUD_STORAGE_PATH_KEY]
                ) {
                    resourcesCloudStoragePaths.push(historyResource[RESOURCE_CLOUD_STORAGE_PATH_KEY]);
                }
                historyResources.push(historyResource);
            }

            if (historyResources.length === 0) {
                throw new NotFoundError(`History not found for resource ${resourceType}/${id}`);
            }

            if (resourcesCloudStoragePaths && resourcesCloudStoragePaths.length > 0) {
                downloadedData = await this.historyResourceCloudStorageClient.downloadInBatchAsync({
                    filePaths: resourcesCloudStoragePaths,
                    batch: this.configManager.cloudStorageBatchDownloadSize
                });
            }

            await Promise.all(
                historyResources.map(async (historyResource) => {
                    if (downloadedData) {
                        const resourceData = downloadedData[historyResource[RESOURCE_CLOUD_STORAGE_PATH_KEY]];
                        if (resourceData) {
                            historyResource = JSON.parse(resourceData);
                        }
                    }

                    if (historyResource.resource) {
                        if (
                            this.configManager.cloudStorageHistoryResources.includes(resourceType) &&
                            !historyResource.resource.resourceType
                        ) {
                            historyResource.resource.resourceType = resourceType;
                        }
                        historyResource = new BundleEntry(historyResource);
                    } else {
                        historyResource = new BundleEntry({
                            historyResource,
                            fullUrl: this.resourceManager.getFullUrlForResource({
                                protocol,
                                host,
                                base_version,
                                historyResource
                            })
                        });
                    }
                    historyResource.resource = await this.databaseAttachmentManager.transformAttachments(
                        historyResource.resource,
                        RETRIEVE
                    );
                    entries.push(historyResource);
                })
            );

            await this.fhirLoggingManager.logOperationSuccessAsync({
                requestInfo,
                args: parsedArgs.getRawArgs(),
                resourceType,
                startTime,
                action: currentOperationName
            });
            /**
             * @type {number}
             */
            const stopTime = Date.now();

            // https://hl7.org/fhir/http.html#history
            // The return content is a Bundle with type set to history containing the specified version history,
            // sorted with oldest versions last, and including deleted resources.
            // Each entry SHALL minimally contain at least one of: a resource which holds the resource as it is at
            // the conclusion of the interaction, or a request with entry.request.method The request provides information
            //  about the result of the interaction that led to this new version, and allows, for instance, a subscriber
            //   system to differentiate between newly created resources and updates to existing resources. The principal
            //    reason a resource might be missing is that the resource was changed by some other channel
            //    rather than via the RESTful interface.
            //    If the entry.request.method is a PUT or a POST, the entry SHALL contain a resource.
            // return resources;
            return this.bundleManager.createBundleFromEntries(
                {
                    type: 'history',
                    requestId: requestInfo.userRequestId,
                    originalUrl: url,
                    host,
                    protocol,
                    entries,
                    base_version,
                    total_count: entries.length,
                    parsedArgs,
                    originalQuery: new QueryItem(
                        {
                            query,
                            resourceType,
                            collectionName
                        }
                    ),
                    originalOptions: options,
                    stopTime,
                    startTime,
                    user,
                    explanations
                }
            );
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
    HistoryByIdOperation
};
