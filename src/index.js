/**
 * Implements the main function
 */
// Load the rest of the modules
const cluster = require('cluster');
const net = require('net');
const { initSentry } = require('./utils/initSentry');
const { createServer } = require('./server');
const { createContainer } = require('./createContainer');
const { getCircularReplacer } = require('./utils/getCircularReplacer');
const { initialize } = require('./winstonInit');
const { fhirSchemaValidator } = require('./utils/fhirSchemaValidator');
const { fhirServerConfig } = require('./config');
const {
    CLUSTER_SCHEDULING_POLICIES,
    readClusterSchedulingConfig
} = require('./utils/cluster/clusterSchedulingConfig');
const { WorkerLoadTable } = require('./utils/cluster/workerLoadTable');
const { ConnectionDispatcher } = require('./utils/cluster/connectionDispatcher');
const { WorkerLoadReporter } = require('./utils/cluster/workerLoadReporter');
const { IPC_CHANNEL_CLOSED_ERROR_CODE } = require('./utils/cluster/clusterDispatchConstants');
const { logError } = require('./operations/common/logging');
const {
    recordClusterConnectionDispatched,
    recordClusterConnectionDropped
} = require('./utils/metrics');

// Validates OpenTelemetry setup, which only this entrypoint (loaded via
// --require=./src/otel_instrumentation.js) actually attempts.
initSentry({ validateOpenTelemetry: true });

const numCPUs = process.env.WORKER_COUNT ? parseInt(process.env.WORKER_COUNT, 10) : 1;
const isClustered = numCPUs > 1;
// Validated at startup in both primary and workers so a bad value fails the pod immediately
const clusterScheduling = readClusterSchedulingConfig(process.env);
const primaryDispatchesConnections =
    isClustered && clusterScheduling.policy === CLUSTER_SCHEDULING_POLICIES.LEAST_BUSY;

/**
 * @returns {WorkerLoadReporter}
 */
const createWorkerLoadReporter = () =>
    new WorkerLoadReporter({
        channel: process,
        // With a callback, a send error goes to the callback instead of being emitted as an
        // 'error' event on process. A closed channel only means the primary is gone or this
        // worker is exiting; anything else would stop the load reports, so it is logged.
        send: (message) => {
            if (!process.connected) {
                return;
            }
            process.send(message, (error) => {
                if (error && error.code !== IPC_CHANNEL_CLOSED_ERROR_CODE) {
                    logError('Failed to send a message to the cluster primary', {
                        messageType: message.type,
                        error: error.message,
                        code: error.code
                    });
                }
            });
        },
        intervalMs: clusterScheduling.reportIntervalMs,
        logError
    });

const main = async function () {
    try {
        initialize();
        const container = createContainer();
        // Pre-compile FHIR schema validators for every resourceType off the request path
        fhirSchemaValidator.preWarm();

        await createServer(() => container, {
            workerLoadReporter: primaryDispatchesConnections ? createWorkerLoadReporter() : undefined
        });

        // Connect the V2 Kafka producer now (a no-op when V2 Kafka is disabled, and never throws),
        // so the first AuditEvent flush doesn't pay for the connect inside its produce timeout.
        // Not awaited: it must not delay startup or readiness.
        container.kafkaClientV2.warmUpAsync();

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

if (cluster.isPrimary && isClustered) {
    console.log(JSON.stringify({
        message: `Master ${process.pid} is running with ${numCPUs} workers`,
        clusterScheduling: clusterScheduling.policy
    }));

    /** @type {ConnectionDispatcher|null} */
    let dispatcher = null;
    if (primaryDispatchesConnections) {
        dispatcher = new ConnectionDispatcher({
            cluster,
            net,
            loadTable: new WorkerLoadTable({
                reportIntervalMs: clusterScheduling.reportIntervalMs,
                blockedMsPerRequest: clusterScheduling.blockedMsPerRequest
            }),
            port: Number(fhirServerConfig.server.port),
            log: (message, args) => console.log(JSON.stringify({ message, ...args })),
            metrics: {
                connectionDispatched: recordClusterConnectionDispatched,
                connectionDropped: recordClusterConnectionDropped
            }
        });
        // Before forking, so every worker's 'fork' event is seen
        dispatcher.trackWorkers();
        dispatcher.listenAsync().catch((error) => {
            console.error(JSON.stringify({ message: 'Connection dispatcher failed to listen', error: error.message }));
            process.exit(1);
        });
    }

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
            // The dispatcher's listening socket would keep the primary alive; close it once the
            // last worker is gone so the primary exits as it does without the dispatcher.
            // (cluster.workers can still list an exited worker until its IPC channel closes, so
            // use the dispatcher's own count, which drops the worker on 'exit'.)
            if (dispatcher && dispatcher.trackedWorkerCount() === 0) {
                dispatcher.closeAsync();
            }
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
