/**
 * This route handler implements the /stats endpoint which shows the collections in mongo and the number of records in each
 */

const {mongoConfig} = require('../config');
// const env = require('var');
const {createClientAsync, disconnectClientAsync} = require('../utils/connect');
const {AdminLogManager} = require('../admin/adminLogManager');

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
        const filePath = __dirname + '/../views/admin/pages/index';
        console.log(`file: ${filePath}.  scope: ${scope}`);
        /**
         * @type {string[]}
         */
        const scopes = scope.split(' ');
        const adminScopes = scopes.filter(s => s.startsWith('admin/'));
        if (adminScopes.length > 0) {
            const home_options = {};
            // console.log(`req.params: ${JSON.stringify(req.params)}`);
            console.log(`req.query: ${JSON.stringify(req.query)}`);
            const id = req.query['id'];
            if (id) {
                const json = await (new AdminLogManager()).getLogAsync(id);
                return res.json(json);
            }
            return res.render(filePath, home_options);
        } else {
            return res.status(403).json({
                message: `Missing scopes for admin/*.read in ${scope}`
            });
        }
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
