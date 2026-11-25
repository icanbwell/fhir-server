'use strict';

const { EventEmitter } = require('events');
const { describe, test, expect, jest: jestObj, beforeEach } = require('@jest/globals');
const { WorkerLoadReporter } = require('../../../../utils/cluster/workerLoadReporter');
const { CLUSTER_MESSAGE_TYPES } = require('../../../../utils/cluster/clusterDispatchConstants');

describe('WorkerLoadReporter', () => {
    let channel;
    let sent;
    let server;
    let tick;
    let reporter;
    let logError;

    const lastReport = () => sent.filter((m) => m.type === CLUSTER_MESSAGE_TYPES.LOAD_REPORT).at(-1);

    beforeEach(() => {
        channel = new EventEmitter();
        sent = [];
        server = new EventEmitter();
        tick = null;
        logError = jestObj.fn();
        reporter = new WorkerLoadReporter({
            channel,
            send: (message) => sent.push(message),
            intervalMs: 25,
            logError,
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

    test.each([
        ['a closed IPC channel is expected at exit and not logged', 'ERR_IPC_CHANNEL_CLOSED', 0],
        ['any other send error is logged', 'ERR_SOMETHING_ELSE', 2]
    ])('%s', (_name, code, expectedLogs) => {
        const failingLog = jestObj.fn();
        const failing = new WorkerLoadReporter({
            channel: new EventEmitter(),
            send: () => {
                throw Object.assign(new Error('send failed'), { code });
            },
            intervalMs: 25,
            logError: failingLog,
            setIntervalFn: () => ({ unref: () => {} })
        });

        expect(() => failing.attach(new EventEmitter())).not.toThrow();
        expect(() => failing.markDraining()).not.toThrow();
        expect(failingLog).toHaveBeenCalledTimes(expectedLogs);
    });
});
