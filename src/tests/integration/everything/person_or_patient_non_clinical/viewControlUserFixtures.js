/**
 * The user the dataConnectionViewControl integration tests read as: the Person and Patient in the
 * person_or_patient_non_clinical fixtures, with a patient-scoped token. All data is synthetic.
 */
const {
    getHeadersWithCustomPayload,
    getHeadersNdJson,
    getCustomGraphQLHeaders
} = require('../../common');

const PERSON_ID = '5f3ca115-8630-5e55-a97d-4d6ee26c0adc';
const PATIENT_UUID = '24a5930e-11b4-5525-b482-669174917044';
// the owner (client) of those fixtures, the one the tests enroll in the feature
const OWNER = 'healthsystem1';

const USER_PAYLOAD = {
    scope: 'patient/*.* user/*.* access/*.*',
    username: 'test',
    client_id: 'client',
    clientFhirPersonId: PERSON_ID,
    clientFhirPatientId: PATIENT_UUID,
    bwellFhirPersonId: 'master-person',
    bwellFhirPatientId: 'master-patient',
    token_use: 'access'
};

const userHeaders = () => getHeadersWithCustomPayload(USER_PAYLOAD);
const ndjsonUserHeaders = () => ({ ...getHeadersNdJson(), Authorization: userHeaders().Authorization });
const userGraphqlHeaders = () => getCustomGraphQLHeaders(USER_PAYLOAD);

module.exports = {
    PERSON_ID,
    PATIENT_UUID,
    OWNER,
    USER_PAYLOAD,
    userHeaders,
    ndjsonUserHeaders,
    userGraphqlHeaders
};
