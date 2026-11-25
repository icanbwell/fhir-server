const { CLUSTER_MESSAGE_TYPES } = require('./clusterMessageTypes');

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
     * @param {(message: Object) => void} params.send sends a message to the primary
     * @param {number} params.intervalMs
     * @param {typeof setInterval} [params.setIntervalFn]
     * @param {typeof clearInterval} [params.clearIntervalFn]
     */
    constructor({ channel, send, intervalMs, setIntervalFn = setInterval, clearIntervalFn = clearInterval }) {
        this.channel = channel;
        this.send = send;
        this.intervalMs = intervalMs;
        this.setIntervalFn = setIntervalFn;
        this.clearIntervalFn = clearIntervalFn;
        this.inFlight = 0;
        this.connectionsReceived = 0;
        this.draining = false;
        this.timer = null;
        this.onChannelMessage = null;
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

        this.onChannelMessage = (message, socket) => {
            if (!message || message.type !== CLUSTER_MESSAGE_TYPES.CONNECTION || !socket) {
                return;
            }
            this.connectionsReceived += 1;
            server.emit('connection', socket);
            socket.resume();
        };
        this.channel.on('message', this.onChannelMessage);

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
     * Stops reporting and taking connections.
     */
    stop() {
        if (this.timer) {
            this.clearIntervalFn(this.timer);
            this.timer = null;
        }
        if (this.onChannelMessage) {
            this.channel.removeListener('message', this.onChannelMessage);
            this.onChannelMessage = null;
        }
    }

    report() {
        this.safeSend({
            type: CLUSTER_MESSAGE_TYPES.LOAD_REPORT,
            inFlight: this.inFlight,
            connectionsReceived: this.connectionsReceived
        });
    }

    /**
     * @param {Object} message
     */
    safeSend(message) {
        try {
            this.send(message);
        } catch {
            // The IPC channel is closed (the primary is gone or the worker is exiting); there is
            // no one left to report to.
        }
    }
}

module.exports = {
    WorkerLoadReporter
};
