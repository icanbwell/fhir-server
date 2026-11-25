const { CLUSTER_MESSAGE_TYPES, IPC_CHANNEL_CLOSED_ERROR_CODE } = require('./clusterDispatchConstants');

/**
 * Runs in a cluster worker when the primary dispatches connections (CLUSTER_SCHEDULING=least_busy).
 * Takes sockets sent by the primary into the worker's HTTP server, and reports the worker's load
 * (in-flight requests, including connections whose first request has not started, and connections
 * received) back to the primary on a timer.
 *
 * The timer doubles as a heartbeat: while the event loop is blocked no report goes out, and the
 * primary reads the overdue report as "busy right now" (see WorkerLoadTable).
 */
class WorkerLoadReporter {
    /**
     * @param {Object} params
     * @param {import('events').EventEmitter} params.channel emits 'message' (message, handle); the
     *  worker's `process`
     * @param {(message: import('./clusterDispatchConstants').ClusterMessage) => void} params.send
     *  sends a message to the primary and never throws (see createIpcSender)
     * @param {number} params.intervalMs
     * @param {typeof setInterval} [params.setIntervalFn]
     * @param {typeof setTimeout} [params.setTimeoutFn]
     * @param {typeof clearTimeout} [params.clearTimeoutFn]
     */
    constructor({
        channel,
        send,
        intervalMs,
        setIntervalFn = setInterval,
        setTimeoutFn = setTimeout,
        clearTimeoutFn = clearTimeout
    }) {
        this.channel = channel;
        this.send = send;
        this.intervalMs = intervalMs;
        this.setIntervalFn = setIntervalFn;
        this.setTimeoutFn = setTimeoutFn;
        this.clearTimeoutFn = clearTimeoutFn;
        /** requests being handled */
        this.inFlight = 0;
        /**
         * Connections taken from the primary whose first request has not started yet. They count
         * as load: a report sent in that gap would otherwise show an idle worker that is about to
         * start a request.
         * @type {Set<import('net').Socket>}
         */
        this.awaitingFirstRequest = new Set();
        this.connectionsReceived = 0;
        /**
         * Connections taken from the primary that are still open. net.Server does not count
         * sockets given to it with emit('connection'), so server.close() does not wait for them;
         * shutdown waits on this set instead (see waitForConnectionsToCloseAsync).
         * @type {Set<import('net').Socket>}
         */
        this.openConnections = new Set();
        /**
         * Pending waitForConnectionsToCloseAsync calls, each resolved when the last connection
         * closes
         * @type {Set<() => void>}
         */
        this.closeWaiters = new Set();
        this.draining = false;
        this.timer = null;
    }

    /**
     * Starts taking connections from the primary into `server` and reporting load. The first
     * report is sent immediately; it is what makes the primary start sending connections here.
     * @param {import('http').Server} server
     */
    attach(server) {
        // Prepended so the count goes up before the request handler runs, not after a
        // synchronous handler has already finished.
        server.prependListener('request', (req, res) => {
            this.awaitingFirstRequest.delete(req.socket);
            this.inFlight += 1;
            res.once('close', () => {
                this.inFlight -= 1;
            });
        });

        /**
         * @param {unknown} message
         * @param {import('net').Socket|undefined} socket
         */
        const onChannelMessage = (message, socket) => {
            if (!message || message.type !== CLUSTER_MESSAGE_TYPES.CONNECTION || !socket) {
                return;
            }
            this.connectionsReceived += 1;
            this.awaitingFirstRequest.add(socket);
            this.openConnections.add(socket);
            socket.once('close', () => {
                this.awaitingFirstRequest.delete(socket);
                this.openConnections.delete(socket);
                if (this.openConnections.size === 0) {
                    [...this.closeWaiters].forEach((onAllClosed) => onAllClosed());
                }
            });
            server.emit('connection', socket);
            socket.resume();
        };
        this.channel.on('message', onChannelMessage);

        this.report();
        this.timer = this.setIntervalFn(() => this.report(), this.intervalMs);
        if (this.timer && typeof this.timer.unref === 'function') {
            this.timer.unref();
        }
    }

    /**
     * Tells the primary to stop sending connections here. Call once the HTTP server stops taking
     * new connections (after the shutdown delay), not when the signal arrives: during the delay
     * the worker must keep serving, or the pod has no worker left to send traffic to.
     */
    markDraining() {
        if (this.draining) {
            return;
        }
        this.draining = true;
        this.send({ type: CLUSTER_MESSAGE_TYPES.DRAINING });
    }

    /**
     * Resolves once every connection taken from the primary has closed, or when `timeoutMs`
     * passes. Call after the HTTP server has stopped (Terminus ends idle connections and each busy
     * one after its response), so in-flight requests finish before the worker exits.
     * @param {Object} params
     * @param {number} params.timeoutMs
     * @returns {Promise<boolean>} true when all closed, false on timeout
     */
    waitForConnectionsToCloseAsync({ timeoutMs }) {
        if (this.openConnections.size === 0) {
            return Promise.resolve(true);
        }
        return new Promise((resolve) => {
            const onAllClosed = () => {
                this.closeWaiters.delete(onAllClosed);
                this.clearTimeoutFn(timer);
                resolve(true);
            };
            const timer = this.setTimeoutFn(() => {
                this.closeWaiters.delete(onAllClosed);
                resolve(false);
            }, timeoutMs);
            this.closeWaiters.add(onAllClosed);
        });
    }

    /**
     * @returns {number} connections taken from the primary that are still open
     */
    openConnectionCount() {
        return this.openConnections.size;
    }

    /**
     * Sends the current load snapshot to the primary.
     */
    report() {
        this.send({
            type: CLUSTER_MESSAGE_TYPES.LOAD_REPORT,
            inFlight: this.inFlight + this.awaitingFirstRequest.size,
            connectionsReceived: this.connectionsReceived
        });
    }

}

/**
 * Builds the worker's `send` for WorkerLoadReporter over a Node IPC channel (the worker's
 * `process`). Node reports a failed send to the callback, never by throwing, so errors are
 * handled there. A closed channel only means the primary is gone or this worker is exiting.
 * Anything else would stop the load reports, and the primary would then treat this worker as
 * blocked and stop sending it traffic, so it is logged.
 * @param {Object} params
 * @param {{connected: boolean, send: Function}} params.channel
 * @param {(message: string, args?: Object) => void} params.logError
 * @returns {(message: import('./clusterDispatchConstants').ClusterMessage) => void}
 */
function createIpcSender({ channel, logError }) {
    return (message) => {
        if (!channel.connected) {
            return;
        }
        channel.send(message, (error) => {
            if (error && error.code !== IPC_CHANNEL_CLOSED_ERROR_CODE) {
                logError('Failed to send a message to the cluster primary', {
                    messageType: message.type,
                    error: error.message,
                    code: error.code
                });
            }
        });
    };
}

module.exports = {
    WorkerLoadReporter,
    createIpcSender
};
