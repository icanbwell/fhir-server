const {MongoMemoryServer} = require('mongodb-memory-server-core');
/**
 * @type {import('mongodb-memory-server').MongoMemoryServer|undefined|null}
 */
let mongo;

let myMongoUrl;

async function startTestMongoServerAsync() {
    mongo = await MongoMemoryServer.create();
    await mongo.ensureInstance();
    myMongoUrl = mongo.getUri();
    global.__MONGO_URI__ = myMongoUrl;
}

async function stopTestMongoServerAsync() {
    await mongo.stop({doCleanup: true});
    mongo = null;
    delete global.__MONGO_URI__;
    myMongoUrl = null;
}

async function getMongoUrlAsync() {
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
