const {BaseScriptRunner} = require('./baseScriptRunner');
const env = require('var');
const superagent = require('superagent');

class ConfigureAuditEventOnlineArchiveRunner extends BaseScriptRunner {
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
     * @description Makes an api call to mongo to create an online archive.
     * @param {Object} config
     * @param {string} collectionName
     */
    async createCollection({config, collectionName}) {
        const data = {
            'collname': collectionName,
            'dbName': config.db_name,
            'criteria': {
                'type': 'DATE',
                'dateField': 'recorded',
            }
        };
        const headers = {
            'Content-Type': 'application/json',
            'apiKey': env.AUDIT_EVENT_API_KEY,
        };
        try {
            // Using superagent to make a post request to create a collection
            superagent
                .post(`https://cloud.mongodb.com/api/atlas/v1.0/groups/${env.AUDIT_EVENT_ONLINE_ARCHIVE_GROUPID}/clusters/${env.AUDIT_EVENT_ONLINE_ARCHIVE_CLUSTER_NAME}/onlineArchives`)
                .send(data)
                .set(headers)
                .then(res => {
                    this.adminLogger.logInfo(res);
                });
        } catch (error) {
            this.adminLogger.logError(error);
        }
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

        await Promise.all(collectionNames.map(async (collectionName) => {
            await this.createCollection({
                config: auditEventConfig,
                collectionName: collectionName
            });
        }));
    }
}

module.exports = {
    ConfigureAuditEventOnlineArchiveRunner
};
