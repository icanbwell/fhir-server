'use strict';

/**
 * Subscribes a MongoClient to the driver's CMAP (Connection Monitoring and Pooling)
 * events and translates them into the OTel instruments in ./metrics.
 *
 * # Why this exists
 *
 * `@opentelemetry/instrumentation-mongodb` spans only the wire command. The time a
 * request spends queued waiting for a pooled connection happens before that span opens,
 * so pool starvation is invisible in traces: the waterfall shows a gap with no span in
 * it, then a fast query. A staging $merge burst produced a 13s gap of exactly this shape,
 * terminating in a `saslContinue` -- the driver had opened a brand-new connection
 * mid-request rather than reusing one, and nothing in the trace said so.
 *
 * # Why no started -> checkedOut correlation
 *
 * The driver already reports the wait: ConnectionCheckedOutEvent and
 * ConnectionCheckOutFailedEvent both carry `durationMS`, measured from the matching
 * ConnectionCheckOutStartedEvent. Pairing the events ourselves would mean holding
 * per-checkout state in a map keyed by an id that ConnectionCheckOutStartedEvent does not
 * carry, and would leak entries for every checkout that never completes. We read
 * durationMS instead and hold no state.
 */

const {
    recordMongoPoolCheckoutDuration,
    recordMongoPoolCheckoutFailed,
    recordMongoPoolCleared,
    recordMongoPoolConnectionCreated
} = require('./metrics');

/**
 * Attach CMAP metric emission to a MongoClient.
 *
 * Safe to call on any client: emission is fire-and-forget and never touches the
 * command path, so a throwing instrument cannot fail a query.
 *
 * @param {Object} params
 * @param {import('mongodb').MongoClient} params.client
 * @param {string} params.poolName Logical pool label. Bounded by deployment (one per
 *   configured database), never derived from resource ids or user input.
 * @returns {void}
 */
function registerMongoPoolMonitoring ({ client, poolName }) {
    if (!client || typeof client.on !== 'function') {
        return;
    }

    client.on('connectionCheckedOut', (event) => {
        recordMongoPoolCheckoutDuration(poolName, event?.durationMS);
    });

    client.on('connectionCheckOutFailed', (event) => {
        recordMongoPoolCheckoutFailed(poolName, event?.reason);
        // A failed checkout still consumed wait time, and that wait is the whole point of
        // the histogram -- excluding it would hide the worst cases.
        recordMongoPoolCheckoutDuration(poolName, event?.durationMS);
    });

    client.on('connectionPoolCleared', () => {
        recordMongoPoolCleared(poolName);
    });

    client.on('connectionCreated', () => {
        recordMongoPoolConnectionCreated(poolName);
    });
}

module.exports = {
    registerMongoPoolMonitoring
};
