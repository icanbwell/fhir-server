// load config from .env.  Should be first thing so env vars are available to rest of the code
const path = require('path');
const dotenv = require('dotenv');
const pathToEnv = path.resolve(__dirname, '.env');
dotenv.config({
    path: pathToEnv
});
console.log(`Reading config from ${pathToEnv}`);
console.log(`AUDIT_EVENT_MONGO_URL=${process.env.AUDIT_EVENT_MONGO_URL}`);
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

    // now add our class
    container.register('indexCollectionsRunner', (c) => new IndexCollectionsRunner(
        {
            indexManager: c.indexManager,
            collections: parameters.collections,
            dropIndexes: parameters.drop,
            useAuditDatabase: parameters.audit ? true : false,
            includeHistoryCollections: parameters.includeHistoryCollections ? true : false,
            adminLogger: new AdminLogger(),
            synchronizeIndexes: parameters.synchronize ? true : false,
            mongoDatabaseManager: c.mongoDatabaseManager,
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
 * nvm use 16.17.1
 * node src/admin/scripts/indexCollections --collection=Patient_4_0_0 --drop
 * node src/admin/scripts/indexCollections --collections=all
 * node src/admin/scripts/indexCollections --synchronize
 * node src/admin/scripts/indexCollections --audit --synchronize
 * node src/admin/scripts/indexCollections --collections=AuditEvent_4_0_0 --drop --audit --includeHistoryCollections
 * node src/admin/scripts/indexCollections --collections=AuditEvent_4_0_0 --drop --audit --includeHistoryCollections
 * collection can be a regex
 */
main().catch(reason => {
    console.error(reason);
});
