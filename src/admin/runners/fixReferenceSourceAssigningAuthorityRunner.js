const { BaseBulkOperationRunner } = require('./baseBulkOperationRunner');
const { assertTypeEquals } = require('../../utils/assertType');
const { PreSaveManager } = require('../../preSaveHandlers/preSave');
const { VERSIONS } = require('../../middleware/fhir/utils/constants');
const { ReferenceParser } = require('../../utils/referenceParser');
const { DatabaseQueryFactory } = require('../../dataLayer/databaseQueryFactory');
const { generateUUIDv5 } = require('../../utils/uid.util');
const deepEqual = require('fast-deep-equal');
const moment = require('moment-timezone');
const { isValidMongoObjectId } = require('../../utils/mongoIdValidator');
const { ResourceLocatorFactory } = require('../../operations/common/resourceLocatorFactory');
const { FhirResourceCreator } = require('../../fhir/fhirResourceCreator');
const { MongoJsonPatchHelper } = require('../../utils/mongoJsonPatchHelper');
const { ResourceMerger } = require('../../operations/common/resourceMerger');
const { RethrownError } = require('../../utils/rethrownError');
const { mongoQueryStringify } = require('../../utils/mongoQueryStringify');
const { ObjectId } = require('mongodb');

/**
 * converts list of properties to a projection
 * @param {string[]} properties
 * @return {import('mongodb').Document}
 */
function getProjection (properties) {
    /**
     * @type {import('mongodb').Document}
     */
    const projection = {};
    for (const property of properties) {
        projection[`${property}`] = 1;
    }
    // always add projection for needed properties
    const neededProperties = ['resourceType', 'meta', 'identifier', '_uuid', '_sourceId', '_sourceAssigningAuthority'];
    for (const property of neededProperties) {
        projection[`${property}`] = 1;
    }
    return projection;
}

/**
 * converts list of properties to a projection
 * @param {string[]} properties
 * @return {import('mongodb').Filter<import('mongodb').Document>}
 */
// eslint-disable-next-line no-unused-vars
function getFilter (properties) {
    if (!properties || properties.length === 0) {
        return {};
    }
    if (properties.length === 1) {
        return {
            [properties[0]]: {
                $exists: true
            }
        };
    }
    /**
     * @type {import('mongodb').Filter<import('mongodb').Document>}
     */
    const filter = {
        $and: []
    };

    for (const property of properties) {
        filter.$and.push({
            [`${property}`]: {
                $exists: true
            }
        });
    }
    return filter;
}

/**
 * @classdesc finds ids in references and updates sourceAssigningAuthority with found resource
 */
class FixReferenceSourceAssigningAuthorityRunner extends BaseBulkOperationRunner {
    /**
     * constructor
     * @param {MongoCollectionManager} mongoCollectionManager
     * @param {string[]} collections
     * @param {number} batchSize
     * @param {AdminLogger} adminLogger
     * @param {MongoDatabaseManager} mongoDatabaseManager
     * @param {PreSaveManager} preSaveManager
     * @param {date|undefined} afterLastUpdatedDate
     * @param {DatabaseQueryFactory} databaseQueryFactory
     * @param {string|undefined} [startFromCollection]
     * @param {ResourceLocatorFactory} resourceLocatorFactory
     * @param {string[]} preloadCollections
     * @param {number|undefined} [limit]
     * @param {string[]|undefined} [properties]
     * @param {ResourceMerger} resourceMerger
     * @param {boolean|undefined} [useTransaction]
     * @param {number|undefined} [skip]
     * @param {string[]|undefined} [filterToRecordsWithFields]
     * @param {string|undefined} [startFromId]
     */
    constructor (
        {
            mongoCollectionManager,
            collections,
            batchSize,
            adminLogger,
            mongoDatabaseManager,
            preSaveManager,
            afterLastUpdatedDate,
            databaseQueryFactory,
            startFromCollection,
            resourceLocatorFactory,
            preloadCollections,
            limit,
            properties,
            resourceMerger,
            useTransaction,
            skip,
            filterToRecordsWithFields,
            startFromId
        }) {
        super({
            mongoCollectionManager,
            batchSize,
            adminLogger,
            mongoDatabaseManager
        });
        /**
         * @type {string[]}
         */
        this.collections = collections;
        /**
         * @type {number}
         */
        this.batchSize = batchSize;

        this.preSaveManager = preSaveManager;
        assertTypeEquals(preSaveManager, PreSaveManager);

        /**
         * @type {date|undefined}
         */
        this.afterLastUpdatedDate = afterLastUpdatedDate;

        /**
         * @type {DatabaseQueryFactory}
         */
        this.databaseQueryFactory = databaseQueryFactory;
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);

