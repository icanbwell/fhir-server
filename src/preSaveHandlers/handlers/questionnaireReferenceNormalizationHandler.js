const { PreSaveHandler } = require('./preSaveHandler');

const QUESTIONNAIRE_NAME_TO_UUID = {
    'fitness-reimbursement-request': '7a7f53d3-acef-539d-b4e6-b48b79c94e72',
    'fitness-reimbursement-request-es': '74dd3eb6-84a2-56ea-9d0d-c77a97608a4c',
    'medical-claim-reimbursement-request': '80bf44d6-0c9a-5468-9343-080f46c8f445',
    'medical-claim-reimbursement-request-es': '7e9afaa5-9d22-5ca1-b301-be91d2c0f64c',
    'request-mailed-documents': 'cfcb7ee4-b4fe-509d-8381-85933766bee0',
    'request-mailed-documents-es': 'd9020917-016d-5994-b424-bb64d3c6dbb0'
};

/**
 * Normalizes QuestionnaireResponse.questionnaire references from legacy
 * human-readable names to stable UUIDs. Old app versions still submit
 * with human-readable names; this ensures all persisted references use
 * the UUID format so downstream consumers (e.g. WellSense) can query
 * consistently.
 */
class QuestionnaireReferenceNormalizationHandler extends PreSaveHandler {
    /**
     * @param {Object} params
     * @param {Resource} params.resource
     * @returns {Promise<Resource>}
     */
    async preSaveAsync ({ resource }) {
        if (resource.resourceType !== 'QuestionnaireResponse') {
            return resource;
        }

        const questionnaire = resource.questionnaire;
        if (!questionnaire) {
            return resource;
        }

        // Extract the reference ID from canonical URLs like
        // "https://fhir.icanbwell.com/4_0_0/Questionnaire/fitness-reimbursement-request"
        // or bare references like "Questionnaire/fitness-reimbursement-request"
        const parts = questionnaire.split('/');
        const referenceName = parts[parts.length - 1];

        const uuid = QUESTIONNAIRE_NAME_TO_UUID[referenceName];
        if (uuid) {
            resource.questionnaire = questionnaire.replace(referenceName, uuid);
        }

        return resource;
    }
}

module.exports = {
    QuestionnaireReferenceNormalizationHandler,
    QUESTIONNAIRE_NAME_TO_UUID
};
