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
const { createContainer } = require('../../createContainer');
const { CommandLineParser } = require('./commandLineParser');
const { AdminLogger } = require('../adminLogger');
const { FixReferenceIdRunner } = require('../runners/fixReferenceIdRunner');

const proaResources = [
    'AllergyIntolerance', 'Claim', 'ClaimResponse', 'Communication', 'Condition', 'Coverage',
    'Encounter', 'EnrollmentRequest', 'ExplanationOfBenefit',
    'FamilyMemberHistory', 'Flag', 'Immunization', 'Location', 'MedicationDispense', 'MedicationRequest',
    'MedicationStatement', 'Observation', 'Organization', 'Patient',
    'Person', 'Practitioner', 'PractitionerRole', 'Procedure'
];

/**
 * main function
 * @returns {Promise<void>}
 */
async function main () {
    /**
     * @type {Object}
     */
    const parameters = CommandLineParser.parseCommandLine();
    const currentDateTime = new Date();
    /**
     * @type {string[]}
     */
    const collections = parameters.collections
        ? parameters.collections.split(',').map(x => x.trim())
        : ['all'];

    const proaCollections = parameters.proaCollections
        ? parameters.proaCollections.split(',').map(x => x.trim()) : [
            ...proaResources.map(collection => `${collection}_4_0_0`),
            ...proaResources.map(collection => `${collection}_4_0_0_History`)
        ];

    const properties = parameters.properties
        ? parameters.properties.split(',').map(x => x.trim())
        : undefined;

    const filterToRecordsWithFields = parameters.filterToRecordsWithFields
        ? parameters.filterToRecordsWithFields.split(',').map(x => x.trim())
        : undefined;

    const batchSize = parameters.batchSize || process.env.BULK_BUFFER_SIZE || 10000;
    /**
     * @type {Date|undefined}
     */
    const afterLastUpdatedDate = parameters.after ? new Date(parameters.after) : undefined;

    /**
     * @type {Date|undefined}
     */
    const beforeLastUpdatedDate = parameters.before ? new Date(parameters.before) : undefined;

    const adminLogger = new AdminLogger();

    adminLogger.logInfo(`[${currentDateTime}] Running script for collections: ${proaCollections.join(',')}`);

    // set up all the standard services in the container
    const container = createContainer();

    // now add our class
    container.register('fixReferenceIdRunner', (c) => new FixReferenceIdRunner(
            {
                collections,
                batchSize,
                referenceBatchSize: parameters.referenceBatchSize,
                collectionConcurrency: parameters.collectionConcurrency,
                afterLastUpdatedDate,
                beforeLastUpdatedDate,
                adminLogger,
                mongoDatabaseManager: c.mongoDatabaseManager,
                preSaveManager: c.preSaveManager,
                databaseQueryFactory: c.databaseQueryFactory,
                startFromCollection: parameters.startFromCollection,
                resourceLocatorFactory: c.resourceLocatorFactory,
                proaCollections,
                limit: parameters.limit,
                properties,
                resourceMerger: c.resourceMerger,
                useTransaction: !!parameters.useTransaction,
                skip: parameters.skip,
                filterToRecordsWithFields,
                startFromId: parameters.startFromId,
                searchParametersManager: c.searchParametersManager
            }
        )
    );

    /**
     * @type {FixReferenceIdRunner}
     */
    const fixReferenceIdRunner = container.fixReferenceIdRunner;
    await fixReferenceIdRunner.processAsync();

    adminLogger.logInfo('Exiting process');
    process.exit(0);
}

/**
 * To run this:
 * nvm use
 * node src/admin/scripts/fixReferenceId.js --collections=Practitioner_4_0_0 --batchSize=10000 --referenceBatchSize=50 --collectionConcurrency=3
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/fixReferenceId.js --collections=all --batchSize=10000
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/fixReferenceId.js --collections=all --batchSize=10000 --startFromCollection FamilyMemberHistory_4_0_0
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/fixReferenceId.js --collections=Person_4_0_0 --batchSize=10000 --proaCollections=Person_4_0_0,Patient_4_0_0
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/fixReferenceId.js --collections=Person_4_0_0 --batchSize=10000 --proaCollections=Person_4_0_0,Patient_4_0_0 --useTransaction
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/fixReferenceId.js --collections=Person_4_0_0 --batchSize=10000 --useTransaction --filterToRecordsWithFields link
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/fixReferenceId.js --collections=Person_4_0_0 --batchSize=10000 --useTransaction --filterToRecordsWithFields link --startFromId=123
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/fixReferenceId.js --collections=Person_4_0_0 --batchSize=10000 --useTransaction --skip 200000
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/fixReferenceId.js --collections=Person_4_0_0 --batchSize=10000 --limit 10
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/fixReferenceId.js --collections=Person_4_0_0 --batchSize=10000 --limit 10 --properties link
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/fixReferenceId.js --collections=all --batchSize=10000 --after 2021-12-31
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/fixReferenceId.js --collections=all --batchSize=10000 --before 2021-12-31
 * node src/admin/scripts/fixReferenceId.js --collections=Account_4_0_0 --batchSize=10000
 */
main().catch(reason => {
    console.error(reason);
});
