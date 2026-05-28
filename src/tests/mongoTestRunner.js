const { MongoMemoryReplSet } = require('mongodb-memory-server-core');

/**
 * @type {import('mongodb-memory-server-core').MongoMemoryReplSet|undefined|null}
 */
let mongoRepl;

async function startTestMongoServerAsync () {
    const start = Date.now();
    mongoRepl = await MongoMemoryReplSet.create({
        replSet: { count: 1, storageEngine: 'wiredTiger' },
        binary: { version: '8.0.20' }
    });
    await mongoRepl.waitUntilRunning();
    process.env["MONGO_MEMORY_SERVER_URL"] = mongoRepl.getUri();
    diag(`started MongoMemoryReplSet in ${Date.now() - start}ms uri=${mongoRepl.getUri()}`);
}

async function stopTestMongoServerAsync () {
    if (mongoRepl) {
        diag('stopping MongoMemoryReplSet');
        await mongoRepl.stop({ doCleanup: true });
        mongoRepl = null;
    }
    delete process.env["MONGO_MEMORY_SERVER_URL"];
}

function diag (msg) {
    // Bypass Jest's console capture (which --silent suppresses) so diagnostic
    // lines about Mongo lifecycle reach the CI log directly.
    process.stderr.write(`[mongoTestRunner] worker=${process.env.JEST_WORKER_ID || '0'} pid=${process.pid} ${msg}\n`);
}

async function getMongoUrlAsync () {
    // For performance tests, use Docker MongoDB instead of in-memory server
    if (process.env.USE_DOCKER_MONGO === '1' && process.env.MONGO_URL) {
        diag('reusing Docker MONGO_URL');
        return process.env.MONGO_URL;
    }

    // Reuse the shared in-memory server started by globalSetup.
    if (process.env["MONGO_MEMORY_SERVER_URL"]) {
        diag('reusing shared MONGO_MEMORY_SERVER_URL');
        return process.env["MONGO_MEMORY_SERVER_URL"];
    }

    diag('spawning per-worker MongoMemoryReplSet (shared URL not set)');
    await startTestMongoServerAsync();
    return process.env["MONGO_MEMORY_SERVER_URL"];
}

module.exports = {
    startTestMongoServerAsync,
    stopTestMongoServerAsync,
    getMongoUrlAsync
};
