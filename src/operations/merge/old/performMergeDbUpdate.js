const {isTrue} = require('../../../utils/isTrue');
const env = require('var');
const {preSaveAsync} = require('../../common/preSave');
const {
    getOrCreateCollectionForResourceTypeAsync,
    getOrCreateHistoryCollectionForResourceTypeAsync
} = require('../../common/resourceManager');

/**
 * performs the db update
 * @param {Resource} resourceToMerge
 * @param {Object} doc
 * @param {Object} cleaned
 * @param {string} baseVersion
 * @returns {Promise<{created: boolean, id: *, updated: any, resource_version}>}
 */
async function performMergeDbUpdateAsync(resourceToMerge, doc, cleaned, baseVersion) {
    let id = resourceToMerge.id;

    /**
     * @type {boolean}
     */
    const useAtlas = isTrue(env.USE_ATLAS);

    /**
     * @type {import('mongodb').Collection<import('mongodb').DefaultSchema>}
     */
    const collection = await getOrCreateCollectionForResourceTypeAsync(resourceToMerge.resourceType, baseVersion, useAtlas);

    await preSaveAsync(doc);

    delete doc['_id'];

    // Insert/update our resource record
    // When using the $set operator, only the specified fields are updated
    /**
     * @type {import('mongodb').FindAndModifyWriteOpResultObject<DefaultSchema>}
     */
    let res = await collection.findOneAndUpdate({id: id.toString()}, {$set: doc}, {upsert: true});

    // save to history
    /**
     * @type {import('mongodb').Collection<import('mongodb').DefaultSchema>}
     */
    const history_collection = await getOrCreateHistoryCollectionForResourceTypeAsync(resourceToMerge.resourceType, baseVersion, useAtlas);
    /**
     * @type {import('mongodb').Document}
     */
    let history_resource = Object.assign(cleaned, {_id: id + cleaned.meta.versionId});
    /**
     * @type {boolean}
     */
    const created_entity = res.lastErrorObject && !res.lastErrorObject.updatedExisting;
    // Insert our resource record to history but don't assign _id
    delete history_resource['_id']; // make sure we don't have an _id field when inserting into history
    await history_collection.insertOne(history_resource);
    return {
        id: id,
        created: created_entity,
        updated: res.lastErrorObject.updatedExisting,
        resource_version: doc.meta.versionId
    };
}

module.exports = {
    performMergeDbUpdateAsync
};
