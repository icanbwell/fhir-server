const {CarePlanConverter} = require('./carePlanConverter');
const {ConditionConverter} = require('./conditionConverter');
const {CoverageConverter} = require('./coverageConverter');
const {ExplanationOfBenefitConverter} = require('./explanationOfBenefitConverter');
const {ImmunizationConverter} = require('./immunizationConverter');
const {MedicationDispenseConverter} = require('./medicationDispenseConverter');
const {MedicationRequestConverter} = require('./medicationRequestConverter');
const {ObservationConverter} = require('./observationConverter');
const {PatientConverter} = require('./patientConverter');
const {ProcedureConverter} = require('./procedureConverter');
const {DocumentReferenceConverter} = require('./documentReferenceConverter');

class ResourceConverterFactory {
    /**
     * constructor
     * @param {MongoDatabaseManager} mongoDatabaseManager
     * @param {DatabaseAttachmentManager} databaseAttachmentManager
     */
    constructor(
        {
            mongoDatabaseManager,
            databaseAttachmentManager
        }
    ) {
        this.converterMapping = {
            'CarePlan': new CarePlanConverter(),
            'Condition': new ConditionConverter(),
            'Coverage': new CoverageConverter(),
            'ExplanationOfBenefit': new ExplanationOfBenefitConverter(),
            'Immunization': new ImmunizationConverter(),
            'MedicationDispense': new MedicationDispenseConverter(),
            'MedicationRequest': new MedicationRequestConverter(),
            'Observation': new ObservationConverter(),
            'Patient': new PatientConverter(),
            'Procedure': new ProcedureConverter(),
            'DocumentReference': new DocumentReferenceConverter(
                {
                    mongoDatabaseManager,
                    databaseAttachmentManager
                }
            ),
        };
    }

    /**
     * returns converter for this resource
     * @param {Resource} resource
     * @returns {BaseConverter|undefined}
     */
    getConverterForResource({resource}) {
        return this.converterMapping[resource.resourceType];
    }
}

module.exports = {
    ResourceConverterFactory
};
