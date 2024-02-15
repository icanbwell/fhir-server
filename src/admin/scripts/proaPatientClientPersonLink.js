// load config from .env.  Should be first thing so env vars are available to rest of the code
const path = require('path');
const dotenv = require('dotenv');
const pathToEnv = path.resolve(__dirname, '.env');
dotenv.config({
    path: pathToEnv
});
console.log(`Reading config from ${pathToEnv}`);
console.log(`MONGO_URL=${process.env.MONGO_URL}`);
const { createContainer } = require('../../createContainer');
const { CommandLineParser } = require('./commandLineParser');
const { AdminLogger } = require('../adminLogger');
const { ProaPatientClientPersonLinkRunner } = require('../runners/proaPatientClientPersonLinkRunner');

/**
 * main function
 * @returns {Promise<void>}
 */
async function main() {
    /**
     * @type {Object}
     */
    const parameters = CommandLineParser.parseCommandLine();
    const currentDateTime = new Date();
    const batchSize = parameters.batchSize || process.env.BULK_BUFFER_SIZE || 10000;

    /**
     * @type {Date|undefined}
     */
    const afterLastUpdatedDate = parameters.after ? new Date(parameters.after) : undefined;

    /**
     * @type {Date|undefined}
     */
    const beforeLastUpdatedDate = parameters.before ? new Date(parameters.before) : undefined;

    /**
     * @type {string[]}
     */
    const clientSourceAssigningAuthorities = parameters.clientSourceAssigningAuthorities ?
        parameters.clientSourceAssigningAuthorities.split(',') :
        ['bwell_demo'];

    const adminLogger = new AdminLogger();

    adminLogger.logInfo(`[${currentDateTime}] Running proaPatientClientPersonLink script`);

    // set up all the standard services in the container
    const container = createContainer();

    // now add our class
    container.register('proaPatientClientPersonLinkRunner', (c) => new ProaPatientClientPersonLinkRunner(
        {
            personMatchManager: c.personMatchManager,
            mongoCollectionManager: c.mongoCollectionManager,
            mongoDatabaseManager: c.mongoDatabaseManager,
            preSaveManager: c.preSaveManager,
            batchSize,
            databaseQueryFactory: c.databaseQueryFactory,
            resourceLocatorFactory: c.resourceLocatorFactory,
            resourceMerger: c.resourceMerger,
            afterLastUpdatedDate,
            beforeLastUpdatedDate,
            adminLogger,
            limit: parameters.limit,
            useTransaction: parameters.useTransaction ? true : false,
            skip: parameters.skip,
            linkClientPersonToProaPatient: parameters.linkClientPersonToProaPatient ? true : false,
            connectionType: parameters.connectionType || 'proa',
            getPersonMatchingScore: parameters.getPersonMatchingScore ? true : false,
            clientSourceAssigningAuthorities
        }
    )
    );

    /**
     * @type {ProaPatientClientPersonLinkRunner}
     */
    const proaPatientClientPersonLinkRunner = container.proaPatientClientPersonLinkRunner;
    await proaPatientClientPersonLinkRunner.processAsync();

    adminLogger.logInfo('Exiting process');
    process.exit(0);
}

/**
 * To run this:
 * nvm use
 * node src/admin/scripts/proaPatientClientPersonLink.js
 * node src/admin/scripts/proaPatientClientPersonLink.js --linkClientPersonToProaPatient --connectionType=humanapi --getPersonMatchingScore
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/proaPatientClientPersonLink.js --batchSize=10000 --after 2021-12-31
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/proaPatientClientPersonLink.js --batchSize=10000 --before 2021-12-31
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/proaPatientClientPersonLink.js --limit 10
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/proaPatientClientPersonLink.js --useTransaction
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/proaPatientClientPersonLink.js --skip 200000
 */
main().catch(reason => {
    console.error(reason);
});
