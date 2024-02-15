const fhirKeyProperties = {
    Patient: [
        'name',
        'telecom',
        'gender',
        'birthDate',
        'address',
        'maritalStatus',
        'generalPractitioner'
    ],
    Condition: [],
    Observation: [
        'status',
        'category',
        'code',
        'effectiveDateTime',
        'effectivePeriod',
        'issued',
        'performer',
        'value*'
    ],
    Procedure: [
        'status',
        'category',
        'code',
        'occurrence',
        'recorded',
        'recorder',
        'performer'
    ],
    MedicationDispense: [],
    MedicationRequest: [],
    Coverage: [],
    ExplanationOfBenefit: [],
    Encounter: [],
    CarePlan: [],
    Immunization: []
};

module.exports = {
    fhirKeyProperties
};
