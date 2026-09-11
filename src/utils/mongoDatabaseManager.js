const { mongoConfig, auditEventMongoConfig, auditEventReadOnlyMongoConfig, accessLogsMongoConfig, resourceHistoryMongoConfig, fhirNotesMongoConfig } = require('../config');
const { isTrue } = require('./isTrue');
const { logInfo, logError } = require('../operations/common/logging');
const { logSystemEventAsync } = require('../operations/common/systemEventLogging');
const { MongoClient, GridFSBucket } = require('mongodb');
const { ConfigManager } = require('./configManager');
const { assertTypeEquals } = require('./assertType');
const { registerMongoPoolMonitoring } = require('./mongoPoolMonitor');

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
 * resource history db
 * @type {import('mongodb').Db}
 */
let resourceHistoryDb = null;

/**
 * gridFs bucket
 * @type {import('mongodb').GridFSBucket}
*/
let gridFSBucket = null;

/**
 * fhir-notes-vector-store db (read-only). Connected lazily and independently of
 * connectAsync()/clientConnection -- see getFhirNotesDbAsync() -- because this is an
 * externally-owned, dependency-of-a-dependency cluster: an outage there must never stall or fail
 * fhir-server's primary request path.
 * @type {import('mongodb').Db}
 */
let fhirNotesDb = null;

/**
 * In-flight connection attempt for fhirNotesDb, so concurrent callers share one attempt instead
 * of racing to connect. Reset to null after every attempt (success or failure) so a later request
 * can retry a transient failure, rather than being permanently stuck once set (unlike
 * clientConnection, which is intentionally never retried within a process's lifetime).
 * @type {Promise<import('mongodb').Db|null>|null}
 */
