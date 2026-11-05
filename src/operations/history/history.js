const { NotFoundError, ForbiddenError, BadRequestError } = require('../../utils/httpErrors');
const { HistoryReadRouter } = require('./historyReadRouter');
const { TABLES } = require('../../constants/clickHouseConstants');
const {
    assertSupportedHistoryArgs, resolveHistoryUuid, resolveHistoryUuids, assertNotDelegatedUser, assertNoCloudStorageStubs, parseSinceArg
} = require('./historyClickHouseGuards');
const { assertTypeEquals, assertIsValid } = require('../../utils/assertType');
const { DatabaseHistoryFactory } = require('../../dataLayer/databaseHistoryFactory');
const { FhirLoggingManager } = require('../common/fhirLoggingManager');
const { ScopesValidator } = require('../security/scopesValidator');
const { BundleManager } = require('../common/bundleManager');
const { ResourceLocatorFactory } = require('../common/resourceLocatorFactory');
const { ConfigManager } = require('../../utils/configManager');
const { SearchManager } = require('../search/searchManager');
const { isTrue } = require('../../utils/isTrue');
const { ResourceManager } = require('../common/resourceManager');
const { ParsedArgs } = require('../query/parsedArgs');
const { QueryItem } = require('../graph/queryItem');
const { DatabaseAttachmentManager } = require('../../dataLayer/databaseAttachmentManager');
const { Base64DataManager } = require('../../dataLayer/base64DataManager');
const { GRIDFS: { RETRIEVE }, BLOB_OP, OPERATIONS: { READ }, RESOURCE_CLOUD_STORAGE_PATH_KEY, DB_SEARCH_LIMIT } = require('../../constants');
const { CloudStorageClient } = require('../../utils/cloudStorageClient');
const { ScopesManager } = require('../security/scopesManager');
const { FhirResourceSerializer } = require('../../fhir/fhirResourceSerializer');
const { ensureHistoryEntryResponse } = require('./historyEntryResponse');
const { getLastUpdatedISO } = require('../../utils/date.util');
const { IdentifierEnrichmentProvider } = require('../../enrich/providers/identifierEnrichmentProvider');
const { CompositionSectionFilterEnrichmentProvider } = require('../../enrich/providers/compositionSectionFilterEnrichmentProvider');
const { AuditLogger } = require('../../utils/auditLogger');
const { PostRequestProcessor } = require('../../utils/postRequestProcessor');

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
     * @param {Base64DataManager} base64DataManager
     * @param {ScopesManager} scopesManager
     * @param {CloudStorageClient | null} historyResourceCloudStorageClient
     * @param {IdentifierEnrichmentProvider} identifierEnrichmentProvider
     * @param {CompositionSectionFilterEnrichmentProvider} compositionSectionFilterEnrichmentProvider
     * @param {AuditLogger} auditLogger
     * @param {PostRequestProcessor} postRequestProcessor
     * @param {import('../../dataLayer/repositories/historyClickHouseRepository').HistoryClickHouseRepository | null} historyClickHouseRepository
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
            base64DataManager,
            scopesManager,
            historyResourceCloudStorageClient,
            identifierEnrichmentProvider,
            compositionSectionFilterEnrichmentProvider,
            auditLogger,
            postRequestProcessor,
            historyClickHouseRepository,
            historyReadRouter
        }
    ) {
        /**
         * null when ClickHouse is not enabled
         * @type {import('../../dataLayer/repositories/historyClickHouseRepository').HistoryClickHouseRepository | null}
         */
        this.historyClickHouseRepository = historyClickHouseRepository || null;
        /**
         * @type {HistoryReadRouter}
         */
        this.historyReadRouter = historyReadRouter;
        assertTypeEquals(historyReadRouter, HistoryReadRouter);
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
         * @type {Base64DataManager}
         */
        this.base64DataManager = base64DataManager;
        assertTypeEquals(base64DataManager, Base64DataManager);

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

        /**
         * @type {IdentifierEnrichmentProvider}
         */
        this.identifierEnrichmentProvider = identifierEnrichmentProvider;
        assertTypeEquals(identifierEnrichmentProvider, IdentifierEnrichmentProvider);

        /**
         * @type {CompositionSectionFilterEnrichmentProvider}
         */
        this.compositionSectionFilterEnrichmentProvider = compositionSectionFilterEnrichmentProvider;
        assertTypeEquals(compositionSectionFilterEnrichmentProvider, CompositionSectionFilterEnrichmentProvider);

        /**
         * @type {AuditLogger}
         */
        this.auditLogger = auditLogger;
        assertTypeEquals(auditLogger, AuditLogger);

        /**
         * @type {PostRequestProcessor}
         */
        this.postRequestProcessor = postRequestProcessor;
        assertTypeEquals(postRequestProcessor, PostRequestProcessor);
    }

    /**
     * fetch FHIR History
     * @typedef {Object} FetchHistoryParams
     * @property {import('../../utils/fhirRequestInfo').FhirRequestInfo} requestInfo
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
            personIdFromJwtToken,
            actor,
            userType
        } = requestInfo;

        // _explain/_debug/_setIndexHint expose Mongo query plans, collection internals, and
        // let the caller pick the query's index; only an admin-scoped caller may use them.
        if ((parsedArgs._explain || parsedArgs._debug || parsedArgs._setIndexHint) && !this.scopesValidator.isAdminScope({ scope })) {
            parsedArgs._explain = undefined;
            parsedArgs._debug = undefined;
            parsedArgs._setIndexHint = undefined;
        }

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

        // SEC-1580 SAE-1: see ScopesManager.hasHistoryAccess for why a tenant-scoped access
        // code is never sufficient to read history.
        const accessRequested = currentOperationName === 'historyById' ? 'r' : 's';
        if (!this.scopesManager.hasHistoryAccess({ resourceType, scope, accessRequested })) {
            const forbiddenError = new ForbiddenError(
                `user ${user} with scopes [${scope}] failed access check to ${resourceType}'s ` +
                    'history: history access requires a non-tenant-specific access scope (access/*.read or access/*.*)'
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
            accessRequested
        });

        if (this.historyReadRouter.readsFromClickHouse(resourceType)) {
            return await this.fetchHistoryFromClickHouseAsync({ requestInfo, parsedArgs, resourceType, startTime });
        }

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
            userType,
            resourceType,
            useAccessIndex,
            personIdFromJwtToken,
            parsedArgs,
            useHistoryTable: true,
            operation: READ,
            accessRequested,
            actor
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

        return await this.buildHistoryBundleAsync({
            requestInfo,
            parsedArgs,
            resourceType,
            startTime,
            historyResources,
            downloadedData,
            collectionName,
            query,
            options,
            explanations,
            lastResourceLastUpdated
        });
    }

    /**
     * Serves a history read for a resource type whose history lives in ClickHouse. For an instance
     * read the URL id must be the resource `_uuid` or `id|owner` (converted to the uuid here); anything
     * else is rejected with 400 before a query runs. A type-level read takes the same id from `_id`;
     * with no `_id` it pages through the history of every resource of the type. The scope checks
     * have already run in fetchHistoryAsync.
     * @param {Object} params
     * @param {import('../../utils/fhirRequestInfo').FhirRequestInfo} params.requestInfo
     * @param {ParsedArgs} params.parsedArgs
     * @param {string} params.resourceType
     * @param {number} params.startTime
     * @return {Promise<Object>} history Bundle
     */
    async fetchHistoryFromClickHouseAsync({ requestInfo, parsedArgs, resourceType, startTime }) {
        const { currentOperationName } = this;
        const isInstanceRead = currentOperationName === 'historyById';
        const cursor = parsedArgs._historyCursor;
        try {
            if (!this.historyClickHouseRepository) {
                throw new Error(
                    `ClickHouse history reads are enabled for ${resourceType} but ClickHouse is not enabled`
                );
            }
            assertNotDelegatedUser({ userType: requestInfo.userType, resourceType });
            assertSupportedHistoryArgs(parsedArgs, { isInstanceRead });
            // `/{type}/_history?_id=x` is the same read as `/{type}/x/_history`; `_id=x,y` reads several
            let uuid;
            let uuids;
            if (isInstanceRead) {
                uuid = resolveHistoryUuid({ id: parsedArgs.id, resourceType });
            } else if (parsedArgs.getRawArgs()._id !== undefined) {
                const resolved = resolveHistoryUuids({ idValue: parsedArgs.id, resourceType });
                [uuid, uuids] = resolved.length === 1 ? [resolved[0], undefined] : [undefined, resolved];
            }
            const sinceMs = parseSinceArg(parsedArgs._since);
            const requested = Number(parsedArgs._count);
            const limit = Math.min(
                Number.isInteger(requested) && requested > 0 ? requested : DB_SEARCH_LIMIT,
                this.configManager.resourceHistoryClickHouseMaxPageSize
            );
            const { entries, nextCursor } = await this.historyClickHouseRepository.findPageAsync({
                resourceType,
                uuid,
                uuids,
                limit,
                sinceMs,
                cursor: typeof cursor === 'string' ? cursor : undefined
            });
            if (entries.length === 0 && !cursor) {
                throw new NotFoundError('History not found ' + this.errorMessagePostfix);
            }
            assertNoCloudStorageStubs(entries);
            return await this.buildHistoryBundleAsync({
                requestInfo,
                parsedArgs,
                resourceType,
                startTime,
                historyResources: entries,
                downloadedData: {},
                collectionName: TABLES.RESOURCE_HISTORY,
                query: { resource_type: resourceType, ...(uuid ? { _uuid: uuid } : {}), ...(uuids ? { _uuid: { $in: uuids } } : {}) },
                options: {},
                explanations: [],
                lastResourceLastUpdated: null,
                historyCursor: nextCursor
            });
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

    /**
     * Wraps history documents in BundleEntry objects and builds the history Bundle
     * @param {Object} params
     * @param {import('../../utils/fhirRequestInfo').FhirRequestInfo} params.requestInfo
     * @param {ParsedArgs} params.parsedArgs
     * @param {string} params.resourceType
     * @param {number} params.startTime
     * @param {object[]} params.historyResources
     * @param {Object} params.downloadedData history documents fetched from cloud storage, by path
     * @param {string} params.collectionName
     * @param {import('mongodb').Document} params.query
     * @param {import('mongodb').FindOptions} params.options
     * @param {import('mongodb').Document[]} params.explanations
     * @param {string|null} params.lastResourceLastUpdated
     * @param {string|null} [params.historyCursor] token for the next page (ClickHouse reads)
     * @return {Promise<Object>} history Bundle
     */
    async buildHistoryBundleAsync({
        requestInfo,
        parsedArgs,
        resourceType,
        startTime,
        historyResources,
        downloadedData,
        collectionName,
        query,
        options,
        explanations,
        lastResourceLastUpdated,
        historyCursor
    }) {
        const { currentOperationName } = this;
        const { user, originalUrl: url, protocol, host, userType, actor, requestId } = requestInfo;
        const { base_version } = parsedArgs;

        // If doc is not BundleEntry then wrap it in a bundle entry.
        // Use the Promise.all return value (not push-in-callback) so the lastUpdated-desc
        // order set by the Mongo query is preserved even when S3 fetches finish out of order.
        const entries = await Promise.all(
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
                historyResource.resource = await this.base64DataManager.transformAsync(
                    historyResource.resource, BLOB_OP.RETRIEVE, undefined, { historyRead: true }
                );
                this.base64DataManager.rehydrateHistoryDiagnostics(historyResource);
                // bdl-4: response is mandatory in history bundles but not stored for new versions
                ensureHistoryEntryResponse(historyResource);
                return historyResource;
            })
        );

        // capture UUIDs eagerly: serialization below strips _uuid. A resource's versions share
        // one _uuid, so de-duplicate to audit each resource once.
        const resourceUuids = [...new Set(entries.map((e) => e.resource?._uuid).filter(Boolean))];
        if (resourceType !== 'AuditEvent' && resourceUuids.length > 0) {
            this.postRequestProcessor.add({
                requestId,
                fnTask: async () => {
                    // log access to audit logs
                    await this.auditLogger.logAuditEntryAsync({
                        requestInfo,
                        base_version,
                        resourceType,
                        operation: 'read',
                        args: parsedArgs.getRawArgs(),
                        ids: resourceUuids
                    });
                }
            });
        }

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
                lastResourceLastUpdated,
                historyCursor
            }
        );

        // enrich bundle
        resultBundle.entry = await this.identifierEnrichmentProvider.enrichBundleEntriesAsync({
            entries: resultBundle.entry,
            parsedArgs
        });
        resultBundle.entry = await this.compositionSectionFilterEnrichmentProvider.enrichBundleEntriesAsync({
            entries: resultBundle.entry,
            parsedArgs,
            enrichmentContext: { userType, actor }
        });
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
