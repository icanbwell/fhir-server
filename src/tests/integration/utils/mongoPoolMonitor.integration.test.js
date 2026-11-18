const { describe, test, expect, beforeAll, afterAll, afterEach, jest } = require('@jest/globals');
const { MongoClient } = require('mongodb');
const { getMongoUrlAsync } = require('../mongoTestRunner');
const {
    mongoPoolConnectionsInUseUpDownCounter,
    mongoPoolWaitQueueSizeUpDownCounter
} = require('../../../utils/metrics');
const { registerMongoPoolMonitoring } = require('../../../utils/mongoPoolMonitor');

const POOL = 'pool_monitor_integration';
const HOLD_MS = 700;

/**
 * Sums every add() an UpDownCounter received: the level a dashboard would show.
 * @param {import('@jest/globals').jest.SpyInstance} spy
 * @returns {number}
 */
const levelOf = (spy) => spy.mock.calls.reduce((sum, [delta]) => sum + delta, 0);

const waitUntilAsync = async (condition, timeoutMs = 5000) => {
    const deadline = Date.now() + timeoutMs;
    while (!condition()) {
        if (Date.now() > deadline) {
            throw new Error('Timed out waiting for condition');
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
};

describe('registerMongoPoolMonitoring against a real MongoClient', () => {
    let client;
    let collection;
    let inUse;
    let waiting;

    beforeAll(async () => {
        client = new MongoClient(await getMongoUrlAsync(), { maxPoolSize: 1, minPoolSize: 0 });
        registerMongoPoolMonitoring({ client, poolName: POOL });
        await client.connect();
        collection = client.db('pool_monitor_integration').collection('items');
        await collection.deleteMany({});
        await collection.insertOne({ a: 1 });
    });

    afterAll(async () => {
        await client.close();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('in use and wait queue track a held connection and a queued operation, and return to 0', async () => {
        inUse = jest.spyOn(mongoPoolConnectionsInUseUpDownCounter, 'add');
        waiting = jest.spyOn(mongoPoolWaitQueueSizeUpDownCounter, 'add');

        // Holds the only connection for HOLD_MS.
        const held = collection.find({ $where: `sleep(${HOLD_MS}) || true` }).toArray();
        await waitUntilAsync(() => levelOf(inUse) === 1);

        // Cannot get a connection until the first operation finishes.
        const queued = collection.find({}).toArray();
        await waitUntilAsync(() => levelOf(waiting) === 1);
        expect(levelOf(inUse)).toBe(1);
        expect(levelOf(waiting)).toBe(1);

        await Promise.all([held, queued]);
        await waitUntilAsync(() => levelOf(inUse) === 0 && levelOf(waiting) === 0);
        expect(levelOf(inUse)).toBe(0);
        expect(levelOf(waiting)).toBe(0);

        for (const spy of [inUse, waiting]) {
            for (const [, attributes] of spy.mock.calls) {
                expect(attributes).toEqual({ pool: POOL });
            }
        }
    });

    test('closing the client leaves both levels at 0', async () => {
        const closing = new MongoClient(await getMongoUrlAsync(), { maxPoolSize: 1 });
        registerMongoPoolMonitoring({ client: closing, poolName: POOL });
        await closing.connect();
        inUse = jest.spyOn(mongoPoolConnectionsInUseUpDownCounter, 'add');
        waiting = jest.spyOn(mongoPoolWaitQueueSizeUpDownCounter, 'add');

        await closing.db('pool_monitor_integration').collection('items').find({}).toArray();
        await closing.close();

        expect(levelOf(inUse)).toBe(0);
        expect(levelOf(waiting)).toBe(0);
    });
});
