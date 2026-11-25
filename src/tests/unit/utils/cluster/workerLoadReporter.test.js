'use strict';

const { EventEmitter } = require('events');
const { describe, test, expect, jest: jestObj, beforeEach } = require('@jest/globals');
const { WorkerLoadReporter } = require('../../../../utils/cluster/workerLoadReporter');
const { CLUSTER_MESSAGE_TYPES } = require('../../../../utils/cluster/clusterMessageTypes');

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
            },
            clearIntervalFn: () => {
                tick = null;
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
        const socket = { resume: jestObj.fn() };
        const connections = [];
        server.on('connection', (s) => connections.push(s));

        channel.emit('message', { type: CLUSTER_MESSAGE_TYPES.CONNECTION }, socket);
        tick();

        expect(connections).toEqual([socket]);
        expect(socket.resume).toHaveBeenCalled();
        expect(lastReport().connectionsReceived).toBe(1);
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

    test('sends draining once, however often it is called', () => {
        reporter.markDraining();
        reporter.markDraining();

        expect(sent.filter((m) => m.type === CLUSTER_MESSAGE_TYPES.DRAINING)).toHaveLength(1);
    });

    test('keeps working when the IPC channel is closed', () => {
        const closed = new WorkerLoadReporter({
            channel: new EventEmitter(),
            send: () => {
                throw new Error('channel closed');
            },
            intervalMs: 25,
            setIntervalFn: () => ({ unref: () => {} }),
            clearIntervalFn: () => {}
        });

        expect(() => closed.attach(new EventEmitter())).not.toThrow();
        expect(() => closed.markDraining()).not.toThrow();
    });

    test('stop() ends reporting and stops taking sockets', () => {
        reporter.stop();
        const socket = { resume: jestObj.fn() };

        channel.emit('message', { type: CLUSTER_MESSAGE_TYPES.CONNECTION }, socket);

        expect(tick).toBeNull();
        expect(socket.resume).not.toHaveBeenCalled();
    });
});
