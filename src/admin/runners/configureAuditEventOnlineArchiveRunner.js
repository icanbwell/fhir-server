const {BaseScriptRunner} = require('./baseScriptRunner');
const env = require('var');
const request = require('request');

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
     * @return {Promise}
     */
    createCollection({config, collectionName}) {
        const data = {
            'collName': collectionName,
            'dbName': config.db_name,
            'criteria': {
                'type': 'DATE',
                'dateField': 'recorded',
                'dateFormat': 'ISODATE',
                'expireAfterDays': 90,
            }
        };
        const headers = {
            'Content-Type': 'application/json'
        };
        const options = {
            method: 'POST',
            url: `https://cloud.mongodb.com/api/atlas/v1.0/groups/${env.AUDIT_EVENT_ONLINE_ARCHIVE_GROUPID}/clusters/${env.AUDIT_EVENT_ONLINE_ARCHIVE_CLUSTER_NAME}/onlineArchives`,
            auth: {
                user: env.PUBLIC_KEY,
                pass: env.PRIVATE_KEY,
                sendImmediately: false
            },
            headers: headers,
            json: data
        };
        return new Promise((resolve, reject) => {
            // eslint-disable-next-line no-unused-vars
            request(options, (error, response, body) => {
                if (response.statusCode !== 200) {
                    reject(response);
                } else {
                    resolve(response);
                }
            });
        });
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

        for (const collectionName of collectionNames) {
            await this.createCollection({
                config: auditEventConfig,
                collectionName: collectionName
            }).then((resp) => {
                this.adminLogger.logInfo(`Collection ${collectionName} created`);
                this.adminLogger.logInfo(`The payload returned is ${JSON.stringify(resp.body)}`);
            }).catch((resp) => {
                this.adminLogger.logError(`Failed to create collection ${collectionName}.`);
                this.adminLogger.logError(`Error status code ${resp.statusCode}`);
                this.adminLogger.logError(`The payload returned is ${JSON.stringify(resp.body)}`);
            });
        }
    }
}

module.exports = {
    ConfigureAuditEventOnlineArchiveRunner
};
