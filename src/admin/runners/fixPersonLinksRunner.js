const { BaseBulkOperationRunner } = require('./baseBulkOperationRunner');
const { assertTypeEquals, assertIsValid } = require('../../utils/assertType');
const { PreSaveManager } = require('../../preSaveHandlers/preSave');
const deepEqual = require('fast-deep-equal');
const moment = require('moment-timezone');
const { ResourceLocatorFactory } = require('../../operations/common/resourceLocatorFactory');
const { RethrownError } = require('../../utils/rethrownError');
const { VERSIONS } = require('../../middleware/fhir/utils/constants');
const { ReferenceParser } = require('../../utils/referenceParser');
const { DatabaseQueryFactory } = require('../../dataLayer/databaseQueryFactory');
const { FhirResourceCreator } = require('../../fhir/fhirResourceCreator');

/**
 * @classdesc runs preSave() on every record
 */
class FixPersonLinksRunner extends BaseBulkOperationRunner {
    /**
     * constructor
     * @param {MongoCollectionManager} mongoCollectionManager
     * @param {string[]} collections
     * @param {number} batchSize
     * @param {date|undefined} beforeLastUpdatedDate
     * @param {DatabaseQueryFactory} databaseQueryFactory
     * @param {AdminLogger} adminLogger
     * @param {MongoDatabaseManager} mongoDatabaseManager
     * @param {ResourceLocatorFactory} resourceLocatorFactory
     * @param {string[]} preloadCollections
     * @param {PreSaveManager} preSaveManager
     * @param {number|undefined} [limit]
     * @param {number|undefined} [skip]
     * @param {number|undefined} [minLinks]
     */
    constructor (
        {
            mongoCollectionManager,
            batchSize,
            beforeLastUpdatedDate,
            databaseQueryFactory,
            adminLogger,
            mongoDatabaseManager,
            preSaveManager,
            preloadCollections,
            resourceLocatorFactory,
            limit,
            skip,
            minLinks
        }) {
        super({
            mongoCollectionManager,
            batchSize,
            adminLogger,
            mongoDatabaseManager
        });
        /**
         * @type {number}
         */
        this.batchSize = batchSize;

        /**
         * @type {date|undefined}
         */
        this.beforeLastUpdatedDate = beforeLastUpdatedDate;

        /**
         * @type {string[]}
         */
        this.preloadCollections = preloadCollections;

        /**
         * @type {DatabaseQueryFactory}
         */
        this.databaseQueryFactory = databaseQueryFactory;
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);

        this.preSaveManager = preSaveManager;
        assertTypeEquals(preSaveManager, PreSaveManager);

        /**
         * @type {ResourceLocatorFactory}
         */
        this.resourceLocatorFactory = resourceLocatorFactory;
        assertTypeEquals(resourceLocatorFactory, ResourceLocatorFactory);

        /**
         * @type {number|undefined}
         */
        this.limit = limit;

        /**
         * @type {number|undefined}
         */
        this.skip = skip;

        /**
         * @type {number|undefined}
         */
        this.minLinks = minLinks;

