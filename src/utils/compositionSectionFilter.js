const { SENSITIVE_CATEGORY } = require('../constants');

function shouldRemoveSection({ section, deniedSensitiveCategorySet }) {
    if (!Array.isArray(section?.code?.coding)) {
        return false;
    }
    return section.code.coding.some(
        (c) => c?.system === SENSITIVE_CATEGORY.SYSTEM && deniedSensitiveCategorySet.has(c?.code)
    );
}

function filterSections({ sections, deniedSensitiveCategorySet }) {
    const result = sections.filter((section) => !shouldRemoveSection({ section, deniedSensitiveCategorySet }));
    for (const section of result) {
        if (section.section) {
            section.section = filterSections({
                sections: section.section,
                deniedSensitiveCategorySet
            });
            if (!section.section.length) {
                delete section.section;
            }
        }
    }
    return result;
}

/**
 * Strips sensitive sections from a Composition resource in place.
 * @param {Object} resource
 * @param {Set<string>} deniedSensitiveCategorySet
 */
function filterCompositionSensitiveSections(resource, deniedSensitiveCategorySet) {
    if (!resource?.section) {
        return;
    }
    resource.section = filterSections({
        sections: resource.section,
        deniedSensitiveCategorySet
    });
    if (!resource.section.length) {
        delete resource.section;
    }
}

module.exports = {
    filterCompositionSensitiveSections
};
