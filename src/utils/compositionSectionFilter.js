const { SENSITIVE_CATEGORY, AUTH_USER_TYPES } = require('../constants');

function filterSections(sections) {
    const result = sections.filter(
        (s) => !Array.isArray(s.code?.coding) || !s.code.coding.some((c) => c.system === SENSITIVE_CATEGORY.SYSTEM)
    );
    for (const section of result) {
        if (section.section) {
            section.section = filterSections(section.section);
            if (!section.section.length) {
                delete section.section;
            }
        }
    }
    return result;
}

/**
 * If composition-sensitive-section filtering is enabled and the user is a delegated user,
 * strips sensitive sections from resource in place.
 */
function filterCompositionSensitiveSections(resource, context) {
    if (
        !context.configManager?.enableCompositionSensitiveSectionFiltering ||
        context.userType !== AUTH_USER_TYPES.delegatedUser ||
        !resource?.section
    ) {
        return;
    }
    resource.section = filterSections(resource.section);
    if (!resource.section.length) {
        delete resource.section;
    }
}

module.exports = {
    filterCompositionSensitiveSections
};
