const {isTrue} = require('../../../utils/isTrue');
const env = require('var');
const globals = require('../../../globals');
const {AUDIT_EVENT_CLIENT_DB, ATLAS_CLIENT_DB, CLIENT_DB} = require('../../../constants');
const {getOrCreateCollection} = require('../../../utils/mongoCollectionManager');
const {preSaveAsync} = require('../../common/preSave');

/**
 * performs the db update
 * @param {Object} resourceToMerge
 * @param {Object} doc
 * @param {Object} cleaned
 * @param {string} baseVersion
 * @param {string} collectionName
 * @returns {Promise<{created: boolean, id: *, updated: any, resource_version}>}
 */
async function performMergeDbUpdateAsync(resourceToMerge, doc, cleaned, baseVersion, collectionName) {
    let id = resourceToMerge.id;

    /**
     * @type {boolean}
     */
    const useAtlas = isTrue(env.USE_ATLAS);
    /**
     * mongo db connection
     * @type {import('mongodb').Db}
     */
    let db = (resourceToMerge.resourceType === 'AuditEvent') ?
        globals.get(AUDIT_EVENT_CLIENT_DB) : (useAtlas && globals.has(ATLAS_CLIENT_DB)) ?
            globals.get(ATLAS_CLIENT_DB) : globals.get(CLIENT_DB);
    /**
     * @type {import('mongodb').Collection}
     */
    let collection = await getOrCreateCollection(db, `${resourceToMerge.resourceType}_${baseVersion}`);

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
     * @type {import('mongodb').Collection}
     */
    let history_collection = await getOrCreateCollection(db, `${collectionName}_${baseVersion}_History`);
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
