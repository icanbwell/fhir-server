'use strict';

const { EventEmitter } = require('events');
const net = require('net');
const { describe, test, expect, jest: jestObj, beforeEach } = require('@jest/globals');
const { ConnectionDispatcher } = require('../../../../utils/cluster/connectionDispatcher');
const { WorkerLoadTable } = require('../../../../utils/cluster/workerLoadTable');
const {
    CLUSTER_MESSAGE_TYPES,
    CLUSTER_CONNECTION_DROP_REASON
} = require('../../../../utils/cluster/clusterDispatchConstants');

/**
 * Stands in for cluster.Worker: the IPC channel to a worker process is the external boundary.
 */
class FakeWorker {
    constructor(id) {
        this.id = id;
        this.connected = true;
        this.sent = [];
        this.sendError = null;
    }

    isConnected() {
        return this.connected;
    }

    send(message, handle, callback) {
        this.sent.push({ message, handle });
        callback(this.sendError);
    }
}

const fakeSocket = () => {
    const socket = new EventEmitter();
    socket.destroy = jestObj.fn();
    return socket;
};

const loadReport = (inFlight) => ({
    type: CLUSTER_MESSAGE_TYPES.LOAD_REPORT,
    inFlight,
    connectionsReceived: 0
});

describe('ConnectionDispatcher', () => {
    let cluster;
    let log;
    let metrics;
    let now;
    let dispatcher;

    const fork = (id) => {
        const worker = new FakeWorker(id);
        cluster.workers[id] = worker;
        cluster.emit('fork', worker);
        return worker;
    };

    beforeEach(() => {
        cluster = new EventEmitter();
        cluster.workers = {};
        log = jestObj.fn();
        metrics = { connectionDispatched: jestObj.fn(), connectionDropped: jestObj.fn() };
        now = 0;
        dispatcher = new ConnectionDispatcher({
            cluster,
            net,
            loadTable: new WorkerLoadTable({
                reportIntervalMs: 25,
                blockedMsPerRequest: 10,
                now: () => now
            }),
            port: 0,
            log,
            metrics,
            random: () => 0,
            now: () => now
        });
        dispatcher.trackWorkers();
    });

    test('sends the socket to the worker with the fewest in-flight requests', () => {
        const busy = fork(1);
        const idle = fork(2);
        cluster.emit('message', busy, loadReport(4));
        cluster.emit('message', idle, loadReport(1));
        const socket = fakeSocket();

        dispatcher.dispatch(socket);

        expect(busy.sent).toHaveLength(0);
        expect(idle.sent).toEqual([
            { message: { type: CLUSTER_MESSAGE_TYPES.CONNECTION }, handle: socket }
        ]);
        expect(socket.destroy).not.toHaveBeenCalled();
    });

    test('stops sending to a worker once it reports draining', () => {
        const draining = fork(1);
        const other = fork(2);
        cluster.emit('message', draining, loadReport(0));
        cluster.emit('message', other, loadReport(9));
        cluster.emit('message', draining, { type: CLUSTER_MESSAGE_TYPES.DRAINING });

        dispatcher.dispatch(fakeSocket());

        expect(draining.sent).toHaveLength(0);
        expect(other.sent).toHaveLength(1);
    });

    test('skips a worker whose IPC channel is closed and tries the next one', () => {
        const disconnected = fork(1);
        const healthy = fork(2);
        cluster.emit('message', disconnected, loadReport(0));
        cluster.emit('message', healthy, loadReport(3));
        disconnected.connected = false;

        dispatcher.dispatch(fakeSocket());

        expect(disconnected.sent).toHaveLength(0);
        expect(healthy.sent).toHaveLength(1);
    });

    test.each([
        ['no worker has reported yet', () => fork(1)],
        [
            'every worker exited',
            () => {
                const worker = fork(1);
                cluster.emit('message', worker, loadReport(0));
                cluster.emit('exit', worker);
            }
        ]
    ])('closes the connection when %s', (_name, arrange) => {
        arrange();
        const socket = fakeSocket();

        dispatcher.dispatch(socket);

        expect(socket.destroy).toHaveBeenCalledTimes(1);
        expect(metrics.connectionDropped).toHaveBeenCalledWith(CLUSTER_CONNECTION_DROP_REASON.NO_WORKER);
    });

    test('closes the socket when the hand-off to the worker fails', () => {
        const worker = fork(1);
        cluster.emit('message', worker, loadReport(0));
        worker.sendError = Object.assign(new Error('channel closed'), { code: 'EPIPE' });
        const socket = fakeSocket();

        dispatcher.dispatch(socket);

        expect(socket.destroy).toHaveBeenCalledTimes(1);
        expect(metrics.connectionDropped).toHaveBeenCalledWith(CLUSTER_CONNECTION_DROP_REASON.SEND_FAILED);
        expect(log).toHaveBeenCalledWith('Failed to hand a connection to a worker; closed it', {
            workerId: 1,
            error: 'channel closed',
            code: 'EPIPE',
            occurrences: 1
        });
    });

    test('logs dropped connections at most once per interval, with the count', () => {
        for (let i = 0; i < 3; i++) {
            dispatcher.dispatch(fakeSocket());
        }
        now = 5000;
        dispatcher.dispatch(fakeSocket());

        expect(log.mock.calls).toEqual([
            [
                'No worker available; closed incoming connections',
                { workers: 0, occurrences: 1 }
            ],
            [
                'No worker available; closed incoming connections',
                { workers: 0, occurrences: 3 }
            ]
        ]);
    });

    test('ignores worker messages that are not its own', () => {
        const worker = fork(1);

        cluster.emit('message', worker, 'plain string');
        // a valid report shape under another type must not make the worker ready
        cluster.emit('message', worker, { type: 'someone-else', inFlight: 0, connectionsReceived: 0 });

        const socket = fakeSocket();
        dispatcher.dispatch(socket);
        expect(socket.destroy).toHaveBeenCalled();
    });

    test('does not charge a worker for a connection whose hand-off failed', () => {
        const failing = fork(1);
        const other = fork(2);
        cluster.emit('message', failing, loadReport(0));
        cluster.emit('message', other, loadReport(1));
        failing.sendError = new Error('EPIPE');
        dispatcher.dispatch(fakeSocket());
        failing.sendError = null;

        dispatcher.dispatch(fakeSocket());

        // without the rollback, worker 1 would score 1 (tied with worker 2) instead of 0
        expect(failing.sent).toHaveLength(2);
        expect(other.sent).toHaveLength(0);
    });

    test('logs a rejected load report, because that worker would otherwise never get traffic', () => {
        const worker = fork(1);

        cluster.emit('message', worker, { type: CLUSTER_MESSAGE_TYPES.LOAD_REPORT, inFlight: -1 });

        expect(log).toHaveBeenCalledWith('Ignored an invalid worker load report', {
            workerId: 1,
            occurrences: 1
        });
    });

    test.each([
        ['a client reset is expected and not logged', 'ECONNRESET', 0],
        ['any other socket error is logged', 'ENOTCONN', 1]
    ])('error on the primary copy of a socket: %s', (_name, code, expectedLogs) => {
        const worker = fork(1);
        cluster.emit('message', worker, loadReport(0));
        const socket = fakeSocket();
        dispatcher.dispatch(socket);

        expect(() => socket.emit('error', Object.assign(new Error(code), { code }))).not.toThrow();
        expect(log).toHaveBeenCalledTimes(expectedLogs);
    });

    test('at shutdown, closes the listener only after the last worker exits', async () => {
        await dispatcher.listenAsync();
        const first = fork(1);
        const second = fork(2);

        dispatcher.closeAfterLastWorkerExits();
        cluster.emit('exit', first);
        expect(dispatcher.server).not.toBeNull();
        cluster.emit('exit', second);

        expect(dispatcher.server).toBeNull();
    });

    test('at shutdown with no worker left, closes the listener at once', async () => {
        await dispatcher.listenAsync();

        dispatcher.closeAfterLastWorkerExits();

        expect(dispatcher.server).toBeNull();
    });

    test('listenAsync rejects when the port is already in use', async () => {
        const occupier = net.createServer();
        await new Promise((resolve) => occupier.listen(0, resolve));
        try {
            const busy = new ConnectionDispatcher({
                cluster,
                net,
                loadTable: new WorkerLoadTable({ reportIntervalMs: 25, blockedMsPerRequest: 10 }),
                port: occupier.address().port,
                log,
                metrics
            });

            await expect(busy.listenAsync()).rejects.toMatchObject({ code: 'EADDRINUSE' });
            // the listener never started, so closing it fails; that is logged, not thrown
            await busy.closeAsync();

            expect(log).toHaveBeenCalledWith(
                'Connection dispatcher failed to close its listener',
                expect.objectContaining({ code: 'ERR_SERVER_NOT_RUNNING' })
            );
        } finally {
            await new Promise((resolve) => occupier.close(resolve));
        }
    });

    test('keeps a client reset on the primary copy of the socket from throwing', () => {
        const worker = fork(1);
        cluster.emit('message', worker, loadReport(0));
        const socket = fakeSocket();
        dispatcher.dispatch(socket);

        expect(() => socket.emit('error', new Error('ECONNRESET'))).not.toThrow();
    });
});
