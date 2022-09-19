/**
 * This route handler implements the /stats endpoint which shows the collections in mongo and the number of records in each
 */

const {mongoConfig} = require('../config');
// const env = require('var');
const {createClientAsync, disconnectClientAsync} = require('../utils/connect');
const {AdminLogManager} = require('../admin/adminLogManager');
const sanitize = require('sanitize-filename');

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
        // console.info('Running index');
        const operation = req.params['op'];
        console.log(`op=${operation}`);

        // console.log(`file: ${filePath}.  scope: ${scope}`);
        /**
         * @type {string[]}
         */
        const scopes = scope.split(' ');
        const adminScopes = scopes.filter(s => s.startsWith('admin/'));
        if (adminScopes.length > 0) {
            switch (operation) {
                case 'searchLog': {
                    const parameters = {};
                    const filePath = __dirname + `/../views/admin/pages/${sanitize(operation)}`;
                    return res.render(filePath, parameters);
                }

                case 'searchLogResults': {
                    console.log(`req.query: ${JSON.stringify(req.query)}`);
                    const id = req.query['id'];
                    if (id) {
                        const json = await (new AdminLogManager()).getLogAsync(id);
                        // const filePath = __dirname + `/../views/admin/pages/${sanitize(operation)}`;
                        // const parameters = {
                        //     id,
                        //     json
                        // };
                        return res.json(json);
                        // return res.render(filePath, parameters);
                    }
                    return res.json({
                        message: 'No id passed'
                    });
                }

                default: {
                    const filePath = __dirname + '/../views/admin/pages/index';
                    return res.render(filePath, {});
                }
            }
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
