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
const moment = require('moment-timezone');
const {PartitionAuditEventRunner} = require('../runners/partitionAuditEventRunner');
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
    let currentDateTime = new Date();
    const recordedAfter = parameters.from ? new Date(`${parameters.from}T00:00:00Z`) : new Date(2021, 6 - 1, 1);
    const recordedBefore = parameters.to ? new Date(`${parameters.to}T00:00:00Z`) : new Date(2022, 10 - 1, 1);
    const batchSize = parameters.batchSize || process.env.BULK_BUFFER_SIZE || 10000;
    console.log(`[${currentDateTime}] ` +
        `Running script from ${recordedAfter.toUTCString()} to ${recordedBefore.toUTCString()}`);

    // set up all the standard services in the container
    const container = createContainer();

    console.log(`Parameters: ${JSON.stringify(parameters)}`);
    // now add our class
    container.register('processAuditEventRunner', (c) => new PartitionAuditEventRunner(
            {
                mongoCollectionManager: c.mongoCollectionManager,
                recordedAfter: moment.utc(recordedAfter),
                recordedBefore: moment.utc(recordedBefore),
                batchSize,
                skipExistingIds: parameters.skipExistingIds ? true : false,
                useAuditDatabase: parameters.audit ? true : false,
                dropDestinationIfCountIsDifferent: parameters.dropDestinationIfCountIsDifferent ? true : false,
                adminLogger: new AdminLogger()
            }
        )
    );

    /**
     * @type {PartitionAuditEventRunner}
     */
    const processAuditEventRunner = container.processAuditEventRunner;
    await processAuditEventRunner.processAsync();

    console.log('Exiting process');
    process.exit(0);
}

/**
 * To run this:
 * nvm use 16.17.1
 * node src/admin/scripts/partitionAuditEvent.js --from=2022-08-01 --to=2022-09-01 --batchSize=10000 --skipExistingIds
 * node src/admin/scripts/partitionAuditEvent.js --from=2022-08-01 --to=2022-09-01 --audit --batchSize=10000 --skipExistingIds
 * node src/admin/scripts/partitionAuditEvent.js --from=2022-08-01 --to=2022-09-01 --audit --batchSize=10000 --skipExistingIds --dropDestinationIfCountIsDifferent
 */
main().catch(reason => {
    console.error(reason);
});
