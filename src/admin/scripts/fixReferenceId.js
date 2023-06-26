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
const {FixReferenceIdRunner} = require('../runners/fixReferenceIdRunner');

const proaResources = [
    'Patient', 'Encounter', 'Condition', 'Procedure', 'Claim', 'EnrollmentRequest',
    'Observation', 'AllergyIntolerance', 'ClaimResponse', 'ClinicalImpression',
    'DetectedIssue', 'EnrollmentResponse', 'FamilyMemberHistory', 'PaymentNotice',
    'PaymentReconciliation', 'RiskAssessment', 'ExplanationOfBenefit', 'Person'
];

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
    let collections = parameters.collections ?
        parameters.collections.split(',').map(x => x.trim()) :
        [];

    let proaCollections = parameters.proaCollections ?
        parameters.proaCollections.split(',').map(x => x.trim()) : [
            ...proaResources.map(collection => `${collection}_4_0_0`),
            ...proaResources.map(collection => `${collection}_4_0_0_History`)
        ];

    let properties = parameters.properties ?
        parameters.properties.split(',').map(x => x.trim()) :
        undefined;

    let filterToRecordsWithFields = parameters.filterToRecordsWithFields ?
        parameters.filterToRecordsWithFields.split(',').map(x => x.trim()) :
        undefined;

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

    adminLogger.logInfo(`[${currentDateTime}] Running script for collections: ${collections.join(',')}`);

    // set up all the standard services in the container
    const container = createContainer();

    // now add our class
    container.register('fixReferenceIdRunner', (c) => new FixReferenceIdRunner(
            {
                mongoCollectionManager: c.mongoCollectionManager,
                collections,
                batchSize,
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
                useTransaction: parameters.useTransaction ? true : false,
                skip: parameters.skip,
                filterToRecordsWithFields,
                startFromId: parameters.startFromId
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
 * node src/admin/scripts/fixReferenceId.js --collections=Practitioner_4_0_0 --batchSize=10000
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
