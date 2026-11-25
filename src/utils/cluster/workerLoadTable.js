/**
 * A report counts as overdue only once it is more than this many intervals old, so ordinary timer
 * jitter on an idle worker does not read as a blocked event loop.
 */
const OVERDUE_GRACE_INTERVALS = 2;

/**
 * @typedef {Object} WorkerLoadReport
 * @property {number} inFlight requests the worker is currently handling
 * @property {number} connectionsReceived connections the worker has taken over since it started
 */

/**
 * Load state for every worker, kept by the cluster primary, and the choice of which worker gets
 * the next connection.
 *
 * A worker's score is:
 *   inFlight (last report)
 *   + connections sent to it that it had not yet received at its last report
 *   + (time its next report is overdue, beyond the grace of OVERDUE_GRACE_INTERVALS intervals) / blockedMsPerRequest
 *
 * The second term is updated synchronously on every dispatch, so a burst of connections arriving
 * between two reports spreads across workers instead of all going to the one that looked least
 * busy in the last report.
 *
 * The third term detects a worker whose event loop is blocked right now (CPU-heavy request): it
 * cannot send its periodic report, so the report goes overdue and the worker's score rises for
 * as long as the block lasts. A backwards-looking measure such as mean event-loop delay would
 * instead penalise a worker after its block has ended, when it is free again.
 */
class WorkerLoadTable {
    /**
     * @param {Object} params
     * @param {number} params.reportIntervalMs how often workers report
     * @param {number} params.blockedMsPerRequest milliseconds overdue that count as one in-flight
     *  request
     * @param {() => number} [params.now]
     */
    constructor({ reportIntervalMs, blockedMsPerRequest, now = Date.now }) {
        if (!(reportIntervalMs > 0)) {
            throw new Error('reportIntervalMs must be a positive number');
        }
        if (!(blockedMsPerRequest > 0)) {
            throw new Error('blockedMsPerRequest must be a positive number');
        }
        this.reportIntervalMs = reportIntervalMs;
        this.blockedMsPerRequest = blockedMsPerRequest;
        this.now = now;
        /**
         * @type {Map<number, {ready: boolean, draining: boolean, inFlight: number,
         *  connectionsReceived: number, connectionsDispatched: number, reportedAt: number}>}
         */
        this.workers = new Map();
    }

    /**
     * Registers a newly forked worker. It gets no connections until its first load report.
     * @param {number} workerId
     */
    addWorker(workerId) {
        this.workers.set(workerId, {
            ready: false,
            draining: false,
            inFlight: 0,
            connectionsReceived: 0,
            connectionsDispatched: 0,
            reportedAt: 0
        });
    }

    /**
     * @param {number} workerId
     */
    removeWorker(workerId) {
        this.workers.delete(workerId);
    }

    /**
     * @returns {number}
     */
    size() {
        return this.workers.size;
    }

    /**
     * Applies a load report. Reports for unknown workers or with non-numeric fields are ignored.
     * @param {number} workerId
     * @param {WorkerLoadReport} report
     * @returns {boolean} whether the report was applied
     */
    recordReport(workerId, report) {
        const state = this.workers.get(workerId);
        if (!state || !isValidReport(report)) {
            return false;
        }
        state.inFlight = report.inFlight;
        state.connectionsReceived = report.connectionsReceived;
        state.reportedAt = this.now();
        state.ready = true;
        return true;
    }

    /**
     * Stops sending connections to the worker. Draining is final for the worker's lifetime.
     * @param {number} workerId
     */
    markDraining(workerId) {
        const state = this.workers.get(workerId);
        if (state) {
            state.draining = true;
        }
    }

    /**
     * @param {number} workerId
     */
    recordDispatch(workerId) {
        const state = this.workers.get(workerId);
        if (state) {
            state.connectionsDispatched += 1;
        }
    }

    /**
     * Undoes recordDispatch for a hand-off that failed, so the worker is not charged for a
     * connection it never received.
     * @param {number} workerId
     */
    cancelDispatch(workerId) {
        const state = this.workers.get(workerId);
        if (state && state.connectionsDispatched > 0) {
            state.connectionsDispatched -= 1;
        }
    }

    /**
     * @param {number} workerId
     * @returns {number|undefined}
     */
    score(workerId) {
        const state = this.workers.get(workerId);
        if (!state) {
            return undefined;
        }
        const notYetReceived = Math.max(0, state.connectionsDispatched - state.connectionsReceived);
        const overdueMs = Math.max(
            0,
            this.now() - state.reportedAt - OVERDUE_GRACE_INTERVALS * this.reportIntervalMs
        );
        return state.inFlight + notYetReceived + overdueMs / this.blockedMsPerRequest;
    }

    /**
     * Picks the ready, non-draining worker with the lowest score. Ties are broken at random so
     * idle workers share connections instead of the first one taking all of them.
     * @param {() => number} [random] returns a number in [0, 1)
     * @returns {number|null} the worker id, or null when no worker can take a connection
     */
    pickWorkerId(random = Math.random) {
        let best = [];
        let bestScore = Infinity;
        for (const [workerId, state] of this.workers) {
            if (!state.ready || state.draining) {
                continue;
            }
            const score = this.score(workerId);
            if (score < bestScore) {
                bestScore = score;
                best = [workerId];
            } else if (score === bestScore) {
                best.push(workerId);
            }
        }
        if (best.length === 0) {
            return null;
        }
        return best[Math.min(best.length - 1, Math.floor(random() * best.length))];
    }
}

/**
 * @param {unknown} report
 * @returns {boolean}
 */
function isValidReport(report) {
    return (
        report !== null &&
        typeof report === 'object' &&
        isNonNegativeNumber(report.inFlight) &&
        isNonNegativeNumber(report.connectionsReceived)
    );
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isNonNegativeNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

module.exports = {
    OVERDUE_GRACE_INTERVALS,
    WorkerLoadTable
};
