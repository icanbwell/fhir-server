const deepEqual = require('fast-deep-equal');
const fs = require('fs');
const { IdentifierSystem } = require('../../utils/identifierSystem');
const { MongoJsonPatchHelper } = require('../../utils/mongoJsonPatchHelper');
const { compare } = require('fast-json-patch');
const { FhirResourceCreator } = require('../../fhir/fhirResourceCreator');
const { RethrownError } = require('../../utils/rethrownError');
const { mongoQueryStringify } = require('../../utils/mongoQueryStringify');
const { SecurityTagSystem } = require('../../utils/securityTagSystem');
const { FixReferenceIdRunner } = require('./fixReferenceIdRunner');
const { generateUUID } = require('../../utils/uid.util');

/**
 * @classdesc Changes reference from id to uuid in person resource
 */
class FixBwellMasterPersonReferenceRunner extends FixReferenceIdRunner {
    /**
     * @param {Object} args
     * @param {string[]} preLoadCollections
     * @param {boolean} logUnresolvedReferencesToFile
     */
    constructor({ preLoadCollections, logUnresolvedReferencesToFile, ...args }) {
        super(args);

        /**
         * @type {string[]}
         */
        this.preLoadCollections = preLoadCollections;

        /**
         * @type {boolean}
         */
        this.logUnresolvedReferencesToFile = logUnresolvedReferencesToFile;

        if (this.logUnresolvedReferencesToFile) {
            /**
             * @type {require('fs').writeStream}
             */
            this.writeStream = fs.createWriteStream(`unresolvedReferences-${generateUUID()}.txt`, { flags: 'w' });

            this.writeStream.write('{\n');
        }
    }
    /**
     * Updates the reference if it is present in cache and removes duplicate references
     * @param {Resource} resource
     * @return {Promise<Reference>}
     */
    async updateResourceReferenceAsync(resource, isHistoryDoc) {
        /**
         * @type {Set<string>}
         */
        const uuidSet = new Set();

        /**
         * @type {Set<string>}
         */
        const unresolvedReferencesSet = new Set();
        try {
            if (resource?.link) {
                resource.link = resource.link.map(link => {
                    let reference = link?.target;
                    if (!reference || !reference.reference) {
                        return reference;
                    }

                    // if reference is of type resource/id|sourceAssigningAuthority then sourceAssigningAuthority is correct
                    // just take the uuid from reference and update it
                    if (reference.reference.includes('|')) {
                        let uuidReference = reference._uuid;
                        const sourceAssigningAuthority = reference.reference.split('|')[1];
                        if (!uuidReference) {
                            const uuidIdentifier = reference.extension.find(element => element.url === IdentifierSystem.uuid);
                            if (uuidIdentifier && uuidIdentifier.valueString) {
                                uuidReference = uuidIdentifier.valueString;
                            }
                        }

                        if (uuidReference) {
                            reference.reference = uuidReference;
                            reference._sourceId = uuidReference;
                            reference.extension.forEach(extension => {
                                if (extension.url === IdentifierSystem.sourceId) {
                                    extension.valueString = uuidReference;
                                } else if (extension.url === SecurityTagSystem.sourceAssigningAuthority) {
                                    extension.valueString = sourceAssigningAuthority;
                                }
                            });
                        }
                    } else {
                        // current reference with id
                        let currentReference = reference._sourceId;

                        if (!currentReference) {
                            if (reference.extension) {
                                reference.extension.forEach(element => {
                                    if (element.url === IdentifierSystem.sourceId && element.valueString) {
                                        currentReference = element.valueString;
                                    }
                                });
                            }

                            if (!currentReference) {
                                currentReference = reference.reference;
                            }
                        }

                        if (this.caches.has(currentReference)) {
                            const newReferences = Array.from(this.caches.get(currentReference));

                            if (newReferences.length > 1) {
                                unresolvedReferencesSet.add(currentReference);
                            } else if (newReferences.length === 1) {
                                const { uuidReference, sourceAssigningAuthority } = JSON.parse(newReferences[0]);

                                // Update all the fields of the reference with correct fields
                                reference.reference = uuidReference;
                                reference._sourceId = uuidReference;
                                reference._uuid = uuidReference;
                                reference._sourceAssigningAuthority = sourceAssigningAuthority;

                                reference.extension = reference.extension.map(extension => {
                                    if (extension.url === IdentifierSystem.sourceId || extension.url === IdentifierSystem.uuid) {
                                        extension.valueString = uuidReference;
                                    } else if (extension.url === SecurityTagSystem.sourceAssigningAuthority) {
                                        extension.valueString = sourceAssigningAuthority;
                                    }

                                    return extension;
                                });
                            }
                        }
                    }
                    return {...link, target: reference};
                    // remove duplicate fields as they were duplicates
                }).filter(link => {
                    if (uuidSet.has(link.target._uuid)) {
                        return false;
                    }
                    uuidSet.add(link.target._uuid);
                    return true;
                });
            }
        } catch (e) {
            this.adminLogger.logError(e.message, { stack: e.stack });
            throw new RethrownError(
                {
                    message: `Error processing reference ${e.message}`,
                    error: e,
                    args: {
                        resource
                    },
                    source: 'FixBwellMasterPersonReferenceRunner.updateReferenceAsync'
                }
            );
        }

        // if there are unResolvedReferences for the resource write them to the file
        const unresolvedReferences = Array.from(unresolvedReferencesSet);

        if (unresolvedReferences.length && !isHistoryDoc) {
            if (this.logUnresolvedReferencesToFile) {
                await this.writeStream.write(
                    `\t"${resource.resourceType}/${resource._uuid}": "${unresolvedReferences.join(',')}",\n`
                );
            } else {
                this.adminLogger.logInfo(`Couldn't resource references for resource ${resource.resourceType}/${resource._uuid}: ${unresolvedReferences.join(',')}`);
            }
        }

        return resource;
    }

