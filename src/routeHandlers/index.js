/**
 * This route handler implements the /index route which is used to check current mongo indexes and add new ones
 */
// eslint-disable-next-line security/detect-child-process
const childProcess = require('child_process');
const {IndexManager} = require('../indexes/indexManager');
const {ErrorReporter} = require('../utils/slack.logger');
const {getImageVersion} = require('../utils/getImageVersion');
const {getAdminScopes} = require('./admin');

module.exports.handleIndex = async (req, res) => {
    // console.info('Running index');

    const {scope, adminScopes} = getAdminScopes({req});
    if (adminScopes.length === 0) {
        return res.status(403).json({
            message: `Missing scopes for admin/*.read in ${scope}`
        });
    }
    const operation = req.params['op'];
    const tableName = req.params['table'];

    console.log('runIndex: ' + JSON.stringify(req.params));
    console.log('runIndex: ' + operation);

    let message;
    let collection_stats = {};
    if (operation === 'run') {
        //create new instance of node for running separate task in another thread
        const taskProcessor = childProcess.fork('./src/tasks/indexer.js');
        //send some params to our separate task
        const params = {
            message: 'Start Index',
            tableName: tableName,
        };
        taskProcessor.send(params);
        message = 'Started indexing in separate process.  Check logs or Slack for output.';
    } else if (operation === 'rebuild') {
        // await deleteIndexesInAllCollections();
        //create new instance of node for running separate task in another thread
        const taskProcessor = childProcess.fork('./src/tasks/indexer.js');
        //send some params to our separate task
        const params = {
            message: 'Rebuild Index',
            table: tableName,
        };
        taskProcessor.send(params);
        message =
            'Started rebuilding indexes in separate process.  Check logs or Slack for output.';
    } else {
        collection_stats = await new IndexManager({
            errorReporter: new ErrorReporter(getImageVersion()),
        }).getIndexesInAllCollectionsAsync();
        message = 'Listing current indexes.  Use /index/run if you want to run index creation';
    }

    console.log(message);

    res.status(200).json({
        success: true,
        collections: collection_stats,
        message: message,
    });
};
