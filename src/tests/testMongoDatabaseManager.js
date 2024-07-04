const { MongoDatabaseManager } = require('../utils/mongoDatabaseManager');
const { getMongoUrlAsync } = require('./mongoTestRunner');

class TestMongoDatabaseManager extends MongoDatabaseManager {
    async getClientConfigAsync () {
        const mongoUrl = await getMongoUrlAsync();
        return {
            connection: mongoUrl, // set by https://github.com/shelfio/jest-mongodb
            db_name: 'fhir',
            options: {}
        };
    }

    async getAuditConfigAsync () {
        const mongoUrl = await getMongoUrlAsync();
        return {
            connection: mongoUrl,
            db_name: 'audit-event',
            options: {}
        };
    }

    async getAuditReadOnlyConfigAsync () {
        const mongoUrl = await getMongoUrlAsync();
        return {
            connection: mongoUrl,
            db_name: 'audit-event',
            options: {}
        };
    }

    async getAccessLogsConfigAsync () {
        const mongoUrl = await getMongoUrlAsync();
        return {
            connection: mongoUrl,
            db_name: 'access-logs',
            options: {}
        };
    }

    async getResourceHistoryConfigAsync () {
        const mongoUrl = await getMongoUrlAsync();
        return {
            connection: mongoUrl,
            db_name: 'resource-history',
            options: {}
        };
    }

    async dropDatabasesAsync () {
        const db = await this.getClientDbAsync();
        await db.dropDatabase();

        const auditDb = await this.getAuditDbAsync();
        await auditDb.dropDatabase();

        const accessLogsDbDb = await this.getAccessLogsDbAsync();
        await accessLogsDbDb.dropDatabase();

        const resourceHistoryDb = await this.getResourceHistoryDbAsync();
        await resourceHistoryDb.dropDatabase();

        // check if database is done
        const clientConfig = await this.getClientConfigAsync();
        const client = await this.createClientAsync(clientConfig);

        /**
         * @type {import('mongo').ListDatabasesResult}
         */
        const databasesResult = await client.db().admin().listDatabases();
        const databases = databasesResult.databases;
        while (databases.some(d => d.db_name === clientConfig.db_name)) { /* empty */
        }

        // check if audit database is gone
        const auditConfig = await this.getAuditConfigAsync();
        const auditEventClient = await this.createClientAsync(auditConfig);
        /**
         * @type {import('mongo').ListDatabasesResult}
         */
        const auditDatabasesResult = await auditEventClient.db().admin().listDatabases();
        const auditDatabases = auditDatabasesResult.databases;
        while (auditDatabases.some(d => d.db_name === auditConfig.db_name)) { /* empty */
        }

        // check if access logs database is gone
        const accessLogsConfig = await this.getAccessLogsConfigAsync();
        const accessLogsClient = await this.createClientAsync(accessLogsConfig);
        /**
         * @type {import('mongo').ListDatabasesResult}
         */
        const accessLogsDatabasesResult = await accessLogsClient.db().admin().listDatabases();
        const accessLogsDatabases = accessLogsDatabasesResult.databases;
        while (accessLogsDatabases.some(d => d.db_name === accessLogsConfig.db_name)) { /* empty */
        }

        // check if resource history database is gone
        const resourceHistoryConfig = await this.getResourceHistoryConfigAsync();
        const resourceHistoryClient = await this.createClientAsync(resourceHistoryConfig);
        /**
         * @type {import('mongo').ListDatabasesResult}
         */
        const resourceHistoryDatabasesResult = await resourceHistoryClient.db().admin().listDatabases();
        const resourceHistoryDatabases = resourceHistoryDatabasesResult.databases;
        while (resourceHistoryDatabases.some(d => d.db_name === resourceHistoryConfig.db_name)) { /* empty */
        }
    }
}

module.exports = {
    TestMongoDatabaseManager
};