    /**
     * returns the bulk operation for this doc
     * @param {import('mongodb').DefaultSchema} doc
     * @returns {Promise<(import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>)[]>}
     */
    async processRecordAsync(doc) {
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

            // Update resource references from cache
            resource = await this.updateResourceReferenceAsync(resource, isHistoryDoc);

            // for speed, first check if the incoming resource is exactly the same
            let updatedResourceJsonInternal = resource.toJSONInternal();
            let currentResourceJsonInternal = currentResource.toJSONInternal();

            if (deepEqual(updatedResourceJsonInternal, currentResourceJsonInternal) === true) {
                return operations;
            }

            if (isHistoryDoc) {
                updatedResourceJsonInternal = { resource: updatedResourceJsonInternal };
                currentResourceJsonInternal = { resource: currentResourceJsonInternal };
            }

            /**
             * @type {import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>}
             */
            // batch up the calls to update
            const patches = compare(currentResourceJsonInternal, updatedResourceJsonInternal);

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

            if (!isHistoryDoc && operations.length > 0) {
                if (this.historyUuidCache.has(doc.resourceType)) {
                    this.historyUuidCache.set(doc.resourceType, []);
                }
                this.historyUuidCache.get(doc.resourceType).push(doc._uuid);
            }

            return operations;
        } catch (e) {
            throw new RethrownError(
                {
                    message: `Error processing record ${e.message}`,
                    error: e.stack,
                    args: {
                        resource: doc
                    },
                    source: 'FixBwellMasterPersonReferenceRunner.processRecordAsync'
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
                this.collections = ['Person_4_0_0', 'Person_4_0_0_History'];

                if (this.startFromCollection) {
                    this.collections = this.collections.filter(c => c >= this.startFromCollection);
                }
            }

            await this.init();

            /**
             * @type {{connection: string, db_name: string, options: import('mongodb').MongoClientOptions}}
             */
            const mongoConfig = await this.mongoDatabaseManager.getClientConfigAsync();

            await this.preloadReferencesAsync({ mongoConfig });

            try {
                for (const collectionName of this.collections) {
                    this.adminLogger.logInfo(`Starting reference update for ${collectionName}`);
                    /**
                     * @type {boolean}
                     */
                    const isHistoryCollection = collectionName.includes('_History');
                    /**
                     * @type {import('mongodb').Filter<import('mongodb').Document>}
                     */
                    const query = this.getQueryForResource(isHistoryCollection);
                    /**
                     * @type {string}
                     */
                    const resourceName = collectionName.split('_')[0];

                    const startFromIdContainer = this.createStartFromIdContainer();

                    try {
                        this.adminLogger.logInfo(`query: ${mongoQueryStringify(query)}`);

                        await this.runForQueryBatchesAsync({
                            config: mongoConfig,
                            sourceCollectionName: collectionName,
                            destinationCollectionName: collectionName,
                            query,
                            startFromIdContainer,
                            fnCreateBulkOperationAsync: async (doc) => await this.processRecordAsync(doc),
                            ordered: false,
                            batchSize: this.batchSize,
                            skipExistingIds: false,
                            limit: this.limit,
                            useTransaction: this.useTransaction,
                            skip: this.skip,
                            filterToIds: isHistoryCollection && this.historyUuidCache.has(resourceName) ? this.historyUuidCache.get(resourceName) : undefined,
                            filterToIdProperty: isHistoryCollection && this.historyUuidCache.has(resourceName) ? 'resource._uuid' : undefined
                        });

                    } catch (e) {
                        this.adminLogger.logError(`Got error ${e}.  At ${startFromIdContainer.startFromId}`);
                        throw new RethrownError(
                            {
                                message: `Error processing ids of collection ${collectionName} ${e.message}`,
                                error: e,
                                args: {
                                    query
                                },
                                source: 'FixReferenceIdRunner.processAsync'
                            }
                        );
                    }
                }
            } catch (err) {
                this.adminLogger.logError(err.message, { stack: err.stack });
            }

            if (this.logUnresolvedReferencesToFile) {
                this.writeStream.write('}\n');
            }
            this.adminLogger.logInfo('Finished script');
            this.adminLogger.logInfo('Shutting down');
            await this.shutdown();
            this.adminLogger.logInfo('Shutdown finished');
        } catch (e) {
            this.adminLogger.logError(`ERROR: ${e.message}`, { stack: e.stack });
        }
    }

