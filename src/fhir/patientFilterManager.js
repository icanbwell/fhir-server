class PatientFilterManager {
    /**
     * @param {string} resourceType
     * @return {string|null}
     */
    getPatientPropertyForResource({resourceType}) {
        const mapping = {
            'AllergyIntolerance': 'patient.reference',
            'CarePlan': 'subject.reference',
            'CareTeam': 'subject.reference',
            'Condition': 'subject.reference',
            'Encounter': 'subject.reference',
            'ExplanationOfBenefit': 'subject.reference',
            'Immunization': 'patient.reference',
            'MedicationRequest': 'subject.reference',
            'MedicationStatement': 'subject.reference',
            'Observation': 'subject.reference',
            'Patient': 'id',
            'Procedure': 'subject.reference',
            'Person': 'link.target.reference'
        };

        return mapping[`${resourceType}`];
    }
}

module.exports = {
    PatientFilterManager
};
