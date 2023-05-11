const { assertIsValid } = require('../../utils/assertType');
const deepEqual = require('fast-deep-equal');
const moment = require('moment-timezone');
const { BaseBulkOperationRunner } = require('./baseBulkOperationRunner');
const { FhirResourceCreator } = require('../../fhir/fhirResourceCreator');

class RemoveDuplicatePersonLinkRunner extends BaseBulkOperationRunner {
    /**
     * Constructor
     * @param {AdminLogger} adminLogger
     * @param {MongoDatabaseManager} mongoDatabaseManager
     * @param {MongoCollectionManager} mongoCollectionManager
     * @param {number} minLinks
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
            personUuids,
            limit,
            skip,
            minLinks,
            batchSize,
            ownerCode,
            uuidGreaterThan
        }
    ) {
        super({
            mongoCollectionManager,
            batchSize,
            adminLogger,
            mongoDatabaseManager,
        });

        /**
         * @type {number}
         */
        this.minLinks = minLinks;

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

        this.collectionName = 'Person_4_0_0';
    }


    /**
     * @description Updates the link of resources by removing
     * @param {Resource} resource
     * @returns
     */
    async removeDuplicateLinks(resource) {
        const links = resource.link.map(link => JSON.stringify(link));
        const uniqueLinkSet = [...new Set(links)];
        const uniqueLinks = uniqueLinkSet.map(linkString => JSON.parse(linkString));
        resource.link = uniqueLinks;
        return resource;
    }

    /**
     * returns the bulk operation for this doc
     * @param {import('mongodb').DefaultSchema} doc
     * @returns {Promise<(import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>)[]>}
     */
    async processRecordAsync(doc) {
        const operations = [];
        assertIsValid(doc.resourceType);
        /**
         * @type {Resource}
         */
        const currentResource = FhirResourceCreator.create(doc);
        let resource = currentResource.clone();
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

    async processBatch(uuidList) {
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
                    useTransaction: true,
                    skip: this.skip,
                    filterToIdProperty: '_uuid',
                    filterToIds: uuidList,
                },
            );
        } catch (e) {
            this.adminLogger.logError(`Got error ${e}.  At ${this.startFromIdContainer.startFromId}`);
        }
    }
    /**
     * Runs a loop to process all the documents and remove duplicate person links
     * @returns {Promise<void>}
     */
    async processAsync() {
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
        // Filter to process only certain documents depending on the owner code passed.
        const ownerFilter = this.ownerCode ?
            { 'meta.security': { $elemMatch: { 'system': 'https://www.icanbwell.com/owner', 'code': this.ownerCode }} } :
            {};
        // Fetch onlu uuid that are greater than uuidGreaterThan
        const uuidGreaterThanQuery = this.uuidGreaterThan ?
            { _uuid: { $gt: this.uuidGreaterThan}} :
            {};

        const result = await dbCollection.find({
            link: {$exists: true},
            $expr: { $gt: [{ $size: '$link' }, this.minLinks] },
            ...personUuidQuery,
            ...ownerFilter,
            ...uuidGreaterThanQuery
        }, { projection: { _uuid: 1 }}).sort({_uuid: -1}).batchSize(this.batchSize);
        let uuidList = [];
        // Remove duplicates and update in batches.
        while (await result.hasNext()) {
            let document = await result.next();
            uuidList.push(document._uuid);
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
