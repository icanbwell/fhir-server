/**
 * This route handler implements the /stats endpoint which shows the collections in mongo and the number of records in each
 */

const async = require('async');
const env = require('var');
const {RethrownError} = require('../utils/rethrownError');
const {logInfo} = require('../operations/common/logging');

/**
 * Handles stats
 * @param {function (): SimpleContainer} fnGetContainer
 * @param {import('http').IncomingMessage} req
 * @param {import('express').Response} res
 * @return {Promise<void>}
 */
// eslint-disable-next-line no-unused-vars
module.exports.handleStats = async ({fnGetContainer, req, res}) => {
    logInfo('Running stats', {});

    /**
     * gets stats for a collection
     * @param {string} collection_name
     * @param {import('mongodb').Db} db
     * @return {Promise<{name, count: number, indexes: Omit<IndexInfo, 'v'>[]}>}
     */
    async function getStatsForCollectionAsync (collection_name, db) {
        logInfo(collection_name, {});
        const count = await db.collection(collection_name).estimatedDocumentCount();
        /**
         * @typedef {{ key: {[keyName: string]: number; v: number}; name: string}} IndexInfo
         * @type {IndexInfo[]}
         */
        const indexes = await db.collection(collection_name).indexes();
        logInfo(['Fetched index for collection: ', collection_name].join(''), { indexes });
        logInfo(['Found: ', count, ' documents in ', collection_name].join(''), {});
        return {name: collection_name, count: count, indexes: indexes.map((i) => ({ key: i.key, name: i.name }))};
    }

    const container = fnGetContainer();
    /**
     * @type {MongoDatabaseManager}
     */
    const mongoDatabaseManager = container.mongoDatabaseManager;
    try {
        /**
         * @type {import('mongodb').Db}
         */
        const db = await mongoDatabaseManager.getClientDbAsync();
        let collection_names = [];

        for await (const /** @type {{name: string, type: string}} */ collection of db.listCollections(
            {}, {nameOnly: true})) {
            if (collection.name.indexOf('system.') === -1) {
                collection_names.push(collection.name);
            }
        }

        collection_names = collection_names.sort((a, b) => a.localeCompare(b));
        logInfo(`Collection_names: ${collection_names}`, {});
        const collection_stats = await async.map(
            collection_names,
            async (collection_name) => await getStatsForCollectionAsync(collection_name, db)
        );
        const mongoConfig = await mongoDatabaseManager.getClientConfigAsync();
        res.status(200).json({
            success: true,
            image: env.DOCKER_IMAGE || '',
            database: mongoConfig.db_name,
            collections: collection_stats
        });
    } catch (error) {
        throw new RethrownError({
            error
        });
    }
};
