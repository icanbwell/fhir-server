const {createContainer} = require('../../createContainer');
const {CommandLineParser} = require('./commandLineParser');
const {AdminLogger} = require('../adminLogger');
const {RemoveDuplicatePersonLinkRunner} = require('../runners/removeDuplicatePersonLinkRunner');

/**
 * main function
 * @returns {Promise<void>}
 */
async function main() {
    /**
     * @type {Object}
     */
    const parameters = CommandLineParser.parseCommandLine();
    const maximumLinkSize = parameters.maximumLinkSize ? parseInt(parameters.maximumLinkSize) : 10;
    const personUuids = parameters.personUuids ? parameters.personUuids.split(',') : undefined;
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
            maximumLinkSize: maximumLinkSize,
            personUuids: personUuids
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
 * Required env variables:
 * MONGO_URL, MONGO_USERNAME, MONGO_PASSWORD, MONGO_DB_NAME(default: fhir)
 * node src/admin/scripts/removeDuplicatePersonLinks
 * node src/admin/scripts/removeDuplicatePersonLinks --maximumLinkSize=2
 * node src/admin/scripts/removeDuplicatePersonLinks --personUuids="60185667-f6c5-5534-8980-90448606be94,f31e6f0a-a0fc-500d-8e6a-e017d633391d"
 */
main().catch(reason => {
    console.error(reason);
});
