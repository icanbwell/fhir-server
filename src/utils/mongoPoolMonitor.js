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
 * durationMS instead and hold no state for the histogram.
 *
 * # Occupancy: connections in use and the wait queue
 *
 * fhir_mongo_pool_connections_in_use and fhir_mongo_pool_wait_queue_size do need state,
 * because they are levels, not events. That state lives in one small object per client
 * (createPoolOccupancy), keyed by server address: one MongoClient owns a pool per
 * replica-set member, and keeping them apart means a stray event for one server cannot
 * cancel out a real checkout on another, and a server's pool closing drops only its own
 * counts. The emitted value is the sum across addresses, labelled by pool as before.
 *
 * - In use is a Set of the connection ids checked out, not a number. checkedOut and
 *   checkedIn both carry connectionId, so a duplicate checkedOut or a checkedIn for a
 *   connection we never saw is a no-op, and the level is bounded by maxPoolSize.
 * - Waiting is a counter: ConnectionCheckOutStartedEvent carries no id to pair on. It is
 *   clamped at 0, so a checkedOut or checkOutFailed with no matching started (subscribed
 *   mid-flight, or a reordered or duplicate event) cannot drive it negative. A negative
 *   level would read as spare capacity, so dropping the decrement is the safer error.
 * - connectionPoolCleared changes neither level. The driver pauses the pool and fails
 *   every waiter with a checkOutFailed (reason connectionError), and checked-out
 *   connections are still checked in (then destroyed as stale). Resetting here would
 *   count each of those twice.
 * - connectionClosed removes the id from in use. The driver checks a connection in before
 *   destroying it, so this is normally a no-op; it covers a missed checkedIn, since a
 *   closed connection cannot be in use.
 * - connectionPoolClosed drops that address's state entirely and emits the negative of
 *   whatever it still held, so a closed pool reports 0 rather than a leftover level. Late
 *   checkedIn events after the close find no entry and do nothing.
 *
 * - A checkout cancelled through an AbortSignal emits no checkOutFailed: the driver marks
 *   the wait-queue member cancelled and drops it silently the next time it processes the
 *   queue (on a checkIn). The counter alone would therefore drift upward by one per
 *   cancelled checkout until its pool closes. To correct it, after a checkedIn,
 *   checkedOut or checkOutFailed with waiters still counted, the monitor reads the pool's
 *   real queue length (client.topology.s.servers.get(address).pool.waitQueueSize, a driver
 *   internal) on the next macrotask, once the driver has dropped cancelled members, and
 *   lowers the count to it. It only ever lowers the count, and if the internals are not
 *   there (a driver upgrade) it does nothing and the counter behaves as before. While a
 *   cancelled checkout sits behind a connection that stays busy, the gauge overstates the
 *   wait by one until that connection is checked in.
 */

const {
    recordMongoPoolCheckoutDuration,
    recordMongoPoolCheckoutFailed,
    recordMongoPoolCleared,
    recordMongoPoolConnectionCreated,
    recordMongoPoolConnectionsInUseChange,
    recordMongoPoolWaitQueueSizeChange
} = require('./metrics');

const UNKNOWN_ADDRESS = 'unknown';

/**
 * Per-client connection occupancy, keyed by server address. Every method returns the
 * change it made to the summed levels as `{ inUse, waiting }`, so the caller emits exactly
 * what changed and nothing when an event was a duplicate or out of order.
 * @returns {{
 *   checkOutStarted: (address: string|undefined) => {inUse: number, waiting: number},
 *   checkedOut: (address: string|undefined, connectionId: number|undefined) => {inUse: number, waiting: number},
 *   checkOutFailed: (address: string|undefined) => {inUse: number, waiting: number},
 *   checkedIn: (address: string|undefined, connectionId: number|undefined) => {inUse: number, waiting: number},
 *   connectionClosed: (address: string|undefined, connectionId: number|undefined) => {inUse: number, waiting: number},
 *   poolClosed: (address: string|undefined) => {inUse: number, waiting: number},
 *   hasWaiters: (address: string|undefined) => boolean,
 *   reconcileWaiting: (address: string|undefined, actualWaiting: number) => {inUse: number, waiting: number}
 * }}
 */
