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
            ownerCode
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
         * @type {string| undefined}
         */
        this.ownerCode = ownerCode;
    }


    /**
     * @description Updates the link of resources by removing
     * @param {Resource} resource
     * @returns
     */
    async removeDuplicateLinks(resource) {
        const uniqueLinks = [];
        for (const currentLink of resource.link) {
            if (!uniqueLinks.some(prevLink => deepEqual(prevLink, currentLink))) {
                uniqueLinks.push(currentLink);
            }
        }
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

    /**
     * Runs a loop to process all the documents and remove duplicate person links
     * @returns {Promise<void>}
     */
    async processAsync() {
        await this.init();
        const collectionName = 'Person_4_0_0';
        this.startFromIdContainer.startFromId = '';
        const db = await this.mongoDatabaseManager.getClientDbAsync();
        const dbCollection = await this.mongoCollectionManager.getOrCreateCollectionAsync(
            {
                db: db, collectionName: collectionName
            }
        );
        const query = {};
        // Filter to process only certain documents which match an uuid
        const personUuidQuery = this.personUuids ?
            { _uuid: { $in: this.personUuids } } :
            {};
        // Filter to process only certain documents depending on the owner code passed.
        const ownerFilter = this.ownerCode ?
            { 'meta.security': { $elemMatch: { 'system': 'https://www.icanbwell.com/owner', 'code': this.ownerCode }} } :
            {};

        const result = await dbCollection.find({
            link: {$exists: true},
            $expr: { $gt: [{ $size: '$link' }, this.minLinks] },
            ...personUuidQuery,
            ...ownerFilter
        }, { projection: { _uuid: 1 }}).batchSize(this.batchSize);
        let uuidList = [];
        while (await result.hasNext()) {
            let document = await result.next();
            uuidList.push(document._uuid);
        }
        this.adminLogger.logInfo(`Toal resources: ${uuidList.length}`);

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
        this.adminLogger.logInfo(`Finished loop ${collectionName}`);
        this.adminLogger.logInfo('Finished script');
        this.adminLogger.logInfo('Shutting down');
        await this.shutdown();
        this.adminLogger.logInfo('Shutdown finished');
    }
}

module.exports = {
    RemoveDuplicatePersonLinkRunner
};
