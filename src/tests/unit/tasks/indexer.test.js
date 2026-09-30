'use strict';

/**
 * Coverage for src/tasks/indexer.js — the background index task that is meant to run in a
 * forked child process and drive IndexManager from IPC messages.
 *
 * The module registers its handlers on `process` at require time, so the tests capture those
 * real listeners and invoke them directly. IndexManager and the logging helpers are the only
 * things mocked: they are the external boundary (Mongo and Winston).
 *
 * `process.send` / `process.disconnect` are stubbed for the duration of the suite — jest
 * workers are themselves IPC children, so calling the real `process.disconnect()` would tear
 * down the worker.
 */

const {
    describe, test, expect, beforeEach, afterEach, beforeAll, afterAll, jest: jestObj
} = require('@jest/globals');

const mockIndexAllCollectionsAsync = jestObj.fn();
const mockDeleteIndexesInAllCollectionsAsync = jestObj.fn();
const mockIndexManagerConstructor = jestObj.fn();
const mockLogInfo = jestObj.fn();
const mockLogError = jestObj.fn();

jestObj.mock('../../../indexes/indexManager', () => ({
    IndexManager: function IndexManager () {
        mockIndexManagerConstructor();
        this.indexAllCollectionsAsync = mockIndexAllCollectionsAsync;
        this.deleteIndexesInAllCollectionsAsync = mockDeleteIndexesInAllCollectionsAsync;
    }
}));

jestObj.mock('../../../operations/common/logging', () => ({
    logInfo: (...args) => mockLogInfo(...args),
    logError: (...args) => mockLogError(...args)
}));

let messageHandler;
let uncaughtExceptionHandler;
let originalSend;
let originalDisconnect;
let sendSpy;
let disconnectSpy;

beforeAll(() => {
    const messageListenersBefore = process.listeners('message').length;
    const uncaughtListenersBefore = process.listeners('uncaughtException').length;

    require('../../../tasks/indexer');

    const messageListeners = process.listeners('message');
    const uncaughtListeners = process.listeners('uncaughtException');
    expect(messageListeners.length).toBe(messageListenersBefore + 1);
    expect(uncaughtListeners.length).toBe(uncaughtListenersBefore + 1);

    messageHandler = messageListeners[messageListeners.length - 1];
    uncaughtExceptionHandler = uncaughtListeners[uncaughtListeners.length - 1];

    // Detach immediately so the real jest process is not affected by these handlers.
    process.removeListener('message', messageHandler);
    process.removeListener('uncaughtException', uncaughtExceptionHandler);
});

afterAll(() => {
    process.send = originalSend;
    process.disconnect = originalDisconnect;
});

beforeEach(() => {
    jestObj.clearAllMocks();
    mockIndexAllCollectionsAsync.mockResolvedValue({ Patient_4_0_0: 3 });
    mockDeleteIndexesInAllCollectionsAsync.mockResolvedValue(undefined);

    originalSend = process.send;
    originalDisconnect = process.disconnect;
    sendSpy = jestObj.fn();
    disconnectSpy = jestObj.fn();
    process.send = sendSpy;
    process.disconnect = disconnectSpy;
});

afterEach(() => {
    process.send = originalSend;
    process.disconnect = originalDisconnect;
});

describe('indexer task — message handler registration', () => {
    test('registers exactly one message handler and one uncaughtException handler on require', () => {
        expect(typeof messageHandler).toBe('function');
        expect(typeof uncaughtExceptionHandler).toBe('function');
        // the message handler is async (returns a promise) so the caller can await it
        expect(messageHandler({ message: 'noop', tableName: 'x' })).toBeInstanceOf(Promise);
    });
});

describe('indexer task — "Start Index"', () => {
    test('acknowledges to the parent before doing any work', async () => {
        let sendCountAtIndexTime = -1;
        mockIndexAllCollectionsAsync.mockImplementation(async () => {
            sendCountAtIndexTime = sendSpy.mock.calls.length;
            return {};
        });

        await messageHandler({ message: 'Start Index', tableName: 'Patient_4_0_0' });

        expect(sendSpy).toHaveBeenCalledWith({ status: 'We have started processing your data.' });
        expect(sendCountAtIndexTime).toBe(1);
    });

    test('builds an IndexManager and indexes only the requested collection regex', async () => {
        await messageHandler({ message: 'Start Index', tableName: 'Observation_4_0_0' });

        expect(mockIndexManagerConstructor).toHaveBeenCalledTimes(1);
        expect(mockIndexAllCollectionsAsync).toHaveBeenCalledTimes(1);
        expect(mockIndexAllCollectionsAsync).toHaveBeenCalledWith({
            collectionRegex: 'Observation_4_0_0'
        });
        expect(mockDeleteIndexesInAllCollectionsAsync).not.toHaveBeenCalled();
    });

    test('logs the collection stats returned by the index run', async () => {
        mockIndexAllCollectionsAsync.mockResolvedValue({ Patient_4_0_0: { created: 2 } });

        await messageHandler({ message: 'Start Index', tableName: 'Patient_4_0_0' });

        expect(mockLogInfo).toHaveBeenCalledWith('Done Indexing in separate process', {
            source: 'indexerTask',
            collection_stats: { Patient_4_0_0: { created: 2 } }
        });
        expect(mockLogError).not.toHaveBeenCalled();
    });

    test('disconnects from the parent once indexing has completed', async () => {
        await messageHandler({ message: 'Start Index', tableName: 'Patient_4_0_0' });

        expect(disconnectSpy).toHaveBeenCalledTimes(1);
    });
});

