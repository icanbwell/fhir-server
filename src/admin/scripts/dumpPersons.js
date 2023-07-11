const {createContainer} = require('../../createContainer');
const {CommandLineParser} = require('./commandLineParser');
const {AdminLogger} = require('../adminLogger');
const {DumpPersonsRunner} = require('../runners/dumpPersonsRunner');

/**
 * main function
 * @returns {Promise<void>}
 */
async function main() {
    /**
     * @type {Object}
     */
    const parameters = CommandLineParser.parseCommandLine();
    const batchSize = parameters.batchSize || process.env.BULK_BUFFER_SIZE || 100;
    const accessCode = parameters.accessCode;
    const beforeDate = parameters.beforeDate;
    const outputFile = parameters.outputFile;
    // set up all the standard services in the container
    const container = createContainer();
    console.log(parameters);
    /**
     * @type {string[]}
     */

    // now add our class
    container.register('dumpPersonsRunner', (c) => new DumpPersonsRunner(
        {
            adminLogger: new AdminLogger(),
            mongoDatabaseManager: c.mongoDatabaseManager,
            mongoCollectionManager: c.mongoCollectionManager,
            limit: parameters.limit,
            skip: parameters.skip,
            batchSize: batchSize,
            accessCode: accessCode,
            beforeDate: beforeDate,
            outputFile: outputFile
        }));

    /**
     * @type {RemoveBadRecordsRunner}
     */
    const dumpPersonsRunner = container.dumpPersonsRunner;
    await dumpPersonsRunner.processAsync();

    process.exit(0);
}

/**
 * To run this:
 * If running the script using EC2, the command will be: node -r dotenv/config src/admin/scripts/dumpPersons
 * Required env variables:
 * MONGO_URL, MONGO_USERNAME, MONGO_PASSWORD, MONGO_DB_NAME(default: fhir)
 * node src/admin/scripts/dumpPersons
 * node src/admin/scripts/dumpPersons --uuidGreaterThan="60185667-f6c5-5534-8980-90448606be94"
 * node src/admin/scripts/removeDuplicatePersonLinks --minLinks=2 --limit=10 --batchSize=1000
 * node src/admin/scripts/removeDuplicatePersonLinks --ownerCode="bwell"
 * node src/admin/scripts/removeDuplicatePersonLinks --personUuids="60185667-f6c5-5534-8980-90448606be94,f31e6f0a-a0fc-500d-8e6a-e017d633391d"
 */
main().catch(reason => {
    console.error(reason);
});
