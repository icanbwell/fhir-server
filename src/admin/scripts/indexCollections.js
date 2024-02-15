const { createContainer } = require('../../createContainer');
const { CommandLineParser } = require('./commandLineParser');
const { IndexCollectionsRunner } = require('../runners/indexCollectionsRunner');
const { AdminLogger } = require('../adminLogger');

/**
 * main function
 * @returns {Promise<void>}
 */
async function main () {
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
            collections,
            dropIndexes: !!parameters.drop,
            useAuditDatabase: !!parameters.audit,
            useAccessLogsDatabase: !!parameters.accessLogs,
            addMissingIndexesOnly: !!parameters.addMissingIndexesOnly,
            removeExtraIndexesOnly: !!parameters.dropExtraIndexesOnly,
            includeHistoryCollections: !!parameters.includeHistoryCollections,
            adminLogger: new AdminLogger(),
            synchronizeIndexes: !!parameters.synchronize,
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
 * nvm use
 * Create .env file in root directory with these variables
 * MONGO_URL, MONGO_USERNAME, MONGO_PASSWORD, MONGO_DB_NAME
 * AUDIT_EVENT_MONGO_URL, AUDIT_EVENT_MONGO_USERNAME, AUDIT_EVENT_MONGO_PASSWORD, AUDIT_EVENT_MONGO_DB_NAME
 * Command: node -r dotenv/config src/admin/scripts/indexCollections --collections=Patient_4_0_0 --drop
 * Command: node -r dotenv/config src/admin/scripts/indexCollections --collections=all --drop
 * Command: node -r dotenv/config src/admin/scripts/indexCollections --synchronize
 * Command: node -r dotenv/config src/admin/scripts/indexCollections --synchronize --collections=all
 * Command: node -r dotenv/config src/admin/scripts/indexCollections --addMissingIndexesOnly
 * Command: node -r dotenv/config src/admin/scripts/indexCollections --addMissingIndexesOnly --collections=all
 * Command: node -r dotenv/config src/admin/scripts/indexCollections --dropExtraIndexesOnly
 * Command: node -r dotenv/config src/admin/scripts/indexCollections --dropExtraIndexesOnly --collections=all
 * Command: node -r dotenv/config src/admin/scripts/indexCollections --audit --synchronize
 * Command: node -r dotenv/config src/admin/scripts/indexCollections --accessLogs --synchronize
 * Command: node -r dotenv/config src/admin/scripts/indexCollections --collections=AuditEvent_4_0_0 --drop --audit --includeHistoryCollections
 * Command: node -r dotenv/config src/admin/scripts/indexCollections --collections=AuditEvent_4_0_0 --drop --audit --includeHistoryCollections
 * collection can be a regex
 */
main().catch(reason => {
    console.error(reason);
});
