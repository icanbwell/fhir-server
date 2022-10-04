const {mongoConfig, auditEventMongoConfig} = require('../config');
const {isTrue} = require('./isTrue');
const env = require('var');
const {logSystemEventAsync} = require('../operations/common/logging');
const {MongoClient} = require('mongodb');

/**
 * client connection
 * @type import('mongodb').MongoClient
 */
let clientConnection = null;
// /**
//  * client connection
//  * @type import('mongodb').MongoClient
//  */
// let auditConnection = null;
/**
 * client db
 * @type {import('mongodb').Db}
 */
let clientDb = null;

/**
 * client db
 * @type {import('mongodb').Db}
 */
let auditClientDb = null;

class MongoDatabaseManager {
    /**
     * Gets client db
     * @returns {Promise<import('mongodb').Db>}
     */
    async getClientDbAsync() {
        if (!clientDb) {
            await this.connectAsync();
        }
        return clientDb;
    }

    /**
     * Gets audit db
     * @returns {Promise<import('mongodb').Db>}
     */
    async getAuditDbAsync() {
        if (!auditClientDb) {
            await this.connectAsync();
        }
        return auditClientDb;
    }

    /**
     * Gets db for resource type
     * @param {string} resourceType
     * @returns {Promise<import('mongodb').Db>}
     */
    async getDatabaseForResource({resourceType}) {
        return (resourceType === 'AuditEvent') ?
            await this.getAuditDbAsync() : await this.getClientDbAsync();
    }

    getClientConfig() {
        return mongoConfig;
    }

    getAuditConfig() {
        return auditEventMongoConfig;
    }

    /**
     * Creates a new connection
     * @param {Object} mongoConfig1
     * @returns {Promise<import('mongodb').MongoClient>}
     */
    async createClientAsync(mongoConfig1) {
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

    async connectAsync() {
        if (clientConnection) {
            return;
        }
        const client = await this.createClientAsync(mongoConfig);

        clientConnection = client;
        // globals.set(CLIENT, client);
        clientDb = client.db(mongoConfig.db_name);

        if (env.AUDIT_EVENT_MONGO_URL) {
            const auditEventClient = await this.createClientAsync(auditEventMongoConfig);
            // auditConnection = auditEventClient;
            auditClientDb = auditEventClient.db(auditEventMongoConfig.db_name);
        } else {
            // auditConnection = client;
            auditClientDb = client.db(mongoConfig.db_name);
        }
    }

    /**
     * disconnects a client
     * @param {import('mongodb').MongoClient} client
     * @returns {Promise<void>}
     */
    async disconnectClientAsync(client) {
        if (client) {
            await client.close(true);
        }
    }

    /**
     * disconnects all global connections
     * @returns {Promise<void>}
     */
    async disconnectAsync() {
        if (clientConnection) {
            await this.disconnectClientAsync(clientConnection);
        }
    }
}

module.exports = {
    MongoDatabaseManager
};
