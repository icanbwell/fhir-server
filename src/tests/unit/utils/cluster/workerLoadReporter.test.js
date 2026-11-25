'use strict';

const { EventEmitter } = require('events');
const { describe, test, expect, jest: jestObj, beforeEach } = require('@jest/globals');
const {
    WorkerLoadReporter,
    createIpcSender
} = require('../../../../utils/cluster/workerLoadReporter');
const { CLUSTER_MESSAGE_TYPES } = require('../../../../utils/cluster/clusterDispatchConstants');

describe('WorkerLoadReporter', () => {
    let channel;
    let sent;
    let server;
    let tick;
    let reporter;

    const lastReport = () => sent.filter((m) => m.type === CLUSTER_MESSAGE_TYPES.LOAD_REPORT).at(-1);

    beforeEach(() => {
        channel = new EventEmitter();
        sent = [];
        server = new EventEmitter();
        tick = null;
        reporter = new WorkerLoadReporter({
            channel,
            send: (message) => sent.push(message),
            intervalMs: 25,
            setIntervalFn: (fn) => {
                tick = fn;
                return { unref: () => {} };
            }
        });
        reporter.attach(server);
    });

    test('reports immediately on attach so the primary can start sending connections', () => {
        expect(sent).toEqual([
            { type: CLUSTER_MESSAGE_TYPES.LOAD_REPORT, inFlight: 0, connectionsReceived: 0 }
        ]);
    });

    test('counts a request as in flight until its response closes', () => {
        const res = new EventEmitter();
        server.emit('request', {}, res);
        tick();
        expect(lastReport().inFlight).toBe(1);

        res.emit('close');
        tick();
        expect(lastReport().inFlight).toBe(0);
    });

    test('counts the request before the request handler runs', () => {
        let inFlightSeenByHandler;
        server.on('request', () => {
            inFlightSeenByHandler = reporter.inFlight;
        });

        server.emit('request', {}, new EventEmitter());

        expect(inFlightSeenByHandler).toBe(1);
    });

    test('takes a socket from the primary into the HTTP server and resumes it', () => {
        const socket = Object.assign(new EventEmitter(), { resume: jestObj.fn() });
        const connections = [];
        server.on('connection', (s) => connections.push(s));

        channel.emit('message', { type: CLUSTER_MESSAGE_TYPES.CONNECTION }, socket);
        tick();

        expect(connections).toEqual([socket]);
        expect(socket.resume).toHaveBeenCalled();
        expect(lastReport().connectionsReceived).toBe(1);
    });

    test('counts a received connection as in flight until its first request starts and ends', () => {
        const socket = Object.assign(new EventEmitter(), { resume: jestObj.fn() });
        channel.emit('message', { type: CLUSTER_MESSAGE_TYPES.CONNECTION }, socket);
        tick();
        expect(lastReport().inFlight).toBe(1);

        const res = new EventEmitter();
        server.emit('request', { socket }, res);
        tick();
        expect(lastReport().inFlight).toBe(1);

        res.emit('close');
        tick();
        expect(lastReport().inFlight).toBe(0);
    });

    test('stops counting a received connection that closes without a request', () => {
        const socket = Object.assign(new EventEmitter(), { resume: jestObj.fn() });
        channel.emit('message', { type: CLUSTER_MESSAGE_TYPES.CONNECTION }, socket);

        socket.emit('close');
        tick();

        expect(lastReport().inFlight).toBe(0);
    });

    test.each([
        ['another message type', { type: 'other' }, { resume: jestObj.fn() }],
        ['a connection message without a socket', { type: CLUSTER_MESSAGE_TYPES.CONNECTION }, undefined],
        ['a non-object message', 'hello', undefined]
    ])('ignores %s', (_name, message, socket) => {
        const connections = [];
        server.on('connection', (s) => connections.push(s));

        channel.emit('message', message, socket);

        expect(connections).toHaveLength(0);
    });

    describe('waitForConnectionsToCloseAsync', () => {
        const receive = () => {
            const socket = Object.assign(new EventEmitter(), { resume: jestObj.fn() });
            channel.emit('message', { type: CLUSTER_MESSAGE_TYPES.CONNECTION }, socket);
            return socket;
        };

        /**
         * A reporter with one open connection from the primary, whose shutdown-wait timers are
         * recorded in `timers` (id -> callback) and removed when cleared
         */
        const timedReporterWithOpenConnection = () => {
            const timers = new Map();
            let nextTimer = 0;
            const timedReporter = new WorkerLoadReporter({
                channel: new EventEmitter(),
                send: () => {},
                intervalMs: 25,
                setIntervalFn: () => ({ unref: () => {} }),
                setTimeoutFn: (fn) => {
                    nextTimer += 1;
                    timers.set(nextTimer, fn);
                    return nextTimer;
                },
                clearTimeoutFn: (id) => timers.delete(id)
            });
            timedReporter.attach(new EventEmitter());
            const socket = Object.assign(new EventEmitter(), { resume: jestObj.fn() });
            timedReporter.channel.emit('message', { type: CLUSTER_MESSAGE_TYPES.CONNECTION }, socket);
            return { timedReporter, timers, socket };
        };

        test('resolves at once when no connection from the primary is open', async () => {
            await expect(reporter.waitForConnectionsToCloseAsync({ timeoutMs: 1000 })).resolves.toBe(true);
        });

        test('resolves once the last open connection closes', async () => {
            const first = receive();
            const second = receive();
            let settled = false;
            const waiting = reporter
                .waitForConnectionsToCloseAsync({ timeoutMs: 60000 })
                .then((allClosed) => {
                    settled = true;
                    return allClosed;
                });

            first.emit('close');
            await Promise.resolve();
            expect(settled).toBe(false);
            second.emit('close');

            await expect(waiting).resolves.toBe(true);
        });

        test('resolves every concurrent waiter once the last connection closes, and clears their timers', async () => {
            const { timedReporter, timers, socket } = timedReporterWithOpenConnection();
            const first = timedReporter.waitForConnectionsToCloseAsync({ timeoutMs: 60000 });
            const second = timedReporter.waitForConnectionsToCloseAsync({ timeoutMs: 3000 });

            socket.emit('close');

            await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
            expect(timers.size).toBe(0);
            expect(timedReporter.openConnectionCount()).toBe(0);
        });

        test('times out one waiter without affecting another that is still waiting', async () => {
            const { timedReporter, timers, socket } = timedReporterWithOpenConnection();
            const short = timedReporter.waitForConnectionsToCloseAsync({ timeoutMs: 1000 });
            const long = timedReporter.waitForConnectionsToCloseAsync({ timeoutMs: 60000 });

            timers.get(1)();
            await expect(short).resolves.toBe(false);
            socket.emit('close');

            await expect(long).resolves.toBe(true);
            expect(timedReporter.closeWaiters.size).toBe(0);
            expect(timers.size).toBe(1); // only the fired one, which needs no clearing
        });

        test('gives up after the timeout while a connection is still open', async () => {
            let expire;
            const timed = new WorkerLoadReporter({
                channel: new EventEmitter(),
                send: () => {},
                intervalMs: 25,
                setIntervalFn: () => ({ unref: () => {} }),
                setTimeoutFn: (fn) => {
                    expire = fn;
                    return 1;
                },
                clearTimeoutFn: () => {}
            });
            timed.attach(new EventEmitter());
            timed.channel.emit(
                'message',
                { type: CLUSTER_MESSAGE_TYPES.CONNECTION },
                Object.assign(new EventEmitter(), { resume: jestObj.fn() })
            );

            const waiting = timed.waitForConnectionsToCloseAsync({ timeoutMs: 5000 });
            expire();

            await expect(waiting).resolves.toBe(false);
        });
    });

    test('sends draining once, however often it is called', () => {
        reporter.markDraining();
        reporter.markDraining();

        expect(sent.filter((m) => m.type === CLUSTER_MESSAGE_TYPES.DRAINING)).toHaveLength(1);
    });
});

