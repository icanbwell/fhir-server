const {MongoClient} = require('mongodb');
const globals = require('../globals');
const {mongoConfig, atlasMongoConfig, auditEventMongoConfig} = require('../config');
const {
    CLIENT,
    CLIENT_DB,
    ATLAS_CLIENT,
    ATLAS_CLIENT_DB,
    AUDIT_EVENT_CLIENT,
    AUDIT_EVENT_CLIENT_DB
} = require('../constants');
const {isTrue} = require('./isTrue');
const env = require('var');

/**
 * Creates a new connection
 * @param {Object} mongoConfig1
 * @returns {Promise<import("mongodb").MongoClient>}
 */
async function createClient(mongoConfig1) {
    if (isTrue(env.LOG_ALL_MONGO_CALLS)) {
        mongoConfig1.options.monitorCommands = true;
        console.log(`Connecting to ${mongoConfig1.connection}`);
    }
    // https://www.mongodb.com/docs/drivers/node/current/fundamentals/connection/
    /**
     * @type {import("mongodb").MongoClient}
     */
    const client = new MongoClient(mongoConfig1.connection, mongoConfig1.options);

    try {
        await client.connect();
    } catch (e) {
        console.error(`Failed to connect to ${mongoConfig1.connection}: ${e}`);
        throw e;
    }
    try {
        await client.db('admin').command({ping: 1});
    } catch (e) {
        console.error(`Failed to execute ping on ${mongoConfig1.connection}: ${e}`);
        throw e;
    }
    console.log('Successfully connected to AWS DocumentDB ');

    if (isTrue(env.LOG_ALL_MONGO_CALLS)) {
        // https://www.mongodb.com/docs/drivers/node/current/fundamentals/monitoring/command-monitoring/
        client.on('commandStarted', event => {
            console.log(`AWS Received commandStarted: ${JSON.stringify(event, null, 2)}\n\n`);
        });
        client.on('commandSucceeded', event => {
            console.log(`AWS Received commandSucceeded: ${JSON.stringify(event, null, 2)}\n\n`);
        });
        client.on('commandFailed', event => {
            console.log(`AWS Received commandFailed: ${JSON.stringify(event, null, 2)}\n\n`);
        });
    }
    return client;
}

const connect = async function () {
    if (globals.get(CLIENT)) {
        return;
    }
    const client = await createClient(mongoConfig);

    globals.set(CLIENT, client);
    globals.set(CLIENT_DB, client.db(mongoConfig.db_name));

    if (env.ATLAS_MONGO_URL) {
        const atlasClient = await createClient(atlasMongoConfig);

        globals.set(ATLAS_CLIENT, atlasClient);
        globals.set(ATLAS_CLIENT_DB, atlasClient.db(atlasMongoConfig.db_name));
    }
    if (env.AUDIT_EVENT_MONGO_URL) {
        const auditEventClient = await createClient(auditEventMongoConfig);

        globals.set(AUDIT_EVENT_CLIENT, auditEventClient);
        globals.set(AUDIT_EVENT_CLIENT_DB, auditEventClient.db(auditEventMongoConfig.db_name));
    } else {
        globals.set(AUDIT_EVENT_CLIENT, client);
        globals.set(AUDIT_EVENT_CLIENT_DB, client.db(mongoConfig.db_name));
    }
};

/**
 * disconnects a client
 * @param client
 * @returns {Promise<void>}
 */
const disconnectClient = async function (client) {
    if (client) {
        await client.close();
    }
};

/**
 * disconnects all global connections
 * @returns {Promise<void>}
 */
const disconnect = async function () {
    const awsClient = globals.get(CLIENT);
    await disconnectClient(awsClient);
    const atlasClient = globals.get(ATLAS_CLIENT);
    await disconnectClient(atlasClient);
};

module.exports = {
    createClient: createClient,
    connect: connect,
    disconnectClient: disconnectClient,
    disconnect: disconnect,
};
