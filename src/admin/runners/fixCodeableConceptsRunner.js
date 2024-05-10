const { BaseBulkOperationRunner } = require('./baseBulkOperationRunner');
const deepEqual = require('fast-deep-equal');
const { isValidMongoObjectId } = require('../../utils/mongoIdValidator');
const { MongoJsonPatchHelper } = require('../../utils/mongoJsonPatchHelper');
const { compare } = require('fast-json-patch');
const { FhirResourceCreator } = require('../../fhir/fhirResourceCreator');
const { RethrownError } = require('../../utils/rethrownError');
const { mongoQueryStringify } = require('../../utils/mongoQueryStringify');
const { ObjectId } = require('mongodb');
const CodeableConcept = require('../../fhir/classes/4_0_0/complex_types/codeableConcept');

/**
 * @classdesc Checks all the proa and hapi resources and converts oid values into standard urls
 */
class FixCodeableConceptsRunner extends BaseBulkOperationRunner {
    /**
     * constructor
     * @param {MongoCollectionManager} mongoCollectionManager
     * @param {number} batchSize
     * @param {AdminLogger} adminLogger
     * @param {MongoDatabaseManager} mongoDatabaseManager
     * @param {number} promiseConcurrency
     * @param {string[]} collections
     * @param {date|undefined} afterLastUpdatedDate
     * @param {date|undefined} beforeLastUpdatedDate
     * @param {string|undefined} [startFromCollection]
     * @param {number|undefined} [limit]
     * @param {string[]|undefined} [properties]
     * @param {number|undefined} [skip]
     * @param {string[]|undefined} [filterToRecordsWithFields]
     * @param {string|undefined} [startFromId]
     * @param {Object} oidToStandardSystemUrlMap
     * @param {boolean} updateResources
     */
    constructor ({
        mongoCollectionManager,
        batchSize,
        adminLogger,
        mongoDatabaseManager,
        promiseConcurrency,
        collections,
        afterLastUpdatedDate,
        beforeLastUpdatedDate,
        startFromCollection,
        limit,
        properties,
        skip,
        filterToRecordsWithFields,
        startFromId,
        oidToStandardSystemUrlMap,
        updateResources
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
        /**
         * @type {number}
         */
        this.promiseConcurrency = promiseConcurrency;
        /**
         * @type {date|undefined}
         */
        this.afterLastUpdatedDate = afterLastUpdatedDate;

        /**
         * @type {date|undefined}
         */
        this.beforeLastUpdatedDate = beforeLastUpdatedDate;

        /**
         * @type {string|undefined}
         */
        this.startFromCollection = startFromCollection;

        /**
         * @type {number|undefined}
         */
        this.limit = limit;

        /**
         * @type {string[]|undefined}
         */
        this.properties = properties;

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
         * @type {Object}
         */
        this.oidToStandardSystemUrlMap = oidToStandardSystemUrlMap;

        /**
         * @type {Set<string>}
         */
        this.availableOidValues = new Set(Object.keys(oidToStandardSystemUrlMap));

        /**
         * @type {boolean}
         */
        this.updateResources = updateResources;

        /**
         * @type {Map<string,number>}
         */
        this.uuidsToUpdate = new Map();
    }

    /**
     * converts list of properties to a projection
     * @param {string[]} properties
     * @return {import('mongodb').Filter<import('mongodb').Document>}
     */

    getFilter (properties) {
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
    getProjection () {
        /**
         * @type {import('mongodb').Document}
         */
        const projection = {};
        for (const property of this.properties) {
            projection[`${property}`] = 1;
        }
        // always add projection for needed properties
        const neededProperties = [
            'resourceType',
            'meta',
            'identifier',
            '_uuid',
            '_sourceId',
            '_sourceAssigningAuthority'
        ];
        for (const property of neededProperties) {
            projection[`${property}`] = 1;
        }
        return projection;
    }

    /**
     * returns the bulk operation for this doc
     * @param {import('mongodb').DefaultSchema} doc
     * @returns {Promise<(import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>)[]>}
     */
    async processRecordAsync (doc) {
        try {
            /**
             * @type {boolean}
             */
            const isHistoryDoc = Boolean(doc.resource);

            const operations = [];
            /**
             * @type {import('../../fhir/classes/4_0_0/resources/resource')}
             */
            let resource = FhirResourceCreator.create(isHistoryDoc ? doc.resource : doc);

            /**
             * @type {import('../../fhir/classes/4_0_0/resources/resource')}
             */
            const currentResource = resource.clone();

            // call the passed update function to update the resource
            resource = this.updateResource(resource);

            // for speed, first check if the incoming resource is exactly the same
            let updatedResourceJsonInternal = resource.toJSONInternal();
            let currentResourceJsonInternal = currentResource.toJSONInternal();

            // if it is history doc then include the request as well
            if (isHistoryDoc && doc.request) {
                currentResourceJsonInternal = {
                    resource: currentResourceJsonInternal,
                    request: { ...doc.request }
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

            const updateOperation = MongoJsonPatchHelper.convertJsonPatchesToMongoUpdateCommand({
                patches
            });

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
            throw new RethrownError({
                message: `Error processing record ${e.message}`,
                error: e,
                args: {
                    resource: doc
                },
                source: 'FixCodeableConceptsRunner.processRecordAsync'
            });
        }
    }

    /**
     * Checks if resource needs to be updated based on ooid values passed
     * @param {import('../../fhir/classes/4_0_0/resources/resource')} resource
     * @returns {boolean}
     */
    isUpdateNeeded (resource) {
        if (resource instanceof CodeableConcept && resource.coding) {
            for (const coding of resource.coding) {
                if (
                    coding?.system?.toLowerCase().startsWith('urn:oid:') ||
                    this.availableOidValues.has(coding?.system)
                ) {
                    return true;
                }
            }
            return false;
        }
        /**
         * @type {boolean}
         */
        let isUpdateNeeded = false;

        if (resource instanceof Object || Array.isArray(resource)) {
            for (const /** @type {string} */ key in resource) {
                if ((
                        resource[`${key}`] instanceof Object ||
                        Array.isArray(resource[`${key}`])
                    ) &&
                    this.isUpdateNeeded(resource[`${key}`])
                ) {
                    isUpdateNeeded = true;
                    break;
                }
            }
        }
        return isUpdateNeeded;
    }

    /**
     * Updates the values of resource with oidToStandardUrlMap values
     * @param {import('../../fhir/classes/4_0_0/resources/resource')} resource
     * @returns {import('../../fhir/classes/4_0_0/resources/resource')}
     */
    updateResource (resource) {
        if (resource instanceof CodeableConcept && resource.coding) {
            for (const coding of resource.coding) {
                if (
                    coding?.system?.toLowerCase().startsWith('urn:oid:') ||
                    this.availableOidValues.has(coding?.system)
                ) {
                    // to remove prefix urn:oid: or URN:OID:
                    const system = coding.system.toLowerCase().startsWith('urn:oid:')
                        ? coding.system.split(':')[2] : coding.system;

                    if (this.availableOidValues.has(system)) {
                        coding.system = this.oidToStandardSystemUrlMap[`${system}`];
                    } else {
                        coding.system = system;
                    }
                }
            }
            return resource;
        }

        if (resource instanceof Object || Array.isArray(resource)) {
            for (const /** @type {string} */ key in resource) {
                if ((
                        resource[`${key}`] instanceof Object ||
                        Array.isArray(resource[`${key}`])
                    ) &&
                    Object.getOwnPropertyDescriptor(resource, key).writable !== false
                ) {
                    resource[`${key}`] = this.updateResource(resource[`${key}`]);
                }
            }
        }

        return resource;
    }

    /**
     * Creates a query from the parameters provided
     * @param {string} queryPrefix
     * @returns {import('mongodb').Filter<import('mongodb').Document>}
     */
    getQueryFromParameters ({ queryPrefix = '' }) {
        /**
         * @type {import('mongodb').Filter<import('mongodb').Document>}
         */
        let query = {};

        if (this.afterLastUpdatedDate && this.beforeLastUpdatedDate) {
            query = {
                $and: [
                    {
                        [`${queryPrefix}meta.lastUpdated`]: {
                            $gt: this.afterLastUpdatedDate
                        }
                    },
                    {
                        [`${queryPrefix}meta.lastUpdated`]: {
                            $lt: this.beforeLastUpdatedDate
                        }
                    }
                ]
            };
        } else if (this.afterLastUpdatedDate) {
            query = {
                [`${queryPrefix}meta.lastUpdated`]: {
                    $gt: this.afterLastUpdatedDate
                }
            };
        } else if (this.beforeLastUpdatedDate) {
            query = {
                [`${queryPrefix}meta.lastUpdated`]: {
                    $lt: this.beforeLastUpdatedDate
                }
            };
        } else {
            query = this.properties && this.properties.length > 0
                ? this.getFilter(this.properties.concat(this.filterToRecordsWithFields || []))
                : this.getFilter(this.filterToRecordsWithFields);
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
     * Get query for the resources whose id might change
     * @param {string} queryPrefix
     * @param {string[]} uuidChunk
     * @returns {import('mongodb').Filter<import('mongodb').Document>}
     */
    getQueryForResource ({ queryPrefix = '', uuidChunk }) {
        // create a query from the parameters
        /**
         * @type {import('mongodb').Filter<import('mongodb').Document>}
         */
        let query = this.getQueryFromParameters({ queryPrefix });

        // query to get resources that needs to be changes
        /**
         * @type {import('mongodb').Filter<import('mongodb').Document>}
         */
        const filterQuery = { _uuid: { $in: uuidChunk } };

        // merge query and filterQuery
        if (Object.keys(query).length) {
            query = {
                $and: [query, filterQuery]
            };
        } else {
            query = filterQuery;
        }

        return query;
    }

    /**
     * Runs a loop to process all the documents
     * @returns {Promise<void>}
     */
    async processAsync () {
        // noinspection JSValidateTypes
        try {
            if (this.startFromCollection) {
                this.collections = this.collections.filter((c) => c >= this.startFromCollection);
            }

            await this.init();

            /**
             * @type {{connection: string, db_name: string, options: import('mongodb').MongoClientOptions}}
             */
            const mongoConfig = await this.mongoDatabaseManager.getClientConfigAsync();

            try {
                for (const /** @type {string} */ collectionName of this.collections) {
                    /**
                     * @type {{collection: import('mongodb').Collection, session: import('mongodb').ClientSession, client: import('mongodb').MongoClient}}
                     */
                    const { collection, session, client } = await this.createSingeConnectionAsync({
                        mongoConfig,
                        collectionName
                    });

                    try {
                        this.adminLogger.logInfo(`Loading uuids for collection ${collectionName}`);
                        /**
                         * @type {string[]}
                         */
                        const uuidsToUpdate = [];
                        /**
                         * @type {import('mongodb').FindCursor}
                         */
                        const cursor = collection.find({});

                        while (await cursor.hasNext()) {
                            const doc = await cursor.next();

                            const resource = FhirResourceCreator.create(doc);

                            if (this.isUpdateNeeded(resource)) {
                                uuidsToUpdate.push(resource._uuid);
                            }
                        }

                        this.adminLogger.logInfo(`Uuids to update in collection ${collectionName}: ${uuidsToUpdate.length}`);
                        this.uuidsToUpdate.set(collectionName, uuidsToUpdate.length);

                        const updateUuids = async (uuidChunk) => {
                            /**
                             * @type {import('mongodb').Filter<import('mongodb').Document>}
                             */
                            const query = this.getQueryForResource({ uuidChunk });

                            const startFromIdContainer = this.createStartFromIdContainer();
                            try {
                                this.adminLogger.logInfo(`query: ${mongoQueryStringify(query)}`);
                                await this.runForQueryBatchesAsync({
                                    config: mongoConfig,
                                    sourceCollectionName: collectionName,
                                    destinationCollectionName: collectionName,
                                    query,
                                    projection: this.properties ? this.getProjection() : undefined,
                                    startFromIdContainer,
                                    fnCreateBulkOperationAsync: async (doc) => await this.processRecordAsync(doc),
                                    ordered: false,
                                    batchSize: this.batchSize,
                                    skipExistingIds: false,
                                    limit: this.limit,
                                    useTransaction: this.useTransaction,
                                    skip: this.skip
                                });
                            } catch (e) {
                                this.adminLogger.logError(`Got error ${e}.  At ${startFromIdContainer.startFromId}`);
                                throw new RethrownError(
                                    {
                                        message: `Error processing uuidChunk of collection ${collectionName} ${e.message}`,
                                        error: e,
                                        args: {
                                            uuidChunk,
                                            query
                                        },
                                        source: 'FixCodeableConceptsRunner.processAsync'
                                    }
                                );
                            }
                        };
                        if (this.updateResources) {
                            const uuidChunks = [];
                            while (uuidsToUpdate.length > 0) {
                                uuidChunks.push(uuidsToUpdate.splice(0, this.batchSize));
                            }

                            while (uuidChunks.length > 0) {
                                await Promise.all(uuidChunks.splice(0, this.promiseConcurrency).map(updateUuids));
                            }
                        }
                    } catch (e) {
                        throw new RethrownError(
                            {
                                message: `Error processing resources for collection ${collectionName}, ${e.message}`,
                                error: e,
                                args: {
                                    stack: e.stack
                                },
                                source: 'FixCodeableConceptRunner.processAsync'
                            }
                        );
                    } finally {
                        await session.endSession();
                        await client.close();
                    }
                }
            } catch (err) {
                this.adminLogger.logError(err);
            }

            this.adminLogger.logInfo(`Resources to update: ${Array.from(this.uuidsToUpdate).join(' ')}`);
            this.adminLogger.logInfo('Finished script');
            this.adminLogger.logInfo('Shutting down');
            await this.shutdown();
            this.adminLogger.logInfo('Shutdown finished');
        } catch (e) {
            this.adminLogger.logError(`ERROR: ${e}`);
        }
    }
}

module.exports = {
    FixCodeableConceptsRunner
};
