// const {indexCollection} = require('./index.util');

/**
 * Gets or creates a collection
 * @param {import('mongodb').Db} db
 * @param {string} collection_name
 * @return {Promise<import('mongodb').Collection>}
 */

async function getOrCreateCollection(db, collection_name) {
    const collectionExists = await db.listCollections({name: collection_name}, {nameOnly: true}).hasNext();
    if (!collectionExists) {
        await db.createCollection(collection_name);
        // await indexCollection(collection_name, db);
    }
    return Promise.resolve(db.collection(collection_name));
}

module.exports = {
    getOrCreateCollection
};