        /**
         * @type {string|undefined}
         */
        this.startFromCollection = startFromCollection;

        /**
         * @type {ResourceLocatorFactory}
         */
        this.resourceLocatorFactory = resourceLocatorFactory;
        assertTypeEquals(resourceLocatorFactory, ResourceLocatorFactory);

        /**
         * @type {string[]}
         */
        this.preloadCollections = preloadCollections;

        /**
         * @type {number|undefined}
         */
        this.limit = limit;

        /**
         * @type {string[]|undefined}
         */
        this.properties = properties;

        /**
         * @type {boolean|undefined}
         */
        this.useTransaction = useTransaction;

        /**
         * @type {number|undefined}
         */
        this.skip = skip;

        /**
         * @type {string[]|undefined}
         */
        this.filterToRecordsWithFields = filterToRecordsWithFields;

        /**
         * @type {string|undefined}
         */
        this.startFromId = startFromId;

        /**
         * @type {ResourceMerger}
         */
        this.resourceMerger = resourceMerger;
        assertTypeEquals(resourceMerger, ResourceMerger);

        /**
         * cache of caches
         * @type {Map<string, Map<string, {_uuid: string|null, _sourceId: string|null, _sourceAssigningAuthority: string|null}>>}
         */
        this.caches = new Map();

