/**
 * This class manages inserts and updates to the database
 */
const { assertTypeEquals } = require('../utils/assertType');
const { ACCESS_LOGS_COLLECTION_NAME } = require('../constants');
const { ConfigManager } = require('../utils/configManager');
const { DatabaseQueryFactory } = require('./databaseQueryFactory');
const { FhirRequestInfo } = require('../utils/fhirRequestInfo');
const { getCircularReplacer } = require('../utils/getCircularReplacer');
const { logTraceSystemEventAsync } = require('../operations/common/systemEventLogging');
const { PreSaveManager } = require('../preSaveHandlers/preSave');
const { ReadPreference } = require('mongodb');
const { ResourceLocatorFactory } = require('../operations/common/resourceLocatorFactory');
const { ResourceMerger } = require('../operations/common/resourceMerger');
const { RethrownError } = require('../utils/rethrownError');
const BundleEntry = require('../fhir/classes/4_0_0/backbone_elements/bundleEntry');
const BundleRequest = require('../fhir/classes/4_0_0/backbone_elements/bundleRequest');
const Resource = require('../fhir/classes/4_0_0/resources/resource');

class DatabaseUpdateManager {
    /**
     * Constructor
     * @param {ResourceLocatorFactory} resourceLocatorFactory
     * @param {ResourceMerger} resourceMerger
     * @param {PreSaveManager} preSaveManager
     * @param {string} resourceType
     * @param {string} base_version
     * @param {DatabaseQueryFactory} databaseQueryFactory
     * @param {ConfigManager} configManager
     */
    constructor ({
                    resourceLocatorFactory,
                    resourceMerger,
                    preSaveManager,
                    resourceType,
                    base_version,
                    databaseQueryFactory,
                    configManager
                }) {
        assertTypeEquals(resourceLocatorFactory, ResourceLocatorFactory);
        /**
         * @type {string}
         * @private
         */
        this._resourceType = resourceType;
        /**
         * @type {string}
         * @private
         */
        this._base_version = base_version;
        /**
         * @type {ResourceLocator}
         */
        this.resourceLocator = resourceLocatorFactory.createResourceLocator(
            {
                resourceType: this._resourceType,
                base_version: this._base_version
            });

        /**
         * @type {ResourceMerger}
         */
        this.resourceMerger = resourceMerger;
        assertTypeEquals(resourceMerger, ResourceMerger);

        /**
         * @type {PreSaveManager}
         */
        this.preSaveManager = preSaveManager;
        assertTypeEquals(preSaveManager, PreSaveManager);

        /**
         * @type {DatabaseQueryFactory}
         */
        this.databaseQueryFactory = databaseQueryFactory;
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);

        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);
    }

    /**
     * Inserts a resource into the database
     * @param {Resource} doc
     * @return {Promise<Resource>}
     */
    async insertOneAsync ({ doc }) {
        try {
            doc = await this.preSaveManager.preSaveAsync({ resource: doc });
            const collection = await this.resourceLocator.getOrCreateCollectionForResourceAsync(doc);
            if (!doc.meta.versionId || isNaN(parseInt(doc.meta.versionId))) {
                doc.meta.versionId = '1';
            }
            await collection.insertOne(doc.toJSONInternal());
            return doc;
        } catch (e) {
            throw new RethrownError({
                error: e
            });
        }
    }

    /**
     * Updates the resource present in db
     * @typedef {Object} UpdateOneAsyncParams
     * @property {Resource} doc
     * @property {FhirRequestInfo} requestInfo
     *
     * @param {UpdateOneAsyncParams}
     */
    async updateOneAsync ({ doc, requestInfo }) {
        assertTypeEquals(requestInfo, FhirRequestInfo);
        assertTypeEquals(doc, Resource);

        try {
            await this.preSaveManager.preSaveAsync({ resource: doc });
            /**
             * @type {import('mongodb').Collection<import('mongodb').DefaultSchema>}
             */
            const collection = await this.resourceLocator.getOrCreateCollectionForResourceAsync(doc);

            await collection.replaceOne({ _uuid: doc._uuid }, doc.toJSONInternal());

            // create history for the resource
            await this.postSaveAsync({ requestInfo, doc });
        } catch (err) {
            throw new RethrownError({
                error: err,
                args: {
                    doc
                }
            });
        }
    }

    /**
     * Inserts a resource into the database
     * Return value of null means no replacement was necessary since the data in the db is the same
     * @param {string} base_version
     * @param {FhirRequestInfo} requestInfo
     * @param {Resource} doc
     * @param {Boolean} [smartMerge]
     * @return {Promise<{savedResource: Resource|null, patches: MergePatchEntry[]|null}>}
     */
    async replaceOneAsync ({ base_version, requestInfo, doc, smartMerge = true }) {
        assertTypeEquals(requestInfo, FhirRequestInfo);
        assertTypeEquals(doc, Resource);
        const originalDoc = doc.clone();
        doc = await this.preSaveManager.preSaveAsync({ resource: doc });
        /**
         * @type {Resource[]}
         */
        const docVersionsTested = [];

        /**
         * @type {import('mongodb').FindOptions}
         */
        const findQueryOptions = { readPreference: ReadPreference.PRIMARY };

        try {
            /**
             * @type {import('mongodb').Collection<import('mongodb').DefaultSchema>}
             */
            const collection = await this.resourceLocator.getOrCreateCollectionForResourceAsync(doc);

            const databaseQueryManager = this.databaseQueryFactory.createQuery(
                {
                    resourceType: doc.resourceType,
                    base_version: '4_0_0'
                }
            );
            /**
             * @type {Resource|null}
             */
            let resourceInDatabase = await databaseQueryManager.findOneAsync({
                query: { _uuid: doc._uuid }, options: findQueryOptions
            });
            await logTraceSystemEventAsync(
                {
                    event: 'replaceOneAsync' + `_${doc.resourceType}`,
                    message: 'Found existing resource',
                    args: {
                        id: doc.id,
                        uuid: doc._uuid,
                        resourceType: doc.resourceType,
                        doc,
                        resourceInDatabase
                    }
                }
            );
            if (!resourceInDatabase) {
                return { savedResource: await this.insertOneAsync({ doc }), patches: null };
            }
            /**
             * @type {Resource|null}
             */
            let { updatedResource, patches } = await this.resourceMerger.mergeResourceAsync(
                {
                    base_version,
                    requestInfo,
                    currentResource: resourceInDatabase,
                    resourceToMerge: doc,
                    smartMerge
                }
            );
            if (!updatedResource) {
                return { savedResource: null, patches: null }; // nothing to do
            }
            doc = updatedResource;
            /**
             * @type {number}
             */
            let runsLeft = this.configManager.replaceRetries || 10;
            const originalDatabaseVersion = parseInt(doc.meta.versionId);
            while (runsLeft > 0) {
                const updatedDoc = await this.preSaveManager.preSaveAsync({ resource: doc.clone() });
                const previousVersionId = parseInt(updatedDoc.meta.versionId) - 1;
                const filter = previousVersionId > 0
                    ? { $and: [{ _uuid: updatedDoc._uuid }, { 'meta.versionId': `${previousVersionId}` }] }
                    : { _uuid: updatedDoc._uuid };
                docVersionsTested.push(updatedDoc);
                const updateResult = await collection.replaceOne(filter, updatedDoc.toJSONInternal());
                await logTraceSystemEventAsync(
                    {
                        event: 'replaceOneAsync: Merging' + `_${updatedDoc.resourceType}`,
                        message: 'Merging existing resource',
                        args: {
                            id: updatedDoc.id,
                            uuid: updatedDoc._uuid,
                            resourceType: updatedDoc.resourceType,
                            updatedDoc,
                            resourceInDatabase,
                            patches,
                            updatedResource,
                            updateResult
                        }
                    }
                );
                if (updateResult.matchedCount === 0) {
                    // if not result matched then the versionId has changed in the database
                    // Get the latest version from the database and merge again
                    /**
                     * @type {Resource|null}
                     */
                    resourceInDatabase = await databaseQueryManager.findOneAsync({
                        query: { _uuid: doc._uuid }, options: findQueryOptions
                    });

                    if (resourceInDatabase === null) {
                        throw new Error(`Unable to read resource ${doc.resourceType}/${doc._uuid} from database`);
                    } else {
                        // merge with our resource
                        ({ updatedResource, patches } = await this.resourceMerger.mergeResourceAsync(
                                {
                                    base_version,
                                    requestInfo,
                                    currentResource: resourceInDatabase,
                                    resourceToMerge: doc
                                }
                            )
                        );
                        if (updatedResource) {
                            doc = updatedResource;
                        } else {
                            return { savedResource: null, patches: null };
                        }
                    }
                    runsLeft -= 1;
                    await logTraceSystemEventAsync({
                        event: 'replaceOneAsync',
                        message: 'retry',
                        args: {
                            originalDoc,
                            doc
                        }
                    });
                } else { // save was successful
                    await logTraceSystemEventAsync(
                        {
                            event: 'replaceOneAsync: Merged' + `_${doc.resourceType}`,
                            message: 'Successful merged existing resource',
                            args: {
                                id: doc.id,
                                uuid: doc._uuid,
                                resourceType: doc.resourceType,
                                doc,
                                resourceInDatabase,
                                patches,
                                updatedResource,
                                updateResult,
                                runsLeft
                            }
                        }
                    );
                    return { savedResource: doc, patches };
                }
            }
            if (runsLeft <= 0) {
                const documentsTestedAsText = JSON.stringify(
                    docVersionsTested.map(d => d.toJSONInternal()),
                    getCircularReplacer()
                );
                throw new Error(
                    `Unable to save resource ${doc.resourceType}/${doc._uuid} with version ${doc.meta.versionId} ` +
                    `(original=${originalDatabaseVersion}) after 10 tries. ` +
                    `(versions tested: ${documentsTestedAsText})`);
            }
        } catch (e) {
            throw new RethrownError({
                error: e,
                args: {
                    originalDoc,
                    doc,
                    docVersionsTested
                }
            });
        }
    }

    /**
     * Inserts a history collection for a resource
     * @param {FhirRequestInfo} requestInfo
     * @param {Resource} doc
     * @return {Promise<void>}
     */
    async postSaveAsync ({
        requestInfo,
        doc
    }) {
        assertTypeEquals(requestInfo, FhirRequestInfo);
        assertTypeEquals(doc, Resource);
        const requestId = requestInfo.requestId;
        const method = requestInfo.method;
        doc = await this.preSaveManager.preSaveAsync({ resource: doc });
        const historyCollectionName = await this.resourceLocator.getHistoryCollectionNameAsync(doc);
        const historyCollection = await this.resourceLocator.getOrCreateCollectionAsync(historyCollectionName);
        await historyCollection.insertOne(new BundleEntry({
            id: doc.id,
            resource: doc.toJSONInternal(),
            request: new BundleRequest(
                {
                    id: requestId,
                    method,
                    url: `${this._base_version}/${doc.resourceType}/${doc._uuid}`
                }
            )
        }).toJSONInternal());
    }

    /**
     * Inserts a resource into the Access logs database
     * @param {Resource} doc
     * @return {Promise<Resource>}
     */
    async insertOneAccessLogsAsync ({ doc }) {
        try {
            const collection =
                await this.resourceLocator.getOrCreateAccessLogCollectionAsync(ACCESS_LOGS_COLLECTION_NAME);
            await collection.insertOne(doc);
            return doc;
        } catch (e) {
            throw new RethrownError({
                error: e
            });
        }
    }
}

module.exports = {
    DatabaseUpdateManager
};
