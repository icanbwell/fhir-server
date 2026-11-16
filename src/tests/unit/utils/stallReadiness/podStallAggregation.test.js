'use strict';

/**
 * Pod-level aggregation across cluster workers. The cluster and the worker IPC channels are
 * replaced by in-memory EventEmitters (the OS process boundary is the only thing faked); the
 * trackers, policy, aggregator, coordinator and worker providers are all real.
 */

const { EventEmitter } = require('events');
const { describe, test, expect, beforeEach, afterEach, jest: jestObj } = require('@jest/globals');
const {
    StallReadinessConfig,
    StallReadinessPolicy,
    StallSnapshot,
    PodStallAggregator,
    PrimaryStallCoordinator,
    RequestStallTracker,
    ClusterWorkerStallVerdictProvider,
    LocalStallVerdictProvider,
    DisabledStallVerdictProvider,
    VERDICT_REASON,
    STALL_MESSAGE_TYPE,
    createRequestStallTracker,
    createStallVerdictProvider,
    attachPrimaryStallAggregator
} = require('../../../../utils/stallReadiness');

const ENABLED_ENV = {
    READINESS_STALL_CHECK_ENABLED: 'true',
    READINESS_STALL_THRESHOLD_MS: '30000',
    READINESS_STALL_WINDOW_MS: '120000',
    READINESS_STALL_MAX_RATIO: '0.2',
    READINESS_STALL_MIN_SAMPLES: '20',
    READINESS_STALL_REPORT_INTERVAL_MS: '5000'
};

function fakeClock (start = 5_000_000) {
    const clock = { t: start };
    clock.now = () => clock.t;
    clock.advance = (ms) => { clock.t += ms; };
    return clock;
}

/**
 * An in-memory stand-in for node's cluster module plus one IPC channel per worker.
 */
function fakeCluster () {
    const cluster = new EventEmitter();
    cluster.workers = {};
    cluster.addWorker = (id) => {
        const ipc = new EventEmitter();
        ipc.connected = true;
        const worker = {
            id,
            isConnected: () => ipc.connected,
            send: (message, cb) => { ipc.emit('message', message); cb && cb(null); }
        };
        ipc.send = (message, cb) => { cluster.emit('message', worker, message); cb && cb(null); };
        cluster.workers[id] = worker;
        return { worker, ipc };
    };
    cluster.killWorker = (id) => {
        const worker = cluster.workers[id];
        delete cluster.workers[id];
        cluster.emit('exit', worker, 1, null);
    };
    return cluster;
}

function startWorker ({ cluster, id, config, clock }) {
    const { ipc } = cluster.addWorker(id);
    const tracker = new RequestStallTracker({
        windowMs: config.windowMs, stallThresholdMs: config.stallThresholdMs, now: clock.now
    });
    const provider = new ClusterWorkerStallVerdictProvider({
        tracker,
        policy: new StallReadinessPolicy({ maxStalledRatio: config.maxStalledRatio, minSamples: config.minSamples }),
        ipc,
        reportIntervalMs: config.reportIntervalMs,
        verdictStaleAfterMs: config.staleAfterMs,
        now: clock.now
    });
    ipc.on('message', provider.onMessage);
    return { tracker, provider };
}

function runRequests (tracker, clock, { count, durationMs }) {
    for (let i = 0; i < count; i++) {
        const end = tracker.startRequest();
        clock.advance(durationMs);
        end();
    }
}

function setUpPod (clock) {
    const config = StallReadinessConfig.fromEnv(ENABLED_ENV);
    const cluster = fakeCluster();
    const policy = new StallReadinessPolicy({ maxStalledRatio: config.maxStalledRatio, minSamples: config.minSamples });
    const aggregator = new PodStallAggregator({ policy, staleAfterMs: config.staleAfterMs, now: clock.now });
    new PrimaryStallCoordinator({ aggregator, cluster, log: () => {} }).attach();
    return { config, cluster, aggregator };
}

