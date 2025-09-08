const { NotFoundError, ForbiddenError } = require('../../utils/httpErrors');
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
const { GRIDFS: { RETRIEVE }, OPERATIONS: { READ }, RESOURCE_CLOUD_STORAGE_PATH_KEY, DB_SEARCH_LIMIT } = require('../../constants');
const { CloudStorageClient } = require('../../utils/cloudStorageClient');
const { ScopesManager } = require('../security/scopesManager');
const { FhirResourceSerializer } = require('../../fhir/fhirResourceSerializer');
const { getLastUpdatedISO } = require('../../utils/date.util');

class BaseHistoryOperationProcessor {
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
     * @param {ScopesManager} scopesManager
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
            scopesManager,
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
         * @type {ScopesManager}
         */
        this.scopesManager = scopesManager;
        assertTypeEquals(scopesManager, ScopesManager);

        /**
         * @type {CloudStorageClient | null}
         */
        this.historyResourceCloudStorageClient = historyResourceCloudStorageClient;
        if (historyResourceCloudStorageClient) {
            assertTypeEquals(historyResourceCloudStorageClient, CloudStorageClient);
        }
    }

    /**
     * fetch FHIR History
     * @typedef {Object} FetchHistoryParams
     * @property {FhirRequestInfo} requestInfo
     * @property {ParsedArgs} parsedArgs
     * @property {string} resourceType
     *
     * @param {FetchHistoryParams} params
     */
    async fetchHistoryAsync({ requestInfo, parsedArgs, resourceType }) {
        assertIsValid(this.currentOperationName !== undefined);
        assertIsValid(this.errorMessagePostfix !== undefined);
        assertIsValid(requestInfo !== undefined);
        assertIsValid(parsedArgs !== undefined);
        assertIsValid(resourceType !== undefined);
        assertTypeEquals(parsedArgs, ParsedArgs);

        const { currentOperationName, errorMessagePostfix } = this;
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

        if (this.scopesManager.hasPatientScope({ scope })) {
            const forbiddenError =  new ForbiddenError(
                `user ${user} with scopes [${scope}] failed access check to ${resourceType}'s ` +
                    'history: Access to history resources not allowed if patient scope is present'
            );
            await this.fhirLoggingManager.logOperationFailureAsync({
                requestInfo,
                args: parsedArgs?.getRawArgs(),
                resourceType,
                startTime,
                action: currentOperationName,
                error: forbiddenError
            });
            throw forbiddenError;
        }

        await this.scopesValidator.verifyHasValidScopesAsync({
            requestInfo,
            parsedArgs,
            resourceType,
            startTime,
            action: currentOperationName,
            accessRequested: 'read'
        });

        // Common search params
        const { base_version, _count } = parsedArgs;

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
                'resource.meta.lastUpdated': -1
            }
        };

        /**
         * @type {import('../../dataLayer/databaseCursor').DatabaseCursor}
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
            await this.fhirLoggingManager.logOperationFailureAsync({
                requestInfo,
                args: parsedArgs.getRawArgs(),
                resourceType,
                startTime,
                action: currentOperationName,
                error: e
            });
            throw new NotFoundError(e.message);
        }
        /**
         * @type {import('mongodb').Document[]}
         */
        const explanations = (parsedArgs._explain || parsedArgs._debug || process.env.LOGLEVEL === 'DEBUG') ? (await cursor.explainAsync()) : [];
        if (parsedArgs._explain) {
            // if explain is requested then don't return any results
            cursor.setEmpty();
        }
        const collectionName = cursor.getCollection();

        /**
         * @type {String[]|null}
         */
        let resourcesCloudStoragePaths = [];
        let downloadedData = {};

        /**
         * @type {object[]}
         */
        let historyResources = [];
        /**
         * @type {string|null}
         */
        let lastResourceLastUpdated = null;
        const count = Number(_count);
        const limit = !isNaN(count) ? count : DB_SEARCH_LIMIT;

        while (await cursor.hasNext()) {
            let historyResource = await cursor.next();
            if (!historyResource) {
                throw new NotFoundError('Resource not found');
            }

            const currentResourceLastUpdated = historyResource.resource
                ? getLastUpdatedISO(historyResource.resource?.meta?.lastUpdated)
                : getLastUpdatedISO(historyResource?.meta?.lastUpdated);

            // fetch all resource with same lastUpdated to allow consistent pagination
            if (historyResources.length >= limit && lastResourceLastUpdated !== currentResourceLastUpdated) {
                break;
            } else {
                // save paths for cloud storage data to fetch in batch
                if (historyResource[RESOURCE_CLOUD_STORAGE_PATH_KEY]) {
                    resourcesCloudStoragePaths.push(
                        `${collectionName}/${historyResource?.resource?._uuid}/${historyResource[RESOURCE_CLOUD_STORAGE_PATH_KEY]}.json`
                    );
                }
                historyResources.push(historyResource);

                lastResourceLastUpdated = historyResource.resource
                    ? getLastUpdatedISO(historyResource.resource?.meta?.lastUpdated)
                    : getLastUpdatedISO(historyResource?.meta?.lastUpdated);
            }
        }

        if (historyResources.length === 0 && !parsedArgs._explain) {
            throw new NotFoundError('History not found ' + errorMessagePostfix);
        }

        if (
            this.historyResourceCloudStorageClient &&
            this.configManager.cloudStorageHistoryResources.includes(resourceType) &&
            resourcesCloudStoragePaths.length > 0
        ) {
            downloadedData = await this.historyResourceCloudStorageClient.downloadInBatchAsync({
                filePaths: resourcesCloudStoragePaths,
                batch: this.configManager.cloudStorageBatchDownloadSize
            });
        }

        // If doc is not BundleEntry then wrap it in a bundle entry
        const entries = []
        await Promise.all(
            historyResources.map(async (historyResource) => {
                const downloadedResourceData =
                    downloadedData[
                        `${collectionName}/${historyResource?.resource?._uuid}/${historyResource[RESOURCE_CLOUD_STORAGE_PATH_KEY]}.json`
                    ];
                if (downloadedResourceData) {
                    historyResource = JSON.parse(downloadedResourceData);
                }

                if (historyResource.resource) {
                    if (!historyResource.resource.resourceType) {
                        historyResource.resource.resourceType = resourceType;
                    }
                } else {
                    historyResource = {
                        id: historyResource.id,
                        resource: historyResource,
                        fullUrl: this.resourceManager.getFullUrlForResource({
                            protocol,
                            host,
                            base_version,
                            resource: historyResource
                        })
                    };
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
        const resultBundle = this.bundleManager.createRawBundleFromEntries(
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
                explanations,
                lastResourceLastUpdated
            }
        );

        // serialize bundle
        FhirResourceSerializer.serializeByResourceType(resultBundle, 'Bundle');

        return resultBundle;
    }
}

class HistoryOperation extends BaseHistoryOperationProcessor {
    /**
     * does a FHIR History
     * @param {FhirRequestInfo} requestInfo
     * @param {ParsedArgs} parsedArgs
     * @param {string} resourceType
     */
    async historyAsync ({ requestInfo, parsedArgs, resourceType }) {
        this.currentOperationName = 'history';
        this.errorMessagePostfix = `for ${resourceType} resources`;
        return this.fetchHistoryAsync({ requestInfo, parsedArgs, resourceType });
    }
};

module.exports = {
    BaseHistoryOperationProcessor,
    HistoryOperation
};
