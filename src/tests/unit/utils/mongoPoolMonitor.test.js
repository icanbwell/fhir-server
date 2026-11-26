'use strict';

const { EventEmitter } = require('events');
const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

// The OTel meter is process-wide ambient (see metrics.js docstring), so the only honest
// seam is the @opentelemetry/api boundary. Unlike metrics.test.js's shared-instrument
// mock, this keys instruments by name so a test can assert WHICH instrument was hit.
jest.mock('@opentelemetry/api', () => {
    const counters = {};
    const histograms = {};
    return {
        metrics: {
            getMeter: () => ({
                createCounter: (name) => {
                    counters[name] = counters[name] || { add: jest.fn() };
                    return counters[name];
                },
                // UpDownCounters share the counter map: both expose add(), and the names differ.
                createUpDownCounter: (name) => {
                    counters[name] = counters[name] || { add: jest.fn() };
                    return counters[name];
                },
                createHistogram: (name) => {
                    histograms[name] = histograms[name] || { record: jest.fn() };
                    return histograms[name];
                }
            })
        },
        __counters: counters,
        __histograms: histograms
    };
});

jest.mock('../../../operations/common/logging', () => ({ logWarn: jest.fn() }));

const { __counters, __histograms } = require('@opentelemetry/api');
const { logWarn } = require('../../../operations/common/logging');
const { registerMongoPoolMonitoring } = require('../../../utils/mongoPoolMonitor');

const CHECKOUT_DURATION = 'fhir_mongo_pool_checkout_duration_seconds';
const CHECKOUT_FAILED = 'fhir_mongo_pool_checkout_failed_total';
const POOL_CLEARED = 'fhir_mongo_pool_cleared_total';
const CONNECTION_CREATED = 'fhir_mongo_pool_connection_created_total';
const CONNECTIONS_IN_USE = 'fhir_mongo_pool_connections_in_use';
const WAIT_QUEUE_SIZE = 'fhir_mongo_pool_wait_queue_size';

