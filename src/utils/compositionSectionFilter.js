const { SENSITIVE_CATEGORY } = require('../constants');
const { logInfo } = require('../operations/common/logging');
const { IdentifierSystem } = require('./identifierSystem');
const { ReferenceParser } = require('./referenceParser');

/**
 * Removal rule: given a section, returns true if the section (and everything nested in it) should be
 * removed from the Composition.
 * @callback SectionRemovalRule
 * @param {Object} section
 * @return {boolean}
 */

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

/**
 * Walks the sections depth-first, dropping every section the rule matches (with its nested sections)
 * and deleting `section` from any parent left with none.
 * @param {Object[]} sections
 * @param {SectionRemovalRule} removalRule
 * @param {string} compositionUuid for the log line only
 * @param {string} path for the log line only
 * @return {Object[]}
 */
function filterSections({ sections, removalRule, compositionUuid, path }) {
    const result = [];
    for (let i = 0; i < sections.length; i++) {
        const section = sections[i];
        const currentPath = `${path}section[${i}]`;
        if (removalRule(section)) {
            logInfo(
                `Dropping section ${section?.id} from Composition/${compositionUuid} at ${currentPath}`
            );
            continue;
        }
        if (section.section) {
            section.section = filterSections({
                sections: section.section,
                removalRule,
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
 * Removes the sections a rule matches from a Composition, in place.
 * @param {Object} resource
 * @param {SectionRemovalRule} removalRule
 */
function filterCompositionSections(resource, removalRule) {
    if (!resource?.section) {
        return;
    }
    resource.section = filterSections({
        sections: resource.section,
        removalRule,
        compositionUuid: resource._uuid,
        path: ''
    });
    if (!resource.section.length) {
        delete resource.section;
    }
}

/**
 * Strips sensitive sections from a Composition resource in place.
 * @param {Object} resource
 * @param {Set<string>} deniedSensitiveCategorySet
 */
function filterCompositionSensitiveSections(resource, deniedSensitiveCategorySet) {
    filterCompositionSections(
        resource,
        (section) => shouldRemoveSection({ section, deniedSensitiveCategorySet })
    );
}

/**
 * Every "Type/id" form a section entry can name its target by: the reference itself, the stored
 * `_uuid`/`_sourceId`, and the uuid and sourceId extensions. A Consent can block by either id and a
 * Composition can reference by either, so all of them are checked.
 * @param {Object} entry a Reference
 * @return {string[]}
 */
function getEntryReferenceForms(entry) {
    const forms = [entry?.reference, entry?._uuid, entry?._sourceId];
    for (const extension of entry?.extension || []) {
        if (extension?.url === IdentifierSystem.uuid || extension?.url === IdentifierSystem.sourceId) {
            forms.push(extension.valueString);
        }
    }
    return forms.filter((form) => typeof form === 'string' && form.length > 0);
}

/**
 * Does any entry of this section (not its nested sections, which the walk visits on their own)
 * reference a blocked resource of the same resourceType?
 * @param {Object} section
 * @param {{[resourceType: string]: Set<string>}} blockedIdSetByType
 * @return {boolean}
 */
function referencesBlockedResource({ section, blockedIdSetByType }) {
    return (section?.entry || []).some((entry) =>
        getEntryReferenceForms(entry).some((form) => {
            const { resourceType, id } = ReferenceParser.parseReference(form);
            return Boolean(resourceType) && blockedIdSetByType[resourceType]?.has(id) === true;
        })
    );
}

/**
 * Removes, in place, every Composition section with an entry referencing a resource the
 * dataConnectionViewControl Consent hides. The whole section goes, because its narrative and
 * remaining entries describe the hidden resource; nested sections are judged on their own entries.
 * @param {Object} resource
 * @param {Readonly<{[resourceType: string]: ReadonlyArray<string>}>|undefined} excludeMap hidden ids
 *  (uuid or source id) by resourceType, as returned by PatientDataViewControlExclusion
 */
function filterCompositionBlockedReferenceSections(resource, excludeMap) {
    const blockedIdSetByType = {};
    for (const [resourceType, ids] of Object.entries(excludeMap || {})) {
        if (ids?.length) {
            blockedIdSetByType[resourceType] = new Set(ids);
        }
    }
    if (Object.keys(blockedIdSetByType).length === 0) {
        return;
    }
    filterCompositionSections(
        resource,
        (section) => referencesBlockedResource({ section, blockedIdSetByType })
    );
}

module.exports = {
    filterCompositionSensitiveSections,
    filterCompositionBlockedReferenceSections
};
