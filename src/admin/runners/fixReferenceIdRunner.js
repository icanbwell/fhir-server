const {BaseBulkOperationRunner} = require('./baseBulkOperationRunner');
const {assertTypeEquals} = require('../../utils/assertType');
const {PreSaveManager} = require('../../preSaveHandlers/preSave');
const {VERSIONS} = require('../../middleware/fhir/utils/constants');
const {ReferenceParser} = require('../../utils/referenceParser');
const {DatabaseQueryFactory} = require('../../dataLayer/databaseQueryFactory');
const deepEqual = require('fast-deep-equal');
const moment = require('moment-timezone');
const {generateUUIDv5} = require('../../utils/uid.util');
const { isValidMongoObjectId } = require('../../utils/mongoIdValidator');
const {ResourceLocatorFactory} = require('../../operations/common/resourceLocatorFactory');
const {FhirResourceCreator} = require('../../fhir/fhirResourceCreator');
const {ResourceMerger} = require('../../operations/common/resourceMerger');
const {RethrownError} = require('../../utils/rethrownError');
const {mongoQueryStringify} = require('../../utils/mongoQueryStringify');
const { ObjectId } = require('mongodb');
const {searchParameterQueries} = require('../../searchParameters/searchParameters');
const referenceCollections = require('../utils/referenceCollections.json');

/**
 * @classdesc Finds proa resources whose id needs to be changed and changes the id along with its references
 */
class FixReferenceIdRunner extends BaseBulkOperationRunner {
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
     * @param {string[]} proaCollections
     * @param {number|undefined} [limit]
     * @param {string[]|undefined} [properties]
     * @param {ResourceMerger} resourceMerger
     * @param {boolean|undefined} [useTransaction]
     * @param {number|undefined} [skip]
     * @param {string[]|undefined} [filterToRecordsWithFields]
     * @param {string|undefined} [startFromId]
     */
    constructor(
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
            proaCollections,
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
        this.proaCollections = proaCollections;

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
         * caches currentReference with newReference collectionWise
         * @type {Map<string, Map<string, string>>}
         */
        this.caches = new Map();

        /**
         * caches currentId with newUuid
         */
        this.uuidCache = new Map();

        /**
         * @type {Map<string, number>}
         */
        this.cacheHits = new Map();
        /**
         * @type {Map<string, number>}
         */
        this.cacheMisses = new Map();
    }

