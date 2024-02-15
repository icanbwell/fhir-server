const { mongoConfig, auditEventMongoConfig, auditEventReadOnlyMongoConfig, accessLogsMongoConfig } = require('../config');
const { isTrue } = require('./isTrue');
const env = require('var');
const { logInfo, logError } = require('../operations/common/logging');
const { logSystemEventAsync } = require('../operations/common/systemEventLogging');
const { MongoClient, GridFSBucket } = require('mongodb');
const { ConfigManager } = require('./configManager');
const { assertTypeEquals } = require('./assertType');

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

/**
 * client db
 * @type {import('mongodb').Db}
 */
let auditReadOnlyClientDb = null;

/**
 * client db
 * @type {import('mongodb').Db}
 */
let accessLogsDb = null;

/**
 * gridFs bucket
 * @type {import('mongodb').GridFSBucket}
*/
let gridFSBucket = null;

/**
 * @typedef MongoDatabaseManagerProps
 * @property {ConfigManager} configManager
 */

class MongoDatabaseManager {
    /**
     * constructor
     * @param {MongoDatabaseManagerProps} params
     */
    constructor ({ configManager }) {
        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);
    }

    /**
     * Gets client db
     * @returns {Promise<import('mongodb').Db>}
     */
    async getClientDbAsync () {
        if (!clientDb) {
            await this.connectAsync();
        }
        return clientDb;
    }

    /**
     * Gets audit db
     * @returns {Promise<import('mongodb').Db>}
     */
    async getAuditDbAsync () {
        if (!auditClientDb) {
            await this.connectAsync();
        }
        return auditClientDb;
    }

    /**
     * Gets audit event read only db
     * @returns {Promise<import('mongodb').Db>}
     */
    async getAuditReadOnlyDbAsync () {
        if (!auditReadOnlyClientDb) {
            await this.connectAsync();
        }
        return auditReadOnlyClientDb;
    }

    /**
     * Gets access logs db
     * @returns {Promise<import('mongodb').Db>}
     */
    async getAccessLogsDbAsync () {
        if (!accessLogsDb) {
            await this.connectAsync();
        }
        return accessLogsDb;
    }

    /**
     * Gets db for resource type
     * @param {string} resourceType
     * @param {Object} extraInfo
     * @returns {Promise<import('mongodb').Db>}
     */
    async getDatabaseForResourceAsync ({ resourceType, extraInfo = {} }) {
        const searchOperationNames = ['search', 'searchStreaming', 'searchById'];
        if (resourceType === 'AuditEvent') {
            if (searchOperationNames.includes(extraInfo.currentOperationName)) {
                return await this.getAuditReadOnlyDbAsync();
            }
            return await this.getAuditDbAsync();
        }
        return await this.getClientDbAsync();
    }

    /**
     * Gets GridFs Bucket
     * @returns {Promise<import('mongodb').GridFSBucket>}
     */
    async getGridFsBucket () {
        if (!gridFSBucket) {
            gridFSBucket = new GridFSBucket(await this.getClientDbAsync());
        }
        return gridFSBucket;
    }

    async getClientConfigAsync () {
        return mongoConfig;
    }

    async getAuditConfigAsync () {
        return auditEventMongoConfig;
    }

    async getAuditReadOnlyConfigAsync () {
        return auditEventReadOnlyMongoConfig;
    }

    async getAccessLogsConfigAsync () {
        return accessLogsMongoConfig;
    }

    /**
     * Creates a new connection
     * @param {Object} clientConfig
     * @returns {Promise<import('mongodb').MongoClient>}
     */
    async createClientAsync (clientConfig) {
        if (isTrue(env.LOG_ALL_MONGO_CALLS)) {
            clientConfig.options.monitorCommands = true;
            await logSystemEventAsync(
                {
                    event: 'dbConnect',
                    message: `Connecting to ${clientConfig.connection}`,
                    args: { db: clientConfig.db_name }
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
            logError(`Failed to connect to ${clientConfig.connection}`, { error: e });
            throw e;
        }
        try {
            await client.db('admin').command({ ping: 1 });
        } catch (e) {
            logError(`Failed to execute ping on ${clientConfig.connection}`, { error: e });
            throw e;
        }
        await logSystemEventAsync(
            {
                event: 'dbConnect',
                message: 'Successfully connected to database',
                args: { db: clientConfig.db_name }
            }
        );

        if (isTrue(env.LOG_ALL_MONGO_CALLS)) {
            // https://www.mongodb.com/docs/drivers/node/current/fundamentals/monitoring/command-monitoring/
            client.on('commandStarted', event => {
                logInfo('AWS Received commandStarted', { event: event });
            });
            client.on('commandSucceeded', event => {
                logInfo('AWS Received commandSucceeded', { event: event });
            });
            client.on('commandFailed', event => {
                logInfo('AWS Received commandFailed', { event: event });
            });
        }
        return client;
    }

    /**
     * @return {Promise<void>}
     */
    async connectAsync () {
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

        // if enabled then use auditEventReadOnlyMongoConfig else use same instance on audit event db
        if (this.configManager.enableAuditEventArchiveRead) {
            const auditReadOnlyConfig = await this.getAuditReadOnlyConfigAsync();
            const auditEventReadOnlyClient = await this.createClientAsync(auditReadOnlyConfig);
            auditReadOnlyClientDb = auditEventReadOnlyClient.db(auditReadOnlyConfig.db_name);
        } else {
            auditReadOnlyClientDb = auditClientDb;
        }

        const accessLogsConfig = await this.getAccessLogsConfigAsync();
        const accessLogsClient = await this.createClientAsync(accessLogsConfig);
        accessLogsDb = accessLogsClient.db(accessLogsConfig.db_name);
    }

    /**
     * @return {Promise<void>}
     */
    async dropDatabasesAsync () {
        // not implemented for production but can be implemented by sub-classes for tests
    }

    /**
     * disconnects a client
     * @param {import('mongodb').MongoClient} client
     * @returns {Promise<void>}
     */
    async disconnectClientAsync (client) {
        if (client) {
            await client.close(true);
        }
    }

    /**
     * disconnects all global connections
     * @returns {Promise<void>}
     */
    async disconnectAsync () {
        if (clientConnection) {
            await this.disconnectClientAsync(clientConnection);
        }
    }
}

module.exports = {
    MongoDatabaseManager
};
