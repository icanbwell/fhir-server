const {createContainer} = require('../../createContainer');
const {CommandLineParser} = require('./commandLineParser');
const {IndexCollectionsRunner} = require('../runners/indexCollectionsRunner');
const {AdminLogger} = require('../adminLogger');

/**
 * main function
 * @returns {Promise<void>}
 */
async function main() {
    /**
     * @type {Object}
     */
    const parameters = CommandLineParser.parseCommandLine();
    // set up all the standard services in the container
    const container = createContainer();

    /**
     * @type {string[]}
     */
    let collections = parameters.collections ? parameters.collections.split(',').map(x => x.trim()) : [];
    if (parameters.collections === 'all') {
        collections = ['all'];
    }

    // now add our class
    container.register('indexCollectionsRunner', (c) => new IndexCollectionsRunner(
        {
            indexManager: c.indexManager,
            collections: collections,
            dropIndexes: parameters.drop ? true : false,
            useAuditDatabase: parameters.audit ? true : false,
            addMissingOnly: parameters.missingOnly ? true : false,
            removeExtraOnly: parameters.extraOnly ? true : false,
            includeHistoryCollections: parameters.includeHistoryCollections ? true : false,
            adminLogger: new AdminLogger(),
            synchronizeIndexes: parameters.synchronize ? true : false,
            mongoDatabaseManager: c.mongoDatabaseManager,
            mongoCollectionManager: c.mongoCollectionManager
        }));

    /**
     * @type {IndexCollectionsRunner}
     */
    const indexCollectionsRunner = container.indexCollectionsRunner;
    await indexCollectionsRunner.processAsync();

    process.exit(0);
}

/**
 * To run this:
 * nvm use 18.14.2
 * Create .env file in root directory with these variables
 * MONGO_URL, MONGO_USERNAME, MONGO_PASSWORD, MONGO_DB_NAME
 * AUDIT_EVENT_MONGO_URL, AUDIT_EVENT_MONGO_USERNAME, AUDIT_EVENT_MONGO_PASSWORD, AUDIT_EVENT_MONGO_DB_NAME
 * Command: node -r dotenv/config src/admin/scripts/indexCollections --collections=Patient_4_0_0 --drop
 * Command: node -r dotenv/config src/admin/scripts/indexCollections --collections=all --drop
 * Command: node -r dotenv/config src/admin/scripts/indexCollections --synchronize
 * Command: node -r dotenv/config src/admin/scripts/indexCollections --missingOnly
 * Command: node -r dotenv/config src/admin/scripts/indexCollections --extraOnly
 * Command: node -r dotenv/config src/admin/scripts/indexCollections --audit --synchronize
 * Command: node -r dotenv/config src/admin/scripts/indexCollections --collections=AuditEvent_4_0_0 --drop --audit --includeHistoryCollections
 * Command: node -r dotenv/config src/admin/scripts/indexCollections --collections=AuditEvent_4_0_0 --drop --audit --includeHistoryCollections
 * collection can be a regex
 */
main().catch(reason => {
    console.error(reason);
});
