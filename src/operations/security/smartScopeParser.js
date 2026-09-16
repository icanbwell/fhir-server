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
 * Whether a legacy binary action ('read'/'write') is satisfied by a parsed scope's CRUDS set.
 * @param {Set<string>|null} cruds
 * @param {string} action 'read'|'write'
 * @return {boolean}
 */
function isActionSatisfiedByCruds (cruds, action) {
    const requiredLetters = V1_ACTION_TO_REQUIRED_CRUDS[action];
    if (!requiredLetters || !cruds) {
        return false;
    }
    for (const letter of requiredLetters) {
        if (cruds.has(letter)) {
            return true;
        }
    }
    return false;
}

module.exports = {
    SCOPE_PREFIXES,
    CRUDS_LETTERS,
    V1_SUFFIX_TO_CRUDS,
    isV1Suffix,
    isV2Suffix,
    normalizeSuffixToCruds,
    parseScopeToken,
    isActionSatisfiedByCruds
};
