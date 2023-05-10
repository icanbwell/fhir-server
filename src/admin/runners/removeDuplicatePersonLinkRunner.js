const { assertTypeEquals } = require('../../utils/assertType');
const { MongoCollectionManager } = require('../../utils/mongoCollectionManager');
const { MongoDatabaseManager } = require('../../utils/mongoDatabaseManager');
const { AdminLogger } = require('../adminLogger');

class RemoveDuplicatePersonLinkRunner {
    /**
     * Constructor
     * @param {AdminLogger} adminLogger
     * @param {MongoDatabaseManager} mongoDatabaseManager
     * @param {MongoCollectionManager} mongoCollectionManager
     * @param {number} maximumLinkSize
     * @param {Object} personUuids
     */
    constructor (
        {
            adminLogger,
            mongoDatabaseManager,
            mongoCollectionManager,
            maximumLinkSize,
            personUuids,
        }
    ) {
        /**
         * @type {AdminLogger}
         */
        this.adminLogger = adminLogger;
        assertTypeEquals(adminLogger, AdminLogger);

        /**
         * @type {MongoDatabaseManager}
         */
        this.mongoDatabaseManager = mongoDatabaseManager;
        assertTypeEquals(mongoDatabaseManager, MongoDatabaseManager);

        /**
         * @type {MongoCollectionManager}
         */
        this.mongoCollectionManager = mongoCollectionManager;
        assertTypeEquals(mongoCollectionManager, MongoCollectionManager);

        /**
         * @type {number}
         */
        this.maximumLinkSize = maximumLinkSize;

        /**
         * @type {Object}
         */
        this.personUuids = personUuids;
    }


    /**
     * Runs a loop to process all the documents and remove duplicate person links
     * @returns {Promise<void>}
     */
    async processAsync() {
        const collectionName = 'Person_4_0_0';
        const db = await this.mongoDatabaseManager.getClientDbAsync();
        const dbCollection = await this.mongoCollectionManager.getOrCreateCollectionAsync(
            {
                db: db, collectionName: collectionName
            }
        );
        // Filter to process only certain documents which match an uuid.
        const personUuidQuery = this.personUuids ?
            { _uuid: { $in: this.personUuids } } :
            {};

        const resourcesIdCursor = await dbCollection.aggregate([
            // Extract all documents that have multiple links in person records
            {
                '$match': {
                    '$and': [
                        {link: {$exists: true}},
                        {$expr: { $gt: [{ $size: '$link' }, this.maximumLinkSize] }},
                        personUuidQuery
                    ]
                }
            },
            // Creates a new document for each array element inside the link
            {
                '$unwind': {
                    path: '$link'
                }
            },
            // Group elements depending on its uuid, and $addToSet helps in selecting unique values only.
            {
                '$group': {
                    _id: '$_uuid',
                    uniqueLinks: {
                        $addToSet: {
                            target: '$link.target',
                            assurance: {
                                $cond: {
                                    if: { $ne: [ '$link.assurance', null ] },
                                    then: '$link.assurance',
                                    else: '$$REMOVE'
                                }
                            }
                        }
                    },
                }
            }
        ]);

        const resources = await resourcesIdCursor.toArray();
        this.adminLogger.logInfo(`Total documents with duplicate person links: ${resources.length}`);

        let totalUpdatedDocuments = 0; // Keep tracks of all the documents that has been updated.
        let documentsContainingUniqueinks = 0; // Keep tracks of all documents that have all links unique
        for (const resource of resources) {
            this.adminLogger.logInfo(
                `Processing document with _uuid as ${resource._id}`
            );

            try {
                // Update document only if link array size != to the size of unique links
                let result = await dbCollection.updateOne(
                    {
                        _uuid: resource._id,
                        $expr: {
                            $ne: [ { $size: '$link' }, { $size: { $literal: resource.uniqueLinks } } ]
                        }
                    },
                    {
                        $set: {'link': resource.uniqueLinks}
                    }
                );
                if (result.modifiedCount === 1) {
                    totalUpdatedDocuments += 1;
                    this.adminLogger.logInfo(
                        `Updated resource with _uuid: ${resource._id}`
                    );
                }
                if (result.matchedCount === 0) {
                    documentsContainingUniqueinks += 1;
                }
            } catch (e) {
                this.adminLogger.logError(`Error: ${e}`);
            }
        }
        this.adminLogger.logInfo(
            `Total documents updated: ${totalUpdatedDocuments}, 
            document were all links are unique but number of links greater than ${this.maximumLinkSize}: ${documentsContainingUniqueinks}`
        );
    }
}

module.exports = {
    RemoveDuplicatePersonLinkRunner
};
