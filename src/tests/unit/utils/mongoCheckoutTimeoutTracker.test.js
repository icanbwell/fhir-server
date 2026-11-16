'use strict';

const { EventEmitter } = require('events');
const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

// The OTel meter is the external boundary for metrics (see metrics.js docstring); key
// instruments by name so a test can assert which one was hit.
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
                createHistogram: (name) => {
                    histograms[name] = histograms[name] || { record: jest.fn() };
                    return histograms[name];
                }
            })
        },
        __counters: counters
    };
});

const { __counters } = require('@opentelemetry/api');
const {
    MongoCheckoutTimeoutTracker,
    readCheckoutTimeoutExitSettings,
    createGracefulWorkerExit,
    DEFAULT_THRESHOLD,
    DEFAULT_WINDOW_MS
} = require('../../../utils/mongoCheckoutTimeoutTracker');
const { registerMongoPoolMonitoring } = require('../../../utils/mongoPoolMonitor');

const SELF_EXIT_COUNTER = 'fhir_mongo_checkout_timeout_self_exit_total';
const WINDOW_MS = 120000;

/**
 * A clock the test advances by hand.
 */
function createFakeClock () {
    let nowMs = 0;
    return {
        now: () => nowMs,
        set: (ms) => {
            nowMs = ms;
        }
    };
}

/**
 * Stands in for the Node process, which is the boundary the exit action acts on.
 */
function createFakeProcess () {
    return { pid: 4242, exitCode: undefined, kill: jest.fn(), exit: jest.fn() };
}

describe('MongoCheckoutTimeoutTracker', () => {
    // Each step is [type, atMs]: 'T' is a checkout timeout, 'S' a successful checkout.
    test.each([
        ['threshold timeouts inside the window trigger', 5, [['T', 0], ['T', 1000], ['T', 2000], ['T', 3000], ['T', 4000]], true],
        ['one short of the threshold does not trigger', 5, [['T', 0], ['T', 1000], ['T', 2000], ['T', 3000]], false],
        ['timeouts spread wider than the window do not trigger', 5, [['T', 0], ['T', 40000], ['T', 80000], ['T', 120000], ['T', 160000]], false],
        ['the window slides, so old timeouts age out and recent ones still count', 5, [['T', 0], ['T', 200000], ['T', 201000], ['T', 202000], ['T', 203000], ['T', 204000]], true],
        ['a success resets the count', 5, [['T', 0], ['T', 1000], ['T', 2000], ['T', 3000], ['S', 3500], ['T', 4000]], false],
        ['a full run after a reset still triggers', 5, [['T', 0], ['T', 1000], ['S', 1500], ['T', 2000], ['T', 3000], ['T', 4000], ['T', 5000], ['T', 6000]], true],
        ['threshold 0 disables the tracker', 0, Array.from({ length: 50 }, (_, i) => ['T', i]), false],
        ['threshold 1 triggers on the first timeout', 1, [['T', 0]], true]
    ])('%s', (_name, threshold, steps, shouldTrigger) => {
        const clock = createFakeClock();
        const onThresholdReached = jest.fn();
        const tracker = new MongoCheckoutTimeoutTracker({
            poolName: 'fhir', threshold, windowMs: WINDOW_MS, now: clock.now, onThresholdReached
        });

        for (const [type, atMs] of steps) {
            clock.set(atMs);
            if (type === 'T') {
                tracker.recordCheckoutTimeout();
            } else {
                tracker.recordCheckoutSuccess();
            }
        }

        if (shouldTrigger) {
            expect(onThresholdReached).toHaveBeenCalledWith({
                poolName: 'fhir', consecutiveTimeouts: threshold, windowMs: WINDOW_MS
            });
        } else {
            expect(onThresholdReached).not.toHaveBeenCalled();
        }
    });

    test('triggers only once however many timeouts follow', () => {
        const onThresholdReached = jest.fn();
        const tracker = new MongoCheckoutTimeoutTracker({
            poolName: 'fhir', threshold: 2, windowMs: WINDOW_MS, now: () => 0, onThresholdReached
        });

        for (let i = 0; i < 10; i++) {
            tracker.recordCheckoutTimeout();
        }

        expect(onThresholdReached).toHaveBeenCalledTimes(1);
    });
});

describe('readCheckoutTimeoutExitSettings', () => {
    test.each([
        ['defaults when unset', {}, { threshold: DEFAULT_THRESHOLD, windowMs: DEFAULT_WINDOW_MS }],
        ['defaults when empty', { MONGO_CHECKOUT_TIMEOUT_EXIT_THRESHOLD: '', MONGO_CHECKOUT_TIMEOUT_EXIT_WINDOW_MS: '' }, { threshold: 5, windowMs: 120000 }],
        ['reads overrides', { MONGO_CHECKOUT_TIMEOUT_EXIT_THRESHOLD: '10', MONGO_CHECKOUT_TIMEOUT_EXIT_WINDOW_MS: '60000' }, { threshold: 10, windowMs: 60000 }],
        ['0 disables', { MONGO_CHECKOUT_TIMEOUT_EXIT_THRESHOLD: '0' }, { threshold: 0, windowMs: 120000 }]
    ])('%s', (_name, env, expected) => {
        expect(readCheckoutTimeoutExitSettings(env)).toEqual(expected);
    });

    test.each([
        ['MONGO_CHECKOUT_TIMEOUT_EXIT_THRESHOLD', 'five'],
        ['MONGO_CHECKOUT_TIMEOUT_EXIT_THRESHOLD', '-1'],
        ['MONGO_CHECKOUT_TIMEOUT_EXIT_THRESHOLD', '2.5'],
        ['MONGO_CHECKOUT_TIMEOUT_EXIT_WINDOW_MS', '2m']
    ])('rejects %s=%s at startup', (name, value) => {
        expect(() => readCheckoutTimeoutExitSettings({ [name]: value })).toThrow(name);
    });
});

