const { describe, test, expect } = require('@jest/globals');
const { QuestionnaireReferenceNormalizationHandler, QUESTIONNAIRE_NAME_TO_UUID } = require('../../../../preSaveHandlers/handlers/questionnaireReferenceNormalizationHandler');

const handler = new QuestionnaireReferenceNormalizationHandler();

describe('QuestionnaireReferenceNormalizationHandler', () => {
    test('rewrites known human-readable name to UUID (full canonical URL)', async () => {
        const resource = {
            resourceType: 'QuestionnaireResponse',
            questionnaire: 'https://fhir.icanbwell.com/4_0_0/Questionnaire/fitness-reimbursement-request'
        };
        const result = await handler.preSaveAsync({ resource });
        expect(result.questionnaire).toBe(
            'https://fhir.icanbwell.com/4_0_0/Questionnaire/7a7f53d3-acef-539d-b4e6-b48b79c94e72'
        );
    });

    test('rewrites known human-readable name to UUID (bare reference)', async () => {
        const resource = {
            resourceType: 'QuestionnaireResponse',
            questionnaire: 'Questionnaire/request-mailed-documents'
        };
        const result = await handler.preSaveAsync({ resource });
        expect(result.questionnaire).toBe(
            'Questionnaire/cfcb7ee4-b4fe-509d-8381-85933766bee0'
        );
    });

    test('rewrites all 6 known mappings', async () => {
        for (const [name, uuid] of Object.entries(QUESTIONNAIRE_NAME_TO_UUID)) {
            const resource = {
                resourceType: 'QuestionnaireResponse',
                questionnaire: `https://fhir.icanbwell.com/4_0_0/Questionnaire/${name}`
            };
            const result = await handler.preSaveAsync({ resource });
            expect(result.questionnaire).toBe(
                `https://fhir.icanbwell.com/4_0_0/Questionnaire/${uuid}`
            );
        }
    });

    test('does not rewrite questionnaire reference that is already a UUID', async () => {
        const resource = {
            resourceType: 'QuestionnaireResponse',
            questionnaire: 'https://fhir.icanbwell.com/4_0_0/Questionnaire/7a7f53d3-acef-539d-b4e6-b48b79c94e72'
        };
        const result = await handler.preSaveAsync({ resource });
        expect(result.questionnaire).toBe(
            'https://fhir.icanbwell.com/4_0_0/Questionnaire/7a7f53d3-acef-539d-b4e6-b48b79c94e72'
        );
    });

    test('does not rewrite unknown human-readable names', async () => {
        const resource = {
            resourceType: 'QuestionnaireResponse',
            questionnaire: 'https://fhir.icanbwell.com/4_0_0/Questionnaire/some-other-form'
        };
        const result = await handler.preSaveAsync({ resource });
        expect(result.questionnaire).toBe(
            'https://fhir.icanbwell.com/4_0_0/Questionnaire/some-other-form'
        );
    });

    test('skips non-QuestionnaireResponse resources', async () => {
        const resource = {
            resourceType: 'Patient',
            id: '123'
        };
        const result = await handler.preSaveAsync({ resource });
        expect(result).toBe(resource);
    });

    test('skips QuestionnaireResponse with no questionnaire field', async () => {
        const resource = {
            resourceType: 'QuestionnaireResponse',
            status: 'completed'
        };
        const result = await handler.preSaveAsync({ resource });
        expect(result.questionnaire).toBeUndefined();
    });
});
