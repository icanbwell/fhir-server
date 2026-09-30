'use strict';

// Shared by CompositionLatestVersionTransform (search) and everythingHelper ($everything) so both
// code paths dedup the two-generator Composition duplicate the same way.

/**
 * @param {Resource} resource
 * @param {import('../../utils/configManager').ConfigManager} configManager
 * @returns {boolean}
 */
function isEligibleForCompositionLatestVersionDedup (resource, configManager) {
    const source = resource?.meta?.source;
    if (resource?.resourceType !== 'Composition' || !source) {
        return false;
    }
    return configManager.compositionLatestVersionSources.includes(source);
}

/**
 * @param {Resource} resource
 * @returns {string|null}
 */
function compositionGroupKey (resource) {
    const subjectReference = resource?.subject?.reference;
    const typeCode = resource?.type?.coding?.[0]?.code;
    if (!subjectReference || !typeCode) {
        return null;
    }
    return `${subjectReference}|${typeCode}`;
}

/**
 * @param {Resource} candidate
 * @param {Resource} existing
 * @returns {boolean}
 */
function isNewerComposition (candidate, existing) {
    const existingLastUpdated = new Date(existing?.meta?.lastUpdated || 0).getTime();
    const candidateLastUpdated = new Date(candidate?.meta?.lastUpdated || 0).getTime();
    return candidateLastUpdated >= existingLastUpdated;
}

module.exports = {
    isEligibleForCompositionLatestVersionDedup,
    compositionGroupKey,
    isNewerComposition
};
