/**
 * Supported FHIR resource types that can be Group members
 * Per FHIR R4B spec: Group.member.entity can reference these resource types
 */
const MEMBER_RESOURCE_TYPES = [
    'Patient',
    'Practitioner',
    'PractitionerRole',
    'Device',
    'Medication',
    'Substance',
    'Group'
];

module.exports = {
    MEMBER_RESOURCE_TYPES
};
