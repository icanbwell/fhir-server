/**
 * Helpers for interpreting FHIR R4 `Person.link.assurance`, the match-confidence field for a
 * link, bound to the `identity-assuranceLevel` ValueSet: `level1` (algorithmic match only) <
 * `level2` (validated) < `level3` (validated with verification) < `level4` (level 3 + additional
 * consent).
 *
 * These are pure, side-effect-free helpers with no dependency on ConfigManager or any other
 * service, so they can be unit tested in isolation and reused by both the dry-run logging and
 * the enforcement gate in personToPatientIdsExpander.js.
 */

/**
 * Ordered rank (1-4) for each recognized `identity-assuranceLevel` code. Any value not present
 * here (including missing/null/empty/unrecognized) ranks 0 -- "missing" must never be treated as
 * "trusted".
 * @type {{[key: string]: number}}
 */
const ASSURANCE_LEVEL_RANK = {
    level1: 1,
    level2: 2,
    level3: 3,
    level4: 4
};

/**
 * Returns the ordered rank of a `Person.link.assurance` value.
 * @param {string|undefined|null} assurance
 * @return {number} 0 for missing/unrecognized values, 1-4 for `level1`-`level4`
 */
function rankPersonLinkAssurance (assurance) {
    if (!assurance) {
        return 0;
    }
    return ASSURANCE_LEVEL_RANK[assurance] || 0;
}

/**
 * Returns whether a `Person.link.assurance` value meets (is at or above) a configured minimum
 * level. A missing/unrecognized assurance ranks 0, so it never meets any configured minimum.
 * @typedef meetsMinimumAssuranceArgs
 * @property {string|undefined|null} assurance
 * @property {string} minimumLevel
 * @param {meetsMinimumAssuranceArgs}
 * @return {boolean}
 */
function meetsMinimumAssurance ({ assurance, minimumLevel }) {
    return rankPersonLinkAssurance(assurance) >= rankPersonLinkAssurance(minimumLevel);
}

module.exports = {
    rankPersonLinkAssurance,
    meetsMinimumAssurance
};
