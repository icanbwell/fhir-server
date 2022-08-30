/**
 * This route handler implements the /stats endpoint which shows the collections in mongo and the number of records in each
 */

const { mongoConfig } = require('../config');
const async = require('async');
const env = require('var');
const { createClientAsync, disconnectClientAsync } = require('../utils/connect');
const { CLIENT_DB } = require('../constants');

module.exports.handleStats = async (req, res) => {
    console.info('Running stats');

    /**
     * gets stats for a collection
     * @param {string} collection_name
     * @param {import('mongodb').Db} db
     * @return {Promise<{name, count: *}>}
     */
    async function getStatsForCollectionAsync(collection_name, db) {
        console.log(collection_name);
        const count = await db.collection(collection_name).estimatedDocumentCount();
        console.log(['Found: ', count, ' documents in ', collection_name].join(''));
        return { name: collection_name, count: count };
    }

    /**
     * @type {import("mongodb").MongoClient}
     */
    const client = await createClientAsync(mongoConfig);
    try {
        /**
         * @type {import('mongodb').Db}
         */
        const db = client.db(CLIENT_DB);
        let collection_names = [];
        // const collections = await db.listCollections().toArray();

        for await (const collection of db.listCollections()) {
            console.log(collection.name);
            if (collection.name.indexOf('system.') === -1) {
                collection_names.push(collection.name);
            }
        }

        console.info('Collection_names:' + collection_names);
        const collection_stats = await async.map(
            collection_names,
            async (collection_name) => await getStatsForCollectionAsync(collection_name, db)
        );
        res.status(200).json({
            success: true,
            image: env.DOCKER_IMAGE || '',
            database: mongoConfig.db_name,
            collections: collection_stats,
        });
    } finally {
        await disconnectClientAsync(client);
    }
};