describe('indexer task — "Rebuild Index"', () => {
    test('deletes existing indexes BEFORE rebuilding them, on the same collection regex', async () => {
        const callOrder = [];
        mockDeleteIndexesInAllCollectionsAsync.mockImplementation(async () => { callOrder.push('delete'); });
        mockIndexAllCollectionsAsync.mockImplementation(async () => { callOrder.push('index'); return {}; });

        await messageHandler({ message: 'Rebuild Index', tableName: 'Encounter_4_0_0' });

        expect(callOrder).toEqual(['delete', 'index']);
        expect(mockDeleteIndexesInAllCollectionsAsync).toHaveBeenCalledWith({
            collectionRegex: 'Encounter_4_0_0'
        });
        expect(mockIndexAllCollectionsAsync).toHaveBeenCalledWith({
            collectionRegex: 'Encounter_4_0_0'
        });
    });

    test('does not rebuild indexes when the delete step fails', async () => {
        mockDeleteIndexesInAllCollectionsAsync.mockRejectedValue(new Error('dropIndexes failed'));

        await messageHandler({ message: 'Rebuild Index', tableName: 'Encounter_4_0_0' });

        expect(mockIndexAllCollectionsAsync).not.toHaveBeenCalled();
        expect(mockLogError).toHaveBeenCalledWith(
            'ERROR Indexing in separate process',
            expect.objectContaining({ source: 'indexerTask' })
        );
        expect(disconnectSpy).toHaveBeenCalledTimes(1);
    });
});

describe('indexer task — unrecognised and malformed messages', () => {
    test('an unknown message value performs no index work but still acknowledges and disconnects', async () => {
        await messageHandler({ message: 'Start Indexing', tableName: 'Patient_4_0_0' });

        expect(mockIndexAllCollectionsAsync).not.toHaveBeenCalled();
        expect(mockDeleteIndexesInAllCollectionsAsync).not.toHaveBeenCalled();
        expect(sendSpy).toHaveBeenCalledWith({ status: 'We have started processing your data.' });
        expect(disconnectSpy).toHaveBeenCalledTimes(1);
        expect(mockLogError).not.toHaveBeenCalled();
    });

    test('message matching is case sensitive — "start index" is not "Start Index"', async () => {
        await messageHandler({ message: 'start index', tableName: 'Patient_4_0_0' });
        expect(mockIndexAllCollectionsAsync).not.toHaveBeenCalled();

        await messageHandler({ message: 'Start Index', tableName: 'Patient_4_0_0' });
        expect(mockIndexAllCollectionsAsync).toHaveBeenCalledTimes(1);
    });

    test('an absent tableName is forwarded as undefined (index everything) rather than crashing', async () => {
        await messageHandler({ message: 'Start Index' });

        expect(mockIndexAllCollectionsAsync).toHaveBeenCalledWith({ collectionRegex: undefined });
        expect(disconnectSpy).toHaveBeenCalledTimes(1);
    });

    test('a null params payload rejects before any index work is attempted', async () => {
        await expect(messageHandler(null)).rejects.toThrow(TypeError);

        expect(mockIndexAllCollectionsAsync).not.toHaveBeenCalled();
        expect(mockDeleteIndexesInAllCollectionsAsync).not.toHaveBeenCalled();
        expect(disconnectSpy).not.toHaveBeenCalled();
    });
});

describe('indexer task — failure handling', () => {
    test('an index failure is logged and swallowed — it never reports success to the parent', async () => {
        // The only IPC message this task ever sends is the optimistic "started" ack. A
        // failure must therefore never be accompanied by a success/completion message that
        // would let an operator believe the index build landed.
        const failure = new Error('Mongo connection reset');
        mockIndexAllCollectionsAsync.mockRejectedValue(failure);

        await expect(
            messageHandler({ message: 'Start Index', tableName: 'Patient_4_0_0' })
        ).resolves.toBeUndefined();

        expect(mockLogError).toHaveBeenCalledWith('ERROR Indexing in separate process', {
            source: 'indexerTask',
            error: failure
        });
        expect(sendSpy).toHaveBeenCalledTimes(1);
        expect(sendSpy).toHaveBeenCalledWith({ status: 'We have started processing your data.' });
        expect(mockLogInfo).not.toHaveBeenCalledWith(
            'Done Indexing in separate process',
            expect.anything()
        );
    });

    test('the child always disconnects after a failure so the parent is not left waiting', async () => {
        mockIndexAllCollectionsAsync.mockRejectedValue(new Error('boom'));

        await messageHandler({ message: 'Start Index', tableName: 'Patient_4_0_0' });

        expect(disconnectSpy).toHaveBeenCalledTimes(1);
    });

    test('the uncaughtException handler logs the message and stack without rethrowing', () => {
        const err = new Error('unhandled indexer failure');
        err.stack = 'Error: unhandled indexer failure\n    at indexer.js:1:1';

        expect(() => uncaughtExceptionHandler(err)).not.toThrow();

        expect(mockLogError).toHaveBeenCalledWith('unhandled indexer failure', {
            'error stack': 'Error: unhandled indexer failure\n    at indexer.js:1:1'
        });
        expect(mockLogInfo).toHaveBeenCalledWith('Gracefully finish the routine.');
    });
});
