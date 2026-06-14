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
const { BaseSerializer } = require('./fhir/writeSerializers/4_0_0/customSerializers');
const { BaseFhirResourceSerializer } = require('./fhir/baseFhirResourceSerializer');

Sentry.init({
    release: getImageVersion(),
    environment: process.env.ENVIRONMENT,
    autoSessionTracking: false,
    skipOpenTelemetrySetup: true,
    tracesSampleRate: undefined,
    tracesSampler: undefined,
    tracePropagationTargets: []
});

// Validate that OpenTelemetry setup is correct
Sentry.validateOpenTelemetrySetup();

const main = async function () {
    try {
        initialize();
        const container = createContainer();
        // Initialize configManager for all serializers
        BaseSerializer.setConfigManager(container.configManager);
        BaseFhirResourceSerializer.setConfigManager(container.configManager);

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

    // Give each worker a distinct, queryable identity on its OpenTelemetry signals
    // (heap usage, GC, event-loop, traces) so per-worker resource usage is visible
    // in cluster mode. The attributes are injected via OTEL_RESOURCE_ATTRIBUTES
    // *before* the worker boots, so the env resource detector picks them up in both
    // the operator auto-instrumentation path and the manual SDK path. Any pod-level
    // OTEL_RESOURCE_ATTRIBUTES set on the primary is preserved (prepended).
    let nextWorkerNumber = 0;
    const forkWorker = () => {
        nextWorkerNumber += 1;
        const otelResourceAttributes = [
            process.env.OTEL_RESOURCE_ATTRIBUTES,
            'cluster.role=worker',
            `cluster.worker.id=${nextWorkerNumber}`
        ].filter(Boolean).join(',');
        return cluster.fork({ OTEL_RESOURCE_ATTRIBUTES: otelResourceAttributes });
    };

    // Fork workers
    for (let i = 0; i < numCPUs; i++) {
        forkWorker();
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
        forkWorker();
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
