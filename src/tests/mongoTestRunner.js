const { MongoMemoryReplSet } = require('mongodb-memory-server-core');

/**
 * @type {import('mongodb-memory-server').MongoMemoryReplSet|undefined|null}
 */
let mongoRepl;

let myMongoUrl;

async function startTestMongoServerAsync () {
    mongoRepl = await MongoMemoryReplSet.create({
        replSet: { count: 1, storageEngine: 'wiredTiger' },
        binary: { version: '8.0.15' }
    });
    await mongoRepl.waitUntilRunning();
    myMongoUrl = mongoRepl.getUri();
    global.__MONGO_URI__ = myMongoUrl;
}

async function stopTestMongoServerAsync () {
    if (mongoRepl) {
        await mongoRepl.stop({ doCleanup: true });
        mongoRepl = null;
    }
    delete global.__MONGO_URI__;
    myMongoUrl = null;
}

async function getMongoUrlAsync () {
    // For performance tests that need a persistent MongoDB instance instead of the in-memory server,
    // set USE_DOCKER_MONGO=1 and ensure MONGO_URL points to a running MongoDB container.
    // This is useful for large-scale tests where in-memory server has size/performance limitations.
    if (process.env.USE_DOCKER_MONGO === '1' && process.env.MONGO_URL) {
        return process.env.MONGO_URL;
    }

    if (!myMongoUrl) {
        await startTestMongoServerAsync();
    }
    return myMongoUrl;
}

module.exports = {
    startTestMongoServerAsync,
    stopTestMongoServerAsync,
    getMongoUrlAsync
};
