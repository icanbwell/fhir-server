const { SENSITIVE_CATEGORY } = require('../constants');
const { logInfo } = require('../operations/common/logging');

/**
 * A pure denylist-membership check: does this section carry any coding whose system is the
 * sensitivity-category system and whose code is in the caller-supplied denylist? Callers that
 * also want the hardcoded `unclassified` code excluded (see
 * CompositionSectionFilterEnrichmentProvider.getDeniedSensitiveCategorySet) fold it into
 * deniedSensitiveCategorySet themselves before calling filterCompositionSensitiveSections --
 * this function stays a simple set-membership check with no implicit special case.
 */
function shouldRemoveSection({ section, deniedSensitiveCategorySet }) {
    if (!Array.isArray(section?.code?.coding)) {
        return false;
    }
    return section.code.coding.some(
        (c) => c?.system === SENSITIVE_CATEGORY.SYSTEM && deniedSensitiveCategorySet.has(c?.code)
    );
}

function filterSections({ sections, deniedSensitiveCategorySet, compositionUuid, path }) {
    const result = [];
    for (let i = 0; i < sections.length; i++) {
        const section = sections[i];
        const currentPath = `${path}section[${i}]`;
        if (shouldRemoveSection({ section, deniedSensitiveCategorySet })) {
            logInfo(
                `Dropping section ${section?.id} from Composition/${compositionUuid} at ${currentPath}`
            );
            continue;
        }
        if (section.section) {
            section.section = filterSections({
                sections: section.section,
                deniedSensitiveCategorySet,
                compositionUuid,
                path: `${currentPath}.`
            });
            if (!section.section.length) {
                delete section.section;
            }
        }
        result.push(section);
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
        deniedSensitiveCategorySet,
        compositionUuid: resource._uuid,
        path: ''
    });
    if (!resource.section.length) {
        delete resource.section;
    }
}

module.exports = {
    filterCompositionSensitiveSections
};
