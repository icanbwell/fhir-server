/**
 * This route handler implements the /stats endpoint which shows the collections in mongo and the number of records in each
 */

const {mongoConfig} = require('../config');
// const env = require('var');
const {createClientAsync, disconnectClientAsync} = require('../utils/connect');

module.exports.handleAdmin = async (req, res) => {
    console.info('Running admin');
    /**
     * @type {import('mongodb').MongoClient}
     */
    const client = await createClientAsync(mongoConfig);
    try {
        /**
         * @type {string}
         */
        const scope = req.authInfo && req.authInfo.scope;
        const home_options = {};
        const filePath = __dirname + '/../views/admin/pages/index';
        console.log(`file: ${filePath}.  scope: ${scope}`);
        return res.render(filePath, home_options);
        // }
        //     res.status(200).json({
        //         success: true,
        //         image: env.DOCKER_IMAGE || '',
        //     });
        // res.set('Content-Type', 'text/html');
        // res.send(Buffer.from('<html><body><h2>Test String</h2></body></html>'));
    } finally {
        await disconnectClientAsync(client);
    }
};
