/**
 * This class manages inserts and updates to the database
 */
const { assertTypeEquals } = require('../utils/assertType');
const BundleEntry = require('../fhir/classes/4_0_0/backbone_elements/bundleEntry');
const BundleRequest = require('../fhir/classes/4_0_0/backbone_elements/bundleRequest');
const { ResourceLocatorFactory } = require('../operations/common/resourceLocatorFactory');
const { RethrownError } = require('../utils/rethrownError');
const { ResourceMerger } = require('../operations/common/resourceMerger');
const { PreSaveManager } = require('../preSaveHandlers/preSave');
const { logTraceSystemEventAsync } = require('../operations/common/systemEventLogging');
const { DatabaseQueryFactory } = require('./databaseQueryFactory');
const { ConfigManager } = require('../utils/configManager');
const { getCircularReplacer } = require('../utils/getCircularReplacer');
const { ReadPreference } = require('mongodb');

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
            doc = await this.preSaveManager.preSaveAsync(doc);
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
     * Inserts a resource into the database
     * Return value of null means no replacement was necessary since the data in the db is the same
     * @param {Resource} doc
     * @param {Boolean} [smartMerge]
     * @return {Promise<{savedResource: Resource|null, patches: MergePatchEntry[]|null}>}
     */
    async replaceOneAsync ({ doc, smartMerge = true }) {
        const originalDoc = doc.clone();
        doc = await this.preSaveManager.preSaveAsync(doc);
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
                const updatedDoc = await this.preSaveManager.preSaveAsync(doc.clone());
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

                    if (resourceInDatabase !== null) {
                        // merge with our resource
                        ({ updatedResource, patches } = await this.resourceMerger.mergeResourceAsync(
                                {
                                    currentResource: resourceInDatabase,
                                    resourceToMerge: doc
                                }
                            )
                        );
                        if (!updatedResource) {
                            return { savedResource: null, patches: null };
                        } else {
                            doc = updatedResource;
                        }
                    } else {
                        throw new Error(`Unable to read resource ${doc.resourceType}/${doc._uuid} from database`);
                    }
                    runsLeft = runsLeft - 1;
                    logTraceSystemEventAsync({
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
     * @param {string} requestId
     * @param {string} method
     * @param {Resource} doc
     */
    async postSaveAsync (
        {
            requestId,
            method,
            doc
        }
    ) {
        doc = await this.preSaveManager.preSaveAsync(doc);
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
}

module.exports = {
    DatabaseUpdateManager
};