describe('createGracefulWorkerExit', () => {
    let processRef;
    let logError;
    let setTimer;
    let exitWorker;

    beforeEach(() => {
        __counters[SELF_EXIT_COUNTER].add.mockClear();
        processRef = createFakeProcess();
        logError = jest.fn();
        setTimer = jest.fn(() => ({ unref: jest.fn() }));
        exitWorker = createGracefulWorkerExit({ processRef, logError, forceExitAfterMs: 75000, setTimer });
    });

    test('logs, counts, and starts the graceful shutdown with a non-zero exit code', () => {
        exitWorker({ poolName: 'fhir', consecutiveTimeouts: 5, windowMs: WINDOW_MS });

        expect(logError).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
            args: expect.objectContaining({ pool: 'fhir', consecutiveTimeouts: 5, windowMs: WINDOW_MS, exitCode: 1 })
        }));
        expect(__counters[SELF_EXIT_COUNTER].add).toHaveBeenCalledWith(1, { pool: 'fhir' });
        expect(processRef.exitCode).toBe(1);
        expect(processRef.kill).toHaveBeenCalledWith(4242, 'SIGTERM');
        expect(processRef.exit).not.toHaveBeenCalled();
    });

    test('forces exit(1) if the graceful drain does not finish in time', () => {
        exitWorker({ poolName: 'fhir', consecutiveTimeouts: 5, windowMs: WINDOW_MS });
        const [forceExit, delayMs] = setTimer.mock.calls[0];

        forceExit();

        expect(delayMs).toBe(75000);
        expect(processRef.exit).toHaveBeenCalledWith(1);
    });

    test('runs once even when several pools trip', () => {
        exitWorker({ poolName: 'fhir', consecutiveTimeouts: 5, windowMs: WINDOW_MS });
        exitWorker({ poolName: 'fhir_audit', consecutiveTimeouts: 5, windowMs: WINDOW_MS });

        expect(processRef.kill).toHaveBeenCalledTimes(1);
        expect(__counters[SELF_EXIT_COUNTER].add).toHaveBeenCalledTimes(1);
    });
});

describe('a worker wired through registerMongoPoolMonitoring', () => {
    let client;
    let clock;
    let processRef;

    beforeEach(() => {
        __counters[SELF_EXIT_COUNTER].add.mockClear();
        clock = createFakeClock();
        processRef = createFakeProcess();
        // A real EventEmitter stands in for MongoClient, which emits CMAP events through it.
        client = new EventEmitter();
        const tracker = new MongoCheckoutTimeoutTracker({
            poolName: 'fhir',
            ...readCheckoutTimeoutExitSettings({}),
            now: clock.now,
            onThresholdReached: createGracefulWorkerExit({
                processRef, logError: jest.fn(), forceExitAfterMs: 75000, setTimer: () => ({ unref: () => {} })
            })
        });
        registerMongoPoolMonitoring({ client, poolName: 'fhir', checkoutTimeoutTracker: tracker });
    });

    test('exits when the pool is wedged and every checkout times out', () => {
        for (let i = 0; i < 5; i++) {
            clock.set(i * 30000);
            client.emit('connectionCheckOutFailed', { reason: 'timeout', durationMS: 30000 });
        }

        expect(processRef.kill).toHaveBeenCalledWith(4242, 'SIGTERM');
        expect(processRef.exitCode).toBe(1);
        expect(__counters[SELF_EXIT_COUNTER].add).toHaveBeenCalledWith(1, { pool: 'fhir' });
    });

    test('never exits on a healthy pool with occasional timeouts and non-timeout failures', () => {
        for (let i = 0; i < 200; i++) {
            clock.set(i * 100);
            if (i % 4 === 0) {
                client.emit('connectionCheckOutFailed', { reason: 'timeout', durationMS: 30000 });
            } else if (i % 4 === 1) {
                client.emit('connectionCheckOutFailed', { reason: 'connectionError', durationMS: 5 });
            }
            client.emit('connectionCheckedOut', { durationMS: 1 });
        }

        expect(processRef.kill).not.toHaveBeenCalled();
        expect(processRef.exitCode).toBeUndefined();
        expect(__counters[SELF_EXIT_COUNTER].add).not.toHaveBeenCalled();
    });

    test('does not count non-timeout failures toward the exit', () => {
        for (let i = 0; i < 20; i++) {
            client.emit('connectionCheckOutFailed', { reason: 'connectionError', durationMS: 5 });
        }

        expect(processRef.kill).not.toHaveBeenCalled();
    });
});