describe('pod-level stall aggregation over cluster IPC', () => {
    test('one stalled worker and one healthy worker: the pod is not ready, whichever worker answers', () => {
        const clock = fakeClock();
        const { config, cluster } = setUpPod(clock);
        const stalled = startWorker({ cluster, id: 1, config, clock });
        const healthy = startWorker({ cluster, id: 2, config, clock });

        // Healthy worker serves 40 fast requests. The wedged worker accepted 15 requests that
        // are still hanging on an exhausted pool 45s later.
        runRequests(healthy.tracker, clock, { count: 40, durationMs: 50 });
        for (let i = 0; i < 15; i++) {
            stalled.tracker.startRequest();
        }
        clock.advance(45_000);
        stalled.provider.report();
        healthy.provider.report();

        expect(stalled.provider.getVerdict()).toMatchObject({
            ready: false, reason: VERDICT_REASON.STALLED_SHARE_EXCEEDED, total: 55, stalled: 15
        });
        expect(healthy.provider.getVerdict()).toMatchObject({ ready: false, total: 55, stalled: 15 });
    });

    test.each([2, 4, 6])('steady state: %i workers, one hanging every request until the 120s router timeout, the pod is not ready', (workerCount) => {
        const clock = fakeClock();
        const { config, cluster } = setUpPod(clock);
        const workers = Array.from({ length: workerCount }, (_, i) => startWorker({ cluster, id: i + 1, config, clock }));
        const wedged = workers[0];
        const pending = [];

        // One request per worker per second for 5 minutes; the wedged worker's requests close at 120s.
        for (let second = 0; second < 300; second++) {
            for (const [index, { tracker }] of workers.entries()) {
                const end = tracker.startRequest();
                if (index === 0) {
                    pending.push({ end, dueAt: clock.now() + 120_000 });
                } else {
                    end();
                }
            }
            clock.advance(1000);
            while (pending.length && pending[0].dueAt <= clock.now()) {
                pending.shift().end();
            }
        }
        workers.forEach(({ provider }) => provider.report());

        const verdict = workers[workerCount - 1].provider.getVerdict();
        expect(verdict.ready).toBe(false);
        expect(verdict.stalled / verdict.total).toBeGreaterThan(0.2);
        expect(wedged.provider.getVerdict()).toEqual(verdict);
    });

    test('without aggregation the healthy worker alone would have said ready', () => {
        const clock = fakeClock();
        const config = StallReadinessConfig.fromEnv(ENABLED_ENV);
        const healthyTracker = new RequestStallTracker({ windowMs: config.windowMs, stallThresholdMs: config.stallThresholdMs, now: clock.now });
        runRequests(healthyTracker, clock, { count: 40, durationMs: 50 });
        const local = new LocalStallVerdictProvider({
            tracker: healthyTracker,
            policy: new StallReadinessPolicy({ maxStalledRatio: config.maxStalledRatio, minSamples: config.minSamples })
        });

        expect(local.getVerdict().ready).toBe(true);
    });

    test('a healthy pod stays ready', () => {
        const clock = fakeClock();
        const { config, cluster } = setUpPod(clock);
        const workers = [1, 2, 3].map((id) => startWorker({ cluster, id, config, clock }));

        for (const { tracker } of workers) {
            runRequests(tracker, clock, { count: 30, durationMs: 120 });
            tracker.startRequest(); // one normal request still in flight per worker
        }
        clock.advance(500);
        workers.forEach(({ provider }) => provider.report());

        for (const { provider } of workers) {
            expect(provider.getVerdict()).toMatchObject({ ready: true, reason: VERDICT_REASON.WITHIN_THRESHOLD, total: 93, stalled: 0 });
        }
    });

    test('a pod with a few slow requests and little traffic stays ready (min sample)', () => {
        const clock = fakeClock();
        const { config, cluster } = setUpPod(clock);
        const a = startWorker({ cluster, id: 1, config, clock });
        const b = startWorker({ cluster, id: 2, config, clock });

        runRequests(a.tracker, clock, { count: 3, durationMs: 40_000 });
        runRequests(b.tracker, clock, { count: 5, durationMs: 100 });
        a.provider.report();
        b.provider.report();

        expect(b.provider.getVerdict()).toMatchObject({ ready: true, reason: VERDICT_REASON.BELOW_MIN_SAMPLES });
    });

    test('the pod recovers once the wedged worker exits and is replaced', () => {
        const clock = fakeClock();
        const { config, cluster } = setUpPod(clock);
        const stalled = startWorker({ cluster, id: 1, config, clock });
        const healthy = startWorker({ cluster, id: 2, config, clock });
        runRequests(healthy.tracker, clock, { count: 40, durationMs: 50 });
        for (let i = 0; i < 15; i++) {
            stalled.tracker.startRequest();
        }
        clock.advance(45_000);
        stalled.provider.report();
        healthy.provider.report();
        expect(healthy.provider.getVerdict().ready).toBe(false);

        cluster.killWorker(1);
        healthy.provider.report();

        expect(healthy.provider.getVerdict()).toMatchObject({ ready: true, total: 40, stalled: 0 });
    });

    test('a worker that stops reporting drops out of the aggregate after the stale window', () => {
        const clock = fakeClock();
        const { config, aggregator } = setUpPod(clock);
        aggregator.recordWorkerReport('1', new StallSnapshot({ total: 30, stalled: 30 }));
        clock.advance(config.staleAfterMs + 1);
        aggregator.recordWorkerReport('2', new StallSnapshot({ total: 30, stalled: 0 }));

        expect(aggregator.evaluate()).toMatchObject({ ready: true, total: 30, stalled: 0 });
    });

    test('a worker falls back to its own snapshot when the primary verdict is stale', () => {
        const clock = fakeClock();
        const { config, cluster } = setUpPod(clock);
        const healthy = startWorker({ cluster, id: 1, config, clock });
        const stalled = startWorker({ cluster, id: 2, config, clock });
        runRequests(healthy.tracker, clock, { count: 40, durationMs: 50 });
        for (let i = 0; i < 25; i++) {
            stalled.tracker.startRequest();
        }
        clock.advance(31_000);
        healthy.provider.report();
        expect(stalled.provider.getVerdict().ready).toBe(true); // pod verdict from healthy-only report

        clock.advance(config.staleAfterMs + 1);

        expect(stalled.provider.getVerdict()).toMatchObject({ ready: false, total: 25, stalled: 25 });
    });

    test.each([
        ['a message of another type', { type: 'something-else', snapshot: { total: 1, stalled: 1 } }],
        ['a malformed snapshot', { type: STALL_MESSAGE_TYPE.REPORT, snapshot: { total: 1, stalled: 9 } }],
        ['a non-object message', 'hello']
    ])('the primary ignores %s', (_label, message) => {
        const clock = fakeClock();
        const { cluster, aggregator } = setUpPod(clock);
        const { worker } = cluster.addWorker(7);

        cluster.emit('message', worker, message);

        expect(aggregator.reports.size).toBe(0);
    });
});

