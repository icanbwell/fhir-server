/**
 * This route handler implements the /clean route which cleans all data in the FHIR server
 */

const env = require('var');
const async = require('async');
const {RethrownError} = require('../utils/rethrownError');
const {logInfo} = require('../operations/common/logging');

/**
 * Handles clean
 * @param {function (): SimpleContainer} fnCreateContainer
 * @param {import('http').IncomingMessage} req
 * @param {import('express').Response} res
 * @return {Promise<void>}
 */
module.exports.handleClean = async ({fnCreateContainer, req, res}) => {
    if (!env.DISABLE_CLEAN_ENDPOINT) {
        logInfo('Running clean');
        const container = fnCreateContainer();
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

            const specific_collection = req.params['collection'];
            logInfo('', {'specific_collection': specific_collection});
            if (env.IS_PRODUCTION && !specific_collection) {
                return res
                    .status(400)
                    .json({
                        message:
                            'IS_PRODUCTION env var is set so you must pass a specific collection to clean',
                    });
            }

            for await (const collection of db.listCollections()) {
                logInfo(collection.name);
                if (collection.name.indexOf('system.') === -1) {
                    if (
                        !specific_collection ||
                        collection.name === specific_collection + '_4_0_0' ||
                        collection.name === specific_collection + '_4_0_0_History'
                    ) {
                        collection_names.push(collection.name);
                    }
                }
            }

            logInfo('', {'Collection_names': collection_names});
            res.status(202).json({
                status: 'processing request, check the stats endpoint for progress.',
                deleting_from_collections: collection_names,
            });
            await async.mapSeries(
                collection_names,
                async (collection_name) => await db.collection(collection_name).deleteMany({})
            );
        } catch (error) {
            throw new RethrownError({
                error
            });
        }
    } else {
        res.status(403).json();
    }
};
