const { parseIfMatchVersionIds } = require('../../utils/ifMatchHelper');

/**
 * The `If-Match` and `If-None-Match` headers of a write request, read once into a frozen value.
 * `ifMatchVersionIds` is the normalized `If-Match` version list (`*` stays `'*'`), and
 * `writePrecondition` is what the bulk inserter queues so a replayed write checks `If-Match` again
 * (`null` when no `If-Match` was sent).
 */
class HttpPreconditions {
    /**
     * Reads the request's `if-match` and `if-none-match` headers into a new `HttpPreconditions`.
     * @param {FhirRequestInfo} requestInfo
     * @returns {HttpPreconditions}
     */
    static fromRequestInfo (requestInfo) {
        const headers = requestInfo.headers;
        return new HttpPreconditions({
            ifMatch: headers?.['if-match'],
            ifNoneMatch: headers?.['if-none-match']
        });
    }

    /**
     * Keeps the raw headers, parses `If-Match` into its normalized version list, builds the
     * `writePrecondition` from that list, and freezes the value.
     * @param {string|undefined} ifMatch - the raw `If-Match` header
     * @param {string|undefined} ifNoneMatch - the raw `If-None-Match` header
     */
    constructor ({ ifMatch, ifNoneMatch }) {
        /**
         * @type {string|undefined}
         */
        this.ifMatch = ifMatch;
        /**
         * @type {string[]}
         */
        this.ifMatchVersionIds = Object.freeze(parseIfMatchVersionIds(ifMatch));
        /**
         * @type {string|undefined}
         */
        this.ifNoneMatch = ifNoneMatch;
        /**
         * @type {{ifMatchVersionIds: string[]}|null}
         */
        this.writePrecondition = this.ifMatchVersionIds.length > 0
            ? Object.freeze({ ifMatchVersionIds: this.ifMatchVersionIds })
            : null;
        Object.freeze(this);
    }
}

module.exports = { HttpPreconditions };
