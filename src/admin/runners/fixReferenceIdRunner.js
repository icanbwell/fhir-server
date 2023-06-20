const {BaseBulkOperationRunner} = require('./baseBulkOperationRunner');
const {assertTypeEquals} = require('../../utils/assertType');
const {PreSaveManager} = require('../../preSaveHandlers/preSave');
const {VERSIONS} = require('../../middleware/fhir/utils/constants');
const {ReferenceParser} = require('../../utils/referenceParser');
const {DatabaseQueryFactory} = require('../../dataLayer/databaseQueryFactory');
const deepEqual = require('fast-deep-equal');
const moment = require('moment-timezone');
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
 * converts list of properties to a projection
 * @param {string[]} properties
 * @return {import('mongodb').Document}
 */
function getProjection(properties) {
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
function getFilter(properties,) {
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
     * @param {string[]} preloadCollections
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
         * @type {Map<string, Map<string, string>>}
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
    async updateReferenceAsync(reference, databaseQueryFactory) {
        try {
            assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);
            if (!reference.reference) {
                return reference;
            }

            // if the _uuid reference works then we're good
            const {resourceType} = ReferenceParser.parseReference(reference.reference);
            if (!resourceType) {
                return reference;
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
            const oldReference = reference.reference;

            if (cache.has(oldReference)) {
                foundInCache = true;
                if (this.cacheHits.has(referenceCollectionName)) {
                    this.cacheHits.set(referenceCollectionName, this.cacheHits.get(referenceCollectionName) + 1);
                } else {
                    this.cacheHits.set(referenceCollectionName, 1);
                }

                if (reference._sourceId) {
                    reference._sourceId = cache.get(oldReference);
                }
                if (reference.extension) {
                    for (let element of reference.extension) {
                        if (element.id === 'sourceId') {
                            element.valueString = cache.get(oldReference).split('|')[0];
                        }
                    }
                }
                reference.reference = cache.get(oldReference);
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
     * returns the bulk operation for this doc
     * @param {import('mongodb').DefaultSchema} doc
     * @returns {Promise<(import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>)[]>}
     */
    async processRecordAsync(doc) {
        try {
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
     * returns the bulk operation for this doc
     * @param {import('mongodb').DefaultSchema} doc
     * @returns {Promise<(import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>)[]>}
     */
    async updateIdAsync(doc) {
        try {
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

            const originalId = this.getOriginalId({ doc: isHistoryDoc ? doc.resource : doc});

            resource.id = originalId;
            resource._sourceId = originalId;

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
                    source: 'FixReferenceIdRunner.updateIdAsync'
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

            for (const preloadCollection of this.preloadCollections) {
                console.log(`Preloading collection: ${preloadCollection}`);
                // preload person table
                await this.preloadReferencesAsync({
                    mongoConfig,
                    collectionName: preloadCollection
                });

                const count = this.getCacheForReference({collectionName: preloadCollection}).size;

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
                        $gt: this.afterLastUpdatedDate,
                    }
                } : this.properties && this.properties.length > 0 ?
                    getFilter(this.properties.concat(this.filterToRecordsWithFields || [])) :
                    getFilter(this.filterToRecordsWithFields);

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

                const resourceName = collectionName.replace('_4_0_0', '').replace('_History', '');
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
                        console.log(`query: ${mongoQueryStringify(query)}`);
                        await this.runForQueryBatchesAsync(
                            {
                                config: mongoConfig,
                                sourceCollectionName: collectionName,
                                destinationCollectionName: collectionName,
                                query: query,
                                projection: this.properties ? getProjection(this.properties) : undefined,
                                startFromIdContainer: this.startFromIdContainer,
                                fnCreateBulkOperationAsync: async (doc) => await this.processRecordAsync(doc),
                                ordered: false,
                                batchSize: this.batchSize,
                                skipExistingIds: false,
                                limit: this.limit,
                                useTransaction: this.useTransaction,
                                skip: this.skip,
                                referenceFieldNames
                                // filterToIdProperty: '_uuid',
                                // filterToIds: uuidList
                            }
                        );

                    } catch (e) {
                        console.error(e);
                        console.log(`Got error ${e}.  At ${this.startFromIdContainer.startFromId}`);
                    }
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

            // changing the id of the resources
            for (const collectionName of this.preloadCollections) {
                this.startFromIdContainer.startFromId = '';
                /**
                 * @type {import('mongodb').Filter<import('mongodb').Document>}
                 */
                let query = this.afterLastUpdatedDate ? {
                    'meta.lastUpdated': {
                        $gt: this.afterLastUpdatedDate,
                    }
                } : this.properties && this.properties.length > 0 ?
                    getFilter(this.properties.concat(this.filterToRecordsWithFields || [])) :
                    getFilter(this.filterToRecordsWithFields);

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

                if (Object.keys(query).length) {
                    query = {
                        $and: [
                            query,
                            {[isHistoryCollection ? 'resource._sourceId' : '_sourceId']: {$type: 2, $regex: /^.{63,}$/}},
                            {[isHistoryCollection ? 'resource.meta.security' : 'meta.security']: {$elemMatch: {code: 'proa'}}}
                        ]
                    };
                } else {
                    query = {
                        $and: [
                            {[isHistoryCollection ? 'resource._sourceId' : '_sourceId']: {$type: 2, $regex: /^.{63,}$/}},
                            {[isHistoryCollection ? 'resource.meta.security' : 'meta.security']: {$elemMatch: {code: 'proa'}}}
                        ]
                    };
                }


                if (Object.keys(query).length) {
                    try {
                        console.log(`query: ${mongoQueryStringify(query)}`);
                        await super.runForQueryBatchesAsync(
                            {
                                config: mongoConfig,
                                sourceCollectionName: collectionName,
                                destinationCollectionName: collectionName,
                                query: query,
                                projection: this.properties ? getProjection(this.properties) : undefined,
                                startFromIdContainer: this.startFromIdContainer,
                                fnCreateBulkOperationAsync: async (doc) => await this.updateIdAsync(doc),
                                ordered: false,
                                batchSize: this.batchSize,
                                skipExistingIds: false,
                                limit: this.limit,
                                useTransaction: this.useTransaction,
                                skip: this.skip,
                                // filterToIdProperty: '_uuid',
                                // filterToIds: uuidList
                            }
                        );

                    } catch (e) {
                        console.error(e);
                        console.log(`Got error ${e}.  At ${this.startFromIdContainer.startFromId}`);
                    }
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
     * Adding indexes to the collection to speed up execution and then removing the indexes
     * @param {string[]} referenceFieldNames
     * @param {Object} args
     */
    async runForQueryBatchesAsync({ referenceFieldNames, ...args}) {
        let {
            sourceCollection
        } = await this.createConnectionAsync({
            config: args.config,
            destinationCollectionName: args.destinationCollectionName,
            sourceCollectionName: args.sourceCollectionName
        });

        let indexNames = [];
        // adding the indexes
        if (referenceFieldNames && referenceFieldNames.length) {
            const indexes = [];
            referenceFieldNames.forEach(referenceField => {
                const indexFieldName = `${referenceField}.reference`;
                indexes.push({
                    key: {[indexFieldName]: 1},
                    name: `fixReferenceScript_${indexFieldName}`
                });
            });
            this.adminLogger.logInfo(`Creating reference indexes for ${referenceFieldNames}`);
            indexNames = await sourceCollection.createIndexes(indexes);
            this.adminLogger.logInfo(`Created reference indexes ${indexNames}`);
        }

        // running parents runForQueryBatchesAsync
        await super.runForQueryBatchesAsync(args);

        // removing the indexes
        if (indexNames && indexNames.length){
            for (const indexName of indexNames) {
                this.adminLogger.logInfo(`Removing index ${indexName}`);
                await sourceCollection.dropIndex(indexName);
                this.adminLogger.logInfo(`Removed index ${indexName}`);
            }
        }
    }

    /**
     * preloads the references into cache
     * @param mongoConfig
     * @param {string} collectionName
     * @return {Promise<void>}
     */
    async preloadReferencesAsync({mongoConfig, collectionName}) {
        let {
            sourceCollection
        } = await this.createConnectionAsync(
            {
                config: mongoConfig,
                sourceCollectionName: collectionName,
                destinationCollectionName: collectionName
            }
        );

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
        const cursor = sourceCollection.find({
            $and: [
                {[isHistoryCollection ? 'resource._sourceId' : '_sourceId']: {$type: 2, $regex: /^.{63,}$/}},
                {[isHistoryCollection ? 'resource.meta.security' : 'meta.security']: {$elemMatch: {code: 'proa'}}}
            ]
        }).project(projection);

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
     * Caches old and new references
     * @param {Resource} doc
     * @param {string} collectionName
     */
    cacheReferenceFromResource({doc, collectionName}) {
        const originalId = this.getOriginalId({doc});

        collectionName = collectionName.replace('_History', '').replace('_4_0_0', '');

        if (originalId && doc._sourceId !== originalId) {
            this.getCacheForReference({collectionName}).set(
                `${collectionName}/${doc._sourceId}`,
                `${collectionName}/${originalId}`
            );

            this.getCacheForReference({collectionName}).set(
                `${collectionName}/${doc._sourceId}|proa`,
                `${collectionName}/${originalId}|proa`
            );
        }
    }

    /**
     * Gets cache for reference
     * @param {string} collectionName
     * @return {Map<string, Map<string, string>>}
     */
    getCacheForReference({collectionName}) {
        collectionName = collectionName.replace('_History', '').replace('_4_0_0', '');

        if (!this.caches.has(collectionName)) {
            this.caches.set(collectionName, new Map());
        }
        return this.caches.get(collectionName);
    }
}

module.exports = {
    FixReferenceIdRunner
};
