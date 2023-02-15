const {mongoConfig, auditEventMongoConfig} = require('../config');
const {isTrue} = require('./isTrue');
const env = require('var');
const {logSystemEventAsync, logInfo, logError} = require('../operations/common/logging');
const {MongoClient} = require('mongodb');

/**
 * client connection
 * @type import('mongodb').MongoClient
 */
let clientConnection = null;
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
    async getDatabaseForResourceAsync({resourceType}) {
        return (resourceType === 'AuditEvent') ?
            (await this.getAuditDbAsync()) : (await this.getClientDbAsync());
    }

    async getClientConfigAsync() {
        return mongoConfig;
    }

    async getAuditConfigAsync() {
        return auditEventMongoConfig;
    }

    /**
     * Creates a new connection
     * @param {Object} clientConfig
     * @returns {Promise<import('mongodb').MongoClient>}
     */
    async createClientAsync(clientConfig) {
        if (isTrue(env.LOG_ALL_MONGO_CALLS)) {
            clientConfig.options.monitorCommands = true;
            await logSystemEventAsync(
                {
                    event: 'dbConnect',
                    message: `Connecting to ${clientConfig.connection}`,
                    args: {db: clientConfig.db_name}
                }
            );
        }
        // https://www.mongodb.com/docs/drivers/node/current/fundamentals/connection/
        /**
         * @type {import('mongodb').MongoClient}
         */
        const client = new MongoClient(clientConfig.connection, clientConfig.options);

        try {
            await client.connect();
        } catch (e) {
            logError(`Failed to connect to ${clientConfig.connection}`, {'error': e});
            throw e;
        }
        try {
            await client.db('admin').command({ping: 1});
        } catch (e) {
            logError(`Failed to execute ping on ${clientConfig.connection}`, {'error': e});
            throw e;
        }
        await logSystemEventAsync(
            {
                event: 'dbConnect',
                message: 'Successfully connected to database',
                args: {db: clientConfig.db_name}
            }
        );

        if (isTrue(env.LOG_ALL_MONGO_CALLS)) {
            // https://www.mongodb.com/docs/drivers/node/current/fundamentals/monitoring/command-monitoring/
            client.on('commandStarted', event => {
                logInfo('AWS Received commandStarted', {'event': event});
            });
            client.on('commandSucceeded', event => {
                logInfo('AWS Received commandSucceeded', {'event': event});
            });
            client.on('commandFailed', event => {
                logInfo('AWS Received commandFailed', {'event': event});
            });
        }
        return client;
    }

    /**
     * @return {Promise<void>}
     */
    async connectAsync() {
        if (clientConnection) {
            return;
        }
        const clientConfig = await this.getClientConfigAsync();
        const client = await this.createClientAsync(clientConfig);

        clientConnection = client;
        clientDb = client.db(clientConfig.db_name);

        const auditConfig = await this.getAuditConfigAsync();
        const auditEventClient = await this.createClientAsync(auditConfig);
        auditClientDb = auditEventClient.db(auditConfig.db_name);
    }

    /**
     * @return {Promise<void>}
     */
    async dropDatabasesAsync() {
        // not implemented for production but can be implemented by sub-classes for tests
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
