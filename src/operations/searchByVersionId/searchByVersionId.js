const { NotFoundError, ForbiddenError, BadRequestError } = require('../../utils/httpErrors');
const { EnrichmentManager } = require('../../enrich/enrich');
const { assertTypeEquals, assertIsValid } = require('../../utils/assertType');
const { DatabaseHistoryFactory } = require('../../dataLayer/databaseHistoryFactory');
const { FhirLoggingManager } = require('../common/fhirLoggingManager');
const { ScopesValidator } = require('../security/scopesValidator');
const { isTrue } = require('../../utils/isTrue');
const { ConfigManager } = require('../../utils/configManager');
const { SearchManager } = require('../search/searchManager');
const { ParsedArgs } = require('../query/parsedArgs');
const { ScopesManager } = require('../security/scopesManager');
const { DatabaseAttachmentManager } = require('../../dataLayer/databaseAttachmentManager');
const { Base64DataManager } = require('../../dataLayer/base64DataManager');
const { GRIDFS: { RETRIEVE }, BLOB_OP, OPERATIONS: { READ }, RESOURCE_CLOUD_STORAGE_PATH_KEY } = require('../../constants');
const { CloudStorageClient } = require('../../utils/cloudStorageClient');
const { FhirResourceCreator } = require('../../fhir/fhirResourceCreator');
const { FhirResourceSerializer } = require('../../fhir/fhirResourceSerializer');
const { MONGO_GROUP_EXTENDED_FIELD } = require('../../utils/mongoGroupExtendedTag');
const { MongoGroupMemberRepository } = require('../../dataLayer/repositories/mongoGroupMemberRepository');

class SearchByVersionIdOperation {
    /**
     * constructor
     * @param {DatabaseHistoryFactory} databaseHistoryFactory
     * @param {FhirLoggingManager} fhirLoggingManager
     * @param {ScopesValidator} scopesValidator
     * @param {EnrichmentManager} enrichmentManager
     * @param {ConfigManager} configManager
     * @param {SearchManager} searchManager
     * @param {ScopesManager} scopesManager
     * @param {DatabaseAttachmentManager} databaseAttachmentManager
     * @param {Base64DataManager} base64DataManager
     * @param {CloudStorageClient | null} historyResourceCloudStorageClient
     * @param {MongoGroupMemberRepository} mongoGroupMemberRepository
     */
    constructor (
        {
            databaseHistoryFactory,
            fhirLoggingManager,
            scopesValidator,
            enrichmentManager,
            configManager,
            searchManager,
            scopesManager,
            databaseAttachmentManager,
            base64DataManager,
            historyResourceCloudStorageClient,
            mongoGroupMemberRepository
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
         * @type {ScopesManager}
         */
        this.scopesManager = scopesManager;
        assertTypeEquals(scopesManager, ScopesManager);
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
         * @type {CloudStorageClient | null}
         */
        this.historyResourceCloudStorageClient = historyResourceCloudStorageClient;
        if (historyResourceCloudStorageClient) {
            assertTypeEquals(historyResourceCloudStorageClient, CloudStorageClient);
        }

        /**
         * @type {MongoGroupMemberRepository}
         */
        this.mongoGroupMemberRepository = mongoGroupMemberRepository;
        assertTypeEquals(mongoGroupMemberRepository, MongoGroupMemberRepository);
    }

    /**
     * does a FHIR Search By Version
     * @param {Object} params
     * @param {import('../../utils/fhirRequestInfo').FhirRequestInfo} params.requestInfo
     * @param {ParsedArgs} params.parsedArgs
     * @param {string} params.resourceType
     * @param {import('http').ServerResponse} [params.res]
     */
    async searchByVersionIdAsync ({ requestInfo, parsedArgs, resourceType, res }) {
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
            scope,
            actor,
            userType
            // /** @type {string} */
            // requestId
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

        // SEC-1580 SAE-1: see ScopesManager.hasHistoryAccess for why a tenant-scoped access
        // code is never sufficient to read a specific historical version.
        if (!this.scopesManager.hasHistoryAccess({ resourceType, scope })) {
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
                userType,
                resourceType,
                useAccessIndex,
                personIdFromJwtToken,
                parsedArgs,
                useHistoryTable: true,
                operation: READ,
                actor
            });

            if (typeof version_id !== 'string') {
                throw new BadRequestError('version_id must be a string');
            }
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
                result = await databaseHistoryManager.findOneAsync({
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
                            `${collectionName}/${historyResource?.resource?._uuid}/${historyResource[RESOURCE_CLOUD_STORAGE_PATH_KEY]}.json`
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

                // Captured now, not re-read off historyResource after serialize below -- serialize
                // strips server-internal fields like _uuid from the wire representation (see
                // searchById.js's identical pattern with resourceUuid).
                const groupUuid = historyResource._uuid;
                const targetLastUpdated = historyResource.meta.lastUpdated;
                const isExtendedGroup = resourceType === 'Group' &&
                    historyResource[MONGO_GROUP_EXTENDED_FIELD] === true &&
                    this.configManager.enableExtendedGroup;

                // run any enrichment
                historyResource = (await this.enrichmentManager.enrichAsync({
                            resources: [historyResource],
                            parsedArgs,
                            enrichmentContext: { userType, actor }
                        }
                    )
                )[0];

                historyResource = await this.databaseAttachmentManager.transformAttachments(historyResource, RETRIEVE);
                historyResource = await this.base64DataManager.transformAsync(
                    historyResource, BLOB_OP.RETRIEVE, undefined, { historyRead: true }
                );
                await this.fhirLoggingManager.logOperationSuccessAsync({
                    requestInfo,
                    args: parsedArgs.getRawArgs(),
                    resourceType,
                    startTime,
                    action: currentOperationName
                });

                // serialize the resource
                FhirResourceSerializer.serialize(historyResource);

                if (isExtendedGroup && res) {
                    const memberCursor = await this.mongoGroupMemberRepository.getMemberCursorAtAsync({
                        base_version,
                        groupUuid,
                        targetLastUpdated
                    });
                    await this.searchManager.streamGroupMemberArrayAsync({
                        requestId: requestInfo.requestId,
                        cursor: memberCursor,
                        groupResourceJson: historyResource,
                        res,
                        // memberCursor is an aggregation pipeline, not a plain find() query --
                        // MongoReadableStream can't resume it via its default
                        // getCursorForQueryAsync path (no cursor.getQuery()), so resume it
                        // ourselves past the last row streamed. See getMemberCursorAtAsync's
                        // afterUuid param.
                        rebuildCursorAsync: async ({ lastUUID, maxMongoTimeMS }) =>
                            await this.mongoGroupMemberRepository.getMemberCursorAtAsync({
                                base_version,
                                groupUuid,
                                targetLastUpdated,
                                afterUuid: lastUUID,
                                maxTimeMS: maxMongoTimeMS
                            })
                    });
                    return null;
                }

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
