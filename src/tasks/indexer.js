/**
 * This file implements a background long-running task to apply indexes to mongo db
 */

// This runs in a separate process to index so the main thread is not blocked
// from https://riptutorial.com/node-js/example/21833/processing-long-running-queries-with-node

const {IndexManager} = require('../indexes/indexManager');
const {logInfo, logError} = require('../operations/common/logging');

// eslint-disable-next-line no-unused-vars
process.on('message', async (params) => {
    //send status update to the main app
    logInfo(params);
    const message = params.message;
    const tableName = params.tableName;
    process.send({status: 'We have started processing your data.'});

    try {
        const indexManager = new IndexManager();
        if (message === 'Start Index') {
            logInfo('Starting indexing in separate process', { source: 'indexerTask' });
            const collection_stats = await indexManager.indexAllCollectionsAsync({
                collectionRegex: tableName
            });
            logInfo('Finished indexing in separate process', { source: 'indexerTask' });
            logInfo('Done Indexing in separate process', {
                source: 'indexerTask',
                collection_stats
            });
        } else if (message === 'Rebuild Index') {
            logInfo('Starting deleting indexes in separate process', { source: 'indexerTask' });
            await indexManager.deleteIndexesInAllCollectionsAsync({
                collectionRegex: tableName
            });
            logInfo('Finished deleting index in separate process', { source: 'indexerTask' });
            logInfo('Starting indexing in separate process', { source: 'indexerTask' });
            const collection_stats = await indexManager.indexAllCollectionsAsync({
                collectionRegex: tableName
            });
            logInfo('Finished indexing in separate process', { source: 'indexerTask' });
            logInfo('Done Indexing in separate process', {
                source: 'indexerTask',
                collection_stats
            });
        }
    } catch (e) {
        logError('ERROR Indexing in separate process', { source: 'indexerTask', error: e });
    }
    //notify node, that we are done with this task
    process.disconnect();
});

process.on('uncaughtException', function (err) {
    logError(err.message, {'error stack': err.stack});
    logInfo('Gracefully finish the routine.');
});
