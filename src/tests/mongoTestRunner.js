const {MongoMemoryServer} = require('mongodb-memory-server-core');
/**
 * @type {import('mongodb-memory-server').MongoMemoryServer|undefined|null}
 */
let mongo;

async function startTestMongoServerAsync() {
    mongo = await MongoMemoryServer.create();
    global.__MONGO_URI__ = mongo.getUri();
}

async function stopTestMongoServerAsync() {
    await mongo.stop({doCleanup: true});
    mongo = null;
    delete global.__MONGO_URI__;
}

module.exports = {
    startTestMongoServerAsync,
    stopTestMongoServerAsync
};
