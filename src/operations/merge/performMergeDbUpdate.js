const {preSaveAsync} = require('../common/preSave');

/**
 * performs the db update
 * @param {Object} resourceToMerge
 * @param {Object} doc
 * @param {Object} cleaned
 * @param {string} baseVersion
 * @param {DatabaseBulkInserter} databaseBulkInserter
 * @returns {Promise<void>}
 */
async function performMergeDbUpdateAsync(resourceToMerge, doc, cleaned,
                                         baseVersion,
                                         databaseBulkInserter) {
    let id = resourceToMerge.id;

    await preSaveAsync(doc);

    delete doc['_id'];

    // Insert/update our resource record
    // When using the $set operator, only the specified fields are updated
    // /**
    //  * @type {import('mongodb').FindAndModifyWriteOpResultObject<DefaultSchema>}
    //  */
    //let res = await collection.findOneAndUpdate({id: id.toString()}, {$set: doc}, {upsert: true});
    await databaseBulkInserter.replaceOneAsync(resourceToMerge.resourceType, id.toString(), doc);

    /**
     * @type {import('mongodb').Document}
     */
    let history_resource = Object.assign(cleaned, {_id: id + cleaned.meta.versionId});
    // Insert our resource record to history but don't assign _id
    delete history_resource['_id']; // make sure we don't have an _id field when inserting into history
    // await history_collection.insertOne(history_resource);
    await databaseBulkInserter.insertOneHistoryAsync(resourceToMerge.resourceType, doc);
}

/**
 * performs the db insert
 * @param {Object} resourceToMerge
 * @param {Object} doc
 * @param {Object} cleaned
 * @param {string} baseVersion
 * @param {DatabaseBulkInserter} databaseBulkInserter
 * @returns {Promise<void>}
 */
async function performMergeDbInsertAsync(resourceToMerge, doc, cleaned,
                                         baseVersion,
                                         databaseBulkInserter) {
    let id = resourceToMerge.id;

    await preSaveAsync(doc);

    delete doc['_id'];

    // Insert/update our resource record
    // When using the $set operator, only the specified fields are updated
    // /**
    //  * @type {import('mongodb').FindAndModifyWriteOpResultObject<DefaultSchema>}
    //  */
    //let res = await collection.findOneAndUpdate({id: id.toString()}, {$set: doc}, {upsert: true});
    await databaseBulkInserter.insertOneAsync(resourceToMerge.resourceType, doc);

    /**
     * @type {import('mongodb').Document}
     */
    let history_resource = Object.assign(cleaned, {_id: id + cleaned.meta.versionId});
    // Insert our resource record to history but don't assign _id
    delete history_resource['_id']; // make sure we don't have an _id field when inserting into history
    // await history_collection.insertOne(history_resource);
    await databaseBulkInserter.insertOneHistoryAsync(resourceToMerge.resourceType, doc);
}

module.exports = {
    performMergeDbUpdateAsync,
    performMergeDbInsertAsync
};
