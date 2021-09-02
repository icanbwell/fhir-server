const asyncHandler = require('../lib/async-handler');
const mongoClient = require('../lib/mongo');
const {mongoConfig} = require('../config');
const async = require('async');

/**
 * creates an index if it does not exist
 * @param {Db} db
 * @param {string} property_to_index
 * @param {string} collection_name
 * @return {Promise<boolean>}
 */
async function create_index_if_not_exists(db, property_to_index, collection_name) {
    const index_name = property_to_index + '_1';
    if (!await db.collection(collection_name).indexExists(index_name)) {
        console.log('Creating index ' + index_name + ' in ' + collection_name);
        const my_dict = {};
        my_dict[String(property_to_index)] = 1;
        await db.collection(collection_name).createIndex(my_dict);
        return true;
    }
    return false;
}

/**
 * creates an multi key index if it does not exist
 * @param {Db} db
 * @param {string[]} properties_to_index
 * @param {string} collection_name
 * @return {Promise<boolean>}
 */
async function create_multikey_index_if_not_exists(db, properties_to_index, collection_name) {
    const index_name = properties_to_index.join('_') + '_1';
    if (!await db.collection(collection_name).indexExists(index_name)) {
        console.log('Creating multi key index ' + index_name + ' in ' + collection_name);
        const my_dict = {};
        for (const property_to_index of properties_to_index) {
            my_dict[String(property_to_index)] = 1;
        }
        await db.collection(collection_name).createIndex(my_dict);
        return true;
    }
    return false;
}

/**
 * creates indexes on a collection
 * @param {string} collection_name
 * @param {Db} db
 * @return {Promise<{indexes: *, createdIndex: boolean, name, count: *}>}
 */
async function indexCollection(collection_name, db) {
    console.log(collection_name);
    // check if index exists
    let createdIndex = await create_index_if_not_exists(db, 'id', collection_name);
    createdIndex = await create_index_if_not_exists(db, 'meta.lastUpdated', collection_name) || createdIndex;
    createdIndex = await create_index_if_not_exists(db, 'meta.source', collection_name) || createdIndex;
    createdIndex = await create_multikey_index_if_not_exists(db, ['meta.security.system', 'meta.security.code'], collection_name) || createdIndex;
    const indexes = await db.collection(collection_name).indexes();
    const count = await db.collection(collection_name).countDocuments({});
    console.log(['Found: ', count, ' documents in ', collection_name].join(''));
    return {
        name: collection_name,
        count: count,
        createdIndex: createdIndex,
        indexes: indexes
    };
}

// noinspection UnnecessaryLocalVariableJS
async function indexAllCollections() {
    // eslint-disable-next-line no-unused-vars
    let [mongoError, client] = await asyncHandler(
        mongoClient(mongoConfig.connection, mongoConfig.options)
    );

    //create client by providing database name
    const db = client.db(mongoConfig.db_name);
    const collection_names = [];
    // const collections = await db.listCollections().toArray();

    await db.listCollections().forEach(collection => {
        console.log(collection.name);
        if (collection.name.indexOf('system.') === -1) {
            collection_names.push(collection.name);
        }
    });

    // now add custom indices
    const practitionerRoleCollection = 'PractitionerRole_4_0_0';
    if (collection_names.includes(practitionerRoleCollection)) {
        await create_index_if_not_exists(db, 'practitioner.reference', practitionerRoleCollection);
        await create_index_if_not_exists(db, 'organization.reference', practitionerRoleCollection);
        await create_index_if_not_exists(db, 'location.reference', practitionerRoleCollection);
    }

    // now add indices on id column for every collection
    console.info('Collection_names:' + collection_names);
    const collection_stats = await async.map(
        collection_names,
        async collection_name => await indexCollection(collection_name, db)
    );

    await client.close();
    return collection_stats;
}

async function getIndexesInCollection(collection_name, db) {
    console.log(collection_name);
    // check if index exists
    const indexes = await db.collection(collection_name).indexes();
    return {
        name: collection_name,
        indexes: indexes
    };
}

async function getIndexesInAllCollections() {
    // eslint-disable-next-line no-unused-vars
    let [mongoError, client] = await asyncHandler(
        mongoClient(mongoConfig.connection, mongoConfig.options)
    );

    //create client by providing database name
    const db = client.db(mongoConfig.db_name);
    const collection_names = [];
    // const collections = await db.listCollections().toArray();

    await db.listCollections().forEach(collection => {
        console.log(collection.name);
        if (collection.name.indexOf('system.') === -1) {
            collection_names.push(collection.name);
        }
    });

    // now add indices on id column for every collection
    console.info('Collection_names:' + collection_names);
    const collection_stats = await async.map(
        collection_names,
        async collection_name => await getIndexesInCollection(collection_name, db)
    );

    await client.close();
    return collection_stats;
}

module.exports = {
    indexAllCollections,
    getIndexesInAllCollections
};
