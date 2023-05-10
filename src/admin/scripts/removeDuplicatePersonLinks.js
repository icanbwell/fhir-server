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
    let maximumLinkSize = parameters.maximumLinkSize ? parseInt(parameters.maximumLinkSize) : 10;
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
            maximumLinkSize: maximumLinkSize
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
 */
main().catch(reason => {
    console.error(reason);
});