    /**
     * Caches id references to {uuidReference, sourceAssigningAuthority} array
     * @param {{connection: string, db_name: string, options: import('mongodb').MongoClientOptions}} mongoConfig
     * @returns {Promise<void>}
     */
    async preloadReferencesAsync({ mongoConfig }) {
        let promises = [];

        if (this.preLoadCollections.length > 0 && this.preLoadCollections[0] === 'all') {
            /**
             * @type {string[]}
             */
            this.preLoadCollections = ['Person_4_0_0', 'Patient_4_0_0'];
        }

        this.preLoadCollections.forEach(collectionName => {
            promises.push(this.cacheReferencesAsync({ collectionName, mongoConfig }));
        });

        await Promise.all(promises);
    }

    /**
     * Creates oldReference to newReference mapping collectionwise
     * @param {{connection: string, db_name: string, options: import('mongodb').MongoClientOptions }} mongoConfig
     * @param {string} collectionName
     * @return {Promise<void>}
     */
    async cacheReferencesAsync({ mongoConfig, collectionName }) {
        this.adminLogger.logInfo(`Starting reference caching for collection: ${collectionName}`);
        /**
         * @type {boolean}
         */
        const isHistoryCollection = collectionName.includes('_History');

        /**
         * @type {Object}
         */
        let projection = {
            _id: 0,
            _uuid: 1,
            _sourceId: 1,
            _sourceAssigningAuthority: 1,
            meta: {
                security: 1
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
             * @type {import('mongodb').Filter<import('mongodb').Document>}
             */
            const query = this.getQueryFromParameters({ queryPrefix: isHistoryCollection ? 'resource.' : '' });
            /**
             * @type {import('mongodb').FindCursor<import('mongodb').WithId<import('mongodb').Document>>}
             */
            const cursor = collection.find(query, { projection });

            while (await cursor.hasNext()) {
                /**
                 * @type {import('mongodb').WithId<import('mongodb').Document>}
                 */
                const doc = await cursor.next();

                // creates a mapping of sourceId to uuid and sourceAssigningAuthority
                this.cacheReferenceFromResource({
                    doc: (isHistoryCollection ? doc.resource : doc), collectionName
                });
            }
        } catch (e) {
            console.log(e);
            throw new RethrownError(
                {
                    message: `Error caching references for collection ${collectionName}, ${e.message}`,
                    error: e,
                    source: 'FixBwellMasterPersonReferenceRunner.cacheReferencesAsync'
                }
            );
        } finally {
            await session.endSession();
            await client.close();
        }
        this.adminLogger.logInfo(`Finished reference caching for collection: ${collectionName}`);
    }

    /**
     * Caches sourceIdReference of the current resource to {uuidReference, sourceAssigningAuthority}
     * @param {Resource} doc
     * @param {string} collectionName
     */
    cacheReferenceFromResource({ doc, collectionName }) {
        /**
         * @type {string}
         */
        const resourceName = collectionName.split('_')[0];

        if (!doc._sourceId) {
            this.adminLogger.logInfo(`_sourceId not defined for resource ${doc._uuid}`);
            return;
        }
        /**
         * @type {string}
         */
        const idReference = `${resourceName}/${doc._sourceId}`;

        if (!doc._uuid) {
            this.adminLogger.logInfo(`_uuid not defined for resource ${doc._sourceId}`);
            return;
        }
        /**
         * @type {string}
         */
        const uuidReference = `${resourceName}/${doc._uuid}`;

        /**
         * @type {string}
         */
        let sourceAssigningAuthority = doc._sourceAssigningAuthority;
        if (!sourceAssigningAuthority && doc.meta && doc.meta.security) {
            const authorityObj = doc.meta.security.find((obj) => obj.system === SecurityTagSystem.sourceAssigningAuthority);
            if (authorityObj) {
                sourceAssigningAuthority = authorityObj.code;
            } else {
                sourceAssigningAuthority = '';
            }
        }

        if (!sourceAssigningAuthority) {
            this.adminLogger.logInfo(`Found resource without sourceAssigningAuthority ${doc._uuid}`);
            return;
        }

        if (!this.caches.has(idReference)) {
            this.caches.set(idReference, new Set());
        }

        this.caches.get(idReference).add(JSON.stringify({ uuidReference, sourceAssigningAuthority }));
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
        let query = this.getQueryFromParameters({ queryPrefix: isHistoryCollection ? 'resource.' : '' });

        // query to get resources that needs to be changes
        /**
         * @type {import('mongodb').Filter<import('mongodb').Document>}
         */
        const filterQuery = [
            {
                [isHistoryCollection ? 'resource.meta.security' : 'meta.security']: {
                    $elemMatch: {
                        'system': SecurityTagSystem.owner,
                        'code': 'bwell'
                    }
                }
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
}

module.exports = {
    FixBwellMasterPersonReferenceRunner
};
