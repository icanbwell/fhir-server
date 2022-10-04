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
        db.dropDatabase();
        const auditDb = await this.getAuditDbAsync();
        auditDb.dropDatabase();
    }
}

module.exports = {
    TestMongoDatabaseManager
};
