/**
 * This route handler implements the /stats endpoint which shows the collections in mongo and the number of records in each
 */
const {mongoConfig} = require('../config');
// const env = require('var');
const {AdminLogManager} = require('../admin/adminLogManager');
const sanitize = require('sanitize-filename');
const {createContainer} = require('../createContainer');
const {shouldReturnHtml} = require('../utils/requestHelpers');
const env = require('var');
const {isTrue} = require('../utils/isTrue');
const {MongoDatabaseManager} = require('../utils/mongoDatabaseManager');

/**
 * Gets admin scopes from the request
 * @param {import('http').IncomingMessage} req
 * @returns {{adminScopes: string[], scope: string}}
 */
function getAdminScopes({req}) {
    /**
     * @type {string}
     */
    const scope = req.authInfo && req.authInfo.scope;
    if (!scope) {
        return {scope, adminScopes: []};
    }
    /**
     * @type {string[]}
     */
    const scopes = scope.split(' ');
    const adminScopes = scopes.filter(s => s.startsWith('admin/'));
    return {scope, adminScopes};
}

/**
 * shows indexes
 * @param {import('http').IncomingMessage} req
 * @param {SimpleContainer} container
 * @param {import('http').ServerResponse} res
 * @param {boolean|undefined} [filterToProblems]
 * @returns {Promise<*>}
 */
async function showIndexesAsync(
    {
        req, container, res,
        filterToProblems
    }) {
    console.log(`showIndexesAsync: req.query: ${JSON.stringify(req.query)}`);
    const audit = req.query['audit'];
    /**
     * @type {IndexManager}
     */
    const indexManager = container.indexManager;
    const json = await indexManager.compareCurrentIndexesWithConfigurationInAllCollectionsAsync(
        {
            audit: audit ? true : false,
            filterToProblems: filterToProblems
        }
    );
    if (shouldReturnHtml(req)) {
        const filePath = __dirname + '/../views/admin/pages/indexes';
        return res.render(filePath, {
            collections: json
        });
    } else {
        return res.json(json);
    }
}

/**
 * synchronizes indexes
 * @param {import('http').IncomingMessage} req
 * @param {SimpleContainer} container
 * @param {import('http').ServerResponse} res
 * @returns {Promise<void>}
 */
async function synchronizeIndexesAsync(
    {
        req,
        container,
        res
    }
) {
    console.log(`synchronizeIndexesAsync: req.query: ${JSON.stringify(req.query)}`);
    const audit = req.query['audit'];
    /**
     * @type {IndexManager}
     */
    const indexManager = container.indexManager;

    // return response and then continue processing
    const htmlContent = '<!DOCTYPE html><html><body><script>setTimeout(function(){window.location.href = "/admin/indexProblems";}, 5000);</script><p>Started Synchronizing indexes. Web page redirects after 5 seconds.</p></body></html>';
    res.set('Content-Type', 'text/html');
    res.send(Buffer.from(htmlContent));
    res.end();
    // res.json({message: 'Started Synchronizing indexes'}).end();
    await indexManager.synchronizeIndexesWithConfigAsync({
        audit: audit
    });
    return;
}

async function handleAdmin(
    /** @type {import('http').IncomingMessage} **/ req,
    /** @type {import('http').ServerResponse} **/ res
) {
    console.info('Running admin');
    const mongoDatabaseManager = new MongoDatabaseManager();
    /**
     * @type {import('mongodb').MongoClient}
     */
    const client = await mongoDatabaseManager.createClientAsync(mongoConfig);
    try {
        const operation = req.params['op'];
        console.log(`op=${operation}`);
        const {scope, adminScopes} = getAdminScopes({req});

        // set up all the standard services in the container
        /**
         * @type {SimpleContainer}
         */
        const container = createContainer();

        if (!isTrue(env.AUTH_ENABLED) || adminScopes.length > 0) {
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
                        const adminLogManager = new AdminLogManager();
                        const json = await adminLogManager.getLogAsync(id);
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

                case 'indexes': {
                    return await showIndexesAsync(
                        {
                            req, container, res,
                            filterToProblems: false
                        }
                    );
                }

                case 'indexProblems': {
                    return await showIndexesAsync(
                        {
                            req, container, res,
                            filterToProblems: true
                        }
                    );
                }

                case 'synchronizeIndexes': {
                    return await synchronizeIndexesAsync(
                        {
                            req,
                            container,
                            res
                        }
                    );
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
        await mongoDatabaseManager.disconnectClientAsync(client);
    }
}

module.exports = {
    handleAdmin,
    getAdminScopes
};

