const { assertIsValid, assertTypeEquals } = require('../../utils/assertType');
const deepEqual = require('fast-deep-equal');
const moment = require('moment-timezone');
const { BaseBulkOperationRunner } = require('./baseBulkOperationRunner');
const { FhirResourceCreator } = require('../../fhir/fhirResourceCreator');
const { PreSaveManager } = require('../../preSaveHandlers/preSave');

class RemoveDuplicatePersonLinkRunner extends BaseBulkOperationRunner {
    /**
     * Constructor
     * @param {AdminLogger} adminLogger
     * @param {MongoDatabaseManager} mongoDatabaseManager
     * @param {MongoCollectionManager} mongoCollectionManager
     * @param {PreSaveManager} preSaveManager
     * @param {Object} personUuids
     * @param {number} limit
     * @param {number} skip
     * @param {number} batchSize
     * @param {string|undefined} ownerCode
     * @param {string|undefined} uuidGreaterThan
     */
    constructor (
        {
            adminLogger,
            mongoDatabaseManager,
            mongoCollectionManager,
            preSaveManager,
            personUuids,
            limit,
            skip,
            batchSize,
            ownerCode,
            uuidGreaterThan
        }
    ) {
        super({
            mongoCollectionManager,
            batchSize,
            adminLogger,
            mongoDatabaseManager
        });

        /**
         * @type {PreSaveManager}
         */
        this.preSaveManager = preSaveManager;
        assertTypeEquals(preSaveManager, PreSaveManager);

        /**
         * @type {Object}
         */
        this.personUuids = personUuids;

        /**
         * @type {number}
         */
        this.batchSize = batchSize;

        /**
         * @type {number|undefined}
         */
        this.limit = limit;

        /**
         * @type {number|undefined}
         */
        this.skip = skip;

        /**
         * @type {string|undefined}
         */
        this.ownerCode = ownerCode;

        /**
         * @type {string|undefined}
         */
        this.uuidGreaterThan = uuidGreaterThan;

        /**
         * @type {string}
         */
        this.collectionName = 'Person_4_0_0';
    }

    /**
     * @description Updates the link of resources by removing
     * @param {Resource} resource
     * @returns
     */
    async removeDuplicateLinks (resource) {
        const linkSet = new Set();
        resource.link = resource.link.reduce((uniqueLinks, link) => {
            const reference = link?.target?._uuid;
            if (!linkSet.has(reference)) {
                linkSet.add(reference);
                uniqueLinks.push(link);
            }
            return uniqueLinks;
        }, []);

        return resource;
    }

    /**
     * returns the bulk operation for this doc
     * @param {import('mongodb').DefaultSchema} doc
     * @returns {Promise<(import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>)[]>}
     */
    async processRecordAsync (doc) {
        const operations = [];
        assertIsValid(doc.resourceType);
        /**
         * @type {Resource}
         */
        const currentResource = FhirResourceCreator.create(doc);
        let resource = currentResource.clone();

        resource = await this.preSaveManager.preSaveAsync(resource);
        /**
         * @type {Resource}
         */
        const updatedResource = await this.removeDuplicateLinks(resource);
        // for speed, first check if the incoming resource is exactly the same
        const updatedResourceJsonInternal = updatedResource.toJSONInternal();
        const currentResourceJsonInternal = currentResource.toJSONInternal();
        if (deepEqual(updatedResourceJsonInternal.link, currentResourceJsonInternal.link) === true) {
            return operations;
        }

        /**
         * @type {import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>}
         */
        // batch up the calls to update
        updatedResource.meta.lastUpdated = new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ssZ'));
        const result = { replaceOne: { filter: { _id: doc._id }, replacement: updatedResource.toJSONInternal() } };
        operations.push(result);
        return operations;
    }

    async processBatch (uuidList) {
        const query = {};
        try {
            this.adminLogger.logInfo(`Total resources being processed: ${uuidList.length}`);
            await this.runForQueryBatchesAsync(
                {
                    config: await this.mongoDatabaseManager.getClientConfigAsync(),
                    sourceCollectionName: this.collectionName,
                    destinationCollectionName: this.collectionName,
                    query,
                    projection: undefined,
                    startFromIdContainer: this.startFromIdContainer,
                    fnCreateBulkOperationAsync: async (doc) => await this.processRecordAsync(doc),
                    ordered: false,
                    batchSize: this.batchSize,
                    skipExistingIds: false,
                    limit: this.limit,
                    useTransaction: false,
                    skip: this.skip,
                    filterToIdProperty: '_uuid',
                    filterToIds: uuidList
                }
            );
        } catch (e) {
            this.adminLogger.logError(`Got error ${e.message}.  At ${this.startFromIdContainer.startFromId}`);
        }
    }

    /**
     * Runs a loop to process all the documents and remove duplicate person links
     * @returns {Promise<void>}
     */
    async processAsync () {
        await this.init();
        this.startFromIdContainer.startFromId = '';
        const db = await this.mongoDatabaseManager.getClientDbAsync();
        const dbCollection = await this.mongoCollectionManager.getOrCreateCollectionAsync(
            {
                db: db, collectionName: this.collectionName
            }
        );
        // Filter to process only certain documents which match an uuid
        const personUuidQuery = this.personUuids ?
            { _uuid: { $in: this.personUuids } } :
            {};

        // Fetch only uuid that are greater than uuidGreaterThan
        const uuidGreaterThanQuery = this.uuidGreaterThan ?
            { _uuid: { $gt: this.uuidGreaterThan } } :
            {};

        const result = dbCollection.aggregate([
            { $unwind: '$link' },
            {
                $group: {
                    _id: { link: '$link.target._uuid', _uuid: '$_uuid' },
                    count: { $sum: 1 }
                }
            },
            {
 $match: {
                count: { $gt: 1 },
                ...personUuidQuery,
                ...uuidGreaterThanQuery
            }
},
            { $project: { uuid: '$_id._uuid', _id: 0 } },
            {
                $group: {
                    _id: '$uuid'
                }
            }
        ],
        { allowDiskUse: true }
        );
        let uuidList = [];
        // Remove duplicates and update in batches.
        while (await result.hasNext()) {
            const document = await result.next();
            uuidList.push(document._id);
            if (uuidList.length === this.batchSize) {
                await this.processBatch(uuidList);
                uuidList = [];
            }
        }
        // If the cursor goes empty but uuid still need to processed.
        if (uuidList.length !== 0) {
            await this.processBatch(uuidList);
        }
        this.adminLogger.logInfo(`Finished loop ${this.collectionName}`);
        this.adminLogger.logInfo('Finished script');
        this.adminLogger.logInfo('Shutting down');
        await this.shutdown();
        this.adminLogger.logInfo('Shutdown finished');
    }
}

module.exports = {
    RemoveDuplicatePersonLinkRunner
};
