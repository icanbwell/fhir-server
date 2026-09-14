/**
 * Parses SMART on FHIR `patient/`, `user/`, `access/`, and `system/` scope strings, understanding
 * both v1 (`read`/`write`/`*`) and v2 (`cruds`-letter-combination) suffix grammar. See
 * docs/superpowers/specs/2026-09-13-smart-v2-scope-granularity-design.md.
 *
 * Pure module: no I/O, no dependency on ScopesManager/ScopesValidator state.
 */

const SCOPE_PREFIXES = ['patient', 'user', 'access', 'system'];

const CRUDS_LETTERS = ['c', 'r', 'u', 'd', 's'];

/**
 * Spec-fixed v1 suffix -> CRUDS mapping (not invented; see design doc's Architecture table).
 */
const V1_SUFFIX_TO_CRUDS = {
    read: new Set(['r', 's']),
    write: new Set(['c', 'u', 'd']),
    '*': new Set(['c', 'r', 'u', 'd', 's'])
};

/**
 * The reverse direction from V1_SUFFIX_TO_CRUDS: what a legacy binary *action being requested*
 * (the 'read'/'write' literal every call site hardcodes today) requires of a scope's CRUDS set.
 */
const V1_ACTION_TO_REQUIRED_CRUDS = {
    read: new Set(['r']),
    write: new Set(['c', 'u', 'd'])
};

/**
 * @param {string} suffix
 * @return {boolean}
 */
function isV1Suffix (suffix) {
    return Object.prototype.hasOwnProperty.call(V1_SUFFIX_TO_CRUDS, suffix);
}

/**
 * A suffix is valid v2 grammar iff it is a non-empty combination of unique letters drawn from
 * {c, r, u, d, s}.
 * @param {string} suffix
 * @return {boolean}
 */
function isV2Suffix (suffix) {
    if (!suffix) {
        return false;
    }
    const letters = suffix.split('');
    if (new Set(letters).size !== letters.length) {
        return false;
    }
    return letters.every(letter => CRUDS_LETTERS.includes(letter));
}

/**
 * @param {string} suffix
 * @param {boolean} [allowV2] whether v2 (letter-combination) suffix grammar should be recognized.
 *   Callers pass their own ConfigManager-backed feature flag here -- kept as a parameter rather
 *   than a config read so this module stays pure/dependency-free (see file doc comment). When
 *   false, only the legacy v1 suffixes ('read'/'write'/'*') are recognized, matching this
 *   module's original behavior exactly (see docs/superpowers/specs/2026-09-13-smart-v2-scope-granularity-design.md,
 *   "Open items": enabling v2 parsing is a one-way loosening of what scope strings are honored).
 * @return {Set<string>|null} null when the suffix is neither valid v1, nor (when allowed) valid
 *   v2 grammar
 */
function normalizeSuffixToCruds (suffix, allowV2 = true) {
    if (isV1Suffix(suffix)) {
        return V1_SUFFIX_TO_CRUDS[suffix];
    }
    if (allowV2 && isV2Suffix(suffix)) {
        return new Set(suffix.split(''));
    }
    return null;
}

/**
 * Parses a single `<prefix>/<resourceType>.<suffix>` scope token.
 * @param {string} scopeToken
 * @param {boolean} [allowV2] see normalizeSuffixToCruds
 * @return {{prefix: string, resourceType: string, cruds: Set<string>}|null} null when the token
 *   isn't one of the four supported prefixes, or its suffix is malformed
 */
function parseScopeToken (scopeToken, allowV2 = true) {
    if (!scopeToken) {
        return null;
    }
    const slashIndex = scopeToken.indexOf('/');
    if (slashIndex === -1) {
        return null;
    }
    const prefix = scopeToken.slice(0, slashIndex);
    if (!SCOPE_PREFIXES.includes(prefix)) {
        return null;
    }
    const rest = scopeToken.slice(slashIndex + 1);
    const dotIndex = rest.indexOf('.');
    if (dotIndex === -1) {
        return null;
    }
    const resourceType = rest.slice(0, dotIndex);
    if (!resourceType) {
        return null;
    }
    const suffix = rest.slice(dotIndex + 1);
    const cruds = normalizeSuffixToCruds(suffix, allowV2);
    if (!cruds) {
        return null;
    }
    return { prefix, resourceType, cruds };
}

