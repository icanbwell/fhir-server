const { BaseBulkOperationRunner } = require('./baseBulkOperationRunner');
const { assertTypeEquals } = require('../../utils/assertType');
const { PreSaveManager } = require('../../preSaveHandlers/preSave');
const { VERSIONS } = require('../../middleware/fhir/utils/constants');
const { ReferenceParser } = require('../../utils/referenceParser');
const { DatabaseQueryFactory } = require('../../dataLayer/databaseQueryFactory');
const deepEqual = require('fast-deep-equal');
const { generateUUIDv5 } = require('../../utils/uid.util');
const { isValidMongoObjectId } = require('../../utils/mongoIdValidator');
const { ResourceLocatorFactory } = require('../../operations/common/resourceLocatorFactory');
const { MongoJsonPatchHelper } = require('../../utils/mongoJsonPatchHelper');
const {compare} = require('fast-json-patch');
const { FhirResourceCreator } = require('../../fhir/fhirResourceCreator');
const { ResourceMerger } = require('../../operations/common/resourceMerger');
const { RethrownError } = require('../../utils/rethrownError');
const { mongoQueryStringify } = require('../../utils/mongoQueryStringify');
const { ObjectId } = require('mongodb');
const { searchParameterQueries } = require('../../searchParameters/searchParameters');
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
     * @param {date|undefined} beforeLastUpdatedDate
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
            beforeLastUpdatedDate,
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
         * @type {date|undefined}
         */
        this.beforeLastUpdatedDate = beforeLastUpdatedDate;

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

            const { resourceType, id } = ReferenceParser.parseReference(reference._sourceId);
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

            /**
             * @type {boolean}
             */
            let foundInCache = false;

            // create current reference with id
            const currentReference = reference._sourceId;
            const uuidReference = reference._uuid;

            // check if the current reference is present in cache if present then replace it
            if (cache.has(currentReference)) {
                // create new reference to replace the current reference with
                const newReference = cache.get(currentReference);

                // create new uuid reference to replace current uuid reference with
                const newUuidReference = `${resourceType}/${this.uuidCache.get(id)}`;

                // set foundInCache true and increase the count of cache hits to get the references changed
                foundInCache = true;
                if (this.cacheHits.has(referenceCollectionName)) {
                    this.cacheHits.set(referenceCollectionName, this.cacheHits.get(referenceCollectionName) + 1);
                } else {
                    this.cacheHits.set(referenceCollectionName, 1);
                }

                // change all currentReference values with newReference and uuidReference values with newUuidReference
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

            // if currentReference is not present in the cache then increase the count of cacheMisses
            // to know count of references that were not changed
            if (!foundInCache) {
                if (this.cacheMisses.has(referenceCollectionName)) {
                    this.cacheMisses.set(referenceCollectionName, this.cacheMisses.get(referenceCollectionName) + 1);
                } else {
                    this.cacheMisses.set(referenceCollectionName, 1);
                }
            }
            return reference;
        } catch (e) {
            this.adminLogger.logError(e);
            throw new RethrownError(
                {
                    message: 'Error processing reference',
                    error: e,
                    args: {
                        reference
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
        // iterate over all the references of the resource and run the updateReferenceAsync on them
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
        // create original id with the resource
        /**
         * @type {string}
         */
        const originalId = this.getOriginalId({ doc: resource });

        // create currentId with originalId to check if the resource id needs to be changed
        /**
         * @type {string}
         */
        const currentId = this.getCurrentId({ originalId, _sourceAssigningAuthority: resource._sourceAssigningAuthority });

        // get the new uuid generated for the resource
        /**
         * @type {string|undefined}
         */
        const newUuid = this.uuidCache.get(currentId);

        // check if the currentId and resource id matches if yes then change the id and uuid
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
     * @param {function(resource: Resource):Promise<Resource>} updateRecord
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

            // call the passed update function to update the resource
            resource = await updateRecord.call(this, resource);

            // for speed, first check if the incoming resource is exactly the same
            let updatedResourceJsonInternal = resource.toJSONInternal();
            let currentResourceJsonInternal = currentResource.toJSONInternal();

            // if it is history doc then include the request as well
            if (isHistoryDoc && doc.request) {
                currentResourceJsonInternal = {
                    resource: currentResourceJsonInternal,
                    request: {...doc.request}
                };

                // if it is history doc then replace the id present in the url
                doc.request.url = doc.request.url.replace(currentResource.id, resource.id);

                updatedResourceJsonInternal = {
                    resource: updatedResourceJsonInternal,
                    request: doc.request
                };
            }

            if (deepEqual(updatedResourceJsonInternal, currentResourceJsonInternal) === true) {
                return operations;
            }

            /**
             * @type {import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>}
             */
            // batch up the calls to update
            const patches = compare(currentResourceJsonInternal, updatedResourceJsonInternal);

            const updateOperation = MongoJsonPatchHelper.convertJsonPatchesToMongoUpdateCommand({patches});

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

                await this.cacheReferencesAsync({
                    mongoConfig,
                    collectionName: proaCollection
                });

                const count = this.getCacheForReference({ collectionName: proaCollection }).size;

                this.adminLogger.logInfo(`Done caching collection references: ${proaCollection}: ${count}`);
            }

            try {
                this.adminLogger.logInfo(`Starting loop for ${this.collections.join(',')}. useTransaction: ${this.useTransaction}`);

                // if there is an exception, continue processing from the last id
                for (const collectionName of this.collections) {
                    this.adminLogger.logInfo(`Starting reference updates for ${collectionName}`);
                    this.startFromIdContainer.startFromId = '';

                    // create a query from the parameters
                    /**
                     * @type {import('mongodb').Filter<import('mongodb').Document>}
                     */
                    let parametersQuery = this.getQueryFromParameters({queryPrefix: collectionName.includes('History') ? 'resource.' : ''});

                    // get resourceName from collection name
                    /**
                     * @type {string}
                     */
                    const resourceName = collectionName.split('_')[0];

                    // to store all the reference field names of the resource
                    /**
                     * @type {Set<String>}
                     */
                    let referenceFieldNames = new Set();

                    // get all the reference fields present in the resource
                    const resourceObj = searchParameterQueries[`${resourceName}`];
                    if (resourceObj) {
                        for (const propertyObj of Object.values(resourceObj)) {
                            if (propertyObj.type === 'reference') {
                                for (const field of propertyObj.fields) {
                                    referenceFieldNames.add(field);
                                }
                            }
                        }
                    }

                    // if references are present in the resource then create a query for the reference
                    if (referenceFieldNames && referenceFieldNames.size) {
                        referenceFieldNames = Array.from(referenceFieldNames);

                        /**
                         * @type {string[]}
                         */
                        let referenceArray = [];
                        // check which resources can be referenced by the current resource and
                        // create array of references that can be present in the resource
                        for (let key of this.caches.keys()) {
                            if (referenceCollections[String(key)] && referenceCollections[String(key)].includes(resourceName)) {
                                const references = Array.from(this.caches.get(key), value => value[0]);
                                if (references.length) {
                                    referenceArray = [...referenceArray, ...references];
                                }
                            }
                        }

                        if (!referenceArray.length){
                            this.adminLogger.logInfo(`Procesing not required for ${collectionName}`);
                            continue;
                        }

                        while (referenceArray.length > 0) {
                            const referenceBatch = referenceArray.splice(0, this.batchSize);

                            const referenceFieldQuery = [];

                            // iterate over all the reference field names
                            referenceFieldNames.forEach(referenceFieldName => {
                                const fieldName = collectionName.includes('History') ?
                                    `resource.${referenceFieldName}._sourceId`
                                    : `${referenceFieldName}._sourceId`;

                                // create $in query with the reference array if it has some references
                                if (referenceBatch.length) {
                                    referenceFieldQuery.push({
                                        [fieldName]: {
                                            $in: referenceBatch
                                        }
                                    });
                                }
                            });

                            // if $in queries are present in the referenceFieldQuery then merge it with current query
                            const query = Object.keys(parametersQuery).length ? {
                                    $and: [
                                        parametersQuery,
                                        { $or: referenceFieldQuery }
                                    ],
                                } : { $or: referenceFieldQuery };

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
                                });

                            } catch (e) {
                                this.adminLogger.logError(`Got error ${e}.  At ${this.startFromIdContainer.startFromId}`);
                                throw new RethrownError(
                                    {
                                        message: `Error processing references of collection ${collectionName}`,
                                        error: e,
                                        args: {
                                            query
                                        },
                                        source: 'FixReferenceIdRunner.processAsync'
                                    }
                                );
                            }
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
                    this.adminLogger.logInfo(`Starting id updates for ${collectionName}`);
                    this.startFromIdContainer.startFromId = '';

                    /**
                     * @type {boolean}
                     */
                    const isHistoryCollection = collectionName.includes('History');

                    const query = this.getQueryForResource(isHistoryCollection);

                    // if query is not empty then run the query and process the records
                    if (Object.keys(query).length) {
                        try {
                            this.adminLogger.logInfo(`query: ${mongoQueryStringify(query)}`);
                            await this.runForQueryBatchesAsync({
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
                            throw new RethrownError(
                                {
                                    message: `Error processing ids of collection ${collectionName}`,
                                    error: e,
                                    args: {
                                        query
                                    },
                                    source: 'FixReferenceIdRunner.processAsync'
                                }
                            );
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
            } catch (err) {
                this.adminLogger.logError(err);
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
     * Creates a query from the parameters provided
     * @param {string} queryPrefix
     * @returns {import('mongodb').Filter<import('mongodb').Document>}
     */
    getQueryFromParameters({queryPrefix}) {
        /**
         * @type {import('mongodb').Filter<import('mongodb').Document>}
         */
        let query = {};

        if (this.afterLastUpdatedDate && this.beforeLastUpdatedDate) {
            query = {
                $and: [
                    {
                        [`${queryPrefix}meta.lastUpdated`]: {
                            $gt: this.afterLastUpdatedDate,
                        }
                    },
                    {
                        [`${queryPrefix}meta.lastUpdated`]: {
                            $lt: this.beforeLastUpdatedDate
                        }
                    }
                ]
            };
        }
        else if (this.afterLastUpdatedDate) {
            query = {
                [`${queryPrefix}meta.lastUpdated`]: {
                    $gt: this.afterLastUpdatedDate,
                }
            };
        }
        else if (this.beforeLastUpdatedDate) {
            query = {
                [`${queryPrefix}meta.lastUpdated`]: {
                    $lt: this.beforeLastUpdatedDate,
                }
            };
        }
        else {
            query = this.properties && this.properties.length > 0 ?
                this.getFilter(this.properties.concat(this.filterToRecordsWithFields || [])) :
                this.getFilter(this.filterToRecordsWithFields);
        }

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

        return query;
    }

    /**
     * Creates a single connection and returns the collection instance
     * @param {{connection: string, db_name: string, options: import('mongodb').MongoClientOptions }} mongoConfig
     * @param {string} collectionName
     * @returns {Promise<{collection: require('mongodb').Collection<import('mongodb').Document>|undefined, session: require('mongodb').ClientSession}>}
     */
    async createSingeConnectionAsync({ mongoConfig, collectionName }) {
        /**
         * @type {require('mongodb').MongoClient}
         */
        const client = await this.mongoDatabaseManager.createClientAsync(mongoConfig);

        /**
         * @type {require('mongodb').ClientSession}
         */
        const session = client.startSession();

        /**
         * @type {require('mongodb').db}
         */
        const db = client.db(mongoConfig.db_name);

        /**
         * @type {require('mongodb').Collection<import('mongodb').Document>|undefined}
         */
        let collection;
        if (collectionName) {
            collection = db.collection(collectionName);
        }
        return { collection, session, client };
    }

    /**
     * Creates oldReference to newReference mapping collectionwise
     * @param {{connection: string, db_name: string, options: import('mongodb').MongoClientOptions }} mongoConfig
     * @param {string} collectionName
     * @return {Promise<void>}
     */
    async cacheReferencesAsync({ mongoConfig, collectionName }) {
        /**
         * @type {boolean}
         */
        const isHistoryCollection = collectionName.includes('History');

        /**
         * @type {Object}
         */
        let projection = {
            _id: 0,
            _uuid: 1,
            _sourceId: 1,
            _sourceAssigningAuthority: 1,
            meta: {
                source: 1
            }
        };

        // if this is history collection then change the projection to contain _id at top and
        // rest of the fields inside resource field
        if (isHistoryCollection) {
            delete projection._id;

            projection = { _id: 0, resource: projection };
        }

        /**
         * @type {require('mongodb').collection}
         */
        const { collection, session, client } = await this.createSingeConnectionAsync({ mongoConfig, collectionName });

        try {
            /**
             * @type {import('mongodb').FindCursor<import('mongodb').WithId<import('mongodb').Document>>}
             */
            const cursor = collection.find(this.getQueryForResource(isHistoryCollection), { projection });

            while (await cursor.hasNext()) {
                /**
                 * @type {import('mongodb').WithId<import('mongodb').Document>}
                 */
                const doc = await cursor.next();

                // check if the resource id needs to changed and if it needs to changed
                // then create its mapping in the cache
                this.cacheReferenceFromResource({
                    doc: isHistoryCollection ? doc.resource : doc, collectionName
                });
            }
        } catch (e) {
            throw new RethrownError(
                {
                    message: `Error caching references for collection ${collectionName}`,
                    error: e,
                    source: 'FixReferenceIdRunner.cacheReferencesAsync'
                }
            );
        } finally {
            await session.endSession();
            await client.close();
        }
    }

    /**
     * Get query for the resources whose id might change
     * @param {boolean} isHistoryCollection
     * @returns {import('mongodb').Filter<import('mongodb').Document>}
     */
    getQueryForResource(isHistoryCollection) {
        // create a query from the parameters
        /**
         * @type {import('mongodb').Filter<import('mongodb').Document>}
         */
        let query = this.getQueryFromParameters({queryPrefix: isHistoryCollection ? 'resource.' : ''});

        // query to get resources that needs to be changes
        /**
         * @type {import('mongodb').Filter<import('mongodb').Document>}
         */
        const filterQuery = [
            {
                [isHistoryCollection ? 'resource.meta.security.system' : 'meta.security.system']: 'https://www.icanbwell.com/connectionType',
                [isHistoryCollection ? 'resource.meta.security.code' : 'meta.security.code']: 'proa',
            },
        ];

        // merge query and filterQuery
        if (Object.keys(query).length) {
            query = {
                $and: [query, ...filterQuery]
            };
        } else {
            query = {
                $and: filterQuery
            };
        }

        return query;
    }

    /**
     * Extracts id from document
     * @param {Resource} doc
     * @returns {string}
     */
    getOriginalId({ doc }) {
        return doc.meta.source.split('/').pop();
    }

    /**
     * Created old if from original id
     * @param {string} originalId
     * @param {string} _sourceAssigningAuthority
     * @returns {string}
     */
    getCurrentId({ originalId, _sourceAssigningAuthority }) {
        return (`${_sourceAssigningAuthority.replace(/[^A-Za-z0-9\-.]/g, '-')}-${originalId}`).slice(0, 63);
    }

    /**
     * Caches old and new references
     * @param {Resource} doc
     * @param {string} collectionName
     */
    cacheReferenceFromResource({ doc, collectionName }) {
        // originating id with which to replace the current id
        /**
         * @type {string}
         */
        const originalId = this.getOriginalId({ doc });
        // current id present in the resource
        /**
         * @type {string}
         */
        const currentId = this.getCurrentId({ originalId, _sourceAssigningAuthority: doc._sourceAssigningAuthority });

        // if currentId is equal to doc._sourceId then we need to change the id so cache it
        if (currentId === doc._sourceId) {
            collectionName = collectionName.split('_')[0];

            this.getCacheForReference({ collectionName }).set(
                `${collectionName}/${doc._sourceId}`,
                `${collectionName}/${originalId}`
            );

            // generate a new uuid based on the orginal id
            this.uuidCache.set(currentId, generateUUIDv5(`${originalId}|${doc._sourceAssigningAuthority}`));
        }
    }

    /**
     * Gets cache for reference
     * @param {string} collectionName
     * @return {Map<string, Map<string, string>>}
     */
    getCacheForReference({ collectionName }) {
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
