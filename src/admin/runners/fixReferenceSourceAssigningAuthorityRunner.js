const {BaseBulkOperationRunner} = require('./baseBulkOperationRunner');
const {assertTypeEquals} = require('../../utils/assertType');
const {PreSaveManager} = require('../../preSaveHandlers/preSave');
const {getResource} = require('../../operations/common/getResource');
const {VERSIONS} = require('../../middleware/fhir/utils/constants');
const {ReferenceParser} = require('../../utils/referenceParser');
const {DatabaseQueryFactory} = require('../../dataLayer/databaseQueryFactory');
const {generateUUIDv5} = require('../../utils/uid.util');
const deepEqual = require('fast-deep-equal');
const moment = require('moment-timezone');

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
            startFromCollection
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
    }

    /**
     * @param {Reference} reference
     * @param {DatabaseQueryFactory} databaseQueryFactory
     * @return {Promise<Reference>}
     */
    async updateReferenceAsync(reference, databaseQueryFactory) {
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);
        if (!reference.reference) {
            return reference;
        }

        // if the _uuid reference works then we're good
        const {resourceType, id, sourceAssigningAuthority} = ReferenceParser.parseReference(reference.reference);
        if (!resourceType) {
            return reference;
        }
        if (sourceAssigningAuthority) {
            return reference;
        }
        /**
         * @type {string}
         */
        let uuid;
        if (reference._uuid) {
            ({id: uuid} = ReferenceParser.parseReference(reference._uuid));
        }

        /**
         * @type {DatabaseQueryManager}
         */
        const databaseQueryManager = databaseQueryFactory.createQuery({
            resourceType,
            base_version: VERSIONS['4_0_0']
        });
        /**
         * @type {Resource|null}
         */
        let doc;
        if (uuid) {
            doc = await databaseQueryManager.findOneAsync(
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

        if (!doc) {
            doc = await databaseQueryManager.findOneAsync(
                {
                    query: {
                        id: id
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
                reference._uuid = generateUUIDv5(`${id}|${reference._sourceAssigningAuthority}`);
                if (reference.extension) {
                    const uuidExtension = reference.extension.find(e => e.id === 'uuid');
                    if (uuidExtension) {
                        uuidExtension.valueString = reference._uuid;
                    }
                }
            }
        }
        return reference;
    }

    /**
     * returns the bulk operation for this doc
     * @param {import('mongodb').DefaultSchema} doc
     * @returns {Promise<(import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>)[]>}
     */
    async processRecordAsync(doc) {
        const operations = [];
        const ResourceCreator = getResource(VERSIONS['4_0_0'], doc.resourceType);
        /**
         * @type {Resource}
         */
        let resource = new ResourceCreator(doc);
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
        const result = {replaceOne: {filter: {_id: doc._id}, replacement: resource.toJSONInternal()}};
        operations.push(result);

        return operations;
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

            console.log(`Starting loop for ${this.collections.join(',')}`);

            // if there is an exception, continue processing from the last id
            for (const collectionName of this.collections) {

                this.startFromIdContainer.startFromId = '';
                /**
                 * @type {import('mongodb').Filter<import('mongodb').Document>}
                 */


                const query = this.afterLastUpdatedDate ? {
                    'meta.lastUpdated': {
                        $gt: this.afterLastUpdatedDate,
                    }
                } : {};
                try {
                    await this.runForQueryBatchesAsync(
                        {
                            config: await this.mongoDatabaseManager.getClientConfigAsync(),
                            sourceCollectionName: collectionName,
                            destinationCollectionName: collectionName,
                            query,
                            projection: undefined,
                            startFromIdContainer: this.startFromIdContainer,
                            fnCreateBulkOperationAsync: async (doc) => await this.processRecordAsync(doc),
                            ordered: false,
                            batchSize: this.batchSize,
                            skipExistingIds: false
                        }
                    );
                } catch (e) {
                    console.error(e);
                    console.log(`Got error ${e}.  At ${this.startFromIdContainer.startFromId}`);
                }
                console.log(`Finished loop ${collectionName}`);
            }
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
    FixReferenceSourceAssigningAuthorityRunner
};