/**
 * Whether any of the requiredCruds letters is present in cruds. The shared primitive behind both
 * the legacy binary action check (isActionSatisfiedByCruds) and the granular per-interaction gate
 * (ScopesValidator, phase 2).
 * @param {Set<string>|null} cruds
 * @param {Set<string>|null} requiredCruds
 * @return {boolean}
 */
function isCrudsRequirementSatisfied (cruds, requiredCruds) {
    if (!cruds || !requiredCruds) {
        return false;
    }
    for (const letter of requiredCruds) {
        if (cruds.has(letter)) {
            return true;
        }
    }
    return false;
}

/**
 * Whether a legacy binary action ('read'/'write') is satisfied by a parsed scope's CRUDS set.
 * @param {Set<string>|null} cruds
 * @param {string} action 'read'|'write'
 * @return {boolean}
 */
function isActionSatisfiedByCruds (cruds, action) {
    return isCrudsRequirementSatisfied(cruds, V1_ACTION_TO_REQUIRED_CRUDS[action]);
}

/**
 * Normalizes an `accessRequested` value -- either a legacy 'read'/'write' literal or a single v2
 * CRUDS letter -- into the set of letters that satisfy it.
 * @param {string} accessRequested 'read'|'write'|'c'|'r'|'u'|'d'|'s'
 * @return {Set<string>|null} null when accessRequested is neither
 */
function getRequiredCrudsForAccessRequested (accessRequested) {
    if (V1_ACTION_TO_REQUIRED_CRUDS[accessRequested]) {
        return V1_ACTION_TO_REQUIRED_CRUDS[accessRequested];
    }
    if (CRUDS_LETTERS.includes(accessRequested)) {
        return new Set([accessRequested]);
    }
    return null;
}

/**
 * Whether accessRequested (legacy or granular) is a read-type requirement -- every letter it
 * requires is drawn from {r, s}. Used by ScopesValidator's patient-scope write restriction, which
 * must block only genuinely mutating requests, not every non-'read' granular interaction (e.g. a
 * type-level search, letter 's', is not a write).
 * @param {string} accessRequested
 * @return {boolean}
 */
function isReadOnlyAccessRequested (accessRequested) {
    const requiredCruds = getRequiredCrudsForAccessRequested(accessRequested);
    if (!requiredCruds || requiredCruds.size === 0) {
        return false;
    }
    for (const letter of requiredCruds) {
        if (letter !== 'r' && letter !== 's') {
            return false;
        }
    }
    return true;
}

/**
 * Maps a FHIR interaction name (the `action` value every call site already threads through to
 * ScopesValidator, historically only for logging) to the single CRUDS letter it actually
 * requires. Spec-fixed per the design doc's Architecture table; deliberately does NOT include
 * `graph` (its action name is reused for both a search-type read and a delete-driven write, so it
 * cannot be reduced to one fixed letter) nor any interaction not analyzed by the design doc
 * (merge, import, export, exportById, validate, $access-history) -- those keep using the legacy
 * `accessRequested` ('read'/'write') a call site passes explicitly.
 */
const INTERACTION_TO_CRUDS_LETTER = {
    create: 'c',
    update: 'u',
    patch: 'u',
    remove: 'd',
    searchById: 'r',
    searchByVersionId: 'r',
    historyById: 'r',
    history: 's',
    search: 's',
    searchStreaming: 's',
    everything: 's',
    summary: 's',
    expand: 's'
};

/**
 * @param {string|undefined} interaction
 * @return {string|null} the required CRUDS letter, or null when the interaction isn't in the
 *   table and the caller should fall back to its own accessRequested value
 */
function getInteractionCrudsLetter (interaction) {
    return INTERACTION_TO_CRUDS_LETTER[interaction] || null;
}

module.exports = {
    SCOPE_PREFIXES,
    CRUDS_LETTERS,
    V1_SUFFIX_TO_CRUDS,
    INTERACTION_TO_CRUDS_LETTER,
    isV1Suffix,
    isV2Suffix,
    normalizeSuffixToCruds,
    parseScopeToken,
    isActionSatisfiedByCruds,
    isCrudsRequirementSatisfied,
    getRequiredCrudsForAccessRequested,
    isReadOnlyAccessRequested,
    getInteractionCrudsLetter
};
