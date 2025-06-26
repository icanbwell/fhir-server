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
const { GetIncompatibleResourcesRunner } = require('../runners/getIncompatibleResourcesRunner');

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
    /**
     * @type {string[]}
     */
    const collections = parameters.collections
        ? parameters.collections.split(',').map((x) => x.trim())
        : ['all'];

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
    adminLogger.logInfo(
        `[${currentDateTime}] Running script for collections: ${collections.join(',')}`
    );

    // set up all the standard services in the container
    const container = createContainer();

    // now add our class
    container.register(
        'getIncompatibleResourcesRunner',
        (c) =>
            new GetIncompatibleResourcesRunner({
                mongoDatabaseManager: c.mongoDatabaseManager,
                databaseQueryFactory: c.databaseQueryFactory,
                adminLogger,
                batchSize,
                collections,
                startFromCollection: parameters.startFromCollection,
                limit: parameters.limit,
                skip: parameters.skip,
                startFromId: parameters.startFromId,
                afterLastUpdatedDate,
                beforeLastUpdatedDate
            })
    );

    /**
     * @type {GetIncompatibleResourcesRunner}
     */
    const getIncompatibleResourcesRunner = container.getIncompatibleResourcesRunner;
    await getIncompatibleResourcesRunner.processAsync();

    adminLogger.logInfo('Exiting process');
    process.exit(0);
}

/**
 * To run this:
 * nvm use
 * node src/admin/scripts/getIncompatibleResources.js --collections=Practitioner_4_0_0 --batchSize=10000
 * parallel --ungroup --jobs 3 --eta --colsep '\t' NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/getIncompatibleResources.js --collections ::: Account_4_0_0 ActivityDefinition_4_0_0 AllergyIntolerance_4_0_0 Appointment_4_0_0 Binary_4_0_0 Bundle_4_0_0 CarePlan_4_0_0 CareTeam_4_0_0 ChargeItem_4_0_0 CodeSystem_4_0_0 Communication_4_0_0 Condition_4_0_0 Consent_4_0_0 Contract_4_0_0 Coverage_4_0_0 CoverageEligibilityResponse_4_0_0 DiagnosticReport_4_0_0 DocumentReference_4_0_0 Encounter_4_0_0 Endpoint_4_0_0 EnrollmentRequest_4_0_0 EpisodeOfCare_4_0_0 ExplanationOfBenefit_4_0_0 Group_4_0_0 HealthcareService_4_0_0 Immunization_4_0_0 InsurancePlan_4_0_0 Invoice_4_0_0 Library_4_0_0 Location_4_0_0 Measure_4_0_0 MeasureReport_4_0_0 Medication_4_0_0 MedicationDispense_4_0_0 MedicationRequest_4_0_0 MedicationStatement_4_0_0 Observation_4_0_0 Organization_4_0_0 OrganizationAffiliation_4_0_0 Patient_4_0_0 Person_4_0_0 Practitioner_4_0_0 PractitionerRole_4_0_0 Procedure_4_0_0 Provenance_4_0_0 Questionnaire_4_0_0 QuestionnaireResponse_4_0_0 RelatedPerson_4_0_0 Schedule_4_0_0 ServiceRequest_4_0_0 Slot_4_0_0 Task_4_0_0 ValueSet_4_0_0
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/getIncompatibleResources.js --collections=all --batchSize=10000
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/getIncompatibleResources.js --collections=all --batchSize=10000 --startFromCollection FamilyMemberHistory_4_0_0
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/getIncompatibleResources.js --collections=Person_4_0_0 --batchSize=10000 --startFromId 123
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/getIncompatibleResources.js --collections=Person_4_0_0 --batchSize=10000 --skip 200000
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/getIncompatibleResources.js --collections=Person_4_0_0 --batchSize=10000 --limit 10
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/getIncompatibleResources.js --collections=all --batchSize=10000 --after 2021-12-31
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/getIncompatibleResources.js --collections=all --batchSize=10000 --before 2021-12-31
 */
main().catch((reason) => {
    console.error(reason);
});