        /**
         * @type {Map<string, number>}
         */
        this.cacheHits = new Map();
        /**
         * @type {Map<string, number>}
         */
        this.cacheMisses = new Map();
        /**
         * @type {Map<string, string[]>}
         */
        this.resourcesNotFound = new Map();
    }

    /**
     * @param {Reference} reference
     * @param {DatabaseQueryFactory} databaseQueryFactory
     * @return {Promise<Reference>}
     */
    async updateReferenceAsync (reference, databaseQueryFactory) {
        try {
            assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);
            if (!reference.reference) {
                return reference;
            }

            // if the _uuid reference works then we're good
            const { resourceType, id } = ReferenceParser.parseReference(reference.reference);
            if (!resourceType) {
                return reference;
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
            let foundInCache = false;
            if (uuid) {
                if (cache.has(uuid)) {
                    // uuid already exists so nothing to do for this reference
                    foundInCache = true;
                    if (this.cacheHits.has(referenceCollectionName)) {
                        this.cacheHits.set(referenceCollectionName, this.cacheHits.get(referenceCollectionName) + 1);
                    } else {
                        this.cacheHits.set(referenceCollectionName, 1);
                    }
                }
            }
            if (!foundInCache) {
                // find a match on _sourceId and _sourceAssigningAuthority
                for (const { _uuid, _sourceId, _sourceAssigningAuthority } of cache.values()) {
                    if (_sourceId === id) { // if source id matches then use that uuid and sourceAssigningAuthority
                        // save this uuid in reference
                        reference.reference = ReferenceParser.createReference(
                            {
                                resourceType,
                                id,
                                sourceAssigningAuthority: _sourceAssigningAuthority
                            }
                        );
                        reference._sourceAssigningAuthority = _sourceAssigningAuthority;
                        reference._uuid = `${resourceType}/${_uuid}`;
                        if (reference.extension) {
                            const uuidExtension = reference.extension.find(e => e.id === 'uuid');
                            if (uuidExtension) {
                                uuidExtension.valueString = reference._uuid;
                            }
                            const sourceAssigningAuthorityExtension = reference.extension.find(
                                e => e.id === 'sourceAssigningAuthority');
                            if (sourceAssigningAuthorityExtension) {
                                sourceAssigningAuthorityExtension.valueString = reference._sourceAssigningAuthority;
                            }
                        }
                        foundInCache = true;
                        if (this.cacheHits.has(referenceCollectionName)) {
                            this.cacheHits.set(referenceCollectionName, this.cacheHits.get(referenceCollectionName) + 1);
                        } else {
                            this.cacheHits.set(referenceCollectionName, 1);
                        }
                        break;
                    }
                }
            }

            if (!foundInCache) {
                if (this.cacheMisses.has(referenceCollectionName)) {
                    this.cacheMisses.set(referenceCollectionName, this.cacheMisses.get(referenceCollectionName) + 1);
                } else {
                    this.cacheMisses.set(referenceCollectionName, 1);
                }

                /**
                 * @type {DatabaseQueryManager}
                 */
                const referencedResourceQueryManager = databaseQueryFactory.createQuery({
                    resourceType,
                    base_version: VERSIONS['4_0_0']
                });
                /**
                 * @type {Resource|null}
                 */
                let doc;
                if (uuid) {
                    doc = await referencedResourceQueryManager.findOneAsync(
                        {
                            query: {
                                _uuid: uuid
                            },
                            options: {
                                projection: {
                                    _id: 0,
                                    _uuid: 1
                                }
                            }
                        }
                    );
                }
                if (doc) {
                    // just add to cache and keep going
                    if (!cache.has(uuid)) {
                        cache.set(uuid, {
                            _uuid: uuid,
                            _sourceId: null,
                            _sourceAssigningAuthority: null
                        });
                    }
                } else {
                    doc = await referencedResourceQueryManager.findOneAsync(
                        {
                            query: {
                                _sourceId: id
                            },
                            options: {
                                projection: {
                                    _id: 0,
                                    _sourceAssigningAuthority: 1
                                }
                            }
                        }
                    );
                    if (doc) {
                        reference.reference = ReferenceParser.createReference(
                            {
                                resourceType,
                                id,
                                sourceAssigningAuthority: doc._sourceAssigningAuthority
                            }
                        );
                        reference._sourceAssigningAuthority = doc._sourceAssigningAuthority;
                        const newUUID = generateUUIDv5(`${id}|${reference._sourceAssigningAuthority}`);
                        reference._uuid = `${resourceType}/${newUUID}`;
                        if (reference.extension) {
                            const uuidExtension = reference.extension.find(e => e.id === 'uuid');
                            if (uuidExtension) {
                                uuidExtension.valueString = reference._uuid;
                            }
                            const sourceAssigningAuthorityExtension = reference.extension.find(
                                e => e.id === 'sourceAssigningAuthority');
                            if (sourceAssigningAuthorityExtension) {
                                sourceAssigningAuthorityExtension.valueString = reference._sourceAssigningAuthority;
                            }
                        }

                        if (!cache.has(reference._uuid)) {
                            cache.set(reference._uuid, {
                                _uuid: reference._uuid,
                                _sourceId: id,
                                _sourceAssigningAuthority: reference._sourceAssigningAuthority
                            });
                        }
                    }
                }
                if (!doc) {
                    if (!this.resourcesNotFound.has(referenceCollectionName)) {
                        this.resourcesNotFound.set(referenceCollectionName, []);
                    }
                    this.resourcesNotFound.get(referenceCollectionName).push(
                        id
                    );
                }
            }
            return reference;
        } catch (e) {
            throw new RethrownError(
                {
                    message: 'Error processing reference',
                    error: e,
                    args: {
                        reference
                    },
                    source: 'FixReferenceSourceAssigningAuthorityRunner.updateReferenceAsync'
                }
            );
        }
    }

    /**
     * returns the bulk operation for this doc
     * @param {import('mongodb').DefaultSchema} doc
     * @returns {Promise<(import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>)[]>}
     */
    async processRecordAsync (doc) {
        try {
            const operations = [];
            /**
             * @type {Resource}
             */
            let resource = FhirResourceCreator.create(doc);

            /**
             * @type {Resource}
             */
            const currentResource = resource.clone();

            resource = await this.preSaveManager.preSaveAsync(resource);

            await resource.updateReferencesAsync(
                {
                    fnUpdateReferenceAsync: async (reference) => await this.updateReferenceAsync(
                        reference,
                        this.databaseQueryFactory
                    )
                }
            );

            // for speed, first check if the incoming resource is exactly the same
            const updatedResourceJsonInternal = resource.toJSONInternal();
            const currentResourceJsonInternal = currentResource.toJSONInternal();
            if (deepEqual(updatedResourceJsonInternal, currentResourceJsonInternal) === true) {
                // console.log('No change detected for ');
                return operations;
            }

            /**
             * @type {import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>}
             */
            // batch up the calls to update
            resource.meta.lastUpdated = new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ssZ'));
            if (this.properties && this.properties.length > 0) {
                const { patches } = await this.resourceMerger.mergeResourceAsync({
                    currentResource,
                    resourceToMerge: resource,
                    smartMerge: false,
                    limitToPaths: this.properties.map(p => `/${p}`)
                });
                const updateOperation = MongoJsonPatchHelper.convertJsonPatchesToMongoUpdateCommand({ patches });
                if (Object.keys(updateOperation).length > 0) {
                    operations.push({
                        updateOne: {
                            filter: {
                                _id: doc._id
                            },
                            update: updateOperation
                        }
                    });
                }
            } else {
                const result = { replaceOne: { filter: { _id: doc._id }, replacement: resource.toJSONInternal() } };
                operations.push(result);
            }

            return operations;
        } catch (e) {
            throw new RethrownError(
                {
                    message: 'Error processing record',
                    error: e,
                    args: {
                        resource: doc
                    },
                    source: 'FixReferenceSourceAssigningAuthorityRunner.processRecordAsync'
                }
            );
        }
    }

    /**
     * Runs a loop to process all the documents
     * @returns {Promise<void>}
     */
    async processAsync () {
        // noinspection JSValidateTypes
        try {
            if (this.collections.length > 0 && this.collections[0] === 'all') {
                /**
                 * @type {string[]}
                 */
                this.collections = (await this.getAllCollectionNamesAsync(
                        {
                            useAuditDatabase: false,
                            includeHistoryCollections: false
                        }
                    )
                );
                this.collections = this.collections.sort();
                if (this.startFromCollection) {
                    this.collections = this.collections.filter(c => c >= this.startFromCollection);
                }
            }

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

            console.log(`Starting loop for ${this.collections.join(',')}. useTransaction: ${this.useTransaction}`);

            // if there is an exception, continue processing from the last id
            for (const collectionName of this.collections) {
                this.startFromIdContainer.startFromId = '';
                /**
                 * @type {import('mongodb').Filter<import('mongodb').Document>}
                 */
                let query = this.afterLastUpdatedDate ? {
                    'meta.lastUpdated': {
                        $gt: this.afterLastUpdatedDate
                    }
                } : this.properties && this.properties.length > 0
                    ? getFilter(this.properties.concat(this.filterToRecordsWithFields || []))
                    : getFilter(this.filterToRecordsWithFields);

                if (this.startFromId) {
                    const startId = isValidMongoObjectId(this.startFromId) ? new ObjectId(this.startFromId) : this.startFromId;
                    if (Object.keys(query) > 0) {
                        // noinspection JSValidateTypes
                        query = {
                            $and: [
                                query,
                                {
                                    _id: {
                                        $gte: startId
                                    }
                                }
                            ]
                        };
                    } else {
                        query = {
                            _id: {
                                $gte: startId
                            }
                        };
                    }
                }
                // const personCache = this.getCacheForResourceType(
                //     {
                //         collectionName: 'Person_4_0_0'
                //     }
                // );
                // /**
                //  * @type {string[]}
                //  */
                // const uuidList = Array.from(personCache.keys());

                try {
                    console.log(`query: ${mongoQueryStringify(query)}`);
                    await this.runForQueryBatchesAsync(
                        {
                            config: mongoConfig,
                            sourceCollectionName: collectionName,
                            destinationCollectionName: collectionName,
                            query,
                            projection: this.properties ? getProjection(this.properties) : undefined,
                            startFromIdContainer: this.startFromIdContainer,
                            fnCreateBulkOperationAsync: async (doc) => await this.processRecordAsync(doc),
                            ordered: false,
                            batchSize: this.batchSize,
                            skipExistingIds: false,
                            limit: this.limit,
                            useTransaction: this.useTransaction,
                            skip: this.skip
                            // filterToIdProperty: '_uuid',
                            // filterToIds: uuidList
                        }
                    );
                } catch (e) {
                    console.error(e);
                    console.log(`Got error ${e}.  At ${this.startFromIdContainer.startFromId}`);
                }
                console.log(`Finished loop ${collectionName}`);
                console.log(`Cache hits in ${this.cacheHits.size} collections`);
                for (const [cacheCollectionName, cacheCount] of this.cacheHits.entries()) {
                    console.log(`${cacheCollectionName} hits: ${cacheCount}`);
                }
                console.log(`Cache misses in ${this.cacheMisses.size} collections`);
                for (const [cacheCollectionName, cacheCount] of this.cacheMisses.entries()) {
                    console.log(`${cacheCollectionName} misses: ${cacheCount}`);
                }
                console.log(`Resources not found in ${this.resourcesNotFound.size} collections`);
                for (const [cacheCollectionName, resourceIds] of this.resourcesNotFound.entries()) {
                    console.log(`${cacheCollectionName} not found (${resourceIds.length}): ${resourceIds.join(',')}`);
                }
            }
            console.log('Finished script');
            console.log('Shutting down');
            await this.shutdown();
            console.log('Shutdown finished');
        } catch (e) {
            console.log(`ERROR: ${e}`);
        }
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
                _sourceId: 1,
                _sourceAssigningAuthority: 1
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
                        _sourceId: doc._sourceId,
                        _sourceAssigningAuthority: doc._sourceAssigningAuthority
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
}

module.exports = {
    FixReferenceSourceAssigningAuthorityRunner
};
