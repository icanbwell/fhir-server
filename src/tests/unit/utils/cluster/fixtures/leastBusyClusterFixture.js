'use strict';

/**
 * Child-process fixture for leastBusyCluster.test.js: a real cluster primary and workers wired
 * the way src/index.js and src/server.js wire them under CLUSTER_SCHEDULING=least_busy, with a
 * stand-in request handler instead of the FHIR app (which needs MongoDB and Kafka).
 *
 * Prints one JSON line per event on stdout for the test to read:
 *   {event: 'listening', port}       the primary accepts connections
 *   {event: 'flushed', pid}          a worker's Terminus onSignal ran
 *   {event: 'workerExit', code}      a worker exited
 *
 * GET /slow holds the worker's event loop for 150 ms; any other path answers at once. Every
 * response carries the serving worker's pid in x-worker-pid.
 */
const cluster = require('cluster');
const http = require('http');
const net = require('net');
const { createTerminus } = require('@godaddy/terminus');
const { WorkerLoadTable } = require('../../../../../utils/cluster/workerLoadTable');
const { ConnectionDispatcher } = require('../../../../../utils/cluster/connectionDispatcher');
const { WorkerLoadReporter } = require('../../../../../utils/cluster/workerLoadReporter');
const { CLUSTER_MESSAGE_TYPES } = require('../../../../../utils/cluster/clusterDispatchConstants');

const WORKERS = 3;
const REPORT_INTERVAL_MS = 25;
const SHUTDOWN_DELAY_MS = 300;
const SLOW_REQUEST_MS = 150;

const emit = (event) => console.log(JSON.stringify(event));

if (cluster.isPrimary) {
    let shuttingDown = false;
    const dispatcher = new ConnectionDispatcher({
        cluster,
        net,
        loadTable: new WorkerLoadTable({
            reportIntervalMs: REPORT_INTERVAL_MS,
            blockedMsPerRequest: 10
        }),
        port: 0,
        log: () => {},
        metrics: { connectionDispatched: () => {}, connectionDropped: () => {} }
    });
    dispatcher.trackWorkers();
    let readyWorkers = 0;
    cluster.on('message', (worker, message) => {
        // announce the port once every worker has reported, so no request is dropped at start
        if (message && message.type === CLUSTER_MESSAGE_TYPES.LOAD_REPORT && !worker.announced) {
            worker.announced = true;
            readyWorkers += 1;
            if (readyWorkers === WORKERS) {
                emit({ event: 'listening', port: dispatcher.server.address().port });
            }
        }
    });
    dispatcher.listenAsync().then(() => {
        for (let i = 0; i < WORKERS; i++) {
            cluster.fork();
        }
    });
    process.on('SIGTERM', () => {
        shuttingDown = true;
        for (const id in cluster.workers) {
            cluster.workers[id].process.kill('SIGTERM');
        }
    });
    cluster.on('exit', (worker, code) => {
        emit({ event: 'workerExit', code });
        if (shuttingDown && dispatcher.trackedWorkerCount() === 0) {
            dispatcher.closeAsync();
        }
    });
} else {
    const reporter = new WorkerLoadReporter({
        channel: process,
        send: (message) => {
            if (process.connected) {
                process.send(message, () => {});
            }
        },
        intervalMs: REPORT_INTERVAL_MS,
        logError: () => {}
    });
    const server = http.createServer((req, res) => {
        if (req.url === '/slow') {
            const end = Date.now() + SLOW_REQUEST_MS;
            while (Date.now() < end) {
                // hold the event loop, like a CPU-heavy request
            }
        }
        res.setHeader('x-worker-pid', String(process.pid));
        res.end('ok');
    });
    server.listen({ port: 0, host: '127.0.0.1', exclusive: true });
    createTerminus(server, {
        signals: ['SIGTERM'],
        timeout: 5000,
        useExit0: true,
        beforeShutdown: () =>
            new Promise((resolve) =>
                setTimeout(() => {
                    reporter.markDraining();
                    resolve();
                }, SHUTDOWN_DELAY_MS)
            ),
        onSignal: async () => emit({ event: 'flushed', pid: process.pid })
    });
    reporter.attach(server);
}
