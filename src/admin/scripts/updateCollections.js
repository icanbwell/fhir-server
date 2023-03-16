// load config from .env.  Should be first thing so env vars are available to rest of the code
const path = require('path');
const dotenv = require('dotenv');
const pathToEnv = path.resolve(__dirname, '.env');
dotenv.config({
    path: pathToEnv,
});
const { logInfo } = require('../../operations/common/logging');
const { createContainer } = require('../../createContainer');
const { CommandLineParser } = require('./commandLineParser');
const moment = require('moment-timezone');
const { UpdateCollectionsRunner } = require('../runners/updateCollectionsRunner.js');
const { AdminLogger } = require('../adminLogger');

/**
 * main function
 * @returns {Promise<void>}
 */
async function main() {
    /**
     * @type {Object}
     */
    const parameters = CommandLineParser.parseCommandLine();
    const updatedAfter = parameters.updatedAfter ? new Date(`${parameters.updatedAfter}T00:00:00Z`) : new Date(2023, 3 - 1, 14);
    const readBatchSize = parameters.readBatchSize || process.env.BULK_BUFFER_SIZE || 10000;
    const writeBatchSize = parameters.writeBatchSize || process.env.BULK_BUFFER_SIZE || 10000;
    const readOnlyCertainCollections = parameters.readOnlyCertainCollections ? parameters.readOnlyCertainCollections.split(',') : undefined;
    const excludeCollection = parameters.excludeCollection ? parameters.excludeCollection.split(',') : undefined;
    console.log(`Running script to update data with last_updated greater than ${updatedAfter}`);

    // set up all the standard services in the container
    const container = createContainer();

    logInfo('Parameters', { parameters });
    // now add our class
    container.register(
        'processUpdateFhirRunner',
        (c) =>
            new UpdateCollectionsRunner({
                mongoDatabaseManager: c.mongoDatabaseManager,
                mongoCollectionManager: c.mongoCollectionManager,
                updatedAfter: moment.utc(updatedAfter),
                readBatchSize,
                writeBatchSize,
                readOnlyCertainCollections,
                excludeCollection,
                adminLogger: new AdminLogger(),
            })
    );

    /**
     * @type {PartitionAuditEventRunner}
     */
    const processUpdateFhirRunner = container.processUpdateFhirRunner;
    await processUpdateFhirRunner.processAsync();

    console.log('Exiting process');
    process.exit(0);
}

/**
 * To run this:
 * nvm use 18.14.2
 * node src/admin/scripts/updateCollections.js --updatedAfter=2023-03-14 --readbatchSize=10000 --writeBatchSize=10000
 * node src/admin/scripts/updateCollections.js --updatedAfter=2023-03-14 --readOnlyCertainCollections="value1,value2" --excludeCollection="valueX,valueY"
 */
main().catch((reason) => {
    console.error(reason);
});
