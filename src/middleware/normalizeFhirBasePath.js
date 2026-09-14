'use strict';

const { FhirBasePath } = require('../utils/url/fhirBasePath');

/**
 * Escapes a string for safe embedding inside a `RegExp` literal.
 * @param {string} value
 * @returns {string}
 */
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Attempts to match `url` against a single alias segment (e.g. `'fhir/r4'`), case-insensitively,
 * anchored at the start and bounded so `/fhir/r4x` or `/fhir/r4beta` never match, and a bare
 * `/fhir` (the exact-path OAuth route) never matches either - only the full `/fhir/r4` segment is
 * tested. Preserves everything after the matched prefix verbatim (trailing slash, remaining path,
 * query string) - a splice, not a re-parse.
 * @param {string} url
 * @param {string} aliasSegment
 * @returns {{ rest: string }|null}
 */
const matchAlias = (url, aliasSegment) => {
    const re = new RegExp(`^/${escapeRegExp(aliasSegment)}(?=/|$)`, 'i');
    const match = re.exec(url);
    if (!match) {
        return null;
    }
    return { rest: url.slice(match[0].length) };
};

/**
 * Factory middleware that normalizes an inbound `/fhir/r4/...` request to `/4_0_0/...` before any
 * route matching. Must be mounted as the very first `app.use`, ahead of everything else, so that
 * `base_version` is always the canonical `'4_0_0'` by the time anything else reads the URL.
 *
 * On a match: rewrites both `req.url` and `req.originalUrl` to the canonical spelling, stashes the
 * client's raw request line on `req.clientOriginalUrl`, and stashes a `FhirBasePath` describing
 * the client's spelling on `req.fhirBasePath` (the carrier that response-URL construction later
 * reads via `FhirResponseUrlBuilder.fromRequest`/`fromRequestInfo`).
 *
 * The alias table is a fixed internal constant (`configManager.fhirBasePathAliases`), never
 * operator-supplied - an arbitrary prefix could shadow `/admin`, `/mcp`, `/health` or `/oauth`.
 *
 * @param {Object} params
 * @param {import('../utils/configManager').ConfigManager} params.configManager
 * @returns {import('express').RequestHandler}
 */
const normalizeFhirBasePath = ({ configManager }) => {
    // Read once at createApp time (matching enableMcp/enableGraphQLV2), not per-request - this
    // middleware runs on every single request, so re-reading a getter each time would be wasteful,
    // and the flag is not meant to change without a fresh app/pod anyway.
    const enabled = configManager.enableFhirR4PathAlias;
    const aliases = configManager.fhirBasePathAliases;

    return function normalizeFhirBasePathMiddleware(req, res, next) {
        if (!enabled) {
            return next();
        }

        const clientOriginalUrl = req.originalUrl;

        for (const [aliasSegment, canonicalVersion] of Object.entries(aliases)) {
            const matched = matchAlias(req.url, aliasSegment);
            if (matched) {
                const canonicalUrl = `/${canonicalVersion}${matched.rest}`;
                req.clientOriginalUrl = clientOriginalUrl;
                req.fhirBasePath = new FhirBasePath({
                    canonicalVersion,
                    clientSegment: aliasSegment
                });
                req.url = canonicalUrl;
                req.originalUrl = canonicalUrl;
                return next();
            }
        }

        return next();
    };
};

module.exports = { normalizeFhirBasePath };
