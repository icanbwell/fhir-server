const {MongoDatabaseManager} = require('../utils/mongoDatabaseManager');

class TestMongoDatabaseManager extends MongoDatabaseManager {
    getClientConfig() {
        return {
            connection: process.env.MONGO_URL,
            db_name: 'fhir',
            options: {}
        };
    }

    getAuditConfig() {
        return {
            connection: process.env.MONGO_URL,
            db_name: 'audit-event',
            options: {}
        };
    }

    async dropDatabasesAsync() {
        const db = await this.getClientDbAsync();
        await db.dropDatabase();
        const auditDb = await this.getAuditDbAsync();
        await auditDb.dropDatabase();
    }
}

module.exports = {
    TestMongoDatabaseManager
};
