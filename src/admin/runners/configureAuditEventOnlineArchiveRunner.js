const { BaseScriptRunner } = require('./baseScriptRunner');
const env = require('var');
const { RequestWithDigestAuth } = require('../../utils/digestAuth');
const ARCHIVE_DEFAULT_EXPIRE_AFTER_DAYS = 60;

class ConfigureAuditEventOnlineArchiveRunner extends BaseScriptRunner {
    constructor({
        mongoDatabaseManager,
        mongoCollectionManager,
        adminLogger,
        collections,
        expireAfterDays
    }) {
        super({
            mongoCollectionManager: mongoCollectionManager,
            adminLogger: adminLogger,
            mongoDatabaseManager: mongoDatabaseManager
        });

        /**
         * @type {string [] | undefined}
         */
        this.collections = collections;
        /**
         * @type {number}
         */
        this.expireAfterDays = expireAfterDays || ARCHIVE_DEFAULT_EXPIRE_AFTER_DAYS;
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
     * @return {Promise<import('superagent').Response>}
     * @throws {Error | import('superagent').Response}
     */
    async createCollection({ config, collectionName }) {
        const data = {
            collName: collectionName,
            dbName: config.db_name,
            criteria: {
                type: 'DATE',
                dateField: 'recorded',
                dateFormat: 'ISODATE',
                expireAfterDays: this.expireAfterDays
            },
            partitionFields: [
                {
                    fieldName: 'recorded',
                    order: 0
                }
            ]
        };
        const headers = {
            'Content-Type': 'application/json',
            // version number is required
            'Accept': 'application/vnd.atlas.2023-02-01+json'
        };

        const digestRequest = new RequestWithDigestAuth({
            username: env.ONLINE_ARCHIVE_AUTHENTICATION_PUBLIC_KEY,
            password: env.ONLINE_ARCHIVE_AUTHENTICATION_PRIVATE_KEY
        });
        const response = await digestRequest.request({
            method: 'post',
            url: env.AUDIT_EVENT_ONLINE_ARCHIVE_MANAGEMENT_API,
            headers,
            data
        });
        if (response.status !== 200) {
            throw response;
        }
        return response;
    }

    /**
     * Creates collection in audit event online archive with the same name as that of audit event cluster.
     */
    async processAsync() {
        // Creating a config of audit event cluster and initiating a client connection
        const auditEventConfig = await this.mongoDatabaseManager.getAuditConfigAsync();
        const auditEventClient =
            await this.mongoDatabaseManager.createClientAsync(auditEventConfig);
        // Creating a db instance for audit event cluster
        const auditEventDatabase = auditEventClient.db(auditEventConfig.db_name);
        await this.adminLogger.logInfo(
            `Db instance created, database name = ${auditEventConfig.db_name} `
        );

        // If collection name has been passed from shell tha filter only the audit event collections
        // else get all collection names from audit event cluster database.
        const allCollectionNames = this.collections ? this.collections : await this.mongoCollectionManager.getAllCollectionNames({ db: auditEventDatabase });

        const collectionNames = this.filterAuditEventCollections(allCollectionNames);
        await this.adminLogger.logInfo(
            `The list of collections to be created on audit event online archive are ${collectionNames}`
        );

        for (const collectionName of collectionNames) {
            await this.createCollection({
                config: auditEventConfig,
                collectionName: collectionName
            })
                .then((resp) => {
                    this.adminLogger.logInfo(
                        `Collection - ${collectionName} , _id - ${resp.body._id}`
                    );
                })
                .catch((resp) => {
                    const responseBody = resp?.body || resp?.response?.body || resp;
                    const status = resp?.status || resp.response.status;
                    this.adminLogger.logError(
                        `Collection-${collectionName}, ${status ? `Status: ${status}` : ''} Error-${JSON.stringify(responseBody)}`
                    );
                });
        }
    }
}

module.exports = {
    ConfigureAuditEventOnlineArchiveRunner
};