        /**
         * cache of caches
         * @type {Map<string, Map<string, {_uuid: string|null, _sourceId: string|null, _sourceAssigningAuthority: string|null}>>}
         */
        this.caches = new Map();
    }

    isPersonSame (resource, linkedResource) {
        let isSame;
        if (resource.telecom && resource.telecom.length && linkedResource.telecom && linkedResource.telecom.length) {
            const currentPersonEmail = resource.telecom.find(t => t.system === 'email')?.value;
            const linkedPersonEmail = linkedResource.telecom.find(t => t.system === 'email')?.value;
            if (currentPersonEmail && linkedPersonEmail) {
                isSame = currentPersonEmail === linkedPersonEmail;
            }
        }
        if (isSame === undefined && resource.name && resource.name.length && linkedResource.name && linkedResource.name.length) {
            const currentPersonName = resource.name[0];
            const linkedPersonName = linkedResource.name[0];
            isSame = currentPersonName.family === linkedPersonName.family && currentPersonName.given.join(',') === linkedPersonName.given.join(',');
        }
        return !!isSame;
    }

    async fixLinks (resource) {
        const originalLinks = resource.link;
        if (!originalLinks || originalLinks.length === 0) {
            return resource;
        }
        const newLinks = [];

        for (const link of originalLinks) {
            const reference = link.target;
            if ((reference.reference && reference.reference.indexOf('Person/') === -1) || (reference.type && reference.type !== 'Person')) {
                newLinks.push(link);
                continue;
            }
            try {
                if (!reference.reference) {
                    continue;
                }

                // if the _uuid reference works then we're good
                const { resourceType } = ReferenceParser.parseReference(reference.reference);
                if (!resourceType) {
                    continue;
                }
                /**
                 * @type {string}
                 */
                let uuid;
                if (reference._uuid) {
                    ({ id: uuid } = ReferenceParser.parseReference(reference._uuid));
                }

                // find collection for resource
                /**
                 * @type {ResourceLocator}
                 */
                const resourceLocator = this.resourceLocatorFactory.createResourceLocator({
                    resourceType,
                    base_version: VERSIONS['4_0_0']
                });
                /**
                 * @type {string}
                 */
                const referenceCollectionName = await resourceLocator.getFirstCollectionNameForQueryDebugOnlyAsync(
                    {
                        query: {}
                    }
                );

                // first check in cache
                /**
                 * @type {Map<string, {_uuid: (string|null), _sourceId: (string|null), _sourceAssigningAuthority: (string|null)}>}
                 */
                const cache = this.getCacheForResourceType(
                    {
                        collectionName: referenceCollectionName
                    }
                );
                if (uuid) {
                    if (cache.has(uuid)) {
                        const linkedResource = cache.get(uuid);
                        if (this.isPersonSame(resource, linkedResource)) {
                            newLinks.push(link);
                        }
                    } else {
                        /**
                         * @type {DatabaseQueryManager}
                         */
                        const referencedResourceQueryManager = this.databaseQueryFactory.createQuery({
                            resourceType,
                            base_version: VERSIONS['4_0_0']
                        });
                        const linkedResource = await referencedResourceQueryManager.findOneAsync(
                            {
                                query: {
                                    _uuid: uuid
                                },
                                options: {
                                    projection: {
                                        _id: 0,
                                        _uuid: 1,
                                        name: 1,
                                        telecom: 1
                                    }
                                }
                            }
                        );
                        if (linkedResource && this.isPersonSame(resource, linkedResource)) {
                            newLinks.push(link);
                        }
                    }
                }
            } catch (e) {
                throw new RethrownError(
                    {
                        message: 'Error processing reference',
                        error: e,
                        args: {
                            reference: reference
                        },
                        source: 'FixPersonLinksRunner.fixLinks'
                    }
                );
            }
        }

        resource.link = newLinks;
        return resource;
    }

    /**
     * returns the bulk operation for this doc
     * @param {import('mongodb').DefaultSchema} doc
     * @returns {Promise<(import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>)[]>}
     */
    async processRecordAsync (doc) {
        const operations = [];
        if (!doc.meta || !doc.meta.security) {
            return operations;
        }
        assertIsValid(doc.resourceType);
        /**
         * @type {Resource}
         */
        const currentResource = FhirResourceCreator.create(doc);
        const resource = currentResource.clone();
        /**
         * @type {Resource}
         */
        const updatedResource = await this.fixLinks(resource);
        // for speed, first check if the incoming resource is exactly the same
        const updatedResourceJsonInternal = updatedResource.toJSONInternal();
        const currentResourceJsonInternal = currentResource.toJSONInternal();
        if (deepEqual(updatedResourceJsonInternal, currentResourceJsonInternal) === true) {
            // console.log('No change detected for ');
            return operations;
        }

        /**
         * @type {import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>}
         */
        // batch up the calls to update
        updatedResource.meta.lastUpdated = new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ssZ'));
        const result = { replaceOne: { filter: { _id: doc._id }, replacement: updatedResource.toJSONInternal() } };
        operations.push(result);
        // console.log(`Operation: ${JSON.stringify(result)}`);
        return operations;
    }

    /**
     * preloads the collection into cache
     * @param mongoConfig
     * @param {string} collectionName
     * @return {Promise<void>}
     */
    async preloadCollectionAsync ({ mongoConfig, collectionName }) {
        const {
            sourceCollection
        } = await this.createConnectionAsync(
            {
                config: mongoConfig,
                sourceCollectionName: collectionName,
                destinationCollectionName: collectionName
            }
        );
        /**
         * @type {import('mongodb').FindCursor<import('mongodb').WithId<import('mongodb').Document>>}
         */
        const cursor = sourceCollection.find({}, {
            projection: {
                _id: 0,
                _uuid: 1,
                telecom: 1,
                name: 1
            }
        });
        while (await cursor.hasNext()) {
            /**
             * @type {import('mongodb').WithId<import('mongodb').Document>}
             */
            const doc = await cursor.next();
            this.getCacheForResourceType({ collectionName })
                .set(
                    doc._uuid,
                    {
                        _uuid: doc._uuid,
                        telecom: doc.telecom,
                        name: doc.name
                    }
                );
        }
    }

    /**
     * Gets cache for collection
     * @param {string} collectionName
     * @return {Map<string, {_uuid: (string|null), _sourceId: (string|null), _sourceAssigningAuthority: (string|null)}>}
     */
    getCacheForResourceType ({ collectionName }) {
        if (!this.caches.has(collectionName)) {
            this.caches.set(collectionName, new Map());
        }
        return this.caches.get(collectionName);
    }

    /**
     * Runs a loop to process all the documents
     * @returns {Promise<void>}
     */
    async processAsync () {
        // noinspection JSValidateTypes
        try {
            await this.init();

            /**
             * @type {{connection: string, db_name: string, options: import('mongodb').MongoClientOptions}}
             */
            const mongoConfig = await this.mongoDatabaseManager.getClientConfigAsync();

            for (const preloadCollection of this.preloadCollections) {
                console.log(`Preloading collection: ${preloadCollection}`);
                // preload person table
                await this.preloadCollectionAsync(
                    {
                        mongoConfig,
                        collectionName: preloadCollection
                    }
                );
                const count = this.getCacheForResourceType(
                    {
                        collectionName: preloadCollection
                    }
                ).size;
                console.log(`Done preloading collection: ${preloadCollection}: ${count.toLocaleString('en-US')}`);
            }

            const collectionName = 'Person_4_0_0';

            this.startFromIdContainer.startFromId = '';
            /**
             * @type {import('mongodb').Filter<import('mongodb').Document>}
             */

            const query = this.beforeLastUpdatedDate ? {
                'meta.lastUpdated': {
                    $lt: this.beforeLastUpdatedDate
                }
            } : {};

            // Get ids of documents that have multiple owners/sourceAssigningAuthority.
            const db = await this.mongoDatabaseManager.getDatabaseForResourceAsync(
                {
                    resourceType: this._resourceType
                });
            const dbCollection = await this.mongoCollectionManager.getOrCreateCollectionAsync({
                db,
                collectionName
            });
            const result = await dbCollection.aggregate([
                {
                    '$match': {
                        'meta.security': {
                            '$elemMatch': {
                                'system': 'https://www.icanbwell.com/owner',
                                'code': 'bwell'
                            }
                        }
                    }
                }, {
                    '$unwind': {
                        'path': '$link'
                    }
                }, {
                    '$group': {
                        '_id': '$_id',
                        'count': {
                            '$count': {}
                        }
                    }
                }, {
                    '$match': {
                        'count': {
                            '$gte': parseInt(`${this.minLinks ? this.minLinks : 20}`)
                        }
                    }
                }
            ], { allowDiskUse: true }).toArray();

            const idList = result.map(obj => obj._id);

            try {
                await this.runForQueryBatchesAsync(
                    {
                        config: this.useAuditDatabase ?
                            await this.mongoDatabaseManager.getAuditConfigAsync() :
                            await this.mongoDatabaseManager.getClientConfigAsync(),
                        sourceCollectionName: collectionName,
                        destinationCollectionName: collectionName,
                        query,
                        projection: undefined,
                        startFromIdContainer: this.startFromIdContainer,
                        fnCreateBulkOperationAsync: async (doc) => await this.processRecordAsync(doc),
                        ordered: false,
                        batchSize: this.batchSize,
                        skipExistingIds: false,
                        limit: this.limit,
                        skip: this.skip,
                        filterToIdProperty: '_id',
                        filterToIds: idList
                    }
                );
            } catch (e) {
                console.error(e);
                console.log(`Got error ${e}.  At ${this.startFromIdContainer.startFromId}`);
            }
            console.log(`Finished loop ${collectionName}`);
            console.log('Finished script');
            console.log('Shutting down');
            await this.shutdown();
            console.log('Shutdown finished');
        } catch (e) {
            console.log(`ERROR: ${e}`);
        }
    }
}

module.exports = {
    FixPersonLinksRunner
};
