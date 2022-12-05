/**
 * This route handler implements the /clean route which cleans all data in the FHIR server
 */

const env = require('var');
const async = require('async');
const {mongoConfig} = require('../config');
const {MongoDatabaseManager} = require('../utils/mongoDatabaseManager');

module.exports.handleClean = async (req, res) => {
    // const query_args_array = Object.entries(req.query);
    // return res.status(200).json(req.params);
    if (!env.DISABLE_CLEAN_ENDPOINT) {
        console.info('Running clean');
        const mongoDatabaseManager = new MongoDatabaseManager();
        /**
         * @type {import('mongodb').MongoClient}
         */
        const client = await mongoDatabaseManager.createClientAsync(mongoConfig);
        try {
            /**
             * @type {import('mongodb').Db}
             */
            const db = await new MongoDatabaseManager().getClientDbAsync();
            let collection_names = [];
            // const collections = await db.listCollections().toArray();

            const specific_collection = req.params['collection'];
            console.log('specific_collection: ' + specific_collection);
            if (env.IS_PRODUCTION && !specific_collection) {
                return res
                    .status(400)
                    .json({
                        message:
                            'IS_PRODUCTION env var is set so you must pass a specific collection to clean',
                    });
            }

            for await (const collection of db.listCollections()) {
                console.log(collection.name);
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

            console.info('Collection_names:' + collection_names);
            res.status(202).json({
                status: 'processing request, check the stats endpoint for progress.',
                deleting_from_collections: collection_names,
            });
            await async.mapSeries(
                collection_names,
                async (collection_name) => await db.collection(collection_name).deleteMany({})
            );
        } finally {
            await mongoDatabaseManager.disconnectClientAsync(client);
        }
    } else {
        res.status(403).json();
    }
};
