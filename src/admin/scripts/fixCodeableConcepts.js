if (process.argv.includes('--dotenv')) {
    const path = require('path');
    const dotenv = require('dotenv');
    const pathToEnv = path.resolve(__dirname, '.env');
    dotenv.config({
        path: pathToEnv
    });
    console.log(`Reading config from ${pathToEnv}`);
}
console.log(`MONGO_URL=${process.env.MONGO_URL}`);
console.log(`AUDIT_EVENT_MONGO_URL=${process.env.AUDIT_EVENT_MONGO_URL}`);
const { createContainer } = require('../../createContainer');
const { CommandLineParser } = require('./commandLineParser');
const { AdminLogger } = require('../adminLogger');
const { FixCodeableConceptsRunner } = require('../runners/fixCodeableConceptsRunner');
const oidToStandardUrlMapDefault = require('../utils/oidToStandardSystemUrlMapping.json');

const proaResources = [
    'AllergyIntolerance', 'Claim', 'ClaimResponse', 'Communication', 'Condition', 'Coverage',
    'Encounter', 'EnrollmentRequest', 'ExplanationOfBenefit',
    'FamilyMemberHistory', 'Flag', 'Immunization', 'Location', 'MedicationDispense', 'MedicationRequest',
    'MedicationStatement', 'Observation', 'Organization', 'Patient',
    'Person', 'Practitioner', 'PractitionerRole', 'Procedure'
];

const hapiResources = [
    'AllergyIntolerance', 'CarePlan', 'Condition', 'Device', 'Patient', 'DiagnosticReport',
    'DocumentReference', 'Encounter', 'Immunization', 'Location', 'Procedure', 'Medication',
    'MedicationDispense', 'MedicationRequest', 'MedicationStatement', 'Observation', 'Organization', 'Practitioner',
    'ServiceRequest'
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
    let collections = parameters.collections
        ? parameters.collections.split(',').map(x => x.trim())
        : ['all'];

    if (collections[0] === 'all') {
        collections = Array.from(
            new Set([
                ...hapiResources.map(collection => `${collection}_4_0_0`),
                ...proaResources.map(collection => `${collection}_4_0_0`)
            ])
        );
    }

    const properties = parameters.properties
        ? parameters.properties.split(',').map(x => x.trim())
        : undefined;

    const filterToRecordsWithFields = parameters.filterToRecordsWithFields
        ? parameters.filterToRecordsWithFields.split(',').map(x => x.trim())
        : undefined;

    const batchSize = parameters.batchSize || process.env.BULK_BUFFER_SIZE || 10000;
    const promiseConcurrency = parameters.promiseConcurrency || 10;

    const oidToStandardSystemUrlMap = parameters.oidToStandardUrlMap
        ? { ...JSON.parse(parameters.oidToStandardUrlMap), ...oidToStandardUrlMapDefault }
        : oidToStandardUrlMapDefault;

    /**
     * @type {Date|undefined}
     */
    const afterLastUpdatedDate = parameters.after ? new Date(parameters.after) : undefined;

    /**
     * @type {Date|undefined}
     */
    const beforeLastUpdatedDate = parameters.before ? new Date(parameters.before) : undefined;

    /**
     * @type {AdminLogger}
     */
    const adminLogger = new AdminLogger();

    adminLogger.logInfo(`[${currentDateTime}] Running script for collections: ${collections.join(',')}`);
    adminLogger.logInfo(`Using map: ${oidToStandardSystemUrlMap}`);

    // set up all the standard services in the container
    const container = createContainer();

    // now add our class
    container.register('fixCodeableConceptsRunner', (c) => new FixCodeableConceptsRunner(
            {
                mongoCollectionManager: c.mongoCollectionManager,
                collections,
                batchSize,
                promiseConcurrency,
                afterLastUpdatedDate,
                beforeLastUpdatedDate,
                adminLogger,
                oidToStandardSystemUrlMap,
                mongoDatabaseManager: c.mongoDatabaseManager,
                databaseQueryFactory: c.databaseQueryFactory,
                startFromCollection: parameters.startFromCollection,
                limit: parameters.limit,
                useTransaction: !!parameters.useTransaction,
                startFromId: parameters.startFromId,
                skip: parameters.skip,
                updateResources: !!parameters.updateResources,
                properties,
                filterToRecordsWithFields
            }
        )
    );

    /**
     * @type {FixCodeableConceptsRunner}
     */
    const fixCodeableConceptsRunner = container.fixCodeableConceptsRunner;
    await fixCodeableConceptsRunner.processAsync();

    adminLogger.logInfo('Exiting process');
    process.exit(0);
}

/**
 * To run this:
 * nvm use
 * node src/admin/scripts/fixCodeableConcepts.js --collections=Practitioner_4_0_0 --batchSize=10000
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/fixCodeableConcepts.js --collections=all --batchSize=10000
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/fixCodeableConcepts.js --collections=all --batchSize=10000 --dotenv
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/fixCodeableConcepts.js --collections=all --batchSize=10000 --startFromCollection FamilyMemberHistory_4_0_0
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/fixCodeableConcepts.js --collections=Person_4_0_0 --batchSize=10000 --promiseConcurrency 10
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/fixCodeableConcepts.js --collections=Person_4_0_0 --batchSize=10000 --updateResources
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/fixCodeableConcepts.js --collections=Person_4_0_0 --batchSize=10000 --oidToStandardUrlMap '{key:value}'
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/fixCodeableConcepts.js --collections=Person_4_0_0 --batchSize=10000 --useTransaction
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/fixCodeableConcepts.js --collections=Person_4_0_0 --batchSize=10000 --useTransaction --filterToRecordsWithFields link
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/fixCodeableConcepts.js --collections=Person_4_0_0 --batchSize=10000 --useTransaction --filterToRecordsWithFields link --startFromId=123
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/fixCodeableConcepts.js --collections=Person_4_0_0 --batchSize=10000 --useTransaction --skip 200000
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/fixCodeableConcepts.js --collections=Person_4_0_0 --batchSize=10000 --limit 10
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/fixCodeableConcepts.js --collections=Person_4_0_0 --batchSize=10000 --limit 10 --properties link
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/fixCodeableConcepts.js --collections=all --batchSize=10000 --after 2021-12-31
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/fixCodeableConcepts.js --collections=all --batchSize=10000 --before 2021-12-31
 * node src/admin/scripts/fixCodeableConcepts.js --collections=Account_4_0_0 --batchSize=10000
 */
main().catch(reason => {
    console.error(reason);
});
