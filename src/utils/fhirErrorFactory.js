const OperationOutcomeIssue = require('../fhir/classes/4_0_0/backbone_elements/operationOutcomeIssue');

const GUIDANCE = {
    PATCH: 'Use PATCH with JSON Patch to add members incrementally',
    PATCH_EXAMPLE: '[{"op":"add","path":"/member/-","value":{"entity":{"reference":"Patient/123"}}}]',
    PAGINATION: 'Use pagination with _count parameter (example: GET /Group/{id}?_count=100)',
    STREAMING: 'Use streaming with _streamResponse=true for large result sets',
    FHIR_PATCH_URL: 'https://www.hl7.org/fhir/http.html#patch'
};

/**
 * Creates a FHIR-compliant too-costly BadRequestError
 * @param {Object} params
 * @param {number} params.actual - Actual count that exceeded limit
 * @param {number} params.limit - Configured limit
 * @param {string} params.operation - Operation type ('PUT' or 'PATCH')
 * @param {string} [params.customGuidance] - Optional custom guidance for alternative 1
 * @returns {Object} Error parameters for BadRequestError constructor
 */
function createTooCostlyError({ actual, limit, operation, customGuidance }) {
    const operationType = operation === 'PATCH' ? 'operations' : 'members';
    const alternative1 = customGuidance ||
        `For writes: ${GUIDANCE.PATCH} (example: ${GUIDANCE.PATCH_EXAMPLE}). See: ${GUIDANCE.FHIR_PATCH_URL}`;

    return {
        message: `Group ${operationType} count exceeds maximum (${actual} > ${limit})`,
        options: {
            issue: [new OperationOutcomeIssue({
                severity: 'error',
                code: 'too-costly',
                diagnostics:
                    `Limit exceeded (${actual} > ${limit}). ` +
                    `This operation is too costly to process in a single request.\n\n` +
                    `Alternative approaches:\n` +
                    `1. ${alternative1}\n` +
                    `2. For reads: ${GUIDANCE.PAGINATION}\n` +
                    `3. For reads: ${GUIDANCE.STREAMING}`
            })]
        }
    };
}

module.exports = { createTooCostlyError, GUIDANCE };
