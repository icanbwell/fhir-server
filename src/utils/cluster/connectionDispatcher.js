const { CLUSTER_MESSAGE_TYPES } = require('./clusterMessageTypes');

const DROPPED_CONNECTION_LOG_INTERVAL_MS = 5000;

/** Why the primary closed a connection instead of handing it to a worker */
const CONNECTION_DROP_REASONS = Object.freeze({
    NO_WORKER: 'no_worker',
    SEND_FAILED: 'send_failed'
});

/**
 * @typedef {Object} DispatchMetrics
 * @property {(workerScore: number) => void} connectionDispatched
 * @property {(reason: string) => void} connectionDropped reason is one of CONNECTION_DROP_REASONS
 */

/**
 * Runs in the cluster primary. Accepts every connection on the service port itself and hands
 * each one to the least busy worker (see WorkerLoadTable), instead of Node's round-robin.
 *
 * Workers keep their own HTTP server but do not listen on the service port; they take sockets
 * from the 'message' event (see WorkerLoadReporter).
 */
class ConnectionDispatcher {
    /**
     * @param {Object} params
     * @param {import('cluster').Cluster} params.cluster
     * @param {{createServer: typeof import('net').createServer}} params.net
     * @param {import('./workerLoadTable').WorkerLoadTable} params.loadTable
     * @param {number} params.port
     * @param {(message: string, args?: Object) => void} params.log
     * @param {DispatchMetrics} params.metrics
     * @param {() => number} [params.random]
     * @param {() => number} [params.now]
     */
    constructor({ cluster, net, loadTable, port, log, metrics, random = Math.random, now = Date.now }) {
        this.cluster = cluster;
        this.metrics = metrics;
        this.net = net;
        this.loadTable = loadTable;
        this.port = port;
        this.log = log;
        this.random = random;
        this.now = now;
        /** @type {import('net').Server|null} */
        this.server = null;
        this.droppedSinceLastLog = 0;
        this.lastDropLogAt = -Infinity;
    }

    /**
     * Subscribes to cluster events. Call before forking workers so no 'fork' event is missed.
     */
    trackWorkers() {
        this.cluster.on('fork', (worker) => this.loadTable.addWorker(worker.id));
        this.cluster.on('exit', (worker) => this.loadTable.removeWorker(worker.id));
        this.cluster.on('message', (worker, message) => this.handleWorkerMessage(worker, message));
    }

    /**
     * Workers forked and not yet exited.
     * @returns {number}
     */
    trackedWorkerCount() {
        return this.loadTable.size();
    }

    /**
     * Starts accepting connections on the service port.
     * @returns {Promise<void>}
     */
    listenAsync() {
        this.server = this.net.createServer({ pauseOnConnect: true }, (socket) =>
            this.dispatch(socket)
        );
        return new Promise((resolve, reject) => {
            this.server.once('error', reject);
            this.server.listen(this.port, () => {
                this.server.removeListener('error', reject);
                this.server.on('error', (error) =>
                    this.log('Connection dispatcher server error', { error: error.message })
                );
                resolve();
            });
        });
    }

    /**
     * Stops accepting connections. Connections already handed to workers are not affected.
     * @returns {Promise<void>}
     */
    closeAsync() {
        if (!this.server) {
            return Promise.resolve();
        }
        const server = this.server;
        this.server = null;
        return new Promise((resolve) => server.close(() => resolve()));
    }

    /**
     * @param {import('cluster').Worker} worker
     * @param {unknown} message
     */
    handleWorkerMessage(worker, message) {
        if (!message || typeof message !== 'object') {
            return;
        }
        switch (message.type) {
            case CLUSTER_MESSAGE_TYPES.LOAD_REPORT:
                this.loadTable.recordReport(worker.id, message);
                break;
            case CLUSTER_MESSAGE_TYPES.DRAINING:
                this.loadTable.markDraining(worker.id);
                break;
            default:
                // other IPC traffic (cluster internals, other features) is not ours
                break;
        }
    }

    /**
     * Hands one paused socket to the least busy worker, or closes it when no worker can take it.
     * @param {import('net').Socket} socket
     */
    dispatch(socket) {
        // The primary's copy of the socket is closed once it is sent; until then, a reset from
        // the client must not crash the primary.
        socket.on('error', () => {});

        const attempts = this.loadTable.size();
        for (let attempt = 0; attempt < attempts; attempt++) {
            const workerId = this.loadTable.pickWorkerId(this.random);
            if (workerId === null) {
                break;
            }
            const worker = this.cluster.workers[workerId];
            if (!worker || !worker.isConnected()) {
                this.loadTable.markDraining(workerId);
                continue;
            }
            this.metrics.connectionDispatched(this.loadTable.score(workerId));
            this.loadTable.recordDispatch(workerId);
            worker.send({ type: CLUSTER_MESSAGE_TYPES.CONNECTION }, socket, (error) => {
                if (error) {
                    socket.destroy();
                    this.metrics.connectionDropped(CONNECTION_DROP_REASONS.SEND_FAILED);
                }
            });
            return;
        }
        this.drop(socket);
    }

    /**
     * @param {import('net').Socket} socket
     */
    drop(socket) {
        socket.destroy();
        this.metrics.connectionDropped(CONNECTION_DROP_REASONS.NO_WORKER);
        this.droppedSinceLastLog += 1;
        const now = this.now();
        if (now - this.lastDropLogAt >= DROPPED_CONNECTION_LOG_INTERVAL_MS) {
            this.log('No worker available; closed incoming connections', {
                droppedConnections: this.droppedSinceLastLog,
                workers: this.loadTable.size()
            });
            this.droppedSinceLastLog = 0;
            this.lastDropLogAt = now;
        }
    }
}

module.exports = {
    CONNECTION_DROP_REASONS,
    ConnectionDispatcher
};
