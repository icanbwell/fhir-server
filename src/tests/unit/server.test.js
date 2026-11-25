'use strict';

/**
 * Tests for createServer's two listening modes: the service port (default), and taking
 * connections from the cluster primary (CLUSTER_SCHEDULING=least_busy).
 *
 * The Express app, the MongoDB/Kafka-backed container and Terminus' process signal handlers are
 * external to what is tested here and are replaced; the HTTP server and its sockets are real.
 */

const http = require('http');
const net = require('net');
const { EventEmitter } = require('events');
const { CLUSTER_MESSAGE_TYPES } = require('../../utils/cluster/clusterDispatchConstants');
const { describe, test, expect, beforeEach, afterEach, jest: jestGlobal } = require('@jest/globals');

describe('createServer', () => {
    let order;
    let createTerminusMock;
    let server;
    let logErrorSpy;

    const fakeContainer = () => ({
        mongoDatabaseManager: { connectAsync: jestGlobal.fn(() => Promise.resolve()) },
        kafkaClickPipeBulkWriteExecutor: {}
    });

    const loadCreateServer = () => {
        jestGlobal.doMock('../../app', () => ({
            createApp: () => (req, res) => res.end(`ok ${req.url}`)
        }));
        jestGlobal.doMock('@godaddy/terminus', () => ({
            createTerminus: createTerminusMock,
            HealthCheckError: class HealthCheckError extends Error {}
        }));
        jestGlobal.doMock('../../operations/common/systemEventLogging', () => ({
            logSystemEventAsync: jestGlobal.fn(() => Promise.resolve())
        }));
        // registers process-wide uncaughtException handlers, not part of this test
        jestGlobal.doMock('../../middleware/errorHandler', () => ({}));
        // the log sink is the boundary; the real helpers run, logError is observed
        jestGlobal.doMock('../../operations/common/logging', () => ({
            ...jestGlobal.requireActual('../../operations/common/logging'),
            logError: logErrorSpy
        }));
        let createServer;
        jestGlobal.isolateModules(() => {
            ({ createServer } = require('../../server'));
        });
        return createServer;
    };

    const waitForListening = (srv) =>
        srv.listening ? Promise.resolve() : new Promise((resolve) => srv.once('listening', resolve));

    const get = (port, path) =>
        new Promise((resolve, reject) => {
            http.get({ host: '127.0.0.1', port, path, agent: false }, (res) => {
                let body = '';
                res.on('data', (chunk) => (body += chunk));
                res.on('end', () => resolve(body));
            }).on('error', reject);
        });

    beforeEach(() => {
        order = [];
        createTerminusMock = jestGlobal.fn(() => order.push('createTerminus'));
        logErrorSpy = jestGlobal.fn();
    });

    afterEach(async () => {
        if (server && server.listening) {
            await new Promise((resolve) => server.close(resolve));
        }
        server = null;
        jestGlobal.resetModules();
    });

    test('without a load reporter it listens on the PORT from config, not on loopback only', async () => {
        const originalPort = process.env.PORT;
        // config.js reads the port from the environment when it is loaded; 0 picks a free port
        process.env.PORT = '0';
        try {
            const createServer = loadCreateServer();
            server = await createServer(fakeContainer);
            await waitForListening(server);

            // all interfaces, not the loopback-only private port used in least_busy mode
            expect(server.address().address).not.toBe('127.0.0.1');
            expect(await get(server.address().port, '/direct')).toBe('ok /direct');
        } finally {
            if (originalPort === undefined) {
                delete process.env.PORT;
            } else {
                process.env.PORT = originalPort;
            }
        }
    });

    test('with a load reporter it listens only on a private loopback port and attaches the reporter after Terminus', async () => {
        const createServer = loadCreateServer();
        const workerLoadReporter = {
            attach: jestGlobal.fn(() => order.push('attach')),
            markDraining: jestGlobal.fn()
        };

        server = await createServer(fakeContainer, { workerLoadReporter });
        await waitForListening(server);

        expect(server.address().address).toBe('127.0.0.1');
        expect(order).toEqual(['createTerminus', 'attach']);
        expect(workerLoadReporter.attach).toHaveBeenCalledWith(server);
    });

    test('serves a socket handed to it the way the cluster primary hands one over', async () => {
        const createServer = loadCreateServer();
        server = await createServer(fakeContainer, {
            workerLoadReporter: { attach: () => {}, markDraining: () => {} }
        });
        await waitForListening(server);

        // Stand-in for the primary: accept paused, then pass the socket to the worker's server.
        const primary = net.createServer({ pauseOnConnect: true }, (socket) => {
            server.emit('connection', socket);
            socket.resume();
        });
        await new Promise((resolve) => primary.listen(0, '127.0.0.1', resolve));
        try {
            expect(await get(primary.address().port, '/handed-over')).toBe('ok /handed-over');
        } finally {
            await new Promise((resolve) => primary.close(resolve));
        }
    });

    /**
     * A container whose flush and disconnect steps record that they ran
     * @param {string[]} steps
     */
    const shutdownContainer = (steps) => {
        const step = (name) => jestGlobal.fn(() => {
            steps.push(name);
            return Promise.resolve();
        });
        return {
            ...fakeContainer(),
            postRequestProcessor: { waitTillAllRequestsDoneAsync: step('flush') },
            postSaveProcessor: { flushAsync: step('flush') },
            auditLogger: { flushAsync: step('flush') },
            accessLogger: { flushAsync: step('flush') },
            kafkaClient: { disconnect: step('kafka') },
            kafkaClientV2: { disconnect: step('kafka') }
        };
    };

    /**
     * A real WorkerLoadReporter; the IPC channel to the primary is the boundary that is faked.
     * @param {Object} [timers] setTimeoutFn/clearTimeoutFn overrides
     */
    const realReporter = (timers = {}) => {
        const { WorkerLoadReporter } = require('../../utils/cluster/workerLoadReporter');
        const channel = new EventEmitter();
        const reporter = new WorkerLoadReporter({
            channel,
            send: () => {},
            intervalMs: 25,
            setIntervalFn: () => ({ unref: () => {} }),
            ...timers
        });
        return { reporter, channel };
    };

    /**
     * Opens a real TCP connection and hands its server side to the worker the way the primary
     * does: a CONNECTION message on the IPC channel carrying the paused socket.
     */
    const handOverConnectionAsync = async (channel) => {
        const primary = net.createServer({ pauseOnConnect: true }, (socket) =>
            channel.emit('message', { type: CLUSTER_MESSAGE_TYPES.CONNECTION }, socket)
        );
        await new Promise((resolve) => primary.listen(0, '127.0.0.1', resolve));
        const received = new Promise((resolve) => primary.once('connection', resolve));
        const client = net.connect(primary.address().port, '127.0.0.1');
        await received;
        return { client, primary };
    };

    test('at shutdown, does not flush until connections from the primary have closed', async () => {
        const createServer = loadCreateServer();
        const steps = [];
        const { reporter, channel } = realReporter();
        server = await createServer(() => shutdownContainer(steps), { workerLoadReporter: reporter });
        await waitForListening(server);
        const { client, primary } = await handOverConnectionAsync(channel);
        const { onSignal } = createTerminusMock.mock.calls[0][1];
        try {
            expect(reporter.openConnectionCount()).toBe(1);
            const shutdown = onSignal();
            // let any already-settled step run; nothing may run while the connection is open
            await new Promise((resolve) => setImmediate(resolve));
            expect(steps).toEqual([]);

            client.end();
            await shutdown;

            expect(steps).toContain('flush');
            expect(steps).toContain('kafka');
        } finally {
            client.destroy();
            await new Promise((resolve) => primary.close(resolve));
        }
    });

    test('at shutdown, flushes anyway once the wait for connections from the primary times out', async () => {
        const createServer = loadCreateServer();
        const steps = [];
        const { reporter, channel } = realReporter({
            setTimeoutFn: (fn) => setImmediate(fn),
            clearTimeoutFn: (handle) => clearImmediate(handle)
        });
        server = await createServer(() => shutdownContainer(steps), { workerLoadReporter: reporter });
        await waitForListening(server);
        const { client, primary } = await handOverConnectionAsync(channel);
        const { onSignal } = createTerminusMock.mock.calls[0][1];
        try {
            await onSignal();

            expect(steps).toContain('flush');
            expect(logErrorSpy).toHaveBeenCalledWith(
                'Connections from the cluster primary were still open at shutdown',
                { openConnections: 1, timeoutMs: expect.any(Number) }
            );
        } finally {
            client.destroy();
            await new Promise((resolve) => primary.close(resolve));
        }
    });

    test('marks the worker draining when the shutdown delay ends, not before', async () => {
        jestGlobal.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
        try {
            const createServer = loadCreateServer();
            const workerLoadReporter = { attach: () => {}, markDraining: jestGlobal.fn() };
            server = await createServer(fakeContainer, { workerLoadReporter });
            const { beforeShutdown } = createTerminusMock.mock.calls[0][1];

            const shutdown = beforeShutdown();
            jestGlobal.advanceTimersByTime(15000);
            expect(workerLoadReporter.markDraining).not.toHaveBeenCalled();
            jestGlobal.advanceTimersByTime(200);
            await shutdown;

            expect(workerLoadReporter.markDraining).toHaveBeenCalledTimes(1);
        } finally {
            jestGlobal.useRealTimers();
        }
    });
});
