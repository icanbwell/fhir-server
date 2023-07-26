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
    const batchSize = parameters.batchSize || process.env.BULK_BUFFER_SIZE || 1000;
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
            batchSize: batchSize,
            accessCode: accessCode,
            beforeDate: beforeDate,
            outputFile: outputFile
        }));

    /**
     * @type {DumpPersonsRunner}
     */
    const dumpPersonsRunner = container.dumpPersonsRunner;
    await dumpPersonsRunner.processAsync();

    process.exit(0);
}

/**
 * To run this:
 * If running the script using EC2, the command will be: node -r dotenv/config src/admin/scripts/dumpPersons.js
 * Required env variables:
 * MONGO_URL, MONGO_USERNAME, MONGO_PASSWORD, MONGO_DB_NAME(default: fhir)
 * node src/admin/scripts/dumpPersons.js
 * node src/admin/scripts/dumpPersons.js --beforeDate=2023-04-22T00:00:00Z --accessCode=bWell --batchSize=1000 --outputFile=dump.json
 */
main().catch(reason => {
    console.error(reason);
});