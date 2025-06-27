const { createContainer } = require('../../createContainer');
const { ProaResourcesStats } = require('../runners/proaResourcesStatsRunner');
const { CommandLineParser } = require('./commandLineParser');
const { AdminLogger } = require('../adminLogger');

/**
 * main function
 * @returns {Promise<void>}
 */
async function main() {
    /**
     * @type {Object}
     */
    const parameters = CommandLineParser.parseCommandLine();
    const adminLogger = new AdminLogger();
    const collections = parameters.collections
        ? parameters.collections.split(',')
        : [
              'AllergyIntolerance_4_0_0',
              'CarePlan_4_0_0',
              'CareTeam_4_0_0',
              'Condition_4_0_0',
              'Coverage_4_0_0',
              'Device_4_0_0',
              'DiagnosticReport_4_0_0',
              'DocumentReference_4_0_0',
              'Encounter_4_0_0',
              'ExplanationOfBenefit_4_0_0',
              'Goal_4_0_0',
              'ImagingStudy_4_0_0',
              'Immunization_4_0_0',
              'MedicationAdministration_4_0_0',
              'MedicationDispense_4_0_0',
              'MedicationRequest_4_0_0',
              'MedicationStatement_4_0_0',
              'Observation_4_0_0',
              'Patient_4_0_0',
              'Procedure_4_0_0',
              'QuestionnaireResponse_4_0_0',
              'RelatedPerson_4_0_0',
              'ServiceRequest_4_0_0',
              'Specimen_4_0_0',
              'Binary_4_0_0',
              'Location_4_0_0',
              'Medication_4_0_0',
              'Organization_4_0_0',
              'Practitioner_4_0_0',
              'PractitionerRole_4_0_0',
              'Questionnaire_4_0_0',
              'Substance_4_0_0',
              'MedicationRequest_4_0_0'
          ];
    adminLogger.logInfo(`Running script to checks proa resources stats for collections: ${collections.join(',')}`);

    // set up all the standard services in the container
    const container = createContainer();

    // now add our class
    container.register(
        'processProaResourcesStats',
        (c) =>
            new ProaResourcesStats({
                mongoDatabaseManager: c.mongoDatabaseManager,
                collections,
                adminLogger
            })
    );

    /**
     * @type {ProaResourcesStats}
     */
    const processProaResourcesStats = container.processProaResourcesStats;
    await processProaResourcesStats.processAsync();

    adminLogger.logInfo('Exiting process');
    process.exit(0);
}

/**
 * To run this:
 * nvm use
 * required env variables
 * MONGO_DB_NAME, MONGO_URL
 * node src/admin/scripts/proaResourcesStats.js --collections="AllergyIntolerance_4_0_0,Patient_4_0_0"
 */
main().catch((reason) => {
    console.error(reason);
});
