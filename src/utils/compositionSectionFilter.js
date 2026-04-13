const { SENSITIVE_CATEGORY, AUTH_USER_TYPES } = require('../constants');

/**
 * @param {Object} section
 * @returns {boolean}
 */
function sectionHasSensitiveCoding(section) {
    const codings = section.code?.coding;
    if (!Array.isArray(codings)) {
        return false;
    }
    return codings.some((coding) => coding.system === SENSITIVE_CATEGORY.SYSTEM);
}

/**
 * Recursively filters sections whose code.coding contains a sensitive-category system.
 * @param {Object[]|null|undefined} sections
 * @returns {Object[]|null|undefined}
 */
function filterCompositionSections(sections) {
    if (!sections) {
        return sections;
    }

    const result = [];
    for (const section of sections) {
        if (sectionHasSensitiveCoding(section)) {
            continue;
        }
        if (section.section) {
            section.section = filterCompositionSections(section.section);
        }
        result.push(section);
    }
    return result;
}

/**
 * If composition-sensitive-section filtering is enabled and the user is a delegated user,
 * strips sensitive sections from resource in place.
 * @param {Object} resource
 * @param {{configManager: ConfigManager, userType: string|undefined}} context
 */
function filterCompositionSensitiveSections(resource, context) {
    if (!context.configManager?.enableCompositionSensitiveSectionFiltering || context.userType !== AUTH_USER_TYPES.delegatedUser || !resource?.section) {
        return;
    }

    resource.section = filterCompositionSections(resource.section);
}

module.exports = {
    filterCompositionSensitiveSections
};