describe('createIpcSender', () => {
    /**
     * Stands in for the worker's process: the IPC channel is the external boundary. Node reports
     * a failed send to the callback, never by throwing.
     */
    const fakeChannel = ({ connected = true, error = null } = {}) => ({
        connected,
        send: jestObj.fn((message, callback) => callback(error))
    });

    test.each([
        ['a successful send', null, 0],
        ['a closed channel, expected while the worker exits', { code: 'ERR_IPC_CHANNEL_CLOSED' }, 0],
        ['any other error, which would stop the load reports', { code: 'EPIPE', message: 'broken pipe' }, 1]
    ])('logs %s only when needed', (_name, error, expectedLogs) => {
        const channel = fakeChannel({ error });
        const logError = jestObj.fn();

        createIpcSender({ channel, logError })({ type: CLUSTER_MESSAGE_TYPES.LOAD_REPORT });

        expect(channel.send).toHaveBeenCalledTimes(1);
        expect(logError).toHaveBeenCalledTimes(expectedLogs);
        if (expectedLogs) {
            expect(logError).toHaveBeenCalledWith('Failed to send a message to the cluster primary', {
                messageType: CLUSTER_MESSAGE_TYPES.LOAD_REPORT,
                error: 'broken pipe',
                code: 'EPIPE'
            });
        }
    });

    test('sends nothing once the channel is disconnected', () => {
        const channel = fakeChannel({ connected: false });

        createIpcSender({ channel, logError: jestObj.fn() })({ type: CLUSTER_MESSAGE_TYPES.DRAINING });

        expect(channel.send).not.toHaveBeenCalled();
    });
});
