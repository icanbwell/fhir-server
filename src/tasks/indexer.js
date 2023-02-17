/**
 * This file implements a background long-running task to apply indexes to mongo db
 */
const {ErrorReporter} = require('../utils/slack.logger');

// This runs in a separate process to index so the main thread is not blocked
// from https://riptutorial.com/node-js/example/21833/processing-long-running-queries-with-node

const {IndexManager} = require('../indexes/indexManager');
const {getImageVersion} = require('../utils/getImageVersion');
const {logInfo, logError} = require('../operations/common/logging');

// eslint-disable-next-line no-unused-vars
process.on('message', async (params) => {
    //send status update to the main app
    logInfo(params);
    const message = params.message;
    const tableName = params.tableName;
    process.send({status: 'We have started processing your data.'});

    const errorReporter = new ErrorReporter(getImageVersion());
    try {
        const indexManager = new IndexManager({errorReporter});
        if (message === 'Start Index') {
            logInfo('Starting indexing in separate process', { source: 'indexerTask' });
            await errorReporter.reportMessageAsync({
                source: 'indexerTask',
                message: 'Starting indexing in separate process',
            });
            const collection_stats = await indexManager.indexAllCollectionsAsync({
                collectionRegex: tableName
            });
            logInfo('Finished indexing in separate process', { source: 'indexerTask' });
            await errorReporter.reportMessageAsync({
                source: 'indexerTask',
                message: 'Finished indexing in separate process',
            });
            logInfo('Done Indexing in separate process', {
                source: 'indexerTask',
                collection_stats
            });
            await errorReporter.reportMessageAsync({
                source: 'indexerTask',
                message: JSON.stringify(collection_stats),
            });
        } else if (message === 'Rebuild Index') {
            logInfo('Starting deleting indexes in separate process', { source: 'indexerTask' });
            await errorReporter.reportMessageAsync({
                source: 'indexerTask',
                message: 'Starting deleting indexes in separate process',
            });
            await indexManager.deleteIndexesInAllCollectionsAsync({
                collectionRegex: tableName
            });
            logInfo('Finished deleting index in separate process', { source: 'indexerTask' });
            await errorReporter.reportMessageAsync({
                source: 'indexerTask',
                message: 'Finished deleting index in separate process',
            });
            logInfo('Starting indexing in separate process', { source: 'indexerTask' });
            await errorReporter.reportMessageAsync({
                source: 'indexerTask',
                message: 'Starting indexing in separate process',
            });
            const collection_stats = await indexManager.indexAllCollectionsAsync({
                collectionRegex: tableName
            });
            logInfo('Finished indexing in separate process', { source: 'indexerTask' });
            await errorReporter.reportMessageAsync({
                source: 'indexerTask',
                message: 'Finished indexing in separate process',
            });
            logInfo('Done Indexing in separate process', {
                source: 'indexerTask',
                collection_stats
            });
            await errorReporter.reportMessageAsync({
                source: 'indexerTask',
                message: JSON.stringify(collection_stats),
            });
        }
    } catch (e) {
        logError('ERROR Indexing in separate process', { source: 'indexerTask', error: e });
        await errorReporter.reportMessageAsync({
            source: 'indexerTask',
            message: JSON.stringify(e),
        });
    }
    //notify node, that we are done with this task
    process.disconnect();
});

process.on('uncaughtException', function (err) {
    logError(err.message, {'error stack': err.stack});
    logInfo('Gracefully finish the routine.');
});
