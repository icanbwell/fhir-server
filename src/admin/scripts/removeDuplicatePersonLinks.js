const path = require('path');
const dotenv = require('dotenv');
const pathToEnv = path.resolve(__dirname, '.env');
dotenv.config({
    path: pathToEnv
});
const { createContainer } = require('../../createContainer');
const { CommandLineParser } = require('./commandLineParser');
const { AdminLogger } = require('../adminLogger');
const { RemoveDuplicatePersonLinkRunner } = require('../runners/removeDuplicatePersonLinkRunner');

/**
 * main function
 * @returns {Promise<void>}
 */
async function main () {
    /**
     * @type {Object}
     */
    const parameters = CommandLineParser.parseCommandLine();
    const batchSize = parameters.batchSize || process.env.BULK_BUFFER_SIZE || 10000;
    const personUuids = parameters.personUuids ? parameters.personUuids.split(',') : undefined;
    const ownerCode = parameters.ownerCode ? parameters.ownerCode : undefined;
    const uuidGreaterThan = parameters.uuidGreaterThan ? parameters.uuidGreaterThan : undefined;
    // set up all the standard services in the container
    const container = createContainer();

    /**
     * @type {string[]}
     */

    // now add our class
    container.register('removeDuplicatePersonLinkRunner', (c) => new RemoveDuplicatePersonLinkRunner(
        {
            adminLogger: new AdminLogger(),
            mongoDatabaseManager: c.mongoDatabaseManager,
            mongoCollectionManager: c.mongoCollectionManager,
            preSaveManager: c.preSaveManager,
            personUuids,
            limit: parameters.limit,
            skip: parameters.skip,
            batchSize,
            ownerCode,
            uuidGreaterThan
        }));

    /**
     * @type {RemoveBadRecordsRunner}
     */
    const removeDuplicatePersonLinkRunner = container.removeDuplicatePersonLinkRunner;
    await removeDuplicatePersonLinkRunner.processAsync();

    process.exit(0);
}

/**
 * To run this:
 * If running the script using EC2, the command will be: node -r dotenv/config src/admin/scripts/removeDuplicatePersonLinks
 * Required env variables:
 * MONGO_URL, MONGO_USERNAME, MONGO_PASSWORD, MONGO_DB_NAME(default: fhir)
 * node src/admin/scripts/removeDuplicatePersonLinks
 * node src/admin/scripts/removeDuplicatePersonLinks --uuidGreaterThan="60185667-f6c5-5534-8980-90448606be94"
 * node src/admin/scripts/removeDuplicatePersonLinks --limit=10 --batchSize=1000
 * node src/admin/scripts/removeDuplicatePersonLinks --ownerCode="bwell"
 * node src/admin/scripts/removeDuplicatePersonLinks --personUuids="60185667-f6c5-5534-8980-90448606be94,f31e6f0a-a0fc-500d-8e6a-e017d633391d"
 */
main().catch(reason => {
    console.error(reason);
});
