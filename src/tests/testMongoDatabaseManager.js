const {MongoDatabaseManager} = require('../utils/mongoDatabaseManager');

class TestMongoDatabaseManager extends MongoDatabaseManager {
    getClientConfig() {
        return {
            connection: global.__MONGO_URI__, // set by https://github.com/shelfio/jest-mongodb
            db_name: 'fhir',
            options: {}
        };
    }

    getAuditConfig() {
        return {
            connection: global.__MONGO_URI__,
            db_name: 'audit-event',
            options: {}
        };
    }

    async dropDatabasesAsync() {
        const db = await this.getClientDbAsync();
        await db.dropDatabase();

        const auditDb = await this.getAuditDbAsync();
        await auditDb.dropDatabase();

        // check if database is done
        const clientConfig = this.getClientConfig();
        const client = await this.createClientAsync(clientConfig);

        /**
         * @type {import('mongo').ListDatabasesResult}
         */
        const databasesResult = await client.db().admin().listDatabases();
        const databases = databasesResult.databases;
        while (databases.some(d => d.db_name === clientConfig.db_name)) { /* empty */
        }

        // check if audit database is gone
        const auditConfig = this.getAuditConfig();
        const auditEventClient = await this.createClientAsync(auditConfig);
        /**
         * @type {import('mongo').ListDatabasesResult}
         */
        const auditDatabasesResult = await auditEventClient.db().admin().listDatabases();
        const auditDatabases = auditDatabasesResult.databases;
        while (auditDatabases.some(d => d.db_name === auditConfig.db_name)) { /* empty */
        }
    }
}

module.exports = {
    TestMongoDatabaseManager
};
