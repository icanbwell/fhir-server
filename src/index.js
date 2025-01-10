/**
 * Implements the main function
 */
// Load the rest of the modules
const cluster = require('cluster');
const Sentry = require('@sentry/node');
const { createServer } = require('./server');
const { createContainer } = require('./createContainer');
const { getCircularReplacer } = require('./utils/getCircularReplacer');
const { initialize } = require('./winstonInit');
const { getImageVersion } = require('./utils/getImageVersion');

Sentry.init({
    release: getImageVersion(),
    environment: process.env.ENVIRONMENT,
    autoSessionTracking: false
});

const main = async function () {
    try {
        initialize();
        const container = createContainer();
        await createServer(() => container);
    } catch (e) {
        console.log('ERROR from MAIN: ' + e);
        console.log(JSON.stringify({ method: 'main', message: e.message, stack: JSON.stringify(e.stack, getCircularReplacer()) }));
    }
};

const numCPUs = process.env.WORKER_COUNT ? parseInt(process.env.WORKER_COUNT, 10) : 1;
if (cluster.isMaster && numCPUs > 1) {
    console.log(JSON.stringify({message: `Master ${process.pid} is running`}));

    // Fork workers
    for (let i = 0; i < numCPUs; i++) {
        cluster.fork();
    }

    cluster.on('exit', (worker, code, signal) => {
        console.log(JSON.stringify({message: `Worker ${worker.process.pid} died`}));
        // Optionally, you can fork a new worker here
        cluster.fork();
    });
} else {
    (async () => {
        try {
            console.log(JSON.stringify({message: `Worker ${process.pid} started`}));
            // Your async code here
            await main();
        } catch (error) {
            console.error('Error in main function:', error);
            process.exit(1); // Exit with a failure code
        }
    })();
}
