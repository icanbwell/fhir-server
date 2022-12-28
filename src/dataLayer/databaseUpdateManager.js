/**
 * This class manages inserts and updates to the database
 */
const {assertTypeEquals} = require('../utils/assertType');
const {ResourceLocatorFactory} = require('../operations/common/resourceLocatorFactory');
const {RethrownError} = require('../utils/rethrownError');
const {ResourceMerger} = require('../operations/common/resourceMerger');
const {PreSaveManager} = require('../preSaveHandlers/preSave');
const {logTraceSystemEventAsync} = require('../operations/common/logging');
const {DatabaseQueryFactory} = require('./databaseQueryFactory');
const {ConfigManager} = require('../utils/configManager');

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
    constructor({
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
     * @return {Promise<void>}
     */
    async insertOneAsync({doc}) {
        try {
            const collection = await this.resourceLocator.getOrCreateCollectionForResourceAsync(doc);
            if (isNaN(parseInt(doc.meta.versionId))) {
                doc.meta.versionId = '1';
            }
            await collection.insertOne(doc.toJSONInternal());
        } catch (e) {
            throw new RethrownError({
                error: e
            });
        }
    }

    /**
     * Inserts a resource into the database
     * @param {Resource} doc
     * @return {Promise<void>}
     */
    async replaceOneAsync({doc}) {
        const originalDoc = doc.clone();

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
                query: {id: doc.id}
            });
            if (!resourceInDatabase) {
                return await this.insertOneAsync({doc});
            }
            /**
             * @type {Resource|null}
             */
            let updatedDoc = await this.resourceMerger.mergeResourceAsync({
                currentResource: resourceInDatabase,
                resourceToMerge: doc
            });
            if (!updatedDoc) {
                return; // nothing to do
            }
            doc = updatedDoc;
            /**
             * @type {boolean}
             */
            let passed = false;
            /**
             * @type {number}
             */
            let runsLeft = this.configManager.replaceRetries || 10;
            const originalDatabaseVersion = parseInt(doc.meta.versionId);
            while (!passed && runsLeft > 0) {
                const previousVersionId = parseInt(doc.meta.versionId) - 1;
                const filter = previousVersionId > 0 ?
                    {$and: [{id: doc.id}, {'meta.versionId': `${previousVersionId}`}]} :
                    {id: doc.id};
                const updateResult = await collection.replaceOne(filter, doc.toJSONInternal());
                if (updateResult.matchedCount === 0) {
                    // if not result matched then the versionId has changed in the database
                    // Get the latest version from the database and merge again
                    /**
                     * @type {Resource|null}
                     */
                    resourceInDatabase = await databaseQueryManager.findOneAsync({
                        query: {id: doc.id}
                    });

                    if (resourceInDatabase !== null) {
                        // merge with our resource
                        updatedDoc = await this.resourceMerger.mergeResourceAsync({
                            currentResource: resourceInDatabase,
                            resourceToMerge: doc
                        });
                        if (!updatedDoc) {
                            passed = true; // nothing needed since the resource in the database is same as what we're trying to update with
                        } else {
                            doc = updatedDoc;
                        }
                    } else {
                        throw new Error(`Unable to read resource ${doc.resourceType}/${doc.id} from database`);
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
                } else {
                    passed = true;
                }
            }
            if (runsLeft <= 0) {
                throw new Error(
                    `Unable to save resource ${doc.resourceType}/${doc.id} with version ${doc.meta.versionId} ` +
                    `(original=${originalDatabaseVersion}) after 10 tries`);
            }
        } catch (e) {
            throw new RethrownError({
                error: e,
                args: {
                    originalDoc,
                    doc
                }
            });
        }
    }
}

module.exports = {
    DatabaseUpdateManager
};
