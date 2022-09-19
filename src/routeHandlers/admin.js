/**
 * This route handler implements the /stats endpoint which shows the collections in mongo and the number of records in each
 */

const { mongoConfig } = require('../config');
const env = require('var');
const { createClientAsync, disconnectClientAsync } = require('../utils/connect');

module.exports.handleAdmin = async (req, res) => {
    console.info('Running admin');
    /**
     * @type {import("mongodb").MongoClient}
     */
    const client = await createClientAsync(mongoConfig);
    try {
    //     (req, res) => {
    //     const home_options = {};
    //     return res.render(__dirname + 'admin/views/pages', home_options);
    // }
        res.status(200).json({
            success: true,
            image: env.DOCKER_IMAGE || '',
        });
    } finally {
        await disconnectClientAsync(client);
    }
};
