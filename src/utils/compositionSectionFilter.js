const { SENSITIVE_CATEGORY } = require('../constants');

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
 * Strips sensitive sections from a Composition resource in place.
 * Callers are responsible for gating on config flags and userType.
 */
function filterCompositionSensitiveSections(resource) {
    if (!resource?.section) {
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
