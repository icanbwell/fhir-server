/**
 * @typedef {import('../../fhir/classes/4_0_0/resources/resource')} Resource
 * @typedef {import('../../fhir/classes/4_0_0/complex_types/codeableConcept')} CodeableConcept
 */

/**
 * Tags a resource with sensitive data tags based on the provided value set expansion.
 * @param {Object} param
 * @param {Resource | Resource[]} param.resource
 * @param {SensitiveValueSetExpansion[]} param.sensitiveDataTags
 * @param {SensitiveTaggingOptions | undefined} [param.options]
 */
function tagSensitiveResource({ resource, sensitiveDataTags, options }) {
    // TODO: implement sensitive data tagging logic
    const resources = Array.isArray(resource) ? resource : [resource];
    const { overwriteExistingTags, preserveManualOverrides } = options || {};

    // Internal tagging logic:
    // 1. Extract all CodeableConcepts from resource
    // Would need a maping of resource to field paths for CodeableConcepts
    // 2. For each coding in CodeableConcepts:
    //    - Check if (system, code) exists in any ValueSet expansion
    //    - If match found, add corresponding category tag
    // 3. Deduplicate tags (avoid duplicate tags)

    for (const res of resources) {
        const codeableConcepts = extractCodeableConcepts({ resource: res });
        const matchCodes = matchCodes({ codeableConcepts, sensitiveDataTags });
    }
}

/**
 * Extract CodeableConcepts from the resource
 * @param {Object} param
 * @param {Resource} param.resource
 * @returns {CodeableConcept[]} params.resource
 */
function extractCodeableConcepts({ resource }) {
    const codeableConcepts = [];
    return codeableConcepts;
}

/**
 *
 * @param {CodeableConcept[]} codeableConcepts
 * @param {SensitiveValueSetExpansion[]} sensitiveDataTags
 * @return {Pick<SensitiveValueSetExpansion, 'category' | 'url'>[]}
 */
function matchCodes({ codeableConcepts, sensitiveDataTags }) {
    const matchedTags = [];
    return matchedTags;
}

module.exports = {
    tagSensitiveResource
};