describe('registerMongoPoolMonitoring', () => {
    let client;

    beforeEach(() => {
        for (const counter of Object.values(__counters)) {
            counter.add.mockClear();
        }
        for (const histogram of Object.values(__histograms)) {
            histogram.record.mockClear();
        }
        // A real EventEmitter stands in for MongoClient: the driver emits CMAP events
        // through EventEmitter, so this exercises the real subscription path.
        client = new EventEmitter();
        registerMongoPoolMonitoring({ client, poolName: 'fhir' });
    });

    test('records connection checkout wait time in seconds', () => {
        client.emit('connectionCheckedOut', { durationMS: 13000 });

        expect(__histograms[CHECKOUT_DURATION].record).toHaveBeenCalledWith(13, { pool: 'fhir' });
    });

    test('records a fast checkout as sub-second, not rounded away', () => {
        client.emit('connectionCheckedOut', { durationMS: 250 });

        expect(__histograms[CHECKOUT_DURATION].record).toHaveBeenCalledWith(0.25, { pool: 'fhir' });
    });

    test('counts a failed checkout labelled with the driver reason', () => {
        client.emit('connectionCheckOutFailed', { reason: 'timeout', durationMS: 30000 });

        expect(__counters[CHECKOUT_FAILED].add).toHaveBeenCalledWith(1, {
            pool: 'fhir',
            reason: 'timeout'
        });
    });

    test('maps an unrecognized failure reason to unknown to bound label cardinality', () => {
        client.emit('connectionCheckOutFailed', { reason: 'something-new-from-the-driver' });

        expect(__counters[CHECKOUT_FAILED].add).toHaveBeenCalledWith(1, {
            pool: 'fhir',
            reason: 'unknown'
        });
    });

    test('records the wait time of a failed checkout, which is otherwise invisible', () => {
        client.emit('connectionCheckOutFailed', { reason: 'timeout', durationMS: 30000 });

        expect(__histograms[CHECKOUT_DURATION].record).toHaveBeenCalledWith(30, { pool: 'fhir' });
    });

    test('counts pool clears, which signal the server was marked unknown', () => {
        client.emit('connectionPoolCleared', {});

        expect(__counters[POOL_CLEARED].add).toHaveBeenCalledWith(1, { pool: 'fhir' });
    });

    test('counts connections created, exposing pool churn', () => {
        client.emit('connectionCreated', {});

        expect(__counters[CONNECTION_CREATED].add).toHaveBeenCalledWith(1, { pool: 'fhir' });
    });

    test('does not record a checkout duration when the driver omits durationMS', () => {
        client.emit('connectionCheckedOut', {});

        expect(__histograms[CHECKOUT_DURATION].record).not.toHaveBeenCalled();
    });

    describe('connection occupancy levels', () => {
        const PRIMARY = 'primary.example:27017';
        const SECONDARY = 'secondary.example:27017';
        const started = (address = PRIMARY) => ['connectionCheckOutStarted', { address }];
        const checkedOut = (connectionId, address = PRIMARY) => ['connectionCheckedOut', { address, connectionId, durationMS: 1 }];
        const failed = (reason, address = PRIMARY) => ['connectionCheckOutFailed', { address, reason, durationMS: 1 }];
        const checkedIn = (connectionId, address = PRIMARY) => ['connectionCheckedIn', { address, connectionId }];
        const closed = (connectionId, address = PRIMARY) => ['connectionClosed', { address, connectionId, reason: 'stale' }];
        const poolCleared = (address = PRIMARY) => ['connectionPoolCleared', { address }];
        const poolClosed = (address = PRIMARY) => ['connectionPoolClosed', { address }];

        // The exported value is the running sum of every add() an UpDownCounter received, so
        // replay records that sum after each event -- the level a dashboard would show.
        const replay = (events) => {
            const inUse = [];
            const waiting = [];
            let inUseLevel = 0;
            let waitingLevel = 0;
            for (const [name, payload] of events) {
                const inUseBefore = __counters[CONNECTIONS_IN_USE].add.mock.calls.length;
                const waitingBefore = __counters[WAIT_QUEUE_SIZE].add.mock.calls.length;
                client.emit(name, payload);
                for (const [delta] of __counters[CONNECTIONS_IN_USE].add.mock.calls.slice(inUseBefore)) {
                    inUseLevel += delta;
                }
                for (const [delta] of __counters[WAIT_QUEUE_SIZE].add.mock.calls.slice(waitingBefore)) {
                    waitingLevel += delta;
                }
                inUse.push(inUseLevel);
                waiting.push(waitingLevel);
            }
            return { inUse, waiting };
        };

        test.each([
            {
                name: 'checkout then checkin',
                events: [started(), checkedOut(1), checkedIn(1)],
                inUse: [0, 1, 0],
                waiting: [1, 0, 0]
            },
            {
                name: 'queued requests behind an exhausted pool drain as connections come back',
                events: [started(), checkedOut(1), started(), started(), checkedIn(1), checkedOut(1), checkedIn(1), checkedOut(1), checkedIn(1)],
                inUse: [0, 1, 1, 1, 0, 1, 0, 1, 0],
                waiting: [1, 0, 1, 2, 2, 1, 1, 0, 0]
            },
            {
                name: 'failed checkout leaves the wait queue without taking a connection',
                events: [started(), failed('timeout')],
                inUse: [0, 0],
                waiting: [1, 0]
            },
            {
                name: 'pool cleared while connections are checked out: waiters fail, in-use drains on checkin',
                events: [started(), checkedOut(1), started(), checkedOut(2), started(), poolCleared(), failed('connectionError'), checkedIn(1), closed(1), checkedIn(2), closed(2)],
                inUse: [0, 1, 1, 2, 2, 2, 2, 1, 1, 0, 0],
                waiting: [1, 0, 1, 0, 1, 1, 0, 0, 0, 0, 0]
            },
            {
                name: 'connection closed without a checkin is no longer counted in use',
                events: [started(), checkedOut(1), closed(1)],
                inUse: [0, 1, 0],
                waiting: [1, 0, 0]
            },
            {
                name: 'pool closed with connections and waiters outstanding drops to zero, late checkin is ignored',
                events: [started(), checkedOut(1), started(), poolClosed(), checkedIn(1), failed('poolClosed')],
                inUse: [0, 1, 1, 0, 0, 0],
                waiting: [1, 0, 1, 0, 0, 0]
            },
            {
                name: 'checkin and failure with nothing outstanding never go below zero',
                events: [checkedIn(7), failed('timeout'), closed(7), poolClosed()],
                inUse: [0, 0, 0, 0],
                waiting: [0, 0, 0, 0]
            },
            {
                name: 'duplicate checkedOut and checkedIn for one connection count once',
                events: [started(), checkedOut(1), checkedOut(1), checkedIn(1), checkedIn(1)],
                inUse: [0, 1, 1, 0, 0],
                waiting: [1, 0, 0, 0, 0]
            },
            {
                name: 'checkedOut with no started (subscribed mid-flight) counts in use without a negative wait queue',
                events: [checkedOut(3), checkedIn(3)],
                inUse: [1, 0],
                waiting: [0, 0]
            },
            {
                name: 'out-of-order checkin before checkout does not cancel the later checkout',
                events: [checkedIn(4), started(), checkedOut(4)],
                inUse: [0, 0, 1],
                waiting: [0, 1, 0]
            },
            {
                name: 'server pools are tracked apart: a stray event on one cannot cancel a checkout on another',
                events: [started(PRIMARY), checkedOut(1, PRIMARY), checkedIn(1, SECONDARY), started(SECONDARY), checkedOut(1, SECONDARY), poolClosed(SECONDARY)],
                inUse: [0, 1, 1, 1, 2, 1],
                waiting: [1, 0, 0, 1, 0, 0]
            }
        ])('$name', ({ events, inUse, waiting }) => {
            const levels = replay(events);

            expect(levels).toEqual({ inUse, waiting });
        });

        test.each([
            ['in use', CONNECTIONS_IN_USE, [started(), checkedOut(1), checkedIn(1), checkedIn(1)]],
            ['wait queue', WAIT_QUEUE_SIZE, [started(), failed('timeout'), failed('timeout')]]
        ])('labels every %s change by pool and never emits a zero delta', (_level, instrumentName, events) => {
            for (const event of events) {
                client.emit(...event);
            }

            const calls = __counters[instrumentName].add.mock.calls;
            expect(calls.length).toBeGreaterThan(0);
            for (const [delta, attributes] of calls) {
                expect(delta).not.toBe(0);
                expect(attributes).toEqual({ pool: 'fhir' });
            }
        });

        describe('reconciling the wait queue against the pool after an AbortSignal cancellation', () => {
            const levelOf = (name) =>
                __counters[name].add.mock.calls.reduce((sum, [delta]) => sum + delta, 0);
            const settleAsync = () => new Promise((resolve) => setImmediate(resolve));
            const withPoolQueue = (waitQueueSize, pendingConnectionCount) => {
                client.topology = {
                    s: { servers: new Map([[PRIMARY, { pool: { waitQueueSize, pendingConnectionCount } }]]) }
                };
            };

            test('drops a cancelled checkout the driver never reported once the pool queue is shorter', async () => {
                client.emit(...started());
                client.emit(...started());
                withPoolQueue(0);

                // The cancelled waiter is gone from the pool; the live one gets the connection.
                client.emit(...checkedOut(1));
                await settleAsync();

                expect(levelOf(WAIT_QUEUE_SIZE)).toBe(0);
            });

            test('counts waiters the driver already shifted out to open a new connection', async () => {
                client.emit(...started());
                client.emit(...started());
                client.emit(...started());
                // One waiter is queued, two are waiting on connections still being opened.
                withPoolQueue(1, 2);

                client.emit(...checkedIn(1));
                await settleAsync();

                expect(levelOf(WAIT_QUEUE_SIZE)).toBe(3);
            });

            test.each([
                ['the pool queue matches the count', 2],
                ['the pool queue is longer than the count', 3]
            ])('leaves the count alone when %s', async (_name, poolQueue) => {
                client.emit(...started());
                client.emit(...started());
                withPoolQueue(poolQueue);

                client.emit(...checkedIn(1));
                await settleAsync();

                expect(levelOf(WAIT_QUEUE_SIZE)).toBe(2);
            });

            test.each([
                ['the client has no topology', undefined],
                ['the pool has no wait queue size', { s: { servers: new Map([[PRIMARY, { pool: {} }]]) } }],
                ['the server is unknown', { s: { servers: new Map() } }],
                ['the topology throws', { get s () { throw new Error('boom'); } }]
            ])('leaves the count alone when %s', async (_name, topology) => {
                client.topology = topology;
                client.emit(...started());
                client.emit(...started());

                client.emit(...checkedOut(1));
                await settleAsync();

                expect(levelOf(WAIT_QUEUE_SIZE)).toBe(1);
            });

            test('warns once, without failing, when the driver internals cannot be read', async () => {
                logWarn.mockClear();
                client.topology = undefined;
                client.emit(...started());
                client.emit(...started());

                client.emit(...checkedOut(1));
                client.emit(...checkedIn(1));
                await settleAsync();

                expect(logWarn.mock.calls.length).toBeLessThanOrEqual(1);
            });

            test('does not read the pool when no checkout is counted as waiting', async () => {
                const pool = { get waitQueueSize () { throw new Error('should not be read'); } };
                client.topology = { s: { servers: new Map([[PRIMARY, { pool }]]) } };
                client.emit(...started());
                client.emit(...checkedOut(1));

                client.emit(...checkedIn(1));
                await settleAsync();

                expect(levelOf(WAIT_QUEUE_SIZE)).toBe(0);
            });
        });

        test('clients sharing a pool name sum into one level instead of overwriting each other', () => {
            const archiveClient = new EventEmitter();
            registerMongoPoolMonitoring({ client: archiveClient, poolName: 'fhir' });

            client.emit(...started());
            client.emit(...checkedOut(1));
            archiveClient.emit(...started());
            archiveClient.emit(...checkedOut(1));

            const level = __counters[CONNECTIONS_IN_USE].add.mock.calls.reduce((sum, [delta]) => sum + delta, 0);
            expect(level).toBe(2);
        });
    });
});
