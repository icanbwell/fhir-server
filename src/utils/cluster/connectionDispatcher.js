const { CLUSTER_MESSAGE_TYPES, CLUSTER_CONNECTION_DROP_REASON } = require('./clusterDispatchConstants');

const THROTTLED_LOG_INTERVAL_MS = 5000;

/** Errors a client causes by going away; expected on the primary's copy of a socket */
const CLIENT_DISCONNECT_ERROR_CODES = Object.freeze(['ECONNRESET', 'EPIPE']);

/**
 * @typedef {Object} DispatchMetrics
 * @property {(workerScore: number) => void} connectionDispatched
 * @property {(reason: string) => void} connectionDropped reason is one of
 *  CLUSTER_CONNECTION_DROP_REASON
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
        this.net = net;
        this.loadTable = loadTable;
        this.port = port;
        this.log = log;
        this.metrics = metrics;
        this.random = random;
        this.now = now;
        /** @type {import('net').Server|null} */
        this.server = null;
        /**
         * Per-event state for logs that could otherwise fire on every connection
         * @type {Map<string, {count: number, lastLoggedAt: number}>}
         */
        this.throttledLogs = new Map();
        /** set at shutdown: close the listener once no worker is left */
        this.closeWhenNoWorkers = false;
        /**
         * Sockets sent to each worker whose send callback has not run yet. Node lets only one
         * hand-off per worker wait for the worker's acknowledgement and queues the rest; if the
         * worker dies, it drops the queued ones without calling their callbacks.
         * @type {Map<number, Set<import('net').Socket>>}
         */
        this.pendingHandOffs = new Map();
    }

    /**
     * Subscribes to cluster events. Call before forking workers so no 'fork' event is missed.
     */
    trackWorkers() {
        this.cluster.on('fork', (worker) => this.loadTable.addWorker(worker.id));
        this.cluster.on('exit', (worker) => {
            this.loadTable.removeWorker(worker.id);
            this.dropPendingHandOffs(worker.id);
            this.closeIfShutDown();
        });
        this.cluster.on('message', (worker, message) => this.handleWorkerMessage(worker, message));
    }

    /**
     * Call when the primary starts shutting down. Workers keep serving through their shutdown
     * delay, so the listener stays open until the last one exits; then it closes, so the
     * listening socket does not keep the primary alive.
     */
    closeAfterLastWorkerExits() {
        this.closeWhenNoWorkers = true;
        this.closeIfShutDown();
    }

    /**
     * Closes the listener when shutdown has started and no worker is left.
     */
    closeIfShutDown() {
        if (this.closeWhenNoWorkers && this.loadTable.size() === 0) {
            this.closeAsync();
        }
    }

    /**
     * Starts accepting connections on the service port.
     * @returns {Promise<import('net').AddressInfo>} the address it listens on
     */
    listenAsync() {
        this.server = this.net.createServer({ pauseOnConnect: true }, (socket) =>
            this.dispatch(socket)
        );
        const server = this.server;
        return new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(this.port, () => {
                server.removeListener('error', reject);
                server.on('error', (error) =>
                    this.log('Connection dispatcher server error', {
                        error: error.message,
                        code: error.code
                    })
                );
                resolve(server.address());
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
        return new Promise((resolve) =>
            server.close((error) => {
                if (error) {
                    this.log('Connection dispatcher failed to close its listener', {
                        error: error.message,
                        code: error.code
                    });
                }
                resolve();
            })
        );
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
                if (!this.loadTable.recordReport(worker.id, message)) {
                    // A worker whose reports are all rejected never gets traffic, so say why.
                    this.logThrottled('invalidLoadReport', 'Ignored an invalid worker load report', {
                        workerId: worker.id
                    });
                }
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
        // The primary's copy of the socket is closed once it is sent; until then an error on it
        // must not crash the primary. A client going away is expected; anything else is logged.
        socket.on('error', (error) => {
            if (!CLIENT_DISCONNECT_ERROR_CODES.includes(error.code)) {
                this.logThrottled('socketError', 'Error on a connection before hand-off', {
                    error: error.message,
                    code: error.code
                });
            }
        });

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
            this.sendToWorker(worker, socket);
            return;
        }

        socket.destroy();
        this.metrics.connectionDropped(CLUSTER_CONNECTION_DROP_REASON.NO_WORKER);
        this.logThrottled('noWorker', 'No worker available; closed incoming connections', {
            workers: this.loadTable.size()
        });
    }

    /**
     * @param {import('cluster').Worker} worker
     * @param {import('net').Socket} socket
     */
    sendToWorker(worker, socket) {
        this.metrics.connectionDispatched(this.loadTable.score(worker.id));
        this.loadTable.recordDispatch(worker.id);
        const pending = this.pendingHandOffs.get(worker.id) || new Set();
        pending.add(socket);
        this.pendingHandOffs.set(worker.id, pending);
        // Without `keepOpen`, Node closes the primary's copy of the socket once the handle is sent,
        // so the primary holds no descriptor for a handed-off connection and nothing is left to
        // release on success.
        worker.send({ type: CLUSTER_MESSAGE_TYPES.CONNECTION }, socket, (error) => {
            if (!pending.delete(socket)) {
                // already closed and counted when the worker exited
                return;
            }
            if (!error) {
                return;
            }
            // The worker never received it, so it must not count against the worker's score.
            this.loadTable.cancelDispatch(worker.id);
            socket.destroy();
            this.metrics.connectionDropped(CLUSTER_CONNECTION_DROP_REASON.SEND_FAILED);
            this.logThrottled('sendFailed', 'Failed to hand a connection to a worker; closed it', {
                workerId: worker.id,
                error: error.message,
                code: error.code
            });
        });
    }

    /**
     * Closes the sockets still waiting to be handed to a worker that has exited. Node never
     * calls back for them, so without this the client would wait until it times out.
     * @param {number} workerId
     */
    dropPendingHandOffs(workerId) {
        const pending = this.pendingHandOffs.get(workerId);
        this.pendingHandOffs.delete(workerId);
        if (!pending || pending.size === 0) {
            return;
        }
        const sockets = [...pending];
        // emptied so a send callback that still runs for one of them sees it as already handled
        pending.clear();
        for (const socket of sockets) {
            socket.destroy();
            this.metrics.connectionDropped(CLUSTER_CONNECTION_DROP_REASON.SEND_FAILED);
        }
        this.logThrottled('workerExitedWithPendingHandOffs', 'A worker exited before taking connections sent to it; closed them', {
            workerId,
            connections: sockets.length
        });
    }

    /**
     * Logs at most once per interval per key, with the number of occurrences since the last log.
     * @param {string} key
     * @param {string} message
     * @param {Object} args details of the latest occurrence
     */
    logThrottled(key, message, args) {
        const state = this.throttledLogs.get(key) || { count: 0, lastLoggedAt: -Infinity };
        state.count += 1;
        const now = this.now();
        if (now - state.lastLoggedAt >= THROTTLED_LOG_INTERVAL_MS) {
            this.log(message, { ...args, occurrences: state.count });
            state.count = 0;
            state.lastLoggedAt = now;
        }
        this.throttledLogs.set(key, state);
    }
}

module.exports = {
    ConnectionDispatcher
};
