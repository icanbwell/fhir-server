const {BaseScriptRunner} = require('./baseScriptRunner');

class ConfigureOnlineArchiveRunner extends BaseScriptRunner {
    constructor({
        mongoDatabaseManager,
        mongoCollectionManager,
        adminLogger,
        collections
    }) {
        super({
            mongoCollectionManager: mongoCollectionManager,
            adminLogger: adminLogger,
            mongoDatabaseManager: mongoDatabaseManager,
        });

        /**
         * @type {string [] | undefined}
         */
        this.collections = collections;
    }

    /**
     * Filter's out only auditevent collections from the list of collections passed from shell
     * @param {Object} collectionNames
     * @returns {Object}
     */
    filterAuditEventCollections(collectionNames) {
        return collectionNames.filter((name) => name.includes('AuditEvent_4_0_0'));
    }

    /**
     * Creates collection in audit event online archive with the same name as that of audit event cluster.
     */
    async processAsync() {
        // Creating a config of audit event cluster and initiating a client connection
        const auditEventConfig = await this.mongoDatabaseManager.getAuditConfigAsync();
        const auditEventClient = await this.mongoDatabaseManager.createClientAsync(auditEventConfig);
        // Creating a db instance for audit event cluster
        const auditEventDatabase = auditEventClient.db(auditEventConfig.db_name);
        this.adminLogger.logInfo(`Db instance created, database name = ${auditEventConfig.db_name} `);

        // If collection name has been passed from shell tha filter only the audit event collections
        // else get all collection names from audit event cluster database.
        const collectionNames = this.collections ?
            this.filterAuditEventCollections(this.collections) :
            await this.mongoCollectionManager.getAllCollectionNames({db: auditEventDatabase});
        this.adminLogger.logInfo(`The list of collections to be created on audit event online archive are ${collectionNames}`);

        // Creating a config of audit event online archive cluster and initiating a client connection
        const auditEventReadOnlyConfig = await this.mongoDatabaseManager.getAuditReadOnlyConfigAsync();
        const auditEventOnlineArchiveClient = await this.mongoDatabaseManager.createClientAsync(auditEventReadOnlyConfig);
        // Creating a db instance for audit event online archive cluster
        const auditEventReadOnlyDatabase = auditEventOnlineArchiveClient.db(auditEventReadOnlyConfig.db_name);
        this.adminLogger.logInfo(`Db instance created, database name = ${auditEventReadOnlyDatabase.db_name} `);

        for (const collectionName of collectionNames) {
            this.adminLogger.logInfo(`For ${collectionName} collection will be created if it does not exist`);
            await this.mongoCollectionManager.getOrCreateCollectionAsync({
                db: auditEventReadOnlyDatabase,
                collectionName: collectionName
            });
        }
    }
}

module.exports = {
    ConfigureOnlineArchiveRunner
};
