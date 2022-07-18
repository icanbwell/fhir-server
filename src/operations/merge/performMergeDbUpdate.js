const {preSaveAsync} = require('../common/preSave');

/**
 * performs the db update
 * @param {Object} resourceToMerge
 * @param {Object} doc
 * @param {Object} cleaned
 * @param {string} baseVersion
 * @param {string} collectionName
 * @param {DatabaseBulkInserter} databaseBulkInserter
 * @returns {Promise<void>}
 */
async function performMergeDbUpdateAsync(resourceToMerge, doc, cleaned,
                                         baseVersion, collectionName,
                                         databaseBulkInserter) {
    let id = resourceToMerge.id;

    const dbCollectionName = `${resourceToMerge.resourceType}_${baseVersion}`;
    await preSaveAsync(doc);

    delete doc['_id'];

    // Insert/update our resource record
    // When using the $set operator, only the specified fields are updated
    // /**
    //  * @type {import('mongodb').FindAndModifyWriteOpResultObject<DefaultSchema>}
    //  */
    //let res = await collection.findOneAndUpdate({id: id.toString()}, {$set: doc}, {upsert: true});
    await databaseBulkInserter.replaceOne(dbCollectionName, id.toString(), doc);

    // save to history
    const historyCollectionName = `${collectionName}_${baseVersion}_History`;
    /**
     * @type {import('mongodb').Document}
     */
    let history_resource = Object.assign(cleaned, {_id: id + cleaned.meta.versionId});
    // Insert our resource record to history but don't assign _id
    delete history_resource['_id']; // make sure we don't have an _id field when inserting into history
    // await history_collection.insertOne(history_resource);
    await databaseBulkInserter.insertOne(historyCollectionName, doc);
}

/**
 * performs the db insert
 * @param {Object} resourceToMerge
 * @param {Object} doc
 * @param {Object} cleaned
 * @param {string} baseVersion
 * @param {string} collectionName
 * @param {DatabaseBulkInserter} databaseBulkInserter
 * @returns {Promise<void>}
 */
async function performMergeDbInsertAsync(resourceToMerge, doc, cleaned,
                                         baseVersion, collectionName,
                                         databaseBulkInserter) {
    let id = resourceToMerge.id;

    const dbCollectionName = `${resourceToMerge.resourceType}_${baseVersion}`;
    await preSaveAsync(doc);

    delete doc['_id'];

    // Insert/update our resource record
    // When using the $set operator, only the specified fields are updated
    // /**
    //  * @type {import('mongodb').FindAndModifyWriteOpResultObject<DefaultSchema>}
    //  */
    //let res = await collection.findOneAndUpdate({id: id.toString()}, {$set: doc}, {upsert: true});
    await databaseBulkInserter.insertOne(dbCollectionName, doc);

    // save to history
    const historyCollectionName = `${collectionName}_${baseVersion}_History`;
    /**
     * @type {import('mongodb').Document}
     */
    let history_resource = Object.assign(cleaned, {_id: id + cleaned.meta.versionId});
    // Insert our resource record to history but don't assign _id
    delete history_resource['_id']; // make sure we don't have an _id field when inserting into history
    // await history_collection.insertOne(history_resource);
    await databaseBulkInserter.insertOne(historyCollectionName, doc);
}

module.exports = {
    performMergeDbUpdateAsync,
    performMergeDbInsertAsync
};
