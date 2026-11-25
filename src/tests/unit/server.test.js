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
const { describe, test, expect, beforeEach, afterEach, jest: jestGlobal } = require('@jest/globals');

describe('createServer', () => {
    let order;
    let createTerminusMock;
    let server;

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
    });

    afterEach(async () => {
        if (server && server.listening) {
            await new Promise((resolve) => server.close(resolve));
        }
        server = null;
        jestGlobal.resetModules();
    });

    test('without a load reporter it listens on the service port', async () => {
        const port = await new Promise((resolve) => {
            const probe = net.createServer().listen(0, '127.0.0.1', () => {
                const { port: freePort } = probe.address();
                probe.close(() => resolve(freePort));
            });
        });
        const originalPort = process.env.PORT;
        // config.js reads the port from the environment when it is loaded
        process.env.PORT = String(port);
        try {
            const createServer = loadCreateServer();
            server = await createServer(fakeContainer);
            await waitForListening(server);

            expect(server.address().port).toBe(port);
            expect(await get(port, '/direct')).toBe('ok /direct');
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
