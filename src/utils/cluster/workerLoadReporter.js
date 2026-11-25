const { CLUSTER_MESSAGE_TYPES, IPC_CHANNEL_CLOSED_ERROR_CODE } = require('./clusterDispatchConstants');

/**
 * Runs in a cluster worker when the primary dispatches connections (CLUSTER_SCHEDULING=least_busy).
 * Takes sockets sent by the primary into the worker's HTTP server, and reports the worker's load
 * (in-flight requests, connections received) back to the primary on a timer.
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
     *  sends a message to the primary
     * @param {number} params.intervalMs
     * @param {(message: string, args?: Object) => void} params.logError
     * @param {typeof setInterval} [params.setIntervalFn]
     */
    constructor({
        channel,
        send,
        intervalMs,
        logError,
        setIntervalFn = setInterval
    }) {
        this.logError = logError;
        this.channel = channel;
        this.send = send;
        this.intervalMs = intervalMs;
        this.setIntervalFn = setIntervalFn;
        this.inFlight = 0;
        this.connectionsReceived = 0;
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
        this.safeSend({ type: CLUSTER_MESSAGE_TYPES.DRAINING });
    }

    /**
     * Sends the current load snapshot to the primary.
     */
    report() {
        this.safeSend({
            type: CLUSTER_MESSAGE_TYPES.LOAD_REPORT,
            inFlight: this.inFlight,
            connectionsReceived: this.connectionsReceived
        });
    }

    /**
     * @param {import('./clusterDispatchConstants').ClusterMessage} message
     */
    safeSend(message) {
        try {
            this.send(message);
        } catch (error) {
            // A closed channel means the primary is gone or this worker is exiting: there is no
            // one left to report to. Anything else would silently stop the reports, and the
            // primary would then treat this worker as blocked, so it is logged.
            if (error && error.code === IPC_CHANNEL_CLOSED_ERROR_CODE) {
                return;
            }
            this.logError('Failed to send a load report to the cluster primary', {
                messageType: message.type,
                error: error && error.message,
                code: error && error.code
            });
        }
    }
}

module.exports = {
    WorkerLoadReporter
};
