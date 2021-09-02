// This runs in a separate process to index so the main thread is not blocked
// from https://riptutorial.com/node-js/example/21833/processing-long-running-queries-with-node

const {indexAllCollections} = require('../utils/index.util');

// eslint-disable-next-line no-unused-vars
process.on('message', function (message) {
    console.log('==== Starting indexing in separate process ====');
    //send status update to the main app
    process.send({status: 'We have started processing your data.'});

    (async () => {
        const collection_stats = await indexAllCollections();
        console.log('===== Done Indexing in separate process ======');
        console.log(collection_stats);
        //notify node, that we are done with this task
        process.disconnect();
    })();
});

process.on('uncaughtException', function (err) {
    console.log('Error happened: ' + err.message + '\n' + err.stack + '.\n');
    console.log('Gracefully finish the routine.');
});
