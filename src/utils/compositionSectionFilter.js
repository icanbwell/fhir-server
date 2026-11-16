const { SENSITIVE_CATEGORY } = require('../constants');
const { logInfo } = require('../operations/common/logging');
const { IdentifierSystem } = require('./identifierSystem');
const { ReferenceParser } = require('./referenceParser');
const { UrlParser } = require('./urlParser');

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
 * @param {{removedCount: number}} state counts the sections removed in the whole Composition
 * @param {boolean} stripNarrativeOnRemoval when a section below a kept section was removed, delete the
 *  kept section's `text`: a parent's narrative can summarise the child that was removed
 * @return {Object[]}
 */
function filterSections({ sections, removalRule, compositionUuid, path, state, stripNarrativeOnRemoval }) {
    const result = [];
    for (let i = 0; i < sections.length; i++) {
        const section = sections[i];
        const currentPath = `${path}section[${i}]`;
        if (removalRule(section)) {
            state.removedCount++;
            logInfo(
                `Dropping section ${section?.id} from Composition/${compositionUuid} at ${currentPath}`
            );
            continue;
        }
        if (section.section) {
            const removedBefore = state.removedCount;
            section.section = filterSections({
                sections: section.section,
                removalRule,
                compositionUuid,
                path: `${currentPath}.`,
                state,
                stripNarrativeOnRemoval
            });
            if (stripNarrativeOnRemoval && state.removedCount > removedBefore) {
                delete section.text;
            }
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
 * @param {Object} [options]
 * @param {boolean} [options.stripNarrativeOnRemoval] when any section was removed, also delete the
 *  Composition's `text` (and the `text` of every kept section above a removed one). A Composition
 *  narrative is usually generated from its sections, so it can still hold the removed content.
 */
function filterCompositionSections(resource, removalRule, { stripNarrativeOnRemoval = false } = {}) {
    if (!resource?.section) {
        return;
    }
    const state = { removedCount: 0 };
    resource.section = filterSections({
        sections: resource.section,
        removalRule,
        compositionUuid: resource._uuid,
        path: '',
        state,
        stripNarrativeOnRemoval
    });
    if (!resource.section.length) {
        delete resource.section;
    }
    if (stripNarrativeOnRemoval && state.removedCount > 0) {
        delete resource.text;
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

/** the `Type/id` at the end of an absolute reference URL, optionally followed by `/_history/<v>` */
const ABSOLUTE_REFERENCE_TAIL = /\/([A-Z][A-Za-z]*)\/([^/|?#]+)(?:\/_history\/[^/?#]+)?\/?$/;

/**
 * Parses a reference form into its resourceType and id. ReferenceParser leaves an absolute URL
 * (`https://host/fhir/Patient/123`) without a resourceType, so it would never match a hidden id;
 * its trailing `Type/id` is used instead. A URL for another server with the same Type/id also
 * matches, which hides more, never less.
 * @param {string} form
 * @return {{resourceType: string|undefined, id: string}}
 */
function parseEntryReference(form) {
    if (UrlParser.isUrl(form)) {
        const match = ABSOLUTE_REFERENCE_TAIL.exec(form);
        return match ? { resourceType: match[1], id: match[2] } : { resourceType: undefined, id: form };
    }
    return ReferenceParser.parseReference(form);
}

/**
 * Does any entry of this section (not its nested sections, which the walk visits on their own)
 * reference a blocked resource of the same resourceType?
 * @param {Object} section
 * @param {Map<string, Set<string>>} blockedIdSetByType
 * @return {boolean}
 */
function referencesBlockedResource({ section, blockedIdSetByType }) {
    return (section?.entry || []).some((entry) =>
        getEntryReferenceForms(entry).some((form) => {
            const { resourceType, id } = parseEntryReference(form);
            return Boolean(resourceType) && blockedIdSetByType.get(resourceType)?.has(id) === true;
        })
    );
}

/**
 * The hidden ids as sets by resourceType, for filterCompositionBlockedReferenceSections. Build them
 * once and reuse them for every Composition filtered with the same exclude map.
 * @param {Readonly<{[resourceType: string]: ReadonlyArray<string>}>|undefined} excludeMap hidden ids
 *  (uuid or source id) by resourceType, as returned by PatientDataViewControlExclusion
 * @return {Map<string, Set<string>>} empty when nothing is hidden. A Map, not an object: a reference
 *  type such as `constructor` or `__proto__` must look up as "nothing hidden", not as an inherited
 *  Object.prototype member.
 */
function buildBlockedIdSetByType(excludeMap) {
    const blockedIdSetByType = new Map();
    for (const [resourceType, ids] of Object.entries(excludeMap || {})) {
        if (ids?.length) {
            blockedIdSetByType.set(resourceType, new Set(ids));
        }
    }
    return blockedIdSetByType;
}

/**
 * Removes, in place, every Composition section with an entry referencing a resource the
 * dataConnectionViewControl Consent hides. The whole section goes, because its narrative and
 * remaining entries describe the hidden resource; nested sections are judged on their own entries.
 * When anything was removed the Composition's own `text` goes too (and the `text` of a kept section
 * that held a removed one), because those narratives are usually generated from the sections.
 * @param {Object} resource
 * @param {Map<string, Set<string>>} blockedIdSetByType from buildBlockedIdSetByType
 */
function filterCompositionBlockedReferenceSections(resource, blockedIdSetByType) {
    if (blockedIdSetByType.size === 0) {
        return;
    }
    filterCompositionSections(
        resource,
        (section) => referencesBlockedResource({ section, blockedIdSetByType }),
        { stripNarrativeOnRemoval: true }
    );
}

module.exports = {
    filterCompositionSensitiveSections,
    buildBlockedIdSetByType,
    filterCompositionBlockedReferenceSections
};