function createPoolOccupancy () {
    /** @type {Map<string, {checkedOutIds: Set<number>, waiting: number}>} */
    const servers = new Map();

    const keyOf = (address) => address || UNKNOWN_ADDRESS;

    // Increments create the entry; decrements never do, so a late event for a closed pool
    // cannot resurrect it.
    const getOrCreate = (address) => {
        const key = keyOf(address);
        let server = servers.get(key);
        if (!server) {
            server = { checkedOutIds: new Set(), waiting: 0 };
            servers.set(key, server);
        }
        return server;
    };

    const leaveWaitQueue = (server) => {
        if (!server || server.waiting === 0) {
            return 0;
        }
        server.waiting -= 1;
        return -1;
    };

    const release = (server, connectionId) => {
        return server && server.checkedOutIds.delete(connectionId) ? -1 : 0;
    };

    return {
        checkOutStarted (address) {
            getOrCreate(address).waiting += 1;
            return { inUse: 0, waiting: 1 };
        },
        checkedOut (address, connectionId) {
            const server = getOrCreate(address);
            const waiting = leaveWaitQueue(server);
            // Without an id the matching checkedIn could never release it, so count nothing
            // rather than leak a permanent +1. The driver always sets connectionId.
            if (connectionId === undefined || server.checkedOutIds.has(connectionId)) {
                return { inUse: 0, waiting };
            }
            server.checkedOutIds.add(connectionId);
            return { inUse: 1, waiting };
        },
        checkOutFailed (address) {
            return { inUse: 0, waiting: leaveWaitQueue(servers.get(keyOf(address))) };
        },
        checkedIn (address, connectionId) {
            return { inUse: release(servers.get(keyOf(address)), connectionId), waiting: 0 };
        },
        connectionClosed (address, connectionId) {
            return { inUse: release(servers.get(keyOf(address)), connectionId), waiting: 0 };
        },
        hasWaiters (address) {
            return (servers.get(keyOf(address))?.waiting ?? 0) > 0;
        },
        // Lowers the count to the pool's real queue length. Never raises it: a larger real
        // length means a started event is still ahead of us, not a missing one.
        reconcileWaiting (address, actualWaiting) {
            const server = servers.get(keyOf(address));
            if (!server || !(actualWaiting >= 0) || server.waiting <= actualWaiting) {
                return { inUse: 0, waiting: 0 };
            }
            const waiting = actualWaiting - server.waiting;
            server.waiting = actualWaiting;
            return { inUse: 0, waiting };
        },
        poolClosed (address) {
            const key = keyOf(address);
            const server = servers.get(key);
            if (!server) {
                return { inUse: 0, waiting: 0 };
            }
            servers.delete(key);
            return { inUse: -server.checkedOutIds.size, waiting: -server.waiting };
        }
    };
}

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

    const occupancy = createPoolOccupancy();
    const emitOccupancyChange = ({ inUse, waiting }) => {
        recordMongoPoolConnectionsInUseChange(poolName, inUse);
        recordMongoPoolWaitQueueSizeChange(poolName, waiting);
    };

    // Reads the pool's real queue length from the driver's topology; undefined when the
    // internals are not there.
    const poolWaitQueueSize = (address) => {
        return client.topology?.s?.servers?.get(address)?.pool?.waitQueueSize;
    };

    // Runs on the next macrotask, after the driver has dropped cancelled queue members
    // (see the AbortSignal note in the header), and only when there is something that could be overstated.
    const reconcileWaitQueueSoon = (address) => {
        if (!address || !occupancy.hasWaiters(address)) {
            return;
        }
        setImmediate(() => {
            try {
                const actual = poolWaitQueueSize(address);
                if (typeof actual === 'number') {
                    emitOccupancyChange(occupancy.reconcileWaiting(address, actual));
                }
            } catch {
                // Reconciliation is best effort and must never surface into the driver.
            }
        }).unref();
    };

    client.on('connectionCheckOutStarted', (event) => {
        emitOccupancyChange(occupancy.checkOutStarted(event?.address));
    });

    client.on('connectionCheckedOut', (event) => {
        recordMongoPoolCheckoutDuration(poolName, event?.durationMS);
        emitOccupancyChange(occupancy.checkedOut(event?.address, event?.connectionId));
        reconcileWaitQueueSoon(event?.address);
    });

    client.on('connectionCheckOutFailed', (event) => {
        recordMongoPoolCheckoutFailed(poolName, event?.reason);
        // A failed checkout still consumed wait time, and that wait is the whole point of
        // the histogram -- excluding it would hide the worst cases.
        recordMongoPoolCheckoutDuration(poolName, event?.durationMS);
        emitOccupancyChange(occupancy.checkOutFailed(event?.address));
        reconcileWaitQueueSoon(event?.address);
    });

    client.on('connectionCheckedIn', (event) => {
        emitOccupancyChange(occupancy.checkedIn(event?.address, event?.connectionId));
        reconcileWaitQueueSoon(event?.address);
    });

    client.on('connectionClosed', (event) => {
        emitOccupancyChange(occupancy.connectionClosed(event?.address, event?.connectionId));
    });

    client.on('connectionPoolClosed', (event) => {
        emitOccupancyChange(occupancy.poolClosed(event?.address));
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
