// load config from .env.  Should be first thing so env vars are available to rest of the code
const path = require('path');
const dotenv = require('dotenv');
const pathToEnv = path.resolve(__dirname, '.env');
dotenv.config({
    path: pathToEnv
});
console.log(`Reading config from ${pathToEnv}`);
console.log(`MONGO_URL=${process.env.MONGO_URL}`);
console.log(`AUDIT_EVENT_MONGO_URL=${process.env.AUDIT_EVENT_MONGO_URL}`);
const {createContainer} = require('../../createContainer');
const {CommandLineParser} = require('./commandLineParser');
const {AdminLogger} = require('../adminLogger');
const {RunPreSaveRunner} = require('../runners/runPreSaveRunner');

/**
 * main function
 * @returns {Promise<void>}
 */
async function main() {
    /**
     * @type {Object}
     */
    const parameters = CommandLineParser.parseCommandLine();
    let currentDateTime = new Date();
    /**
     * @type {string[]}
     */
    let collections = parameters.collections ? parameters.collections.split(',').map(x => x.trim()) : [];
    if (parameters.collections === 'all') {
        collections = ['all'];
    }
    const batchSize = parameters.batchSize || process.env.BULK_BUFFER_SIZE || 10000;
    /**
     * @type {Date|undefined}
     */
    const beforeLastUpdatedDate = parameters.before ? new Date(parameters.before) : undefined;
    console.log(`[${currentDateTime}] ` +
        `Running script for collections: ${collections.join(',')}`);

    // set up all the standard services in the container
    const container = createContainer();

    // now add our class
    container.register('runPreSaveRunner', (c) => new RunPreSaveRunner(
            {
                mongoCollectionManager: c.mongoCollectionManager,
                collections: collections,
                batchSize,
                beforeLastUpdatedDate,
                useAuditDatabase: parameters.audit ? true : false,
                adminLogger: new AdminLogger(),
                mongoDatabaseManager: c.mongoDatabaseManager,
                preSaveManager: c.preSaveManager,
            }
        )
    );

    /**
     * @type {RunPreSaveRunner}
     */
    const runPreSaveRunner = container.runPreSaveRunner;
    await runPreSaveRunner.processAsync();

    console.log('Exiting process');
    process.exit(0);
}

/**
 * To run this:
 * nvm use 18.14.0
 * node src/admin/scripts/runPreSave.js --collections=Practitioner_4_0_0 --batchSize=10000
 * node src/admin/scripts/runPreSave.js --collections=all --batchSize=10000
 * node src/admin/scripts/runPreSave.js --collections=Account_4_0_0 --batchSize=10000
 * node src/admin/scripts/runPreSave.js --collections=all --audit --batchSize=10000
 * node src/admin/scripts/runPreSave.js --collections=AuditEvent_4_0_0 --audit --batchSize=10000
 * node src/admin/scripts/runPreSave.js --collections=AuditEvent_4_0_0 --audit --batchSize=10000 --before 2021-12-31
 */
main().catch(reason => {
    console.error(reason);
});