    /**
     * converts list of properties to a projection
     * @param {string[]} properties
     * @return {import('mongodb').Filter<import('mongodb').Document>}
     */
    // eslint-disable-next-line no-unused-vars
    getFilter(properties) {
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
     * converts list of properties to a projection
     * @return {import('mongodb').Document}
     */
    getProjection() {
        /**
         * @type {import('mongodb').Document}
         */
        const projection = {};
        for (const property of this.properties) {
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
     * Updates the reference if it is present in cache
     * @param {Reference} reference
     * @param {DatabaseQueryFactory} databaseQueryFactory
     * @return {Promise<Reference>}
     */
    async updateReferenceAsync(reference, databaseQueryFactory) {
        try {
            assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);
            if (!reference.reference) {
                return reference;
            }

            // if the _uuid reference works then we're good
            const {resourceType, id} = ReferenceParser.parseReference(reference.reference);
            if (!resourceType) {
                return reference;
            }

            /**
             * @type {string}
             */
            let uuid;
            if (reference._uuid) {
                ({id: uuid} = ReferenceParser.parseReference(reference._uuid));
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
            const referenceCollectionName = (await resourceLocator.getFirstCollectionNameForQueryDebugOnlyAsync(
                {
                    query: {}
                }
            )).replace('_4_0_0', '');

            // first check in cache
            /**
             * @type {Map<string, string>}
             */
            const cache = this.getCacheForReference({ collectionName: referenceCollectionName });

            let foundInCache = false;
            const currentReference = `${resourceType}/${id}`;
            let uuidReference;
            if (uuid) {
                uuidReference = `${resourceType}/${uuid}`;
            }

            if (cache.has(currentReference)) {
                const newReference = cache.get(currentReference);
                const newUuidReference = `${resourceType}/${this.uuidCache.get(id)}`;

                foundInCache = true;
                if (this.cacheHits.has(referenceCollectionName)) {
                    this.cacheHits.set(referenceCollectionName, this.cacheHits.get(referenceCollectionName) + 1);
                } else {
                    this.cacheHits.set(referenceCollectionName, 1);
                }

                if (reference._sourceId) {
                    reference._sourceId = reference._sourceId.replace(currentReference, newReference);
                }
                if (reference._uuid) {
                    reference._uuid = reference._uuid.replace(uuidReference, newUuidReference);
                }
                if (reference.extension) {
                    for (let element of reference.extension) {
                        if (element.id === 'sourceId') {
                            element.valueString = element.valueString.replace(currentReference, newReference);
                        }
                        if (element.id === 'uuid') {
                            element.valueString = element.valueString.replace(uuidReference, newUuidReference);
                        }
                    }
                }
                reference.reference = reference.reference.replace(currentReference, newReference);
            }

            if (!foundInCache) {
                if (this.cacheMisses.has(referenceCollectionName)) {
                    this.cacheMisses.set(referenceCollectionName, this.cacheMisses.get(referenceCollectionName) + 1);
                } else {
                    this.cacheMisses.set(referenceCollectionName, 1);
                }
            }
            return reference;
        } catch (e) {
            throw new RethrownError(
                {
                    message: 'Error processing reference',
                    error: e,
                    args: {
                        reference: reference
                    },
                    source: 'FixReferenceIdRunner.updateReferenceAsync'
                }
            );
        }
    }

    /**
     * Updates the references of the resource
     * @param {Resource} resource
     * @returns {Promise<Resource>}
     */
    async updateRecordReferencesAsync(resource) {
        await resource.updateReferencesAsync(
            {
                fnUpdateReferenceAsync: async (reference) => await this.updateReferenceAsync(
                    reference,
                    this.databaseQueryFactory
                )
            }
        );

        return resource;
    }

    /**
     * Updates the id, uuid, and sourceId of the resource provided
     * @param {Resource} resource
     * @returns {Promise<Resource>}
     */
    async updateRecordIdAsync(resource) {
        const originalId = this.getOriginalId({doc: resource});
        const currentId = this.getCurrentId({originalId, _sourceAssigningAuthority: resource._sourceAssigningAuthority});
        const newUuid = this.uuidCache.get(currentId);

        if (currentId === resource._sourceId) {
            resource.id = originalId;
            resource._sourceId = originalId;
            resource._uuid = newUuid;

            if (resource.identifier) {
                for (let identifier of resource.identifier) {
                    if (identifier.id === 'sourceId') {
                        identifier.value = originalId;
                    }
                    if (identifier.id === 'uuid') {
                        identifier.value = newUuid;
                    }
                }
            }
        }
        return resource;
    }

    /**
     * returns the bulk operation for this doc
     * @param {import('mongodb').DefaultSchema} doc
     * @param {function(resource: Resource):Promise<Resource>}
     * @returns {Promise<(import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>)[]>}
     */
    async processRecordAsync(doc, updateRecord) {
        try {
            /**
             * @type {boolean}
             */
            const isHistoryDoc = Boolean(doc.resource);

            const operations = [];
            /**
             * @type {Resource}
             */
            let resource = FhirResourceCreator.create(isHistoryDoc ? doc.resource : doc);

            /**
             * @type {Resource}
             */
            const currentResource = resource.clone();

            resource = await updateRecord.call(this, resource);

            // for speed, first check if the incoming resource is exactly the same
            const updatedResourceJsonInternal = resource.toJSONInternal();
            const currentResourceJsonInternal = currentResource.toJSONInternal();
            if (deepEqual(updatedResourceJsonInternal, currentResourceJsonInternal) === true) {
                // this.adminLogger.logInfo('No change detected for ');
                return operations;
            }

            /**
             * @type {import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>}
             */
            // batch up the calls to update
            resource.meta.lastUpdated = new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ssZ'));
            const result = {
                replaceOne: {filter: {_id: doc._id},
                replacement: isHistoryDoc ? { ...doc, resource: resource.toJSONInternal() }
                    : resource.toJSONInternal()}
            };

            operations.push(result);

            return operations;
        } catch (e) {
            throw new RethrownError(
                {
                    message: 'Error processing record',
                    error: e,
                    args: {
                        resource: doc
                    },
                    source: 'FixReferenceIdRunner.processRecordAsync'
                }
            );
        }
    }

    /**
     * Runs a loop to process all the documents
     * @returns {Promise<void>}
     */
    async processAsync() {
        // noinspection JSValidateTypes
        try {
            if (this.collections.length > 0 && this.collections[0] === 'all') {
                /**
                 * @type {string[]}
                 */
                this.collections = (await this.getAllCollectionNamesAsync(
                        {
                            useAuditDatabase: false,
                            includeHistoryCollections: true
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

            for (const proaCollection of this.proaCollections) {
                this.adminLogger.logInfo(`Caching collection references: ${proaCollection}`);
                // preload person table
                await this.cacheReferencesAsync({
                    mongoConfig,
                    collectionName: proaCollection
                });

                const count = this.getCacheForReference({collectionName: proaCollection}).size;

                this.adminLogger.logInfo(`Done caching collection references: ${proaCollection}: ${count}`);
            }

            this.adminLogger.logInfo(`Starting loop for ${this.collections.join(',')}. useTransaction: ${this.useTransaction}`);

            // if there is an exception, continue processing from the last id
            for (const collectionName of this.collections) {
                this.startFromIdContainer.startFromId = '';
                /**
                 * @type {import('mongodb').Filter<import('mongodb').Document>}
                 */
                let query = this.afterLastUpdatedDate ? {
                    'meta.lastUpdated': {
                        $gt: this.afterLastUpdatedDate,
                    }
                } : this.properties && this.properties.length > 0 ?
                    this.getFilter(this.properties.concat(this.filterToRecordsWithFields || [])) :
                    this.getFilter(this.filterToRecordsWithFields);

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

                const resourceName = collectionName.split('_')[0];
                /**
                 * @type {Set<String>}
                 */
                let referenceFieldNames = new Set();
                const resourceObj = searchParameterQueries[`${resourceName}`];
                if (resourceObj) {
                    for (const propertyObj of Object.values(resourceObj)) {
                        if (propertyObj.type === 'reference') {
                            for (const field of propertyObj.fields){
                                referenceFieldNames.add(field);
                            }
                        }
                    }
                }

                if (referenceFieldNames && referenceFieldNames.size) {
                    referenceFieldNames = Array.from(referenceFieldNames);
                    const referenceFieldQuery = [];

                    referenceFieldNames.forEach(referenceFieldName => {
                        const fieldName = collectionName.includes('History') ?
                            `resource.${referenceFieldName}.reference`
                            : `${referenceFieldName}.reference`;

                        for (let key of this.caches.keys()) {
                            if (referenceCollections[String(key)] && referenceCollections[String(key)].includes(resourceName)) {
                                const references = Array.from(this.caches.get(key), value => value[0]);

                                if (references.length) {
                                    referenceFieldQuery.push({ [fieldName]: {
                                        $in: references
                                    }});
                                }
                            }
                        }
                    });

                    if (referenceFieldQuery.length) {
                        query = Object.keys(query).length ? {
                            $and: [
                                query,
                                { $or: referenceFieldQuery }
                            ],
                        } : { $or: referenceFieldQuery };
                    }
                }

                if (Object.keys(query).length) {
                    try {
                        await this.runForQueryBatchesAsync({
                            config: mongoConfig,
                            sourceCollectionName: collectionName,
                            destinationCollectionName: collectionName,
                            query,
                            projection: this.properties ? this.getProjection() : undefined,
                            startFromIdContainer: this.startFromIdContainer,
                            fnCreateBulkOperationAsync: async (doc) =>
                                await this.processRecordAsync(doc, this.updateRecordReferencesAsync),
                            ordered: false,
                            batchSize: this.batchSize,
                            skipExistingIds: false,
                            limit: this.limit,
                            useTransaction: this.useTransaction,
                            skip: this.skip,
                            referenceFieldNames
                            // filterToIdProperty: '_uuid',
                            // filterToIds: uuidList
                        });

                    } catch (e) {
                        this.adminLogger.logError(`Got error ${e}.  At ${this.startFromIdContainer.startFromId}`);
                    }
                }
                this.adminLogger.logInfo(`Finished loop ${collectionName}`);
                this.adminLogger.logInfo(`Cache hits in ${this.cacheHits.size} collections`);
                for (const [cacheCollectionName, cacheCount] of this.cacheHits.entries()) {
                    this.adminLogger.logInfo(`${cacheCollectionName} hits: ${cacheCount}`);
                }
                this.adminLogger.logInfo(`Cache misses in ${this.cacheMisses.size} collections`);
                for (const [cacheCollectionName, cacheCount] of this.cacheMisses.entries()) {
                    this.adminLogger.logInfo(`${cacheCollectionName} misses: ${cacheCount}`);
                }
            }

            // changing the id of the resources
            for (const collectionName of this.proaCollections) {
                this.startFromIdContainer.startFromId = '';
                /**
                 * @type {import('mongodb').Filter<import('mongodb').Document>}
                 */
                let query = this.afterLastUpdatedDate ? {
                    'meta.lastUpdated': {
                        $gt: this.afterLastUpdatedDate,
                    }
                } : this.properties && this.properties.length > 0 ?
                    this.getFilter(this.properties.concat(this.filterToRecordsWithFields || [])) :
                    this.getFilter(this.filterToRecordsWithFields);

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

                const isHistoryCollection = collectionName.includes('History');

                const filterQuery = [
                    {[isHistoryCollection ? 'resource.meta.security' : 'meta.security']: {$elemMatch: {code: 'proa'}}}
                ];

                if (Object.keys(query).length) {
                    query = {
                        $and: [query, ...filterQuery]
                    };
                } else {
                    query = {
                        $and: filterQuery
                    };
                }


                if (Object.keys(query).length) {
                    try {
                        this.adminLogger.logInfo(`query: ${mongoQueryStringify(query)}`);
                        await super.runForQueryBatchesAsync({
                            config: mongoConfig,
                            sourceCollectionName: collectionName,
                            destinationCollectionName: collectionName,
                            query,
                            projection: this.properties ? this.getProjection() : undefined,
                            startFromIdContainer: this.startFromIdContainer,
                            fnCreateBulkOperationAsync: async (doc) =>
                                await this.processRecordAsync(doc, this.updateRecordIdAsync),
                            ordered: false,
                            batchSize: this.batchSize,
                            skipExistingIds: false,
                            limit: this.limit,
                            useTransaction: this.useTransaction,
                            skip: this.skip,
                        });

                    } catch (e) {
                        this.adminLogger.logError(`Got error ${e}.  At ${this.startFromIdContainer.startFromId}`);
                    }
                }
                this.adminLogger.logInfo(`Finished loop ${collectionName}`);
                this.adminLogger.logInfo(`Cache hits in ${this.cacheHits.size} collections`);
                for (const [cacheCollectionName, cacheCount] of this.cacheHits.entries()) {
                    this.adminLogger.logInfo(`${cacheCollectionName} hits: ${cacheCount}`);
                }
                this.adminLogger.logInfo(`Cache misses in ${this.cacheMisses.size} collections`);
                for (const [cacheCollectionName, cacheCount] of this.cacheMisses.entries()) {
                    this.adminLogger.logInfo(`${cacheCollectionName} misses: ${cacheCount}`);
                }
            }

            this.adminLogger.logInfo('Finished script');
            this.adminLogger.logInfo('Shutting down');
            await this.shutdown();
            this.adminLogger.logInfo('Shutdown finished');
        } catch (e) {
            this.adminLogger.logError(`ERROR: ${e}`);
        }
    }

    /**
     * Adding indexes to the collection to speed up execution and then removing the indexes
     * @param {string[]} referenceFieldNames
     * @param {Object} args
     */
    async runForQueryBatchesAsync({ referenceFieldNames, ...args}) {
        const collection = await this.createSingeConnectionAsync({
            mongoConfig: args.config, collectionName: args.sourceCollectionName
        });

        let indexNames = [];
        try {
            // adding the indexes
            if (referenceFieldNames && referenceFieldNames.length) {
                const indexes = [];
                referenceFieldNames.forEach(referenceField => {
                    const indexFieldName = `${referenceField}.reference`;
                    indexes.push({
                        key: {[indexFieldName]: 1, '_sourceId': 1},
                        name: `fixReferenceIdScript_${indexFieldName}`
                    });
                });
                this.adminLogger.logInfo(`Creating reference indexes for ${referenceFieldNames}`);
                indexNames = await collection.createIndexes(indexes);
                this.adminLogger.logInfo(`Created reference indexes ${indexNames}`);
            }
            // running parents runForQueryBatchesAsync
            await super.runForQueryBatchesAsync(args);
        } finally {
            // removing the indexes
            if (indexNames && indexNames.length){
                for (const indexName of indexNames) {
                    this.adminLogger.logInfo(`Removing index ${indexName}`);
                    await collection.dropIndex(indexName);
                    this.adminLogger.logInfo(`Removed index ${indexName}`);
                }
            }
        }
    }

    /**
     * Creates a single connection and returns the collection instance
     * @param {require('mongodb').mongoConfig} mongoConfig
     * @param {string} collectionName
     * @returns {Promise<require('mongodb').collection>}
     */
    async createSingeConnectionAsync({mongoConfig, collectionName}) {
        /**
         * @type {require('mongodb').MongoClient}
         */
        const client = await this.mongoDatabaseManager.createClientAsync(mongoConfig);

        /**
         * @type {require('mongodb').db}
         */
        const db = client.db(mongoConfig.db_name);

        /**
         * @type {require('mongodb').collection}
         */
        const collection = db.collection(collectionName);

        return collection;
    }

    /**
     * Creates oldReference to newReference mapping collectionwise
     * @param {require('mongodb').mongoConfig} mongoConfig
     * @param {string} collectionName
     * @return {Promise<void>}
     */
    async cacheReferencesAsync({mongoConfig, collectionName}) {
        /**
         * @type {require('mongodb').collection}
         */
        const collection = await this.createSingeConnectionAsync({mongoConfig, collectionName});

        /**
         * @type {boolean}
         */
        const isHistoryCollection = collectionName.includes('History');

        let projection = {
            _id: 0,
            _uuid: 1,
            _sourceId: 1,
            _sourceAssigningAuthority: 1,
            meta: {
                source: 1
            }
        };

        if (isHistoryCollection) {
            delete projection._id;

            projection = { _id: 0, resource: projection};
        }

        /**
         * @type {import('mongodb').FindCursor<import('mongodb').WithId<import('mongodb').Document>>}
         */
        const cursor = collection.find({
            $and: [
                {[isHistoryCollection ? 'resource.meta.security' : 'meta.security']: {$elemMatch: {code: 'proa'}}}
            ]
        }, {projection});

        while (await cursor.hasNext()) {
            /**
             * @type {import('mongodb').WithId<import('mongodb').Document>}
             */
            const doc = await cursor.next();

            this.cacheReferenceFromResource({
                doc: isHistoryCollection ? doc.resource : doc, collectionName
            });
        }
    }

    /**
     * Extracts id from document
     * @param {Resource} doc
     * @returns {string}
     */
    getOriginalId({doc}) {
        return doc.meta.source.split('/').pop();
    }

    /**
     * Created old if from original id
     * @param {string} originalId
     * @param {string} _sourceAssigningAuthority
     * @returns {string}
     */
    getCurrentId({originalId, _sourceAssigningAuthority}) {
        return (`${_sourceAssigningAuthority}-${originalId}`).slice(0, 63);
    }

    /**
     * Caches old and new references
     * @param {Resource} doc
     * @param {string} collectionName
     */
    cacheReferenceFromResource({doc, collectionName}) {
        // originating id with which to replace the current id
        /**
         * @type {string}
         */
        const originalId = this.getOriginalId({doc});
        // current id present in the resource
        /**
         * @type {string}
         */
        const currentId = this.getCurrentId({originalId, _sourceAssigningAuthority: doc._sourceAssigningAuthority});

        if (currentId === doc._sourceId) {
            collectionName = collectionName.split('_')[0];

            this.getCacheForReference({collectionName}).set(
                `${collectionName}/${doc._sourceId}`,
                `${collectionName}/${originalId}`
            );

            this.uuidCache.set(currentId, generateUUIDv5(`${originalId}|${doc._sourceAssigningAuthority}`));
        }
    }

    /**
     * Gets cache for reference
     * @param {string} collectionName
     * @return {Map<string, Map<string, string>>}
     */
    getCacheForReference({collectionName}) {
        collectionName = collectionName.split('_')[0];

        if (!this.caches.has(collectionName)) {
            this.caches.set(collectionName, new Map());
        }
        return this.caches.get(collectionName);
    }
}

module.exports = {
    FixReferenceIdRunner
};
