/**
 * Implements the main function
 */
// Load the rest of the modules
const cluster = require('cluster');
const { initSentry } = require('./utils/initSentry');
const { createServer } = require('./server');
const { createContainer } = require('./createContainer');
const { getCircularReplacer } = require('./utils/getCircularReplacer');
const { initialize } = require('./winstonInit');
const { fhirSchemaValidator } = require('./utils/fhirSchemaValidator');

// Validates OpenTelemetry setup, which only this entrypoint (loaded via
// --require=./src/otel_instrumentation.js) actually attempts.
initSentry({ validateOpenTelemetry: true });

const main = async function () {
    try {
        initialize();
        const container = createContainer();
        // Pre-compile FHIR schema validators for every resourceType off the request path
        fhirSchemaValidator.preWarm();

        await createServer(() => container);

        // Cron tasks flush per-worker buffers (postSaveProcessor, auditLogger,
        // accessLogger). The buffers are local to each worker, so every worker
        // must run its own cron task processor.
        await container.cronTasksProcessor.initiateTasks();
    } catch (e) {
        console.log('ERROR from MAIN: ' + e);
        console.log(JSON.stringify({ method: 'main', message: e.message, stack: JSON.stringify(e.stack, getCircularReplacer()) }));
        throw e;
    }
};

const numCPUs = process.env.WORKER_COUNT ? parseInt(process.env.WORKER_COUNT, 10) : 1;
if (cluster.isPrimary && numCPUs > 1) {
    console.log(JSON.stringify({message: `Master ${process.pid} is running with ${numCPUs} workers`}));

    // Fork workers
    for (let i = 0; i < numCPUs; i++) {
        cluster.fork();
    }

    // Forward all signals to the worker processes. Setting `shuttingDown`
    // first prevents the exit handler from respawning workers that exit
    // because we asked them to.
    let shuttingDown = false;
    const forwardSignal = (signal) => {
        shuttingDown = true;
        for (const id in cluster.workers) {
            cluster.workers[id].process.kill(signal);
        }
    };

    process.on('SIGTERM', () => forwardSignal('SIGTERM'));
    process.on('SIGINT', () => forwardSignal('SIGINT'));
    process.on('SIGQUIT', () => forwardSignal('SIGQUIT'));

    cluster.on('exit', (worker, code, signal) => {
        console.log(JSON.stringify({message: `Worker ${worker.process.pid} died (code=${code}, signal=${signal})`}));
        if (shuttingDown) {
            return;
        }
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
