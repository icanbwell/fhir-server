const { SENSITIVE_CATEGORY, AUTH_USER_TYPES } = require('../../../../constants');

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

    return sections
        .filter((section) => !sectionHasSensitiveCoding(section))
        .map((section) => {
            if (section.section) {
                section.section = filterCompositionSections(section.section);
            }
            return section;
        });
}

/**
 * If composition-sensitive-section filtering is enabled and the user is a delegated user,
 * strips sensitive sections from rawJson in place.
 * @param {Object} rawJson
 * @param {Object} context
 */
function filterCompositionSensitiveSections(rawJson, context) {
    if (!context.configManager?.enableCompositionSensitiveSectionFiltering || context.userType !== AUTH_USER_TYPES.delegatedUser || !rawJson?.section) {
        return;
    }

    rawJson.section = filterCompositionSections(rawJson.section);
}

module.exports = { filterCompositionSections, filterCompositionSensitiveSections };