describe('ClusterWorkerStallVerdictProvider timer', () => {
    beforeEach(() => jestObj.useFakeTimers());
    afterEach(() => jestObj.useRealTimers());

    test('start() reports on the configured interval and stop() ends it', () => {
        const ipc = new EventEmitter();
        ipc.connected = true;
        ipc.send = jestObj.fn();
        const provider = new ClusterWorkerStallVerdictProvider({
            tracker: new RequestStallTracker({ windowMs: 120_000, stallThresholdMs: 30_000 }),
            policy: new StallReadinessPolicy({ maxStalledRatio: 0.2, minSamples: 20 }),
            ipc,
            reportIntervalMs: 5_000,
            verdictStaleAfterMs: 15_000
        });

        provider.start();
        jestObj.advanceTimersByTime(10_000);
        provider.stop();
        jestObj.advanceTimersByTime(10_000);

        expect(ipc.send).toHaveBeenCalledTimes(2);
        expect(ipc.send.mock.calls[0][0]).toEqual({ type: STALL_MESSAGE_TYPE.REPORT, snapshot: { total: 0, stalled: 0 } });
        expect(ipc.listenerCount('message')).toBe(0);
    });

    test('does not send when the IPC channel is disconnected', () => {
        const ipc = new EventEmitter();
        ipc.connected = false;
        ipc.send = jestObj.fn();
        const provider = new ClusterWorkerStallVerdictProvider({
            tracker: new RequestStallTracker({ windowMs: 120_000, stallThresholdMs: 30_000 }),
            policy: new StallReadinessPolicy({ maxStalledRatio: 0.2, minSamples: 20 }),
            ipc,
            reportIntervalMs: 5_000,
            verdictStaleAfterMs: 15_000
        });

        provider.report();

        expect(ipc.send).not.toHaveBeenCalled();
    });
});

describe('factories: disabled by default', () => {
    test.each([
        ['single process', false],
        ['cluster worker', true]
    ])('with no env vars a %s is always ready and tracks nothing', (_label, isClusterWorker) => {
        const config = StallReadinessConfig.fromEnv({});
        const tracker = createRequestStallTracker(config);
        const provider = createStallVerdictProvider({ config, tracker, isClusterWorker, ipc: new EventEmitter() });
        for (let i = 0; i < 50; i++) {
            tracker.startRequest();
        }

        expect(provider).toBeInstanceOf(DisabledStallVerdictProvider);
        expect(tracker.getSnapshot()).toEqual(StallSnapshot.EMPTY);
        expect(provider.getVerdict()).toMatchObject({ ready: true, reason: VERDICT_REASON.DISABLED });
    });

    test.each([
        ['single process', false, LocalStallVerdictProvider],
        ['cluster worker', true, ClusterWorkerStallVerdictProvider]
    ])('when enabled a %s gets the matching provider', (_label, isClusterWorker, expectedClass) => {
        const config = StallReadinessConfig.fromEnv(ENABLED_ENV);
        const tracker = createRequestStallTracker(config);

        const provider = createStallVerdictProvider({ config, tracker, isClusterWorker, ipc: new EventEmitter() });

        expect(tracker).toBeInstanceOf(RequestStallTracker);
        expect(provider).toBeInstanceOf(expectedClass);
    });

    test('the primary does not listen to the cluster when disabled', () => {
        const cluster = fakeCluster();

        const coordinator = attachPrimaryStallAggregator({ cluster, config: StallReadinessConfig.fromEnv({}) });

        expect(coordinator).toBeNull();
        expect(cluster.listenerCount('message')).toBe(0);
    });

    test('the primary listens to the cluster when enabled', () => {
        const cluster = fakeCluster();

        const coordinator = attachPrimaryStallAggregator({ cluster, config: StallReadinessConfig.fromEnv(ENABLED_ENV) });

        expect(coordinator).toBeInstanceOf(PrimaryStallCoordinator);
        expect(cluster.listenerCount('message')).toBe(1);
        expect(cluster.listenerCount('exit')).toBe(1);
    });
});
