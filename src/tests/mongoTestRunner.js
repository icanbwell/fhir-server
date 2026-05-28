const { MongoMemoryReplSet } = require('mongodb-memory-server-core');

/**
 * @type {import('mongodb-memory-server-core').MongoMemoryReplSet|undefined|null}
 */
let mongoRepl;

async function startTestMongoServerAsync () {
    mongoRepl = await MongoMemoryReplSet.create({
        replSet: { count: 1, storageEngine: 'wiredTiger' },
        binary: { version: '8.0.20' }
    });
    await mongoRepl.waitUntilRunning();
    process.env.MONGO_MEMORY_SERVER_URL = mongoRepl.getUri();
}

async function stopTestMongoServerAsync () {
    if (mongoRepl) {
        await mongoRepl.stop({ doCleanup: true });
        mongoRepl = null;
    }
    delete process.env.MONGO_MEMORY_SERVER_URL;
}

async function getMongoUrlAsync () {
    // For performance tests, use Docker MongoDB instead of in-memory server
    if (process.env.USE_DOCKER_MONGO === '1' && process.env.MONGO_URL) {
        return process.env.MONGO_URL;
    }

    // Reuse the shared in-memory server started by globalSetup.
    if (process.env.MONGO_MEMORY_SERVER_URL) {
        return process.env.MONGO_MEMORY_SERVER_URL;
    }

    await startTestMongoServerAsync();
    return process.env.MONGO_MEMORY_SERVER_URL;
}

module.exports = {
    startTestMongoServerAsync,
    stopTestMongoServerAsync,
    getMongoUrlAsync
};
