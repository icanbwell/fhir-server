/**
 * This file implements a background long-running task to apply indexes to mongo db
 */
const {ErrorReporter} = require('../utils/slack.logger');

// This runs in a separate process to index so the main thread is not blocked
// from https://riptutorial.com/node-js/example/21833/processing-long-running-queries-with-node

const {IndexManager} = require('../indexes/index.util');


// eslint-disable-next-line no-unused-vars
process.on('message', async (params) => {
    //send status update to the main app
    console.log('message:' + params);
    const message = params.message;
    const tableName = params.tableName;
    process.send({status: 'We have started processing your data.'});

    const errorReporter = new ErrorReporter();
    try {
        const indexManager = new IndexManager({errorReporter: new ErrorReporter()});
        if (message === 'Start Index') {
            console.log('==== Starting indexing in separate process ====');
            await errorReporter.reportMessageAsync({
                source: 'indexerTask',
                message: 'Starting indexing in separate process'
            });
            const collection_stats = await indexManager.indexAllCollectionsAsync(tableName);
            await errorReporter.reportMessageAsync({
                source: 'indexerTask',
                message: 'Finished indexing in separate process'
            });
            console.log(JSON.stringify(collection_stats));
            console.log('===== Done Indexing in separate process ======');
            await errorReporter.reportMessageAsync({source: 'indexerTask', message: JSON.stringify(collection_stats)});
        } else if (message === 'Rebuild Index') {
            console.log('==== Starting deleting indexes in separate process ====');
            await errorReporter.reportMessageAsync({
                source: 'indexerTask',
                message: 'Starting deleting indexes in separate process'
            });
            await indexManager.deleteIndexesInAllCollectionsAsync(tableName);
            await errorReporter.reportMessageAsync({
                source: 'indexerTask',
                message: 'Finished deleting index in separate process'
            });
            console.log('===== Finished deleting index in separate process ======');
            await errorReporter.reportMessageAsync({
                source: 'indexerTask',
                message: 'Starting indexing in separate process'
            });
            const collection_stats = await indexManager.indexAllCollectionsAsync(tableName);
            await errorReporter.reportMessageAsync({
                source: 'indexerTask',
                message: 'Finished indexing in separate process'
            });
            console.log(JSON.stringify(collection_stats));
            console.log('===== Done Indexing in separate process ======');
            await errorReporter.reportMessageAsync({source: 'indexerTask', message: JSON.stringify(collection_stats)});
        }
    } catch (e) {
        console.log('===== ERROR Indexing in separate process ======', e);
        console.log(JSON.stringify(e));
        await errorReporter.reportMessageAsync({source: 'indexerTask', message: JSON.stringify(e)});
    }
    //notify node, that we are done with this task
    process.disconnect();
});

process.on('uncaughtException', function (err) {
    console.log('Error happened: ' + err.message + '\n' + err.stack + '.\n');
    console.log('Gracefully finish the routine.');
});
