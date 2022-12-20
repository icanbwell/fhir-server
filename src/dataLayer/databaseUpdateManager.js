/**
 * This class manages inserts and updates to the database
 */
const {assertTypeEquals} = require('../utils/assertType');
const {ResourceLocatorFactory} = require('../operations/common/resourceLocatorFactory');
const {RethrownError} = require('../utils/rethrownError');
const {getResource} = require('../operations/common/getResource');
const {ResourceMerger} = require('../operations/common/resourceMerger');
const {PreSaveManager} = require('../preSaveHandlers/preSave');
const {logTraceSystemEventAsync} = require('../operations/common/logging');

class DatabaseUpdateManager {
    /**
     * Constructor
     * @param {ResourceLocatorFactory} resourceLocatorFactory
     * @param {ResourceMerger} resourceMerger
     * @param {PreSaveManager} preSaveManager
     * @param {string} resourceType
     * @param {string} base_version
     */
    constructor({
                    resourceLocatorFactory,
                    resourceMerger,
                    preSaveManager,
                    resourceType,
                    base_version
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
    }

    /**
     * Inserts a resource into the database
     * @param {Resource} doc
     * @return {Promise<void>}
     */
    async insertOneAsync({doc}) {
        try {
            const collection = await this.resourceLocator.getOrCreateCollectionForResourceAsync(doc);
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
        try {
            /**
             * @type {import('mongodb').Collection<import('mongodb').DefaultSchema>}
             */
            const collection = await this.resourceLocator.getOrCreateCollectionForResourceAsync(doc);
            /**
             * @type {boolean}
             */
            let passed = false;
            /**
             * @type {number}
             */
            let runsLeft = 5;
            while (!passed && runsLeft > 0) {
                const previousVersionId = parseInt(doc.meta.versionId) - 1;
                const filter = previousVersionId > 0 ?
                    {$and: [{id: doc.id}, {'meta.versionId': `${previousVersionId}`}]} :
                    {id: doc.id};
                const updateResult = await collection.replaceOne(filter, doc.toJSONInternal());
                if (updateResult.matchedCount === 0) {
                    // if not result matched then the versionId has changed in the database
                    // Get the latest version from the database and merge again
                    const resourceJson = await collection.findOne({id: doc.id});
                    if (resourceJson !== null) {
                        const ResourceCreator = getResource('4_0_0', resourceJson.resourceType);
                        const currentResource = new ResourceCreator(resourceJson);
                        doc = await this.resourceMerger.mergeResourceAsync({
                            currentResource,
                            resourceToMerge: doc
                        });
                        await this.preSaveManager.preSaveAsync(doc);
                    }
                    runsLeft = runsLeft - 1;
                    logTraceSystemEventAsync({
                        event: 'replaceOneAsync',
                        message: 'retry',
                        args: {
                            doc
                        }
                    });
                } else {
                    passed = true;
                }
            }
            if (runsLeft <= 0) {
                throw new Error(`Unable to save resource ${doc.resourceType}/${doc.id} with version ${doc.meta.versionId} after 5 tries`);
            }
        } catch (e) {
            throw new RethrownError({
                error: e,
                args: {
                    doc
                }
            });
        }
    }
}

module.exports = {
    DatabaseUpdateManager
};
