// load config from .env.  Should be first thing so env vars are available to rest of the code
console.log(`MONGO_URL=${process.env.MONGO_URL}`);
console.log(`AUDIT_EVENT_MONGO_URL=${process.env.AUDIT_EVENT_MONGO_URL}`);
const {createContainer} = require('../../createContainer');
const {CommandLineParser} = require('./commandLineParser');
const {AdminLogger} = require('../adminLogger');
const {FixReferenceIdClientRunner} = require('../runners/fixReferenceIdClientRunner');

const clientResources = [
    'AllergyIntolerance', 'CarePlan', 'Condition', 'Patient', 'DiagnosticReport',
    'Encounter', 'Immunization', 'Procedure', 'Medication', 'MedicationRequest',
    'Observation', 'Organization', 'Practitioner', 'PractitionerRole', 'RelatedPerson'
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

    /**
     * @type {string}
     */
    const AWS_BUCKET = parameters.AWS_BUCKET;
    if (!AWS_BUCKET) {
        throw Error('AWS_BUCKET is a required parameter');
    }
    /**
     * @type {string}
     */
    const client = parameters.client;
    if (!client) {
        throw Error('client is a required parameter');
    }
    /**
     * @type {string}
     */
    const AWS_REGION = parameters.AWS_REGION || 'us-east-1';
    /**
     * @type {string}
     */
    const AWS_FOLDER = parameters.AWS_FOLDER || 'fhir/epic/patient/';

    let currentDateTime = new Date();
    /**
     * @type {string[]}
     */
    let collections = parameters.collections ?
        parameters.collections.split(',').map(x => x.trim()) :
        ['all'];

    let clientCollections = parameters.clientCollections ?
        parameters.clientCollections.split(',').map(x => x.trim()) : [
            ...clientResources.map(collection => `${collection}_4_0_0`),
            ...clientResources.map(collection => `${collection}_4_0_0_History`)
        ];

    let properties = parameters.properties ?
        parameters.properties.split(',').map(x => x.trim()) :
        undefined;

    let filterToRecordsWithFields = parameters.filterToRecordsWithFields ?
        parameters.filterToRecordsWithFields.split(',').map(x => x.trim()) :
        undefined;

    const batchSize = parameters.batchSize || process.env.BULK_BUFFER_SIZE || 10000;
    const s3QueryBatchSize = parameters.s3QueryBatchSize || 3000;
    /**
     * @type {Date|undefined}
     */
    const afterLastUpdatedDate = parameters.after ? new Date(parameters.after) : undefined;

    /**
     * @type {Date|undefined}
     */
    const beforeLastUpdatedDate = parameters.before ? new Date(parameters.before) : undefined;

    const adminLogger = new AdminLogger();

    adminLogger.logInfo(`[${currentDateTime}] Running script for collections: ${clientCollections.join(',')}`);

    // set up all the standard services in the container
    const container = createContainer();

    // now add our class
    container.register('fixReferenceIdClientRunner', (c) => new FixReferenceIdClientRunner(
            {
                mongoCollectionManager: c.mongoCollectionManager,
                collections,
                batchSize,
                s3QueryBatchSize,
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
                proaCollections: clientCollections,
                limit: parameters.limit,
                properties,
                AWS_BUCKET,
                AWS_FOLDER,
                AWS_REGION,
                resourceMerger: c.resourceMerger,
                useTransaction: parameters.useTransaction ? true : false,
                skip: parameters.skip,
                filterToRecordsWithFields,
                startFromId: parameters.startFromId,
                client,
            }
        )
    );

    /**
     * @type {FixReferenceIdClientRunner}
     */
    const fixReferenceIdClientRunner = container.fixReferenceIdClientRunner;
    await fixReferenceIdClientRunner.processAsync();

    adminLogger.logInfo('Exiting process');
    process.exit(0);
}

/**
 * To run this:
 * nvm use
 * node src/admin/scripts/fixReferenceIdClient.js --client=bwell_test
 * node src/admin/scripts/fixReferenceIdClient.js --AWS_BUCKET=bucket_name --collections=Practitioner_4_0_0 --batchSize=10000
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/fixReferenceIdClient.js --AWS_BUCKET=bucket_name --collections=all --batchSize=10000
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/fixReferenceIdClient.js --AWS_BUCKET=bucket_name --collections=all --batchSize=10000 --startFromCollection FamilyMemberHistory_4_0_0
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/fixReferenceIdClient.js --AWS_BUCKET=bucket_name --collections=Person_4_0_0 --batchSize=10000 --clientCollections=Person_4_0_0,Patient_4_0_0
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/fixReferenceIdClient.js --AWS_BUCKET=bucket_name --collections=Person_4_0_0 --batchSize=10000 --clientCollections=Person_4_0_0,Patient_4_0_0 --useTransaction
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/fixReferenceIdClient.js --AWS_BUCKET=bucket_name --collections=Person_4_0_0 --batchSize=10000 --useTransaction --filterToRecordsWithFields link
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/fixReferenceIdClient.js --AWS_BUCKET=bucket_name --collections=Person_4_0_0 --batchSize=10000 --useTransaction --filterToRecordsWithFields link --startFromId=123
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/fixReferenceIdClient.js --AWS_BUCKET=bucket_name --collections=Person_4_0_0 --batchSize=10000 --useTransaction --skip 200000
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/fixReferenceIdClient.js --AWS_BUCKET=bucket_name --collections=Person_4_0_0 --batchSize=10000 --limit 10
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/fixReferenceIdClient.js --AWS_BUCKET=bucket_name --collections=Person_4_0_0 --batchSize=10000 --limit 10 --properties link
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/fixReferenceIdClient.js --AWS_BUCKET=bucket_name --collections=all --batchSize=10000 --after 2021-12-31
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/fixReferenceIdClient.js --AWS_BUCKET=bucket_name --collections=all --batchSize=10000 --before 2021-12-31
 * node src/admin/scripts/fixReferenceIdClient.js --AWS_BUCKET=bucket_name --collections=Account_4_0_0 --batchSize=10000
 */
main().catch(reason => {
    console.error(reason);
});
