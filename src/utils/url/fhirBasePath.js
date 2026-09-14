'use strict';

/**
 * The canonical (internal) FHIR base-version path segment. Every persisted collection name,
 * dynamic `require()` of a versioned FHIR class, and `resolveSchema` lookup is keyed on this
 * value. It must never vary.
 * @type {string}
 */
const CANONICAL_VERSION = '4_0_0';

/**
 * Escapes a string for safe embedding inside a `RegExp` literal.
 * @param {string} value
 * @returns {string}
 */
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * `FhirBasePath` is a small, frozen value object describing which base-version path segment a
 * given request/response is speaking in.
 *
 * - `canonicalVersion` is always `'4_0_0'` - the segment used internally for module/schema/
 *   collection resolution. It is never client-facing content, only ever a request/response path.
 * - `clientSegment` is whichever spelling the *client* used - `'4_0_0'` for an unaliased request,
 *   or e.g. `'fhir/r4'` for an aliased one.
 *
 * `stripVersionSegment` and `toClientPath` are the only two operations every response-URL call
 * site needs: strip the canonical segment off an internal path, then re-prefix with whichever
 * segment the client used. Both are anchored at the start of the string (`^/`) so they only ever
 * touch a *path*, never resource content that happens to contain a `/4_0_0/` substring (e.g.
 * `RESOURCE_HIDDEN_TAG.SYSTEM` in `src/constants.js`).
 */
class FhirBasePath {
    /**
     * @param {Object} params
     * @param {string} params.canonicalVersion
     * @param {string} params.clientSegment
     */
    constructor({ canonicalVersion, clientSegment }) {
        /**
         * @type {string}
         */
        this.canonicalVersion = canonicalVersion;
        /**
         * @type {string}
         */
        this.clientSegment = clientSegment;
        Object.freeze(this);
    }

    /**
     * True when the client used a spelling other than the canonical one.
     * @returns {boolean}
     */
    get isAlias() {
        return this.clientSegment !== this.canonicalVersion;
    }

    /**
     * Strips a leading base-version segment (canonical or, if this is an alias base path, the
     * alias spelling) from a path or absolute URL. Handles four input shapes:
     * - version-relative (`'Patient/1'`) - no segment to strip, returned unchanged
     * - rooted canonical (`'/4_0_0/Patient/1'`)
     * - rooted alias (`'/fhir/r4/Patient/1'`)
     * - absolute URL (`'https://host/4_0_0/Patient/1'`) - only the path portion is touched
     *
     * Never re-encodes or otherwise parses the remainder of the string (in particular the query
     * string), so a token-search value like `?identifier=http://sys|code` survives byte-for-byte.
     * Idempotent - calling this again on its own output is a no-op.
     *
     * @param {string} pathOrUrl
     * @returns {string}
     */
    stripVersionSegment(pathOrUrl) {
        if (typeof pathOrUrl !== 'string' || pathOrUrl.length === 0) {
            return pathOrUrl;
        }

        const schemeMatch = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.exec(pathOrUrl);
        if (schemeMatch) {
            const originEnd = pathOrUrl.indexOf('/', schemeMatch[0].length);
            if (originEnd === -1) {
                // no path segment at all (e.g. 'https://host')
                return pathOrUrl;
            }
            const origin = pathOrUrl.slice(0, originEnd);
            const rest = pathOrUrl.slice(originEnd);
            return origin + this._stripFromRootedPath(rest);
        }

        if (pathOrUrl.startsWith('/')) {
            return this._stripFromRootedPath(pathOrUrl);
        }

        // version-relative: prepend a synthetic leading slash purely to reuse the anchored
        // matcher, then remove it again. If there's no version segment to strip (the common
        // case), this round-trips to the original string.
        return this._stripFromRootedPath(`/${pathOrUrl}`).slice(1);
    }

    /**
     * @param {string} rootedPath a string starting with '/'
     * @returns {string}
     * @private
     */
    _stripFromRootedPath(rootedPath) {
        const canonicalRe = new RegExp(`^/${escapeRegExp(this.canonicalVersion)}(?=/|$)`);
        if (canonicalRe.test(rootedPath)) {
            const stripped = rootedPath.replace(canonicalRe, '');
            return stripped.length === 0 ? '/' : stripped;
        }

        if (this.isAlias) {
            const aliasRe = new RegExp(`^/${escapeRegExp(this.clientSegment)}(?=/|$)`);
            if (aliasRe.test(rootedPath)) {
                const stripped = rootedPath.replace(aliasRe, '');
                return stripped.length === 0 ? '/' : stripped;
            }
        }

        return rootedPath;
    }

    /**
     * Re-prefixes a version-relative path with this base path's client-facing segment.
     * `toClientPath('')` returns the base with no trailing slash (used for `implementation.url`).
     * @param {string} relative
     * @returns {string}
     */
    toClientPath(relative) {
        const rel = relative.startsWith('/') ? relative.slice(1) : relative;
        return rel.length === 0 ? `/${this.clientSegment}` : `/${this.clientSegment}/${rel}`;
    }

    /**
     * The default base path everywhere: both fields are `'4_0_0'`.
     * @returns {FhirBasePath}
     */
    static canonical() {
        return new FhirBasePath({
            canonicalVersion: CANONICAL_VERSION,
            clientSegment: CANONICAL_VERSION
        });
    }
}

module.exports = { FhirBasePath, CANONICAL_VERSION };
