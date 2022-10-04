const {mongoConfig, auditEventMongoConfig} = require('../config');
const globals = require('../globals');
const {CLIENT_DB, AUDIT_EVENT_CLIENT_DB} = require('../constants');

class MongoDatabaseManager {
    /**
     * Gets client db
     * @returns {Promise<import('mongodb').Db>}
     */
    async getClientDbAsync() {
        return globals.get(CLIENT_DB);
    }

    /**
     * Gets audit db
     * @returns {Promise<import('mongodb').Db>}
     */
    async getAuditDbAsync() {
        return globals.get(AUDIT_EVENT_CLIENT_DB);
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
}

module.exports = {
    MongoDatabaseManager
};
