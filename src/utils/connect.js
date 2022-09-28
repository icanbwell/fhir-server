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
const {logSystemEventAsync} = require('../operations/common/logging');

/**
 * Creates a new connection
 * @param {Object} mongoConfig1
 * @returns {Promise<import('mongodb').MongoClient>}
 */
async function createClientAsync(mongoConfig1) {
    if (isTrue(env.LOG_ALL_MONGO_CALLS)) {
        mongoConfig1.options.monitorCommands = true;
        await logSystemEventAsync(
            {
                event: 'dbConnect',
                message: `Connecting to ${mongoConfig1.connection}`,
                args: {db: mongoConfig1.db_name}
            }
        );
    }
    // https://www.mongodb.com/docs/drivers/node/current/fundamentals/connection/
    /**
     * @type {import('mongodb').MongoClient}
     */
    const client = new MongoClient(mongoConfig1.connection, mongoConfig1.options);

    try {
        await client.connect();
    } catch (e) {
        console.error(JSON.stringify({message: `Failed to connect to ${mongoConfig1.connection}: ${e}`}));
        throw e;
    }
    try {
        await client.db('admin').command({ping: 1});
    } catch (e) {
        console.error(JSON.stringify({message: `Failed to execute ping on ${mongoConfig1.connection}: ${e}`}));
        throw e;
    }
    await logSystemEventAsync(
        {
            event: 'dbConnect',
            message: 'Successfully connected to database',
            args: {db: mongoConfig1.db_name}
        }
    );

    if (isTrue(env.LOG_ALL_MONGO_CALLS)) {
        // https://www.mongodb.com/docs/drivers/node/current/fundamentals/monitoring/command-monitoring/
        client.on('commandStarted', event => {
            console.log(JSON.stringify({message: `AWS Received commandStarted: ${JSON.stringify(event, null, 2)}\n\n`}));
        });
        client.on('commandSucceeded', event => {
            console.log(JSON.stringify({message: `AWS Received commandSucceeded: ${JSON.stringify(event, null, 2)}\n\n`}));
        });
        client.on('commandFailed', event => {
            console.log(JSON.stringify({message: `AWS Received commandFailed: ${JSON.stringify(event, null, 2)}\n\n`}));
        });
    }
    return client;
}

const connectAsync = async function () {
    if (globals.get(CLIENT)) {
        return;
    }
    const client = await createClientAsync(mongoConfig);

    globals.set(CLIENT, client);
    globals.set(CLIENT_DB, client.db(mongoConfig.db_name));

    if (env.ATLAS_MONGO_URL) {
        const atlasClient = await createClientAsync(atlasMongoConfig);

        globals.set(ATLAS_CLIENT, atlasClient);
        globals.set(ATLAS_CLIENT_DB, atlasClient.db(atlasMongoConfig.db_name));
    }
    if (env.AUDIT_EVENT_MONGO_URL) {
        const auditEventClient = await createClientAsync(auditEventMongoConfig);

        globals.set(AUDIT_EVENT_CLIENT, auditEventClient);
        globals.set(AUDIT_EVENT_CLIENT_DB, auditEventClient.db(auditEventMongoConfig.db_name));
    } else {
        globals.set(AUDIT_EVENT_CLIENT, client);
        globals.set(AUDIT_EVENT_CLIENT_DB, client.db(mongoConfig.db_name));
    }
};

/**
 * disconnects a client
 * @param {import('mongodb').MongoClient} client
 * @returns {Promise<void>}
 */
const disconnectClientAsync = async function (client) {
    if (client) {
        await client.close();
    }
};

/**
 * disconnects all global connections
 * @returns {Promise<void>}
 */
const disconnectAsync = async function () {
    const awsClient = globals.get(CLIENT);
    if (awsClient) {
        await disconnectClientAsync(awsClient);
    }
    const atlasClient = globals.get(ATLAS_CLIENT);
    if (atlasClient) {
        await disconnectClientAsync(atlasClient);
    }
};

module.exports = {
    createClientAsync,
    connectAsync,
    disconnectClientAsync,
    disconnectAsync,
};
