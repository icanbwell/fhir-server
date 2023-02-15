// load config from .env.  Should be first thing so env vars are available to rest of the code
const path = require('path');
const dotenv = require('dotenv');
const pathToEnv = path.resolve(__dirname, '.env');
dotenv.config({
    path: pathToEnv
});
const {createContainer} = require('../../createContainer');
const {CommandLineParser} = require('./commandLineParser');
const {AdminLogger} = require('../adminLogger');
const {RemoveBadRecordsRunner} = require('../runners/removeBadRecordsRunner');

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
    container.register('removeBadRecordsRunner', (c) => new RemoveBadRecordsRunner(
        {
            indexManager: c.indexManager,
            collections: collections,
            useAuditDatabase: parameters.audit ? true : false,
            includeHistoryCollections: parameters.includeHistoryCollections ? true : false,
            adminLogger: new AdminLogger(),
            mongoDatabaseManager: c.mongoDatabaseManager,
            mongoCollectionManager: c.mongoCollectionManager
        }));

    /**
     * @type {RemoveBadRecordsRunner}
     */
    const removeBadRecordsRunner = container.removeBadRecordsRunner;
    await removeBadRecordsRunner.processAsync();

    process.exit(0);
}

/**
 * To run this:
 * nvm use 18.14.0
 * node src/admin/scripts/removeBadRecords --collections=Patient_4_0_0
 * node src/admin/scripts/removeBadRecords --collections=all
 * node src/admin/scripts/removeBadRecords --collections=AuditEvent_4_0_0 --audit --includeHistoryCollections
 * node src/admin/scripts/removeBadRecords --collections=AuditEvent_4_0_0 --audit --includeHistoryCollections
 * collection can be a regex
 */
main().catch(reason => {
    console.error(reason);
});
