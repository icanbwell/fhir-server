'use strict';

const { FhirBasePath } = require('./fhirBasePath');

/**
 * Matches an absolute URL's scheme, e.g. the `https://` in `https://host/path`.
 * @type {RegExp}
 */
const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;

/**
 * `FhirResponseUrlBuilder` is the single collaborator every response-URL call site uses to turn a
 * version-relative or rooted-canonical path into a client-facing URL, mirroring whichever base
 * path (`/4_0_0` or an alias like `/fhir/r4`) the current request used.
 *
 * Four steps, the only branch in the feature:
 *   1. strip the version segment off the input
 *   2. if `externalUrlPrefix` is set, it wins absolutely: return `${prefix}/${rel}` - byte
 *      identical to the pre-existing `ResourceManager#getFullUrlForResource` external-prefix
 *      branch - and the alias has no effect
 *   3. otherwise, re-prefix with `basePath.toClientPath(rel)`
 *   4. format per `form`: `'absolute'` (protocol + host + path), `'path'` (rooted path only), or
 *      `'relative'` (no leading slash)
 */
class FhirResponseUrlBuilder {
    /**
     * @param {Object} params
     * @param {string} [params.protocol]
     * @param {string} [params.host]
     * @param {FhirBasePath} [params.basePath]
     * @param {string|undefined|null} [params.externalUrlPrefix]
     */
    constructor({ protocol, host, basePath, externalUrlPrefix } = {}) {
        /**
         * @type {string}
         */
        this.protocol = protocol;
        /**
         * @type {string}
         */
        this.host = host;
        /**
         * @type {FhirBasePath}
         */
        this.basePath = basePath || FhirBasePath.canonical();
        /**
         * @type {string|undefined|null}
         */
        this.externalUrlPrefix = externalUrlPrefix;
        Object.freeze(this);
    }

    /**
     * Extracts the version-relative portion of a stripped path/URL - i.e. drops the origin (for
     * an absolute input) and any leading slash.
     * @param {string} strippedPathOrUrl
     * @returns {string}
     * @private
     */
    static _toRelative(strippedPathOrUrl) {
        const schemeMatch = SCHEME_RE.exec(strippedPathOrUrl);
        if (schemeMatch) {
            const originEnd = strippedPathOrUrl.indexOf('/', schemeMatch[0].length);
            const pathPart = originEnd === -1 ? '' : strippedPathOrUrl.slice(originEnd);
            return pathPart.startsWith('/') ? pathPart.slice(1) : pathPart;
        }
        return strippedPathOrUrl.startsWith('/') ? strippedPathOrUrl.slice(1) : strippedPathOrUrl;
    }

    /**
     * @param {string} clientPath a rooted path, e.g. '/4_0_0/Patient/1' or '/fhir/r4/Patient/1'
     * @param {'absolute'|'path'|'relative'} form
     * @returns {string}
     * @private
     */
    _format(clientPath, form) {
        switch (form) {
            case 'path':
                return clientPath;
            case 'relative':
                return clientPath.startsWith('/') ? clientPath.slice(1) : clientPath;
            case 'absolute':
            default:
                return `${this.protocol}://${this.host}${clientPath}`;
        }
    }

    /**
     * Builds a client-facing URL/path from a version-relative path (`'Patient/1'`), a rooted
     * canonical path (`'/4_0_0/Patient/1'`), or an absolute URL (`'https://host/4_0_0/Patient/1'`,
     * e.g. a persisted `ExportStatus.request`).
     * @param {string} pathOrUrl
     * @param {Object} [options]
     * @param {'absolute'|'path'|'relative'} [options.form]
     * @returns {string}
     */
    build(pathOrUrl, { form = 'absolute' } = {}) {
        const stripped = this.basePath.stripVersionSegment(pathOrUrl);
        const rel = FhirResponseUrlBuilder._toRelative(stripped);

        if (this.externalUrlPrefix) {
            return `${this.externalUrlPrefix}/${rel}`;
        }

        const clientPath = this.basePath.toClientPath(rel);
        return this._format(clientPath, form);
    }

    /**
     * Builds a response-URL builder for use in the response-header layer (`fhirResponseWriter`),
     * which has never honoured `externalReqUrlPrefix` and must not start now - only `req.fhirBasePath`,
     * `req.protocol` and `req.get('host')` are used.
     * @param {import('express').Request} req
     * @returns {FhirResponseUrlBuilder}
     */
    static fromRequest(req) {
        return new FhirResponseUrlBuilder({
            protocol: req.protocol,
            host: req.get('host'),
            basePath: req.fhirBasePath || FhirBasePath.canonical()
        });
    }

    /**
     * Builds a response-URL builder from a `FhirRequestInfo`, for use in Bundle/resource
     * construction (`bundleManager`, `resourceManager`), which does honour `externalReqUrlPrefix`.
     * @param {import('./fhirRequestInfo').FhirRequestInfo} requestInfo
     * @returns {FhirResponseUrlBuilder}
     */
    static fromRequestInfo(requestInfo) {
        return new FhirResponseUrlBuilder({
            protocol: requestInfo.protocol,
            host: requestInfo.host,
            basePath: requestInfo.basePath || FhirBasePath.canonical(),
            externalUrlPrefix: requestInfo.externalReqUrlPrefix
        });
    }
}

module.exports = { FhirResponseUrlBuilder };