let fhirNotesConnectPromise = null;

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
     * Gets resource history db
     * @returns {Promise<import('mongodb').Db>}
     */
    async getResourceHistoryDbAsync () {
        if (!resourceHistoryDb) {
            await this.connectAsync();
        }
        return resourceHistoryDb;
    }

    /**
     * Gets the fhir-notes-vector-store db (read-only). Returns null when the feature isn't
     * configured in this environment (FHIR_NOTES_MONGO_URL unset), or when connecting to it
     * fails -- callers (ClinicalNoteSearchClient, ClinicalNoteTextRetriever) already treat a null
     * db as "feature unavailable" and degrade gracefully, rather than this method throwing and
     * taking down an unrelated request.
     * @returns {Promise<import('mongodb').Db|null>}
     */
    async getFhirNotesDbAsync () {
        if (!this.configManager.fhirNotesFullTextSearchConfigured) {
            return null;
        }
        if (fhirNotesDb) {
            return fhirNotesDb;
        }
        if (!fhirNotesConnectPromise) {
            fhirNotesConnectPromise = this.connectFhirNotesAsync();
        }
        try {
            return await fhirNotesConnectPromise;
        } finally {
            fhirNotesConnectPromise = null;
        }
    }

    /**
     * Connects to the fhir-notes-vector-store cluster in isolation from connectAsync()'s primary
     * connection setup. Never throws -- a failure here (misconfiguration, network outage, auth
     * failure) must not cascade into fhir-server's primary request path failing. Logs and returns
     * null instead, leaving fhirNotesDb unset so the next call retries.
     * @returns {Promise<import('mongodb').Db|null>}
     */
    async connectFhirNotesAsync () {
        try {
            const fhirNotesConfig = await this.getFhirNotesConfigAsync();
            const fhirNotesClient = await this.createClientAsync(fhirNotesConfig);
            fhirNotesDb = fhirNotesClient.db(fhirNotesConfig.db_name);
            return fhirNotesDb;
        } catch (e) {
            logError('Failed to connect to fhir-notes-vector-store. _content search and ' +
                '_format=text/plain derived-text reads will be unavailable until this succeeds.', { error: e });
            return null;
        }
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
        } else if (extraInfo.isHistoryQuery || resourceType?.endsWith('_History')) {
            return await this.getResourceHistoryDbAsync();
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

    async getResourceHistoryConfigAsync () {
        return resourceHistoryMongoConfig;
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

    async getFhirNotesConfigAsync () {
        return fhirNotesMongoConfig;
    }

    /**
     * Creates a new connection
     * @param {Object} clientConfig
     * @returns {Promise<import('mongodb').MongoClient>}
     */
    async createClientAsync (clientConfig) {
        const parts = clientConfig.connection.split(':');
        const server = clientConfig.connection.substring(clientConfig.connection.indexOf('@'));
        const maskedConnection = `${parts[0]}:${parts[1]}:***********${server}`;
        if (isTrue(process.env.LOG_ALL_MONGO_CALLS)) {
            clientConfig.options.monitorCommands = true;
            await logSystemEventAsync(
                {
                    event: 'dbConnect',
                    message: `Connecting to ${maskedConnection}`,
                    args: { db: clientConfig.db_name }
                }
            );
        }
        // https://www.mongodb.com/docs/drivers/node/current/fundamentals/connection/
        /**
         * @type {import('mongodb').MongoClient}
         */
        const client = new MongoClient(clientConfig.connection, clientConfig.options);

        // Subscribe before connect() so the connections the driver opens to satisfy
        // minPoolSize are counted too. Always on -- this is a fixed set of four
        // instruments, unlike the per-command logging gated behind LOG_ALL_MONGO_CALLS
        // below, which is far too chatty to leave enabled.
        registerMongoPoolMonitoring({ client, poolName: clientConfig.db_name });

        try {
            await client.connect();
        } catch (e) {
            logError(`Failed to connect to ${maskedConnection}`, { error: e });
            throw e;
        }
        try {
            await client.db('admin').command({ ping: 1 });
        } catch (e) {
            logError(`Failed to execute ping on ${maskedConnection}`, { error: e });
            throw e;
        }
        await logSystemEventAsync(
            {
                event: 'dbConnect',
                message: 'Successfully connected to database',
                args: { db: clientConfig.db_name }
            }
        );

        if (isTrue(process.env.LOG_ALL_MONGO_CALLS)) {
            // https://www.mongodb.com/docs/drivers/node/current/fundamentals/monitoring/command-monitoring/
            client.on('commandStarted', event => {
                logInfo('AWS Received commandStarted', { event });
            });
            client.on('commandSucceeded', event => {
                logInfo('AWS Received commandSucceeded', { event });
            });
            client.on('commandFailed', event => {
                logInfo('AWS Received commandFailed', { event });
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
        const auditEventClient = auditConfig.connection ? await this.createClientAsync(auditConfig) : client;
        auditClientDb = auditEventClient.db(auditConfig.db_name);

        // if enabled then use auditEventReadOnlyMongoConfig else use same instance on audit event db
        if (this.configManager.enableAuditEventArchiveRead) {
            const auditReadOnlyConfig = await this.getAuditReadOnlyConfigAsync();
            const auditEventReadOnlyClient = auditReadOnlyConfig.connection
                ? await this.createClientAsync(auditReadOnlyConfig)
                : auditEventClient;
            auditReadOnlyClientDb = auditEventReadOnlyClient.db(auditReadOnlyConfig.db_name);
        } else {
            auditReadOnlyClientDb = auditClientDb;
        }

        const accessLogsConfig = await this.getAccessLogsConfigAsync();
        const accessLogsClient = accessLogsConfig.connection
            ? await this.createClientAsync(accessLogsConfig)
            : auditEventClient;
        accessLogsDb = accessLogsClient.db(accessLogsConfig.db_name);

        const resourceHistoryConfig = await this.getResourceHistoryConfigAsync();
        const resourceHistoryClient = resourceHistoryConfig.connection
            ? await this.createClientAsync(resourceHistoryConfig)
            : client;
        resourceHistoryDb = resourceHistoryClient.db(resourceHistoryConfig.db_name);
        // fhir-notes-vector-store is intentionally NOT connected here -- see getFhirNotesDbAsync()
        // and connectFhirNotesAsync() for why it's connected lazily and in isolation.
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
