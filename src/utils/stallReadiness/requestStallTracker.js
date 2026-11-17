'use strict';

/**
 * Counts of recent requests on one worker (or a whole pod, once summed).
 * `total` is requests completed within the window plus requests still in flight.
 * `stalled` is completed requests that took longer than the stall threshold plus
 * in-flight requests already older than it. In-flight requests matter because a hung
 * request never completes, so a tracker that only counted completions would miss it.
 */
class StallSnapshot {
    /**
     * @param {Object} params
     * @param {number} params.total
     * @param {number} params.stalled
     */
    constructor ({ total, stalled }) {
        this.total = total;
        this.stalled = stalled;
        Object.freeze(this);
    }

    /**
     * @param {StallSnapshot} other
     * @returns {StallSnapshot}
     */
    plus (other) {
        return new StallSnapshot({ total: this.total + other.total, stalled: this.stalled + other.stalled });
    }

    /**
     * Rebuilds a snapshot from an IPC payload, rejecting anything malformed.
     * @param {unknown} value
     * @returns {StallSnapshot|null}
     */
    static fromPlain (value) {
        if (!value || typeof value !== 'object') {
            return null;
        }
        const { total, stalled } = /** @type {{total: unknown, stalled: unknown}} */ (value);
        if (!Number.isInteger(total) || !Number.isInteger(stalled) || total < 0 || stalled < 0 || stalled > total) {
            return null;
        }
        return new StallSnapshot({ total, stalled });
    }
}

StallSnapshot.EMPTY = new StallSnapshot({ total: 0, stalled: 0 });

const BUCKET_MS = 1000;

/**
 * Tracks request durations for one process over a sliding time window.
 *
 * Completed requests go into one-second buckets in a ring, so memory is bounded by
 * the window length, not the request rate. In-flight requests are kept by start time
 * until they finish. No request data (URL, user, payload) is stored, only timings.
 */
class RequestStallTracker {
    /**
     * @param {Object} params
     * @param {number} params.windowMs
     * @param {number} params.stallThresholdMs
     * @param {() => number} [params.now] clock, injectable for tests
     */
    constructor ({ windowMs, stallThresholdMs, now = Date.now }) {
        this.windowMs = windowMs;
        this.stallThresholdMs = stallThresholdMs;
        this.now = now;
        this.bucketCount = Math.max(1, Math.ceil(windowMs / BUCKET_MS));
        /** @type {{epoch: number, total: number, stalled: number}[]} */
        this.buckets = Array.from({ length: this.bucketCount }, () => ({ epoch: -1, total: 0, stalled: 0 }));
        /** @type {Map<number, number>} request token -> start time */
        this.inFlight = new Map();
        this.nextToken = 0;
    }

    /**
     * Marks the start of a request.
     * @returns {() => void} call once when the request ends (finished or aborted); extra calls are ignored
     */
    startRequest () {
        const token = this.nextToken++;
        this.inFlight.set(token, this.now());
        return () => this.finishRequest(token);
    }

    /**
     * @param {number} token
     */
    finishRequest (token) {
        const startedAt = this.inFlight.get(token);
        if (startedAt === undefined) {
            return;
        }
        this.inFlight.delete(token);
        const finishedAt = this.now();
        const bucket = this.bucketFor(finishedAt);
        bucket.total += 1;
        if (finishedAt - startedAt > this.stallThresholdMs) {
            bucket.stalled += 1;
        }
    }

    /**
     * @returns {StallSnapshot}
     */
    getSnapshot () {
        const now = this.now();
        const currentEpoch = Math.floor(now / BUCKET_MS);
        let total = 0;
        let stalled = 0;
        for (const bucket of this.buckets) {
            if (bucket.epoch > currentEpoch - this.bucketCount) {
                total += bucket.total;
                stalled += bucket.stalled;
            }
        }
        for (const startedAt of this.inFlight.values()) {
            total += 1;
            if (now - startedAt > this.stallThresholdMs) {
                stalled += 1;
            }
        }
        return new StallSnapshot({ total, stalled });
    }

    /**
     * @param {number} at
     * @returns {{epoch: number, total: number, stalled: number}}
     */
    bucketFor (at) {
        const epoch = Math.floor(at / BUCKET_MS);
        const bucket = this.buckets[epoch % this.bucketCount];
        if (bucket.epoch !== epoch) {
            bucket.epoch = epoch;
            bucket.total = 0;
            bucket.stalled = 0;
        }
        return bucket;
    }
}

/**
 * Used when the stall check is disabled, so the request path does no extra work.
 */
class NoopRequestStallTracker {
    startRequest () {
        return () => {};
    }

    getSnapshot () {
        return StallSnapshot.EMPTY;
    }
}

module.exports = {
    StallSnapshot,
    RequestStallTracker,
    NoopRequestStallTracker
};
