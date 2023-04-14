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
            url: env.AUDIT_EVENT_ONLINE_ARCHIVE_MANAGEMENT_API,
            auth: {
                user: env.ONLINE_ARCHIVE_AUTHENTICATION_PUBLIC_KEY,
                pass: env.ONLINE_ARCHIVE_AUTHENTICATION_PRIVATE_KEY,
                sendImmediately: false
            },
            headers: headers,
            json: data
        };
        return new Promise((resolve, reject) => {
            // eslint-disable-next-line no-unused-vars
            request(options, (error, response, body) => {
                if (response.statusCode === 200) {
                    resolve(response);
                } else {
                    reject(response);
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
        const allCollectionNames = this.collections ?
            this.collections :
            await this.mongoCollectionManager.getAllCollectionNames({db: auditEventDatabase});

        const collectionNames = this.filterAuditEventCollections(allCollectionNames);
        this.adminLogger.logInfo(`The list of collections to be created on audit event online archive are ${collectionNames}`);

        for (const collectionName of collectionNames) {
            await this.createCollection({
                config: auditEventConfig,
                collectionName: collectionName
            }).then((resp) => {
                this.adminLogger.logInfo(`Collection - ${collectionName} , _id - ${resp.body._id}`);
            }).catch((resp) => {
                if (resp.statusCode === 409) {
                    this.adminLogger.logError(`Collection-${collectionName}, Error-${resp.body.errorCode}`);
                } else {
                    this.adminLogger.logError(`Collection-${collectionName}, Error-${JSON.stringify(resp.body)}`);
                }
            });
        }
    }
}

module.exports = {
    ConfigureAuditEventOnlineArchiveRunner
};
